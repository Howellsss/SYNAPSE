import { CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { slugProblem, SLUG_PROBLEM_TEXT, SLUG_MAX } from '@/spatial/slug';
import { cn } from '@/lib/utils';
import { StepTitle, FieldLabel } from './ui';
import type { WizardAction, WizardState, SlugStatus } from './state';

/** Keeps what the user types in the link box link-shaped without fighting their cursor. */
function cleanSlugInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, SLUG_MAX);
}

export function StepName({ state, dispatch, slugStatus }: { state: WizardState; dispatch: (a: WizardAction) => void; slugStatus: SlugStatus }) {
  const problem = state.slug ? slugProblem(state.slug) : null;
  return (
    <>
      <StepTitle title="Name your workspace" subtitle="This is what your team sees when they walk in. You can change it later." />
      <div className="space-y-5">
        <div>
          <FieldLabel htmlFor="space-name">Workspace name</FieldLabel>
          <input
            id="space-name"
            autoFocus
            className="input-field !py-3 !text-base"
            value={state.name}
            maxLength={60}
            placeholder="e.g. Howells HQ"
            onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
          />
        </div>

        <div>
          <FieldLabel htmlFor="space-slug">Link</FieldLabel>
          <div className={cn(
            'flex items-center overflow-hidden rounded-xl border bg-white transition focus-within:ring-2',
            slugStatus === 'taken' || problem ? 'border-burgundy-500 focus-within:ring-burgundy-400/20' : 'border-navy-100 focus-within:border-gold-400 focus-within:ring-gold-400/20',
          )}>
            <span className="shrink-0 select-none border-r border-navy-50 bg-ivory-200/40 px-3 py-2.5 text-sm text-ivory-700">synapse.app/</span>
            <input
              id="space-slug"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-navy-800 outline-none"
              value={state.slug}
              placeholder="your-team"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="space-slug-status"
              onChange={(e) => dispatch({ type: 'setSlug', slug: cleanSlugInput(e.target.value) })}
            />
          </div>
          <p id="space-slug-status" aria-live="polite" className="mt-1.5 flex min-h-[20px] items-center gap-1.5 text-sm">
            {problem && state.slug ? (
              <span className="flex items-center gap-1.5 text-burgundy-600"><AlertCircle className="h-4 w-4" /> {SLUG_PROBLEM_TEXT[problem]}</span>
            ) : slugStatus === 'checking' ? (
              <span className="flex items-center gap-1.5 text-ivory-700"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</span>
            ) : slugStatus === 'available' ? (
              <span className="flex items-center gap-1.5 font-medium text-green-700"><CheckCircle2 className="h-4 w-4" /> Available</span>
            ) : slugStatus === 'taken' ? (
              <span className="flex items-center gap-1.5 font-medium text-burgundy-600"><XCircle className="h-4 w-4" /> Taken — try another link</span>
            ) : slugStatus === 'unknown' ? (
              <span className="text-ivory-700">Couldn't check right now. We'll confirm when you finish.</span>
            ) : null}
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="space-description" hint="Optional">What happens here?</FieldLabel>
          <textarea
            id="space-description"
            className="input-field min-h-[92px] resize-none"
            value={state.description}
            maxLength={280}
            placeholder="e.g. Where the product team works, meets and hangs out."
            onChange={(e) => dispatch({ type: 'setDescription', description: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}
