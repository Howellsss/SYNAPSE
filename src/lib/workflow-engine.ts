import { supabase } from '@/lib/supabase';
import type { Workflow, WorkflowNode, Contact, Appointment } from '@/types';

interface WorkflowContext {
  contact?: Contact;
  appointment?: Appointment;
  formSubmission?: { id: string; answers: Record<string, string> };
  [key: string]: unknown;
}

/**
 * Server-side workflow execution engine.
 * Executes workflow nodes in order, recording logs for each step.
 */
export class WorkflowEngine {
  /**
   * Trigger workflows matching an event type.
   */
  static async trigger(
    workspaceId: string | null,
    triggerType: string,
    context: WorkflowContext
  ): Promise<void> {
    if (!workspaceId) return;

    const { data: workflows } = await supabase
      .from('workflows')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .eq('trigger_type', triggerType);

    if (!workflows || workflows.length === 0) return;

    for (const workflow of workflows) {
      await this.executeWorkflow(workflow as unknown as Workflow, workspaceId, context);
    }
  }

  /**
   * Execute a single workflow.
   */
  static async executeWorkflow(
    workflow: Workflow,
    workspaceId: string,
    context: WorkflowContext
  ): Promise<void> {
    // Create execution record
    const { data: execution } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: workflow.id,
        contact_id: context.contact?.id ?? null,
        appointment_id: context.appointment?.id ?? null,
        status: 'running',
        current_node_index: 0,
        context: context as unknown as Record<string, unknown>,
      })
      .select()
      .single();

    if (!execution) return;

    // Get workflow nodes
    const { data: nodes } = await supabase
      .from('workflow_nodes')
      .select('*')
      .eq('workflow_id', workflow.id)
      .order('sort_order');

    if (!nodes || nodes.length === 0) {
      await supabase
        .from('workflow_executions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', execution.id);
      return;
    }

    // Execute each node
    let success = true;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as unknown as WorkflowNode;

      const { data: log } = await supabase
        .from('workflow_execution_logs')
        .insert({
          execution_id: execution.id,
          node_id: node.id,
          node_type: node.node_type,
          action_type: node.action_type,
          status: 'pending',
        })
        .select()
        .single();

      try {
        const result = await this.executeNode(node, workspaceId, context);

        await supabase
          .from('workflow_execution_logs')
          .update({
            status: result.success ? 'success' : 'failed',
            result: result.data as Record<string, unknown>,
            error: result.error ?? null,
            executed_at: new Date().toISOString(),
          })
          .eq('id', log?.id);

        if (!result.success) {
          success = false;
          break;
        }

        // Update execution progress
        await supabase
          .from('workflow_executions')
          .update({ current_node_index: i + 1 })
          .eq('id', execution.id);
      } catch (err) {
        await supabase
          .from('workflow_execution_logs')
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
            executed_at: new Date().toISOString(),
          })
          .eq('id', log?.id);
        success = false;
        break;
      }
    }

    // Mark execution as complete
    await supabase
      .from('workflow_executions')
      .update({
        status: success ? 'completed' : 'failed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', execution.id);

    // Update workflow run count
    try {
      await supabase.rpc('increment_workflow_runs', { workflow_id: workflow.id });
    } catch {
      // Fallback: manual update
      await supabase
        .from('workflows')
        .update({
          total_runs: workflow.total_runs + 1,
          last_run_at: new Date().toISOString(),
        })
        .eq('id', workflow.id);
    }
  }

  /**
   * Execute a single workflow node.
   */
  static async executeNode(
    node: WorkflowNode,
    workspaceId: string,
    context: WorkflowContext
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (node.node_type === 'delay') {
      const minutes = (node.config.minutes as number) || 0;
      // For immediate execution, we just note the delay but don't actually wait
      // In a production system, this would schedule a delayed job
      return { success: true, data: { delayed_minutes: minutes } };
    }

    if (node.node_type === 'condition') {
      // Evaluate condition
      const field = node.config.field as string;
      const operator = node.config.operator as string;
      const value = node.config.value as string;

      const contactValue = this.getContextValue(context, field);
      let matches = false;
      if (operator === 'equals') matches = String(contactValue) === value;
      if (operator === 'contains') matches = String(contactValue ?? '').includes(value);
      if (operator === 'not_equals') matches = String(contactValue) !== value;

      return { success: true, data: { condition_met: matches } };
    }

    if (node.node_type === 'action') {
      return this.executeAction(node, workspaceId, context);
    }

    return { success: false, error: 'Unknown node type' };
  }

  /**
   * Execute a workflow action.
   */
  static async executeAction(
    node: WorkflowNode,
    workspaceId: string,
    context: WorkflowContext
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const actionType = node.action_type;
    const config = node.config;

    switch (actionType) {
      case 'add_tag': {
        const tagName = config.tag as string;
        if (!context.contact || !tagName) return { success: false, error: 'Missing contact or tag' };

        const { data: tag } = await supabase
          .from('tags')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('name', tagName)
          .maybeSingle();

        if (!tag) return { success: false, error: 'Tag not found' };

        await supabase.from('contact_tags').upsert({
          contact_id: context.contact.id,
          tag_id: tag.id,
        });

        return { success: true, data: { tag: tagName } };
      }

      case 'remove_tag': {
        const tagName = config.tag as string;
        if (!context.contact || !tagName) return { success: false, error: 'Missing contact or tag' };

        const { data: tag } = await supabase
          .from('tags')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('name', tagName)
          .maybeSingle();

        if (!tag) return { success: true, data: { tag_not_found: true } };

        await supabase
          .from('contact_tags')
          .delete()
          .eq('contact_id', context.contact.id)
          .eq('tag_id', tag.id);

        return { success: true, data: { removed_tag: tagName } };
      }

      case 'send_email': {
        if (!context.contact) return { success: false, error: 'Missing contact' };
        const subject = this.replaceVariables(config.subject as string, context);
        const body = this.replaceVariables(config.body as string, context);

        const { error } = await supabase.from('messages').insert({
          workspace_id: workspaceId,
          contact_id: context.contact.id,
          appointment_id: context.appointment?.id ?? null,
          channel: 'email',
          direction: 'outbound',
          subject,
          body,
          status: 'queued',
        });

        if (error) return { success: false, error: error.message };
        return { success: true, data: { channel: 'email', subject } };
      }

      case 'send_sms': {
        if (!context.contact) return { success: false, error: 'Missing contact' };
        const body = this.replaceVariables(config.body as string, context);

        const { error } = await supabase.from('messages').insert({
          workspace_id: workspaceId,
          contact_id: context.contact.id,
          appointment_id: context.appointment?.id ?? null,
          channel: 'sms',
          direction: 'outbound',
          body,
          status: 'queued',
        });

        if (error) return { success: false, error: error.message };
        return { success: true, data: { channel: 'sms' } };
      }

      case 'add_note': {
        if (!context.contact) return { success: false, error: 'Missing contact' };
        const content = this.replaceVariables(config.content as string, context);

        const { error } = await supabase.from('notes').insert({
          workspace_id: workspaceId,
          contact_id: context.contact.id,
          appointment_id: context.appointment?.id ?? null,
          content,
        });

        if (error) return { success: false, error: error.message };
        return { success: true, data: { note: content } };
      }

      case 'update_contact': {
        if (!context.contact) return { success: false, error: 'Missing contact' };
        const updates = config.updates as Record<string, string>;

        const { error } = await supabase
          .from('contacts')
          .update(updates)
          .eq('id', context.contact.id);

        if (error) return { success: false, error: error.message };
        return { success: true, data: { updated: Object.keys(updates) } };
      }

      case 'send_webhook': {
        const url = config.url as string;
        if (!url) return { success: false, error: 'Missing webhook URL' };

        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'workflow_action',
              contact: context.contact,
              appointment: context.appointment,
            }),
          });
          return { success: true, data: { webhook_sent: true } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Webhook failed' };
        }
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  }

  /**
   * Replace template variables in a string.
   */
  static replaceVariables(text: string, context: WorkflowContext): string {
    if (!text) return '';
    let result = text;
    const contact = context.contact;
    const appt = context.appointment;

    if (contact) {
      result = result.replace(/\{\{first_name\}\}/g, contact.first_name || '');
      result = result.replace(/\{\{last_name\}\}/g, contact.last_name || '');
      result = result.replace(/\{\{email\}\}/g, contact.email || '');
      result = result.replace(/\{\{phone\}\}/g, contact.phone || '');
      result = result.replace(/\{\{company\}\}/g, contact.company || '');
    }

    if (appt) {
      result = result.replace(/\{\{appointment_date\}\}/g, new Date(appt.start_time).toLocaleDateString());
      result = result.replace(/\{\{appointment_time\}\}/g, new Date(appt.start_time).toLocaleTimeString());
      result = result.replace(/\{\{meeting_link\}\}/g, appt.meeting_link || '');
    }

    return result;
  }

  /**
   * Get a value from context by field name.
   */
  static getContextValue(context: WorkflowContext, field: string): unknown {
    const contact = context.contact;
    if (!contact) return null;
    if (field === 'tag') return null; // handled separately
    if (field in contact) return (contact as unknown as Record<string, unknown>)[field];
    return null;
  }
}
