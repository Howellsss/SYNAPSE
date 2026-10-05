import { useEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Loader2, UserRound, AlertTriangle, RotateCw, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { createSpace, isSlugAvailable, markEntered } from '@/lib/spaces';
import { slugProblem } from '@/spatial/slug';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import {
  wizardReducer, freshState, canContinue, readDraft, saveDraft, clearDraft, stepPosition, isLastStep,
  effectiveRooms, effectiveSizeBand, effectiveTemplateKey, effectiveType, type SlugStatus, type WizardState,
} from '@/components/spaces/wizard/state';
import { generateGuestToken } from '@/spatial/access';
import { StepName } from '@/components/spaces/wizard/StepName';
import { StepType } from '@/components/spaces/wizard/StepType';
import { StepSize } from '@/components/spaces/wizard/StepSize';
import { StepLayout } from '@/components/spaces/wizard/StepLayout';
import { StepInvite } from '@/components/spaces/wizard/StepInvite';
import { StepImport } from '@/components/spaces/wizard/StepImport';
import { StepConfigure } from '@/components/spaces/wizard/StepConfigure';
import { StepComingNext } from '@/components/spaces/wizard/StepComingNext';
import { StepTitle } from '@/components/spaces/wizard/ui';
import { DeviceControls, DevicePreview } from '@/components/spaces/DeviceCheck';
import { useMediaCheck, type MediaCheck } from '@/spatial/media/useMediaCheck';
import { useMediaPrefs } from '@/spatial/media/useMediaPrefs';
import { LivePreview } from '@/components/spaces/wizard/LivePreview';
import type { Space } from '@/types';

export function CreateSpaceWizard() {
  const { workspace, user, profile, canManageTeam } = useAuth();
  const [, navigate] = useRouter();

  if (!workspace || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-white"><LoadingSpinner className="h-10 w-10" /></div>;
  }
  if (!canManageTeam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ivory-200/30 p-4">
        <div className="card max-w-md p-8 text-center">
          <Lock className="mx-auto h-10 w-10 text-gold-600" />
          <h1 className="mt-4 text-xl font-bold text-navy-800">Only owners and admins can create workspaces</h1>
          <p className="mt-2 text-sm text-ivory-700">Ask someone who manages your team to create one, then enter it from Workspaces.</p>
          <button onClick={() => navigate('/workspace')} className="btn-primary mt-6">Back to workspaces</button>
        </div>
      </div>
    );
  }

  const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || 'You';
  return <Wizard workspaceId={workspace.id} userId={user.id} userEmail={user.email ?? null} userName={userName} />;
}

/** Debounced (400ms) availability check; stale answers are ignored. */
function useSlugStatus(slug: string, recheck: number): SlugStatus {
  const [status, setStatus] = useState<SlugStatus>('idle');
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!slug) { setStatus('idle'); return; }
    if (slugProblem(slug)) { setStatus('invalid'); return; }
    setStatus('checking');
    const t = setTimeout(async () => {
      const available = await isSlugAvailable(slug);
      if (id !== seq.current) return;
      setStatus(available === null ? 'unknown' : available ? 'available' : 'taken');
    }, 400);
    return () => clearTimeout(t);
  }, [slug, recheck]);
  return status;
}

function Wizard({ workspaceId, userId, userEmail, userName }: { workspaceId: string; userId: string; userEmail: string | null; userName: string }) {
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [state, dispatch] = useReducer(wizardReducer, workspaceId, (id) => readDraft(id) ?? freshState());
  const [recheck, setRecheck] = useState(0);
  const slugStatus = useSlugStatus(state.slug, recheck);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // If a create attempt got as far as inserting the space, retries continue from it.
  const createdSpace = useRef<Space | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  // Camera and mic run only on the last step; leaving it (or the wizard) stops every track.
  const media = useMediaCheck(state.step === 'media');
  const [mediaPrefs, setMediaPrefs] = useMediaPrefs();
  const { profile } = useAuth();
  const you = { name: userName, firstName: profile?.first_name, lastName: profile?.last_name, avatarUrl: profile?.avatar_url };

  useEffect(() => { saveDraft(workspaceId, state); }, [workspaceId, state]);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); }, [state.step]);

  const position = stepPosition(state);
  const ready = canContinue(state, slugStatus);
  const isLast = isLastStep(state);
  // Type and Configure need more room for the form; the preview panel gets narrower.
  const wide = state.step === 'type' || state.step === 'configure';
  const column = wide ? 'max-w-5xl' : 'max-w-2xl';

  const finish = async () => {
    setCreating(true);
    setCreateError(null);
    const guestLinkToken = state.accessMode === 'guest_link' ? state.guestLinkToken ?? generateGuestToken() : null;
    const result = await createSpace({
      workspaceId,
      userId,
      name: state.name,
      slug: state.slug,
      description: state.description,
      spaceType: effectiveType(state),
      sizeBand: effectiveSizeBand(state),
      templateKey: effectiveTemplateKey(state),
      map: state.typeChoice === 'import' ? state.importedLayout?.map ?? {} : {},
      invites: state.invites,
      inviteRole: state.inviteRole,
      accessMode: state.accessMode,
      guestLinkToken,
      permissions: state.permissions,
      persistence: state.persistence,
      schedule: state.persistence === 'scheduled' ? state.schedule : null,
      branding: state.branding,
      config: { rooms: effectiveRooms(state) },
    }, createdSpace.current);
    setCreating(false);

    if (result.space) createdSpace.current = result.space;
    if (result.error || !result.space) {
      toast(result.error ?? 'Could not create the workspace.', 'error');
      if (result.slugTaken) {
        setRecheck((n) => n + 1);
        dispatch({ type: 'goTo', step: 'name' });
        return;
      }
      setCreateError(result.error ?? 'Could not create the workspace.');
      return;
    }

    clearDraft(workspaceId);
    // Creators have just done the camera check, so they skip the "Get ready" screen.
    await markEntered(result.space.id, userId);
    if (result.inviteError) {
      toast(`Workspace created, but the invites didn't send. Resend them from Settings → Team. (${result.inviteError})`, 'error');
    } else if (state.invites.length) {
      toast(`${state.invites.length} ${state.invites.length === 1 ? 'invite' : 'invites'} sent`);
    }
    navigate(`/workspace/${result.space.slug}`);
  };

  const onContinue = (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || creating) return;
    if (isLast) { finish(); return; }
    dispatch({ type: 'next' });
  };

  /** Enter continues from anywhere in a step, including a focused option tile or checkbox. */
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el.getAttribute('role') === 'radio' || (el instanceof HTMLInputElement && el.type === 'checkbox')) {
      e.preventDefault();
      onContinue();
    }
  };

  const skipInvites = () => {
    dispatch({ type: 'setInvites', invites: [] });
    dispatch({ type: 'next' });
  };

  const saveAndExit = () => {
    saveDraft(workspaceId, state);
    navigate('/workspace');
  };

  const continueLabel = isLast
    ? `Enter ${state.name.trim() || 'workspace'}`
    : state.step === 'invite'
      ? state.invites.length ? `Send ${state.invites.length} ${state.invites.length === 1 ? 'invite' : 'invites'}` : 'Continue'
      : 'Continue';

  return (
    <div className="flex min-h-screen flex-col bg-white lg:h-screen lg:flex-row lg:overflow-hidden">
      <form onSubmit={onContinue} onKeyDown={onKeyDown} className="flex min-w-0 flex-1 flex-col lg:h-full" noValidate>
        {/* Top: logo, save & exit, progress */}
        <header className="px-4 pt-5 sm:px-8 lg:px-12">
          <div className={cn('mx-auto w-full lg:mx-0', column)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-800 text-white"><HowellsLogo className="h-5 w-5" /></span>
                <span className="text-lg font-bold tracking-wide text-navy-800">SYNAPSE</span>
              </div>
              <button type="button" onClick={saveAndExit} className="btn-ghost !px-3 !py-2">Save & exit</button>
            </div>
            <div className="mt-6 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: position.total }, (_, i) => (
                <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i < position.index ? 'bg-gold-400' : 'bg-navy-50')} />
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ivory-700" aria-live="polite">
              Step {position.index} of {position.total} · {position.label}
            </p>
          </div>
        </header>

        {/* Step content */}
        <div ref={mainRef} className="flex-1 px-4 pb-6 pt-5 sm:px-8 lg:overflow-y-auto lg:px-12">
          <div className={cn('mx-auto w-full lg:mx-0', column)}>
            {state.step === 'media' ? (
              <>
                <StepTitle title="Check your camera & mic" subtitle="Make sure people can see and hear you when you walk over." />
                <div className="mb-5 rounded-3xl bg-navy-800 p-4 sm:p-6 lg:hidden"><DevicePreview check={media} {...you} /></div>
                <DeviceControls check={media} prefs={mediaPrefs} onPrefs={setMediaPrefs} />
              </>
            ) : (
              <StepContent state={state} dispatch={dispatch} slugStatus={slugStatus} userEmail={userEmail} workspaceId={workspaceId} userId={userId} />
            )}
          </div>
        </div>

        {/* Live preview stacks under the content on small screens */}
        {/* On the Type step the details show under the chosen card instead. */}
        <aside className={cn('mx-4 mb-4 rounded-3xl bg-navy-800 p-5 sm:mx-8 lg:hidden', (state.step === 'type' || state.step === 'media') && 'hidden')} aria-label="Live preview">
          <LivePreview state={state} userName={userName} />
        </aside>

        {/* Footer */}
        <footer className="sticky bottom-0 z-10 border-t border-navy-50 bg-white/95 px-4 py-3 backdrop-blur sm:px-8 lg:px-12">
          {createError && (
            <div role="alert" className={cn('mx-auto mb-3 flex w-full flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-burgundy-600 lg:mx-0', column)}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{createError}</span>
              <button type="button" onClick={finish} disabled={creating} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
                <RotateCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          )}
          <div className={cn('mx-auto flex w-full items-center gap-2 lg:mx-0', column)}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'back' })}
              disabled={state.step === 'name' || creating}
              className={cn('btn-secondary', state.step === 'name' && 'invisible')}
            >
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
            </button>
            <div className="flex-1" />
            {state.step === 'invite' && (
              <button type="button" onClick={skipInvites} className="btn-ghost !px-3">Skip for now</button>
            )}
            {state.step === 'media' && (
              <button type="button" onClick={finish} disabled={creating} className="btn-ghost !px-3">Skip for now</button>
            )}
            <button type="submit" disabled={!ready || creating} className="btn-primary min-w-0 !px-5">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><span className="truncate">{continueLabel}</span> <ArrowRight className="h-4 w-4 shrink-0" /></>}
            </button>
          </div>
        </footer>
      </form>

      {/* Live preview panel (desktop) */}
      <aside className={cn('hidden shrink-0 p-4 lg:block', wide ? 'w-[380px] xl:w-[430px]' : 'w-[44%] max-w-[640px]')} aria-label={state.step === 'type' ? 'Workspace at a glance' : 'Live preview'}>
        <div className={cn('h-full overflow-y-auto rounded-3xl bg-navy-800', wide ? 'p-7' : 'p-10')}>
          {state.step === 'media' ? <MediaPanel check={media} you={you} /> : <LivePreview state={state} userName={userName} />}
        </div>
      </aside>
    </div>
  );
}

function MediaPanel({ check, you }: { check: MediaCheck; you: Omit<Parameters<typeof DevicePreview>[0], 'check'> }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.22em] text-gold-400">Your preview</p>
      <DevicePreview check={check} {...you} />
    </div>
  );
}

function StepContent({ state, dispatch, slugStatus, userEmail, workspaceId, userId }: {
  state: WizardState;
  dispatch: Parameters<typeof StepName>[0]['dispatch'];
  slugStatus: SlugStatus;
  userEmail: string | null;
  workspaceId: string;
  userId: string;
}) {
  switch (state.step) {
    case 'name': return <StepName state={state} dispatch={dispatch} slugStatus={slugStatus} />;
    case 'type': return <StepType state={state} dispatch={dispatch} />;
    case 'size': return <StepSize state={state} dispatch={dispatch} />;
    case 'layout': return <StepLayout state={state} dispatch={dispatch} />;
    case 'import': return <StepImport state={state} dispatch={dispatch} />;
    case 'configure': return <StepConfigure state={state} dispatch={dispatch} workspaceId={workspaceId} userId={userId} />;
    case 'invite': return <StepInvite state={state} dispatch={dispatch} ownEmail={userEmail} />;
    case 'avatar':
      return (
        <StepComingNext
          title="Create your avatar"
          subtitle="This is how people see you walking around the office."
          icon={UserRound}
          cardTitle="Create your avatar — coming next"
          cardText="You'll pick your look here soon. Until then you'll appear with your initials."
        />
      );
    default:
      // The camera & mic step is rendered by the wizard itself (it shares the preview panel).
      return null;
  }
}
