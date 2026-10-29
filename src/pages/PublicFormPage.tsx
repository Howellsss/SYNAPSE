import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { publicOrigin } from '@/lib/publicUrl';
import type { FormDefinition } from '@/lib/form-builder-types';
import { deserializeDefinition } from '@/lib/form-definition';
import { attribution, closedReason, prefillAnswers, type FormKind } from '@/lib/form-engine';
import { FormPlayer, type FormPayload, type SubmitOutcome } from '@/components/forms/FormPlayer';
import { themeVars } from '@/components/forms/formLook';
import { LoadingSpinner } from '@/components/ui/States';

interface PublicForm { id: string; name: string; description: string | null; type: FormKind; status: string; definition: FormDefinition | null }

/** The link people fill a form or survey in at: /f/<id> (old links: /forms/<id>). No account needed. */
export function PublicFormPage({ formId }: { formId: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [missing, setMissing] = useState(false);
  const params = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search), []);
  useEffect(() => {
    let alive = true;
    supabase.from('forms').select('id, name, description, type, status, definition').eq('id', formId).maybeSingle().then(({ data }) => {
      if (!alive) return;
      const def = data ? deserializeDefinition((data as { definition: string | object | null }).definition) : null;
      if (!data || !def) setMissing(true);
      else { setForm({ ...(data as PublicForm), definition: def }); document.title = (data as PublicForm).name; }
    });
    return () => { alive = false; };
  }, [formId]);

  if (missing) return <Shell><Notice title="This form isn’t available" text="It may have been unpublished or the link is wrong. Check with whoever sent it to you." /></Shell>;
  if (!form?.definition) return <Shell><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div></Shell>;

  const def = form.definition;
  const closed = closedReason(def, form.status, 0);
  if (closed) return <Shell><Notice title={form.name} text={closed} /></Shell>;

  const submit = async (p: FormPayload): Promise<SubmitOutcome> => {
    const { data, error } = await supabase.functions.invoke('form-submit', {
      body: {
        mode: 'submit', formId: form.id, answers: p.answers, disqualified: p.disqualified, trap: p.trap,
        source: params.get('source') ?? 'link', meta: attribution(params, document.referrer),
        returnUrl: `${publicOrigin()}/f/${form.id}`,
      },
    });
    if (error || !data?.success) {
      const msg = (data?.error as string | undefined) ?? (await readError(error)) ?? 'Something went wrong sending this. Please try again.';
      return { ok: false, error: msg, closed: !!data?.closed };
    }
    return { ok: true };
  };

  return (
    <Shell background={def.theme.background.type === 'solid' ? def.theme.background.color : def.theme.colors.pageBackground}
      glow={def.theme.background.type === 'solid' && def.theme.layoutPreset !== 'full_width' && def.theme.layoutPreset !== 'split' ? themeVars(def.theme) : undefined}>
      <FormPlayer
        definition={def}
        formName={form.name}
        formDescription={form.description}
        kind={form.type}
        viewport={window.innerWidth < 640 ? 'mobile' : 'desktop'}
        initialAnswers={prefillAnswers(def, params)}
        onSubmit={submit}
        formId={form.id}
        stage
      />
    </Shell>
  );
}

async function readError(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.json(); return (j?.error as string) ?? null; } catch { return null; }
  }
  return null;
}

/** The page behind the form; with `glow`, a soft light of the form's colours drifts behind the card. */
function Shell({ children, background = '#FFFFFF', glow }: { children: React.ReactNode; background?: string; glow?: React.CSSProperties }) {
  return (
    <div className={glow ? 'sf relative min-h-[100dvh] w-full py-6 sm:py-10' : 'min-h-[100dvh] w-full py-6 sm:py-10'} style={{ background, ...glow }}>
      {glow && <div className="sf-backdrop" aria-hidden />}
      <div className="relative z-[1] mx-auto w-full max-w-5xl px-3 sm:px-6">{children}</div>
    </div>
  );
}
function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto mt-[12vh] max-w-lg rounded-2xl bg-white p-8 text-center shadow-[0_20px_50px_rgba(9,21,48,0.12)]">
      <h1 className="text-2xl font-extrabold text-navy-900">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ivory-700">{text}</p>
    </div>
  );
}
