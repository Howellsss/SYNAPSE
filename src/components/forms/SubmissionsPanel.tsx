import { useEffect, useMemo, useState } from 'react';
import { Download, Inbox, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { FormDefinition } from '@/lib/form-builder-types';
import { fieldElements, money } from '@/lib/form-engine';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

interface Row {
  id: string; created_at: string; answers: Record<string, string>; source: string | null; contact_id: string | null;
  meta?: Record<string, string> | null; score?: number | null; score_max?: number | null; score_percent?: number | null; quiz_result?: string | null;
  disqualified?: boolean | null; payment_status?: string | null; payment_amount?: number | null; payment_currency?: string | null;
}
type Filter = 'all' | 'qualified' | 'disqualified' | 'paid';

/** Every response to this form: who, when, answers, quiz score, payment, where they came from. Export to CSV. */
export function SubmissionsPanel({ formId, definition, isSurvey }: { formId: string; definition: FormDefinition; isSurvey: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Row | null>(null);
  const fields = useMemo(() => fieldElements(definition).filter((el) => el.type !== 'payment'), [definition]);
  const label = (fid: string) => fields.find((f) => f.field.fieldId === fid)?.field.label ?? fid;
  const nameOf = (r: Row) => {
    const pick = (k: string) => { const f = fields.find((x) => x.field.mappedContactField === k); return f ? r.answers?.[f.field.fieldId] : undefined; };
    return [pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || pick('email') || 'Anonymous';
  };
  const quizOn = !!definition.settings.quiz?.enabled;
  const payOn = fieldElements(definition).some((el) => el.type === 'payment');

  useEffect(() => {
    supabase.from('form_submissions').select('*').eq('form_id', formId).order('created_at', { ascending: false }).limit(1000)
      .then(({ data, error: e }) => { if (e) setError(e.message); setRows((data ?? []) as Row[]); });
  }, [formId]);

  const shown = (rows ?? []).filter((r) => filter === 'all' || (filter === 'disqualified' ? r.disqualified : filter === 'qualified' ? !r.disqualified : r.payment_status === 'paid'));
  const word = isSurvey ? 'response' : 'submission';

  const exportCsv = () => {
    const extra = [quizOn && 'Score %', quizOn && 'Result', payOn && 'Payment', payOn && 'Amount', 'Disqualified', 'Source', 'utm_source', 'utm_medium', 'utm_campaign'].filter(Boolean) as string[];
    const head = ['Submitted', ...fields.map((f) => f.field.label), ...extra];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = shown.map((r) => [
      new Date(r.created_at).toISOString(), ...fields.map((f) => r.answers?.[f.field.fieldId] ?? ''),
      ...(quizOn ? [r.score_percent ?? '', r.quiz_result ?? ''] : []),
      ...(payOn ? [r.payment_status ?? '', r.payment_amount ? money(r.payment_amount, r.payment_currency ?? 'usd') : ''] : []),
      r.disqualified ? 'yes' : '', r.source ?? '', r.meta?.utm_source ?? '', r.meta?.utm_medium ?? '', r.meta?.utm_campaign ?? '',
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${word}s.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!rows) return <div className="flex flex-1 items-center justify-center"><LoadingSpinner className="h-7 w-7 text-ivory-600" /></div>;
  return (
    <div className="flex min-h-0 flex-1 bg-ivory-50">
      <div className="min-w-0 flex-1 overflow-y-auto p-6 pb-28">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-lg font-semibold text-navy-800">{rows.length} {word}{rows.length === 1 ? '' : 's'}</h2>
            <div role="tablist" aria-label="Show" className="flex rounded-lg bg-white p-0.5 shadow-[0_0_0_1px_#E8EBF0]">
              {(['all', 'qualified', 'disqualified', ...(payOn ? ['paid'] : [])] as Filter[]).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold capitalize', filter === f ? 'bg-navy-800 text-white' : 'text-navy-700')}>{f}</button>
              ))}
            </div>
            <button type="button" onClick={exportCsv} disabled={!shown.length} className="btn-secondary btn-sm"><Download className="h-4 w-4" /> Export CSV</button>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {!shown.length ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow-[0_0_0_1px_#E8EBF0]">
              <Inbox className="mx-auto h-8 w-8 text-ivory-500" />
              <p className="mt-2 font-semibold text-navy-800">No {word}s yet</p>
              <p className="mt-1 text-sm text-ivory-600">Publish it and share the link; {word}s show up here as they come in.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_0_0_1px_#E8EBF0]">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-ivory-600">
                  <tr>
                    <th className="px-4 py-3">Who</th><th className="px-4 py-3">When</th>
                    {quizOn && <th className="px-4 py-3">Score</th>}
                    {payOn && <th className="px-4 py-3">Payment</th>}
                    <th className="px-4 py-3">Source</th><th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-b border-navy-50 last:border-0 hover:bg-ivory-50" onClick={() => setOpen(r)}>
                      <td className="px-4 py-3 font-medium text-navy-900">{nameOf(r)}{r.disqualified && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700">Disqualified</span>}</td>
                      <td className="px-4 py-3 text-ivory-700">{new Date(r.created_at).toLocaleString()}</td>
                      {quizOn && <td className="px-4 py-3">{r.score_percent != null ? `${r.score_percent}%` : '—'}{r.quiz_result && <span className="block text-xs text-ivory-600">{r.quiz_result}</span>}</td>}
                      {payOn && <td className="px-4 py-3">{r.payment_amount ? money(r.payment_amount, r.payment_currency ?? 'usd') : '—'}<span className={cn('block text-xs font-semibold capitalize', r.payment_status === 'paid' ? 'text-green-700' : 'text-ivory-600')}>{r.payment_status && r.payment_status !== 'none' ? r.payment_status : ''}</span></td>}
                      <td className="px-4 py-3 text-ivory-700">{r.meta?.utm_source ?? r.source ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-navy-700">View</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {open && (
        <aside aria-label="Response" className="w-full max-w-md shrink-0 overflow-y-auto border-l border-navy-100 bg-white p-5 pb-28">
          <div className="flex items-start gap-2">
            <div className="flex-1"><h3 className="text-lg font-bold text-navy-900">{nameOf(open)}</h3><p className="text-xs text-ivory-600">{new Date(open.created_at).toLocaleString()}</p></div>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="rounded-lg bg-ivory-50 p-1.5 text-navy-700"><X className="h-4 w-4" /></button>
          </div>
          <dl className="mt-4 space-y-3">
            {Object.entries(open.answers ?? {}).map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold text-ivory-600">{label(k)}</dt><dd className="whitespace-pre-wrap text-sm text-navy-900">{v}</dd></div>
            ))}
            {open.score_percent != null && <div><dt className="text-xs font-semibold text-ivory-600">Quiz score</dt><dd className="text-sm text-navy-900">{open.score} / {open.score_max} ({open.score_percent}%) {open.quiz_result ? `· ${open.quiz_result}` : ''}</dd></div>}
            {open.payment_amount ? <div><dt className="text-xs font-semibold text-ivory-600">Payment</dt><dd className="text-sm capitalize text-navy-900">{money(open.payment_amount, open.payment_currency ?? 'usd')} · {open.payment_status}</dd></div> : null}
            {open.meta && Object.keys(open.meta).length > 0 && <div><dt className="text-xs font-semibold text-ivory-600">Came from</dt><dd className="text-sm text-navy-900">{Object.entries(open.meta).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd></div>}
          </dl>
          {open.contact_id && <a href={`#/contacts/${open.contact_id}`} className="btn-secondary btn-sm mt-5 inline-flex">Open the contact</a>}
        </aside>
      )}
    </div>
  );
}
