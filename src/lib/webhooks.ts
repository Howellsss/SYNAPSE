/**
 * Outgoing webhooks: other apps get SYNAPSE events as they happen, signed and retried.
 * Database: 20261031090000_outgoing_webhooks.sql (webhook_deliveries is the delivery log).
 */
import { supabase } from '@/lib/supabase';

export const WEBHOOK_EVENTS: { group: string; events: { key: string; label: string }[] }[] = [
  { group: 'Contacts', events: [
    { key: 'contact.created', label: 'Contact created' }, { key: 'contact.updated', label: 'Contact updated' },
    { key: 'contact.tag_added', label: 'Tag added' }, { key: 'contact.tag_removed', label: 'Tag removed' },
  ] },
  { group: 'Forms', events: [{ key: 'form.submitted', label: 'Form or survey submitted' }] },
  { group: 'Appointments', events: [
    { key: 'appointment.created', label: 'Booked' }, { key: 'appointment.rescheduled', label: 'Rescheduled' },
    { key: 'appointment.cancelled', label: 'Cancelled' }, { key: 'appointment.completed', label: 'Showed up' },
    { key: 'appointment.no_show', label: 'No-show' },
  ] },
  { group: 'Messages & workflows', events: [{ key: 'message.received', label: 'Customer replied' }, { key: 'workflow.completed', label: 'Workflow finished' }] },
];
export const ALL_EVENTS = WEBHOOK_EVENTS.flatMap((g) => g.events.map((e) => e.key));
export const eventLabel = (k: string) => WEBHOOK_EVENTS.flatMap((g) => g.events).find((e) => e.key === k)?.label ?? (k === 'webhook.test' ? 'Test' : k);

export interface Webhook { id: string; name: string | null; url: string; secret: string | null; events: string[]; is_active: boolean; last_triggered_at: string | null; created_at: string }
export interface Delivery {
  id: string; webhook_id: string; event: string; status: 'pending' | 'sending' | 'retrying' | 'delivered' | 'failed';
  attempts: number; next_attempt_at: string; response_status: number | null; response_body: string | null; error: string | null; created_at: string; delivered_at: string | null;
}

export const isHttps = (url: string) => /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());

export async function listWebhooks(workspaceId: string) {
  const { data, error } = await supabase.from('webhooks').select('id, name, url, secret, events, is_active, last_triggered_at, created_at').eq('workspace_id', workspaceId).order('created_at');
  return { data: (data ?? []) as Webhook[], error: error?.message ?? null };
}

export async function listDeliveries(webhookId: string, limit = 25) {
  const { data, error } = await supabase.from('webhook_deliveries')
    .select('id, webhook_id, event, status, attempts, next_attempt_at, response_status, response_body, error, created_at, delivered_at')
    .eq('webhook_id', webhookId).order('created_at', { ascending: false }).limit(limit);
  return { data: (data ?? []) as Delivery[], error: error?.message ?? null };
}

export async function createWebhook(workspaceId: string, w: { url: string; name: string; events: string[] }) {
  const { data, error } = await supabase.from('webhooks').insert({ workspace_id: workspaceId, url: w.url.trim(), name: w.name.trim() || null, events: w.events, is_active: true })
    .select('id, name, url, secret, events, is_active, last_triggered_at, created_at').single();
  return { data: data as Webhook | null, error: error?.message ?? null };
}

export async function updateWebhook(id: string, changes: Partial<Pick<Webhook, 'url' | 'name' | 'events' | 'is_active'>>) {
  const { error } = await supabase.from('webhooks').update(changes).eq('id', id);
  return error?.message ?? null;
}

export async function deleteWebhook(id: string) {
  const { error } = await supabase.from('webhooks').delete().eq('id', id);
  return error?.message ?? null;
}

const rpcError = (m: string | undefined) => (m && /Could not find the function|does not exist/i.test(m) ? 'Webhooks need the database update 20261031090000_outgoing_webhooks.sql.' : m ?? null);

export async function sendTest(id: string) {
  const { error } = await supabase.rpc('webhook_send_test', { p_webhook: id });
  return rpcError(error?.message);
}
export async function retryDelivery(id: string) {
  const { error } = await supabase.rpc('webhook_retry', { p_delivery: id });
  return rpcError(error?.message);
}
export async function newSecret(id: string): Promise<{ secret: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('webhook_new_secret', { p_webhook: id });
  return { secret: (data as string | null) ?? null, error: rpcError(error?.message) };
}

/** How a receiver checks a request came from SYNAPSE (shown in Settings). */
export const VERIFY_SNIPPET = `// Node.js: check X-Synapse-Signature before trusting a request
import crypto from 'node:crypto';

function fromSynapse(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300; // within 5 minutes
  return fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`;
