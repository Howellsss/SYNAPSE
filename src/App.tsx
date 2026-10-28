import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { useGmailReturnNotice } from '@/lib/email-accounts';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { DOCK_STRIP, FeatureDock } from '@/components/layout/FeatureDock';
import { AuthPage } from '@/pages/AuthPage';
import { HomePage } from '@/pages/HomePage';
import { inviteFromLocation } from '@/meetings/codes';
import { watchFromLocation } from '@/lib/streams';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { featureForPath, useAccess } from '@/lib/access';
import { clearCache } from '@/lib/cache/withCache';
import { MonitorPlay, FolderOpen } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/States';
import { SpaceDockContext, type SpaceDock } from '@/context/SpaceDockContext';
import { cn } from '@/lib/utils';

// Each page is its own download, fetched when it's first opened (the sign-in and home pages come
// with the app), so opening SYNAPSE doesn't wait for every feature's code.
const AcceptInvitePage = lazy(() => import('@/pages/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })));
const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const ContactsPage = lazy(() => import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const ContactDetailPage = lazy(() => import('@/pages/ContactDetailPage').then((m) => ({ default: m.ContactDetailPage })));
const CalendarsPage = lazy(() => import('@/pages/CalendarsPage').then((m) => ({ default: m.CalendarsPage })));
const FormsPage = lazy(() => import('@/pages/FormsPage').then((m) => ({ default: m.FormsPage })));
const FormBuilder = lazy(() => import('@/pages/FormBuilder').then((m) => ({ default: m.FormBuilder })));
const PublicFormPage = lazy(() => import('@/pages/PublicFormPage').then((m) => ({ default: m.PublicFormPage })));
const WorkflowsHome = lazy(() => import('@/components/workflows/WorkflowsHome').then((m) => ({ default: m.WorkflowsHome })));
const Builder = lazy(() => import('@/components/workflows/Builder').then((m) => ({ default: m.Builder })));
const RecordingsPage = lazy(() => import('@/pages/RecordingsPage').then((m) => ({ default: m.RecordingsPage })));
const CharactersPage = lazy(() => import('@/pages/CharactersPage').then((m) => ({ default: m.CharactersPage })));
const AIAgentPage = lazy(() => import('@/pages/AIAgentPage').then((m) => ({ default: m.AIAgentPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const MeetingsPage = lazy(() => import('@/pages/MeetingsPage').then((m) => ({ default: m.MeetingsPage })));
const MeetingRoomPage = lazy(() => import('@/pages/MeetingRoomPage').then((m) => ({ default: m.MeetingRoomPage })));
const BookingPage = lazy(() => import('@/pages/BookingPage').then((m) => ({ default: m.BookingPage })));
const GroupCalendarSettingsPage = lazy(() => import('@/pages/GroupCalendarSettingsPage').then((m) => ({ default: m.GroupCalendarSettingsPage })));
const ComingSoonPage = lazy(() => import('@/pages/ComingSoonPage').then((m) => ({ default: m.ComingSoonPage })));
const WorkspacesPage = lazy(() => import('@/pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const RoomsPage = lazy(() => import('@/pages/RoomsPage').then((m) => ({ default: m.RoomsPage })));
const ConversationsPage = lazy(() => import('@/pages/ConversationsPage').then((m) => ({ default: m.ConversationsPage })));
const StreamsPage = lazy(() => import('@/pages/StreamsPage').then((m) => ({ default: m.StreamsPage })));
const StreamStudioPage = lazy(() => import('@/pages/StreamStudioPage').then((m) => ({ default: m.StreamStudioPage })));
const WatchPage = lazy(() => import('@/pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const CreateSpaceWizard = lazy(() => import('@/pages/CreateSpaceWizard').then((m) => ({ default: m.CreateSpaceWizard })));
const SpacePage = lazy(() => import('@/pages/SpacePage').then((m) => ({ default: m.SpacePage })));
const GuestJoinPage = lazy(() => import('@/pages/GuestJoinPage').then((m) => ({ default: m.GuestJoinPage })));
const EventsHomePage = lazy(() => import('@/pages/events/EventsHomePage').then((m) => ({ default: m.EventsHomePage })));
const EventDetailPage = lazy(() => import('@/pages/events/EventDetailPage').then((m) => ({ default: m.EventDetailPage })));
const TicketPage = lazy(() => import('@/pages/events/TicketPage').then((m) => ({ default: m.TicketPage })));
const EventsPage = lazy(() => import('@/pages/events/EventsPage').then((m) => ({ default: m.EventsPage })));
const EventBuilder = lazy(() => import('@/pages/events/EventBuilder').then((m) => ({ default: m.EventBuilder })));
const EventManagePage = lazy(() => import('@/pages/events/EventManagePage').then((m) => ({ default: m.EventManagePage })));

const pageSpinner = <div className="flex flex-1 items-center justify-center py-24"><LoadingSpinner className="w-8 h-8" /></div>;

/** Where SYNAPSE shows its menu on the left rather than a feature full screen. */
const isMenuSection = (section: string) => section === 'dashboard' || section === 'signin' || section === 'signup';

function AppContent() {
  const { user, loading, workspace } = useAuth();
  const [path, navigate] = useRouter();
  const access = useAccess();
  // Cached data belongs to one person in one workspace: drop it all when either changes
  // (signing out, someone else signing in, switching workspace).
  const cacheOwner = `${user?.id ?? ''}|${workspace?.id ?? ''}`;
  const lastCacheOwner = useRef(cacheOwner);
  useEffect(() => {
    if (lastCacheOwner.current === cacheOwner) return;
    lastCacheOwner.current = cacheOwner;
    clearCache();
  }, [cacheOwner]);
  const [searchQuery, setSearchQuery] = useState('');
  useGmailReturnNotice(path);

  // The workspace you're in (/workspace/<slug>), and the one kept open on the right while you use
  // the other pages. Only Leave (or signing out) closes it.
  const spaceMatch = path.match(/^\/workspace\/([a-z0-9-]+)(?:[/?]|$)/);
  const spaceSlug = spaceMatch && spaceMatch[1] !== 'new' ? spaceMatch[1] : null;
  const [dockedSpace, setDockedSpace] = useState<string | null>(null);
  // SYNAPSE opens with the menu on the left. Opening a feature gives it the whole screen, with the
  // features in a dock along the bottom; the dock's arrow (and only that) brings the menu back.
  // Opening a feature (anything but the dashboard, which is where SYNAPSE starts) tucks the menu away;
  // so does loading straight into one (a refresh or a shared link).
  const section = path.split(/[/?#]/)[1] || 'dashboard';
  const [navOpen, setNavOpenState] = useState(() => isMenuSection(section));
  const lastSection = useRef(section);
  useEffect(() => {
    if (section === lastSection.current) return;
    lastSection.current = section;
    if (!isMenuSection(section)) setNavOpenState(false);
  }, [section]);
  // Full-screen editors (workflows, events) sit beside the menu when it's open.
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', navOpen ? '240px' : '0px');
    // Pages that fill the screen (Conversations) leave room for the top bar when the menu is open.
    document.documentElement.style.setProperty('--top-h', navOpen ? '64px' : '0px');
    // The feature dock along the bottom (only while the menu is tucked away).
    document.documentElement.style.setProperty('--dock-h', navOpen ? '0px' : '60px');
  }, [navOpen]);
  const setNavOpen = useCallback((open: boolean) => setNavOpenState(open), []);
  useEffect(() => {
    if (!loading && !user) setDockedSpace(null);
    else if (spaceSlug) setDockedSpace(spaceSlug);
  }, [spaceSlug, user, loading]);
  const dockApi = useMemo<SpaceDock>(() => ({
    docked: !spaceSlug && !!dockedSpace,
    dock: () => navigate('/dashboard'),
    expand: () => { if (dockedSpace) navigate(`/workspace/${dockedSpace}`); },
    leave: () => { setDockedSpace(null); navigate('/workspace'); },
    openNav: () => setNavOpen(true),
  }), [spaceSlug, dockedSpace, navigate, setNavOpen]);

  const authPath = path === '/signin' || path === '/signup';
  // A form or survey to fill in: /f/<id> (older shared links: /forms/<id>). Open to everyone.
  const publicFormId = (path.match(/^\/f\/([0-9a-f-]{36})(?:[/?]|$)/i) ?? path.match(/^\/forms\/([0-9a-f-]{36})(?:\?|$)/i))?.[1] ?? null;
  // Public events pages: /e, /e/<slug>, /e/ticket/<token>. Open to everyone, signed in or not.
  const isPublicEvents = path === '/e' || path.startsWith('/e/') || path.startsWith('/e?');
  // A meeting invite link (/meetings/CODE?invite=…) opens for everyone, signed in or not.
  const meetingMatch = path.match(/^\/meetings\/([A-Za-z]{4}-?\d{3})(?:[/?]|$)/);
  const meetingCode = meetingMatch ? meetingMatch[1].toUpperCase().replace(/^([A-Z]{4})(\d{3})$/, '$1-$2') : null;
  const meetingInvite = meetingCode ? inviteFromLocation(path) : null;
  useEffect(() => {
    if (loading) return;
    if (user && authPath) { navigate('/dashboard'); return; }
    if (!user && !authPath && path !== '/' && !path.startsWith('/book/') && !path.startsWith('/group/') && !path.startsWith('/reset-password') && !path.startsWith('/invite/') && !path.startsWith('/join/') && !path.startsWith('/live/') && !isPublicEvents && !meetingInvite && !publicFormId) {
      navigate('/');
    }
  }, [user, loading, path, authPath, isPublicEvents, meetingInvite, publicFormId, navigate]);
  // A section this person can't use (a User without it switched on) sends them to their own home.
  const studioPath = /^\/streams\/[A-Za-z]{4}-?\d{3}(?:[/?]|$)/.test(path);
  const blocked = !!user && !publicFormId && !meetingCode && !studioPath && (() => { const f = featureForPath(path); return !!f && access.ready && !access.can(f); })();
  useEffect(() => {
    if (!loading && blocked) navigate(access.home);
  }, [loading, blocked, access.home, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <LoadingSpinner className="w-10 h-10" />
      </div>
    );
  }

  if (publicFormId) return <PublicFormPage key={publicFormId} formId={publicFormId} />;

  // Public booking page (no auth required)
  if (path.startsWith('/book/') || path.startsWith('/group/')) {
    const slug = path.split('/')[2]?.split('?')[0];
    return <BookingPage slug={slug} isGroup={path.startsWith('/group/')} />;
  }

  if (isPublicEvents) {
    const [, , a, b] = path.split('?')[0].split('/');
    if (a === 'ticket' && b) return <TicketPage key={b} token={b} />;
    if (a) return <EventDetailPage key={a} slug={decodeURIComponent(a)} />;
    return <EventsHomePage />;
  }

  // Meeting invite link without an account: join as a guest
  if (!user && meetingCode && meetingInvite) return <MeetingRoomPage key={meetingCode} code={meetingCode} invite={meetingInvite} />;

  // Guest link for a workspace (no account needed)
  if (path.startsWith('/join/')) {
    const token = path.split('/')[2]?.split('?')[0] ?? '';
    return <GuestJoinPage token={token} />;
  }

  // Watching a stream: anyone with the watch link, signed in or not.
  const liveMatch = path.match(/^\/live\/([A-Za-z]{4}-?\d{3})(?:[/?]|$)/);
  if (liveMatch) {
    const code = liveMatch[1].toUpperCase().replace(/^([A-Z]{4})(\d{3})$/, '$1-$2');
    return <WatchPage key={code} code={code} watch={watchFromLocation(path)} />;
  }

  // Invitation acceptance page (no auth required to view, auth to accept)
  if (path.startsWith('/invite/')) {
    const token = path.split('/')[2]?.split('?')[0];
    return <AcceptInvitePage token={token} />;
  }

  // Auth page (includes sign in, sign up, forgot password, reset password)
  if (!user) {
    if (path.startsWith('/reset-password') || window.location.hash.includes('reset-password')) return <AuthPage />;
    if (authPath) return <AuthPage key={path} initialMode={path === '/signup' ? 'signup' : 'signin'} onBack={() => navigate('/')} />;
    return <HomePage />;
  }

  // A meeting room is full screen, without the sidebar and top bar
  if (meetingCode) return <MeetingRoomPage key={meetingCode} code={meetingCode} invite={meetingInvite} />;

  // The stream studio is full screen too
  const studioMatch = path.match(/^\/streams\/([A-Za-z]{4}-?\d{3})(?:[/?]|$)/);
  if (studioMatch) {
    const code = studioMatch[1].toUpperCase().replace(/^([A-Z]{4})(\d{3})$/, '$1-$2');
    return <StreamStudioPage key={code} code={code} />;
  }

  // Create-a-workspace wizard is full screen, without the sidebar and top bar
  if (path === '/workspace/new' || path.startsWith('/workspace/new?')) {
    return <CreateSpaceWizard />;
  }

  // Authenticated app
  const renderPage = () => {
    if (blocked) return null;
    if (path === '/dashboard' || path === '/') return <Dashboard />;
    const contactMatch = path.match(/^\/contacts\/([^/?]+)/);
    if (contactMatch) return <ContactDetailPage key={contactMatch[1]} contactId={contactMatch[1]} />;
    if (path.startsWith('/contacts')) return <ContactsPage />;
    if (path.startsWith('/calendars/groups/') && user) {
      const groupId = path.split('/')[3]?.split('?')[0];
      return <GroupCalendarSettingsPage groupId={groupId} onBack={() => navigate('/calendars')} />;
    }
    if (path.startsWith('/calendars')) return <CalendarsPage />;
    if (path.match(/^\/forms\/[^/]+\/edit$/)) {
      const formId = path.split('/')[2]?.split('?')[0];
      return <FormBuilder formId={formId} onBack={() => navigate('/forms')} />;
    }
    if (path.startsWith('/forms')) return <FormsPage />;
    if (path.startsWith('/workflows/')) {
      const wfId = path.split('/')[2]?.split('?')[0] ?? '';
      return <Builder key={wfId} id={wfId && wfId !== 'new' ? wfId : null} />;
    }
    if (path.startsWith('/workflows')) return <WorkflowsHome />;
    if (path.startsWith('/recordings')) return <RecordingsPage />;
    if (path.startsWith('/characters')) return <CharactersPage />;
    if (path.startsWith('/ai-hub')) return <AIAgentPage />;
    if (path.startsWith('/settings')) return <SettingsPage />;
    if (path.startsWith('/rooms')) return <RoomsPage />;
    if (path.startsWith('/streams')) return <StreamsPage />;
    if (path.startsWith('/meetings')) return <MeetingsPage />;
    if (path === '/events/new') return <EventBuilder />;
    const eventMatch = path.match(/^\/events\/([0-9a-f-]{36})(\/edit)?(?:[/?]|$)/);
    if (eventMatch) return eventMatch[2] ? <EventBuilder key={eventMatch[1]} eventId={eventMatch[1]} /> : <EventManagePage key={eventMatch[1]} eventId={eventMatch[1]} />;
    if (path.startsWith('/events')) return <EventsPage />;
    if (path.startsWith('/webinars')) return <ComingSoonPage title="Webinars" description="Host live and on-demand webinars" icon={MonitorPlay} />;
    if (path.startsWith('/conversations')) return <ConversationsPage />;
    if (path.startsWith('/media-library')) return <ComingSoonPage title="Media Library" description="Store and organize your media assets" icon={FolderOpen} />;
    if (/^\/workspaces?(?:[/?]|$)/.test(path)) return <WorkspacesPage />;
    return <Dashboard />;
  };

  // The menu on the left (with the top bar), or, once you open a feature, that feature on the whole
  // screen with the features in a dock along the bottom. A workspace you're in stays connected
  // while you use another feature, but out of sight: only the feature you open shows. Its icon in
  // the dock has a dot and takes you back; Leave closes it.
  const liveSpace = spaceSlug ?? dockedSpace;
  const hiddenSpace = !spaceSlug && !!dockedSpace;
  return (
    <SpaceDockContext.Provider value={dockApi}>
      <Sidebar currentPath={path} onNavigate={navigate} open={navOpen} onClose={() => setNavOpen(false)} />
      {!spaceSlug && (
        <div className="min-h-screen bg-white">
          <div className={cn('flex flex-col min-h-screen transition-[margin] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]', navOpen && 'lg:ml-[240px]')}>
            {navOpen && (
              <TopBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onQuickCreate={() => navigate('/calendars')}
              />
            )}
            {/* Each section fades in with a slight rise when you move to it. */}
            <main key={path.split(/[/?]/)[1] || 'dashboard'} className={cn('flex flex-1 flex-col px-4 lg:px-6 pt-5 lg:pt-6 animate-page-in', navOpen ? 'pb-6' : 'pb-[84px]')}>
              {/* Every page fills the screen: its root grows to the bottom (see .page in index.css). */}
              <div className="flex min-h-0 flex-1 flex-col">
                <ErrorBoundary what="this page" resetKey={section} onBack={() => navigate('/dashboard')} backLabel="Back to Dashboard"><Suspense fallback={pageSpinner}>{renderPage()}</Suspense></ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      )}
      {liveSpace && (
        <div
          className={cn(
            'fixed right-0 top-0 z-40 overflow-hidden bg-navy-900 transition-[left] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
            navOpen ? 'bottom-0 left-0 lg:left-[240px]' : 'bottom-[60px] left-0',
            hiddenSpace && 'hidden',
          )}
          aria-hidden={hiddenSpace || undefined}
        >
          <ErrorBoundary what="this workspace" dark onBack={dockApi.leave} backLabel="Back to Workspaces">
            <Suspense fallback={pageSpinner}><SpacePage key={liveSpace} slug={liveSpace} /></Suspense>
          </ErrorBoundary>
        </div>
      )}
      {!navOpen && (
        <div className={cn('fixed inset-x-0 bottom-0 z-50 flex items-center justify-center px-2', DOCK_STRIP, spaceSlug ? 'bg-navy-950' : 'pointer-events-none')}>
          <div className="pointer-events-auto">
            <FeatureDock currentPath={path} onNavigate={navigate} onOpenMenu={() => setNavOpen(true)} dark={!!spaceSlug}
              liveSpace={hiddenSpace ? dockedSpace : null} onBackToSpace={dockApi.expand} />
          </div>
        </div>
      )}
    </SpaceDockContext.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary what="SYNAPSE" onBack={() => { window.location.hash = '#/dashboard'; window.location.reload(); }} backLabel="Reload SYNAPSE">
          <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center"><LoadingSpinner className="w-10 h-10" /></div>}>
            <AppContent />
          </Suspense>
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}
