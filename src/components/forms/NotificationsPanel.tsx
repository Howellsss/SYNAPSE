import { useState } from 'react';
import {
  Bell, Mail, MessageSquare, Send, ChevronDown, ChevronRight,
  Plus, X, AlertCircle, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import type {
  FormDefinition, FormNotifications,
  InternalNotification, RespondentNotification, PostSubmissionConfig,
  ThankYouPage, PostSubmissionType,
} from '@/lib/form-builder-types';

interface Props {
  definition: FormDefinition;
  formName: string;
  onUpdateNotifications: (updates: Partial<FormNotifications>) => void;
}

export function NotificationsPanel({ definition, formName, onUpdateNotifications }: Props) {
  const [openSection, setOpenSection] = useState<string | null>('internal');

  const toggle = (section: string) => setOpenSection(openSection === section ? null : section);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full p-8 space-y-4">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-navy-800">Notifications</h2>
          <p className="text-sm text-ivory-600 mt-1">
            Configure what happens when {formName} receives a submission.
          </p>
        </div>

        <CollapsibleSection
          id="internal"
          title="Internal Notifications"
          subtitle="Notify your team when a form is submitted"
          icon={Bell}
          isOpen={openSection === 'internal'}
          onToggle={toggle}
        >
          <InternalNotificationEditor
            config={definition.notifications.internal}
            definition={definition}
            onChange={(updates) => onUpdateNotifications({ internal: { ...definition.notifications.internal, ...updates } })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="respondent"
          title="Respondent Notifications"
          subtitle="Send a confirmation email to the person who submitted"
          icon={Mail}
          isOpen={openSection === 'respondent'}
          onToggle={toggle}
        >
          <RespondentNotificationEditor
            config={definition.notifications.respondent}
            definition={definition}
            formName={formName}
            onChange={(updates) => onUpdateNotifications({ respondent: { ...definition.notifications.respondent, ...updates } })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="postSubmission"
          title="Post-Submission Experience"
          subtitle="What respondents see after they submit"
          icon={Send}
          isOpen={openSection === 'postSubmission'}
          onToggle={toggle}
        >
          <PostSubmissionEditor
            config={definition.notifications.postSubmission}
            onChange={(updates) => onUpdateNotifications({ postSubmission: { ...definition.notifications.postSubmission, ...updates } })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="workflow"
          title="Workflow Trigger"
          subtitle="Emit events to the SYNAPSE Workflow engine"
          icon={MessageSquare}
          isOpen={openSection === 'workflow'}
          onToggle={toggle}
        >
          <WorkflowInfo />
        </CollapsibleSection>
      </div>
    </div>
  );
}

// ============================================================
// COLLAPSIBLE SECTION
// ============================================================

function CollapsibleSection({
  id, title, subtitle, icon: Icon, isOpen, onToggle, children,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: typeof Bell;
  isOpen: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-navy-100 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 p-4 hover:bg-ivory-50 transition-colors"
      >
        <div className="w-9 h-9 rounded-lg bg-ivory-100 flex items-center justify-center text-ivory-600 shrink-0">
          <Icon className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-semibold text-navy-800">{title}</p>
          <p className="text-xs text-ivory-500 truncate">{subtitle}</p>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-ivory-400" /> : <ChevronRight className="w-4 h-4 text-ivory-400" />}
      </button>
      {isOpen && <div className="px-4 pb-4 pt-2 space-y-4 border-t border-sand">{children}</div>}
    </div>
  );
}

// ============================================================
// INTERNAL NOTIFICATION EDITOR
// ============================================================

function InternalNotificationEditor({
  config, definition, onChange,
}: {
  config: InternalNotification;
  definition: FormDefinition;
  onChange: (updates: Partial<InternalNotification>) => void;
}) {
  const [recipientInput, setRecipientInput] = useState('');

  const addRecipient = () => {
    const email = recipientInput.trim();
    if (!email) return;
    if (config.recipients.includes(email)) return;
    onChange({ recipients: [...config.recipients, email] });
    setRecipientInput('');
  };

  const removeRecipient = (email: string) => {
    onChange({ recipients: config.recipients.filter(r => r !== email) });
  };

  return (
    <>
      <ToggleRow
        label="Enable internal notifications"
        checked={config.enabled}
        onChange={v => onChange({ enabled: v })}
      />

      {config.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Delivery channel</label>
            <div className="grid grid-cols-3 gap-2">
              {(['email', 'in_app', 'both'] as const).map(ch => (
                <button
                  key={ch}
                  onClick={() => onChange({ channel: ch })}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                    config.channel === ch
                      ? 'border-gold-400 bg-gold-50 text-navy-800'
                      : 'border-navy-100 text-ivory-600 hover:bg-ivory-50'
                  )}
                >
                  {ch === 'email' ? 'Email' : ch === 'in_app' ? 'In-App' : 'Both'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Recipients</label>
            <div className="flex gap-2">
              <input
                className="input-field flex-1 text-sm"
                placeholder="email@example.com"
                value={recipientInput}
                onChange={e => setRecipientInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
              />
              <button onClick={addRecipient} className="btn-secondary btn-sm shrink-0">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            {config.recipients.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {config.recipients.map(email => (
                  <span key={email} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-ivory-100 text-xs text-navy-700">
                    {email}
                    <button onClick={() => removeRecipient(email)} className="text-ivory-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Subject</label>
            <input
              className="input-field text-sm"
              value={config.subject}
              onChange={e => onChange({ subject: e.target.value })}
              placeholder="New Form Submission"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Message</label>
            <textarea
              className="input-field text-sm min-h-[80px] resize-y"
              value={config.message}
              onChange={e => onChange({ message: e.target.value })}
              placeholder="A new form submission has been received."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Included submission data</label>
            <ToggleRow
              label="Include all fields"
              checked={config.includeAllFields}
              onChange={v => onChange({ includeAllFields: v })}
            />
            {!config.includeAllFields && (
              <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                {Object.values(definition.elements)
                  .filter(el => el.field && el.field.visible !== false)
                  .map(el => {
                    const fieldId = el.field!.fieldId;
                    const checked = config.includeFields.includes(fieldId);
                    return (
                      <label key={el.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ivory-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...config.includeFields, fieldId]
                              : config.includeFields.filter(f => f !== fieldId);
                            onChange({ includeFields: next });
                          }}
                          className="rounded border-navy-200 text-gold-500 focus:ring-gold-400"
                        />
                        <span className="text-sm text-navy-700">{el.field!.label || el.displayLabel}</span>
                      </label>
                    );
                  })}
              </div>
            )}
          </div>

          <DynamicVariablesHint />
        </>
      )}
    </>
  );
}

// ============================================================
// RESPONDENT NOTIFICATION EDITOR
// ============================================================

function RespondentNotificationEditor({
  config, definition, formName, onChange,
}: {
  config: RespondentNotification;
  definition: FormDefinition;
  formName: string;
  onChange: (updates: Partial<RespondentNotification>) => void;
}) {
  const { toast } = useToast();
  const emailFields = Object.values(definition.elements).filter(el => el.type === 'email' && el.field);

  return (
    <>
      <ToggleRow
        label="Enable respondent confirmation email"
        checked={config.enabled}
        onChange={v => onChange({ enabled: v })}
      />

      {config.enabled && (
        <>
          {emailFields.length === 0 ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-700">Add an email field to your form to enable respondent notifications.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Email field</label>
                <select
                  className="input-field text-sm"
                  value={config.emailFieldId || ''}
                  onChange={e => onChange({ emailFieldId: e.target.value || null })}
                >
                  <option value="">Select an email field</option>
                  {emailFields.map(el => (
                    <option key={el.id} value={el.field!.fieldId}>{el.field!.label || el.displayLabel}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1.5">Sender name</label>
                  <input
                    className="input-field text-sm"
                    value={config.senderName}
                    onChange={e => onChange({ senderName: e.target.value })}
                    placeholder="SYNAPSE"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1.5">Reply-to</label>
                  <input
                    className="input-field text-sm"
                    value={config.replyTo}
                    onChange={e => onChange({ replyTo: e.target.value })}
                    placeholder="noreply@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Subject</label>
                <input
                  className="input-field text-sm"
                  value={config.subject}
                  onChange={e => onChange({ subject: e.target.value })}
                  placeholder="Thank you for your submission"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Message</label>
                <textarea
                  className="input-field text-sm min-h-[100px] resize-y"
                  value={config.message}
                  onChange={e => onChange({ message: e.target.value })}
                  placeholder="We have received your information and will be in touch shortly."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Include submission answers</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { val: 'none', label: 'Confirmation only' },
                    { val: 'selected', label: 'Selected fields' },
                    { val: 'all', label: 'All answers' },
                  ] as const).map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => onChange({ includeAnswers: opt.val })}
                      className={cn(
                        'px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                        config.includeAnswers === opt.val
                          ? 'border-gold-400 bg-gold-50 text-navy-800'
                          : 'border-navy-100 text-ivory-600 hover:bg-ivory-50'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {config.includeAnswers === 'selected' && (
                  <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                    {Object.values(definition.elements)
                      .filter(el => el.field && el.field.visible !== false && el.type !== 'hidden')
                      .map(el => {
                        const fieldId = el.field!.fieldId;
                        const checked = config.includedFields.includes(fieldId);
                        return (
                          <label key={el.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ivory-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                const next = e.target.checked
                                  ? [...config.includedFields, fieldId]
                                  : config.includedFields.filter(f => f !== fieldId);
                                onChange({ includedFields: next });
                              }}
                              className="rounded border-navy-200 text-gold-500 focus:ring-gold-400"
                            />
                            <span className="text-sm text-navy-700">{el.field!.label || el.displayLabel}</span>
                          </label>
                        );
                      })}
                  </div>
                )}
              </div>

              <DynamicVariablesHint />

              <TestEmailButton config={config} formName={formName} definition={definition} toast={toast} />
            </>
          )}
        </>
      )}
    </>
  );
}

// ============================================================
// POST-SUBMISSION EDITOR
// ============================================================

function PostSubmissionEditor({
  config, onChange,
}: {
  config: PostSubmissionConfig;
  onChange: (updates: Partial<PostSubmissionConfig>) => void;
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">After submission</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { val: 'thank_you', label: 'Thank You Page' },
            { val: 'redirect', label: 'Redirect' },
            { val: 'custom_message', label: 'Custom Message' },
          ] as { val: PostSubmissionType; label: string }[]).map(opt => (
            <button
              key={opt.val}
              onClick={() => onChange({ type: opt.val })}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                config.type === opt.val
                  ? 'border-gold-400 bg-gold-50 text-navy-800'
                  : 'border-navy-100 text-ivory-600 hover:bg-ivory-50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {config.type === 'thank_you' && (
        <ThankYouPageEditor
          page={config.thankYouPage}
          onChange={(updates) => onChange({ thankYouPage: { ...config.thankYouPage, ...updates } })}
        />
      )}

      {config.type === 'redirect' && (
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Redirect URL</label>
          <input
            className="input-field text-sm"
            value={config.redirectUrl || ''}
            onChange={e => onChange({ redirectUrl: e.target.value || null })}
            placeholder="https://example.com/thank-you"
          />
          <p className="text-xs text-ivory-500 mt-1.5">Only secure HTTPS URLs are allowed.</p>
          {config.redirectUrl && !isValidUrl(config.redirectUrl) && (
            <p className="text-xs text-red-500 mt-1">Please enter a valid HTTPS URL.</p>
          )}
        </div>
      )}

      {config.type === 'custom_message' && (
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Custom message</label>
          <textarea
            className="input-field text-sm min-h-[100px] resize-y"
            value={config.customMessage}
            onChange={e => onChange({ customMessage: e.target.value })}
            placeholder="Enter the message to display after submission."
          />
        </div>
      )}
    </>
  );
}

function ThankYouPageEditor({
  page, onChange,
}: {
  page: ThankYouPage;
  onChange: (updates: Partial<ThankYouPage>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Heading</label>
        <input
          className="input-field text-sm"
          value={page.heading}
          onChange={e => onChange({ heading: e.target.value })}
          placeholder="Thank You!"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Message</label>
        <textarea
          className="input-field text-sm min-h-[80px] resize-y"
          value={page.message}
          onChange={e => onChange({ message: e.target.value })}
          placeholder="Your submission has been received."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-navy-700 mb-1.5">Image or logo URL (optional)</label>
        <input
          className="input-field text-sm"
          value={page.imageUrl || ''}
          onChange={e => onChange({ imageUrl: e.target.value || null })}
          placeholder="https://example.com/logo.png"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Button text (optional)</label>
          <input
            className="input-field text-sm"
            value={page.buttonText || ''}
            onChange={e => onChange({ buttonText: e.target.value || null })}
            placeholder="Back to Home"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Button link (optional)</label>
          <input
            className="input-field text-sm"
            value={page.buttonLink || ''}
            onChange={e => onChange({ buttonLink: e.target.value || null })}
            placeholder="https://example.com"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WORKFLOW INFO
// ============================================================

function WorkflowInfo() {
  const events = [
    { name: 'form.submitted', desc: 'Fires when a form is successfully submitted and persisted' },
    { name: 'form.started', desc: 'Fires when a respondent begins filling out a form' },
    { name: 'form.abandoned', desc: 'Fires when a respondent leaves without submitting (requires consent tracking)' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-ivory-600">
        Every form submission automatically emits events to the SYNAPSE Workflow engine.
        Create workflows with the <span className="font-medium text-navy-700">Form Submitted</span> trigger to react to submissions.
      </p>
      <div className="space-y-2">
        {events.map(evt => (
          <div key={evt.name} className="flex items-start gap-3 p-3 rounded-lg bg-ivory-50 border border-sand">
            <div className="w-8 h-8 rounded-lg bg-navy-100 flex items-center justify-center shrink-0">
              <Send className="w-3.5 h-3.5 text-navy-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-mono font-medium text-navy-800">{evt.name}</p>
              <p className="text-xs text-ivory-500 mt-0.5">{evt.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ivory-400">
        Workflows are managed separately in the Workflows section. Forms only emit events — they do not execute workflow logic.
      </p>
    </div>
  );
}

// ============================================================
// DYNAMIC VARIABLES HINT
// ============================================================

function DynamicVariablesHint() {
  const [show, setShow] = useState(false);
  const variables = [
    { tag: '{{submission.first_name}}', desc: 'Respondent first name' },
    { tag: '{{submission.last_name}}', desc: 'Respondent last name' },
    { tag: '{{submission.email}}', desc: 'Respondent email' },
    { tag: '{{submission.phone}}', desc: 'Respondent phone' },
    { tag: '{{form.name}}', desc: 'Form name' },
    { tag: '{{submission.created_at}}', desc: 'Submission timestamp' },
  ];
  return (
    <div className="rounded-lg bg-navy-50 border border-navy-100 p-3">
      <button
        onClick={() => setShow(!show)}
        className="flex items-center gap-1.5 text-sm font-medium text-navy-700"
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        Dynamic variables
      </button>
      {show && (
        <div className="mt-2 space-y-1">
          {variables.map(v => (
            <div key={v.tag} className="flex items-center gap-2 text-xs">
              <code className="px-1.5 py-0.5 rounded bg-white border border-navy-100 font-mono text-navy-700">{v.tag}</code>
              <span className="text-ivory-500">{v.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// TEST EMAIL BUTTON
// ============================================================

function TestEmailButton({
  config, formName, toast,
}: {
  config: RespondentNotification;
  formName: string;
  definition: FormDefinition;
  toast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const [sending, setSending] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const sendTest = async () => {
    if (!testEmail.trim()) {
      toast('Enter an email address to send a test', 'error');
      return;
    }
    setSending(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/form-submit`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          mode: 'test_email',
          testEmail: testEmail.trim(),
          config: {
            subject: config.subject,
            senderName: config.senderName,
            replyTo: config.replyTo,
            message: config.message,
          },
          formName,
        }),
      });
      if (!response.ok) throw new Error('Test email failed');
      toast('Test email sent successfully');
    } catch {
      toast('Failed to send test email', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pt-2 border-t border-sand">
      <label className="block text-sm font-medium text-navy-700 mb-1.5">Send test email</label>
      <div className="flex gap-2">
        <input
          className="input-field flex-1 text-sm"
          placeholder="your@email.com"
          value={testEmail}
          onChange={e => setTestEmail(e.target.value)}
        />
        <button
          onClick={sendTest}
          disabled={sending}
          className="btn-secondary btn-sm shrink-0"
        >
          {sending ? <Send className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
          Send Test
        </button>
      </div>
    </div>
  );
}

// ============================================================
// SHARED UI
// ============================================================

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1">
      <span className="text-sm font-medium text-navy-700">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={cn('relative w-10 h-5 rounded-full transition-colors', checked ? 'bg-gold-500' : 'bg-ivory-200')}
      >
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
