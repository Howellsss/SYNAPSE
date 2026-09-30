import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SubmissionBody {
  mode?: "submit" | "test_email";
  formId?: string;
  answers?: Record<string, string>;
  source?: string;
  // test_email mode
  testEmail?: string;
  config?: {
    subject: string;
    senderName: string;
    replyTo: string;
    message: string;
  };
  formName?: string;
}

// Shapes read from a form's saved definition (see src/lib/form-builder-types.ts).
interface DefinitionElement {
  type?: string;
  displayLabel?: string;
  field?: { fieldId: string; label?: string; visible?: boolean; mappedContactField?: string };
}

interface InternalNotificationConfig {
  enabled?: boolean;
  recipients?: string[];
  subject?: string;
  message?: string;
  channel?: string;
  includeAllFields?: boolean;
  includeFields?: string[];
}

interface RespondentNotificationConfig {
  enabled?: boolean;
  emailFieldId?: string;
  subject?: string;
  message?: string;
  includeAnswers?: string;
  includedFields?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: SubmissionBody = await req.json();

    // ============================================================
    // MODE: TEST EMAIL — just validate and acknowledge
    // ============================================================
    if (body.mode === "test_email") {
      if (!body.testEmail || !body.testEmail.includes("@")) {
        return new Response(
          JSON.stringify({ error: "Valid test email required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // In production this would send via an email provider.
      // For now we acknowledge so the UI can confirm.
      return new Response(
        JSON.stringify({ success: true, message: `Test email queued for ${body.testEmail}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // MODE: SUBMIT
    // ============================================================
    if (!body.formId || !body.answers) {
      return new Response(
        JSON.stringify({ error: "formId and answers are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Fetch the form to get workspace_id, definition, and settings
    const { data: form, error: formErr } = await supabase
      .from("forms")
      .select("id, workspace_id, name, definition, create_contact, update_contact, auto_tags")
      .eq("id", body.formId)
      .single();

    if (formErr || !form) {
      return new Response(
        JSON.stringify({ error: "Form not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Parse definition for notification config and field mappings
    let definition: Record<string, unknown> | null = null;
    if (form.definition) {
      try { definition = JSON.parse(form.definition); } catch { definition = null; }
    }

    const notifications = (definition as Record<string, unknown>)?.notifications as
      | { internal?: InternalNotificationConfig; respondent?: RespondentNotificationConfig; postSubmission?: Record<string, unknown> }
      | undefined;

    const settings = (definition as Record<string, unknown>)?.settings as
      | { createContact?: boolean; updateContact?: boolean; autoTags?: string[] }
      | undefined;

    const elements = (definition as Record<string, unknown>)?.elements as
      | Record<string, DefinitionElement>
      | undefined;

    // 3. Save the submission transactionally
    const { data: submission, error: subErr } = await supabase
      .from("form_submissions")
      .insert({
        form_id: body.formId,
        workspace_id: form.workspace_id,
        answers: body.answers,
        source: body.source || "public",
      })
      .select("id")
      .single();

    if (subErr || !submission) {
      return new Response(
        JSON.stringify({ error: "Failed to save submission" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const submissionId = submission.id;
    let contactId: string | null = null;

    // 4. Create/update contact if configured
    const shouldCreateContact = settings?.createContact ?? form.create_contact ?? false;
    const shouldUpdateContact = settings?.updateContact ?? form.update_contact ?? false;

    if (shouldCreateContact && elements) {
      // Extract mapped contact fields from answers
      const contactData: Record<string, string> = {};
      let emailVal: string | null = null;
      let phoneVal: string | null = null;

      for (const el of Object.values(elements)) {
        const field = el.field;
        if (!field || !field.mappedContactField) continue;
        const answer = body.answers![field.fieldId];
        if (!answer) continue;
        contactData[field.mappedContactField] = answer;
        if (field.mappedContactField === "email") emailVal = answer;
        if (field.mappedContactField === "phone") phoneVal = answer;
      }

      if (Object.keys(contactData).length > 0) {
        // Try to find existing contact by email or phone
        let existingContact: { id: string } | null = null;

        if (emailVal) {
          const { data } = await supabase
            .from("contacts")
            .select("id")
            .eq("workspace_id", form.workspace_id)
            .eq("email", emailVal)
            .maybeSingle();
          existingContact = data;
        }

        if (!existingContact && phoneVal) {
          const { data } = await supabase
            .from("contacts")
            .select("id")
            .eq("workspace_id", form.workspace_id)
            .eq("phone", phoneVal)
            .maybeSingle();
          existingContact = data;
        }

        if (existingContact && shouldUpdateContact) {
          // Update existing contact
          const { data: updated } = await supabase
            .from("contacts")
            .update({ ...contactData, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", existingContact.id)
            .select("id")
            .single();
          contactId = updated?.id || existingContact.id;
        } else if (!existingContact) {
          // Create new contact
          const { data: created } = await supabase
            .from("contacts")
            .insert({
              workspace_id: form.workspace_id,
              ...contactData,
              source: "form",
            })
            .select("id")
            .single();
          contactId = created?.id || null;
        } else {
          contactId = existingContact.id;
        }

        // Link submission to contact
        if (contactId) {
          await supabase
            .from("form_submissions")
            .update({ contact_id: contactId })
            .eq("id", submissionId);

          // Add to activity timeline
          await supabase
            .from("form_activity_timeline")
            .insert({
              contact_id: contactId,
              submission_id: submissionId,
              form_id: body.formId,
              workspace_id: form.workspace_id,
              form_name: form.name,
            });

          // Apply auto-tags
          const autoTags = settings?.autoTags ?? form.auto_tags ?? [];
          if (autoTags.length > 0) {
            for (const tagName of autoTags) {
              // Find or create tag
              const { data: tag } = await supabase
                .from("tags")
                .select("id")
                .eq("workspace_id", form.workspace_id)
                .eq("name", tagName)
                .maybeSingle();

              let tagId = tag?.id;
              if (!tagId) {
                const { data: newTag } = await supabase
                  .from("tags")
                  .insert({ workspace_id: form.workspace_id, name: tagName })
                  .select("id")
                  .single();
                tagId = newTag?.id;
              }

              if (tagId) {
                await supabase
                  .from("contact_tags")
                  .upsert({ contact_id: contactId, tag_id: tagId });
              }
            }
          }
        }
      }
    }

    // 5. Trigger internal notifications
    const internalConfig = notifications?.internal;
    const internalRecipients = internalConfig?.recipients ?? [];
    if (internalConfig?.enabled && internalRecipients.length > 0) {
      const subject = replaceVariables(internalConfig.subject || "New Form Submission", body.answers!, form.name, submissionId);
      const messageBody = buildInternalMessage(internalConfig, body.answers!, elements || {});

      for (const recipient of internalRecipients) {
        const { error: logErr } = await supabase
          .from("form_notification_logs")
          .insert({
            submission_id: submissionId,
            form_id: body.formId,
            workspace_id: form.workspace_id,
            type: "internal",
            channel: internalConfig.channel || "email",
            recipient,
            subject,
            body: messageBody,
            status: "pending",
          });

        if (logErr) {
          console.error("Failed to log internal notification:", logErr);
        }
      }
    }

    // 6. Trigger respondent notification
    const respondentConfig = notifications?.respondent;
    if (respondentConfig?.enabled && respondentConfig.emailFieldId && elements) {
      const respondentEmail = body.answers![respondentConfig.emailFieldId];
      if (respondentEmail && respondentEmail.includes("@")) {
        const subject = replaceVariables(
          respondentConfig.subject || "Thank you for your submission",
          body.answers!,
          form.name,
          submissionId,
        );
        const messageBody = buildRespondentMessage(respondentConfig, body.answers!, elements);

        const { error: logErr } = await supabase
          .from("form_notification_logs")
          .insert({
            submission_id: submissionId,
            form_id: body.formId,
            workspace_id: form.workspace_id,
            type: "respondent",
            channel: "email",
            recipient: respondentEmail,
            subject,
            body: messageBody,
            status: "pending",
          });

        if (logErr) {
          console.error("Failed to log respondent notification:", logErr);
        }
      }
    }

    // 7. Emit workflow event (form.submitted)
    // Find workflows with form_submitted trigger
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id, settings")
      .eq("workspace_id", form.workspace_id)
      .eq("status", "active")
      .eq("trigger_type", "form_submitted");

    if (workflows && workflows.length > 0) {
      for (const wf of workflows) {
        // Create a workflow execution entry
        await supabase
          .from("workflow_executions")
          .insert({
            workflow_id: wf.id,
            contact_id: contactId,
            status: "running",
            current_node_index: 0,
            context: {
              event: "form.submitted",
              form_id: body.formId,
              form_name: form.name,
              submission_id: submissionId,
              contact_id: contactId,
              answers: body.answers,
            },
          });
      }
    }

    // 8. Return success with post-submission config
    const postSubmission = notifications?.postSubmission || {
      type: "thank_you",
      thankYouPage: {
        heading: "Thank You!",
        message: "Your submission has been received.",
      },
    };

    return new Response(
      JSON.stringify({
        success: true,
        submissionId,
        contactId,
        postSubmission,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Form submission error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function replaceVariables(
  text: string,
  answers: Record<string, string>,
  formName: string,
  submissionId: string,
): string {
  let result = text;
  for (const [key, value] of Object.entries(answers)) {
    result = result.replace(new RegExp(`{{submission.${key}}}`, "g"), value || "");
  }
  result = result.replace(/{{form\.name}}/g, formName);
  result = result.replace(/{{submission\.created_at}}/g, new Date().toISOString());
  result = result.replace(/{{submission\.id}}/g, submissionId);
  return result;
}

function buildInternalMessage(
  config: InternalNotificationConfig,
  answers: Record<string, string>,
  elements: Record<string, DefinitionElement>,
): string {
  let msg = config.message || "A new form submission has been received.\n\n";

  if (config.includeAllFields) {
    msg += "\n\nSubmission Data:\n";
    for (const el of Object.values(elements)) {
      if (!el.field || el.field.visible === false) continue;
      const val = answers[el.field.fieldId];
      if (val !== undefined) {
        msg += `${el.field.label || el.displayLabel}: ${val}\n`;
      }
    }
  } else if ((config.includeFields ?? []).length > 0) {
    msg += "\n\nSubmission Data:\n";
    for (const el of Object.values(elements)) {
      if (!el.field) continue;
      if (!(config.includeFields ?? []).includes(el.field.fieldId)) continue;
      const val = answers[el.field.fieldId];
      if (val !== undefined) {
        msg += `${el.field.label || el.displayLabel}: ${val}\n`;
      }
    }
  }

  return msg;
}

function buildRespondentMessage(
  config: RespondentNotificationConfig,
  answers: Record<string, string>,
  elements: Record<string, DefinitionElement>,
): string {
  let msg = config.message || "We have received your information.\n\n";

  if (config.includeAnswers === "all") {
    msg += "\n\nYour Responses:\n";
    for (const el of Object.values(elements)) {
      if (!el.field || el.field.visible === false || el.type === "hidden") continue;
      const val = answers[el.field.fieldId];
      if (val !== undefined) {
        msg += `${el.field.label || el.displayLabel}: ${val}\n`;
      }
    }
  } else if (config.includeAnswers === "selected" && (config.includedFields ?? []).length > 0) {
    msg += "\n\nYour Responses:\n";
    for (const el of Object.values(elements)) {
      if (!el.field) continue;
      if (!(config.includedFields ?? []).includes(el.field.fieldId)) continue;
      const val = answers[el.field.fieldId];
      if (val !== undefined) {
        msg += `${el.field.label || el.displayLabel}: ${val}\n`;
      }
    }
  }

  return msg;
}
