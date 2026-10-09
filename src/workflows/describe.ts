import { newId, type Step, type Trigger } from './model';
import { stepDef, triggerDef } from './catalog';

/**
 * "Describe it": turns a plain sentence into a first draft of a workflow, by recognising the
 * triggers and steps SYNAPSE supports. It's a starting point to finish in the builder, not AI.
 */
export function sketch(text: string): { name: string; triggers: Trigger[]; steps: Step[]; unknown: string[] } {
  const t = text.toLowerCase();
  const trig = (type: Trigger['type'], filters: Trigger['filters'] = {}): Trigger => ({ id: newId('t'), type, name: triggerDef(type)!.label, filters: { ...triggerDef(type)!.defaults(), ...filters } });
  const quoted = (s: string) => s.match(/["“']([^"”']{1,40})["”']/)?.[1];

  let trigger: Trigger | null = null;
  if (/no[- ]?show/.test(t)) trigger = trig('appointment_status', { statuses: ['no_show'] });
  else if (/cancel/.test(t)) trigger = trig('appointment_status', { statuses: ['cancelled'] });
  else if (/(book|appointment|schedul)/.test(t)) trigger = trig('customer_booked_appointment');
  else if (/(form|submit|fills? in|intake)/.test(t)) trigger = trig('form_submitted');
  else if (/birthday/.test(t)) trigger = trig('birthday_reminder');
  else if (/(regist|event|ticket)/.test(t)) trigger = trig('event_registered');
  else if (/(repl(y|ies)|responds?)/.test(t)) trigger = trig('customer_replied');
  else if (/task.*(due|overdue)/.test(t)) trigger = trig('task_reminder');
  else if (/tag(ged)?/.test(t)) trigger = trig('contact_tag', { tags: quoted(text) ? [quoted(text)!] : [] });
  else if (/(new (contact|lead|client)|someone (signs up|joins))/.test(t)) trigger = trig('contact_created');

  // Split the "then" part of the sentence into steps, in order.
  const body = t.replace(/^.*?(?:,|then|:)\s*/, (m) => (trigger ? '' : m));
  const parts = body.split(/\bthen\b|,|;|\band\b|\./).map((p) => p.trim()).filter(Boolean);
  const steps: Step[] = [];
  const unknown: string[] = [];
  const add = (type: Step['type'], config: Step['config'] = {}) => steps.push({ id: newId(), type, name: '', config: { ...stepDef(type)!.defaults(), ...config } });
  for (const p of parts) {
    const wait = p.match(/wait\s+(\d+)\s*(minute|hour|day|week)s?/);
    if (wait) { const n = Number(wait[1]); add('wait', wait[2] === 'week' ? { amount: n * 7, unit: 'days' } : { amount: n, unit: `${wait[2]}s` }); continue; }
    if (/\b(sms|texts?|whatsapp)\b/.test(p)) { unknown.push('Text messages (SMS) aren’t available yet, so that step was left out.'); continue; }
    if (/e-?mail/.test(p)) { add('send_email'); continue; }
    if (/(notify|alert|tell|let .* know)/.test(p)) { add('notify'); continue; }
    if (/remove .*tag|untag/.test(p)) { add('remove_tag', { tags: quoted(p) ? [quoted(p)!] : [] }); continue; }
    if (/\btag\b/.test(p) && trigger?.type !== 'contact_tag') { add('add_tag', { tags: quoted(p) ? [quoted(p)!] : [] }); continue; }
    if (/(task|call|follow up|follow-up|remind)/.test(p)) { add('add_task', { title: 'Follow up with {{contact.name}}' }); continue; }
    if (/\bnote\b/.test(p)) { add('add_note'); continue; }
    if (/assign/.test(p)) { add('assign_user'); continue; }
    if (/webhook|zapier|make\.com/.test(p)) { add('webhook'); continue; }
  }
  const name = text.trim().replace(/\s+/g, ' ').slice(0, 60) || 'New workflow';
  return { name: name.length === 60 ? `${name}…` : name, triggers: trigger ? [trigger] : [], steps, unknown };
}
