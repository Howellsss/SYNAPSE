import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { useGmailReturnNotice } from '@/lib/email-accounts';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { DOCK_STRIP, FeatureDock } from '@/components/layout/FeatureDock';
import { AuthPage } from '@/pages/AuthPage';
import { HomePage } from '@/pages/HomePage';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { Dashboard } from '@/pages/Dashboard';
import { ContactsPage } from '@/pages/ContactsPage';
import { ContactDetailPage } from '@/pages/ContactDetailPage';
import { CalendarsPage } from '@/pages/CalendarsPage';
import { FormsPage } from '@/pages/FormsPage';
import { FormBuilder } from '@/pages/FormBuilder';
import { WorkflowsHome } from '@/components/workflows/WorkflowsHome';
import { Builder } from '@/components/workflows/Builder';
import { RecordingsPage } from '@/pages/RecordingsPage';
import { CharactersPage } from '@/pages/CharactersPage';
import { AIAgentPage } from '@/pages/AIAgentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { MeetingRoomPage } from '@/pages/MeetingRoomPage';
import { inviteFromLocation } from '@/meetings/codes';
import { BookingPage } from '@/pages/BookingPage';
import { GroupCalendarSettingsPage } from '@/pages/GroupCalendarSettingsPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { ConversationsPage } from '@/pages/ConversationsPage';
import { StreamsPage } from '@/pages/StreamsPage';
import { StreamStudioPage } from '@/pages/StreamStudioPage';
import { WatchPage } from '@/pages/WatchPage';
import { watchFromLocation } from '@/lib/streams';
import { CreateSpaceWizard } from '@/pages/CreateSpaceWizard';
import { SpacePage } from '@/pages/SpacePage';
import { GuestJoinPage } from '@/pages/GuestJoinPage';
import { EventsHomePage } from '@/pages/events/EventsHomePage';
import { EventDetailPage } from '@/pages/events/EventDetailPage';
import { TicketPage } from '@/pages/events/TicketPage';
import { EventsPage } from '@/pages/events/EventsPage';
import { EventBuilder } from '@/pages/events/EventBuilder';
import { EventManagePage } from '@/pages/events/EventManagePage';
import { MonitorPlay, FolderOpen } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/States';
import { SpaceDockContext, type SpaceDock } from '@/context/SpaceDockContext';
import { cn } from '@/lib/utils';

/** Where SYNAPSE shows its menu on the left rather than a feature full screen. */
const isMenuSection = (section: string) => section === 'dashboard' || section === 'signin' || section === 'signup';

function AppContent() {
  const { user, loading } = useAuth();
  const [path, navigate] = useRouter();
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
  // Public events pages: /e, /e/<slug>, /e/ticket/<token>. Open to everyone, signed in or not.
  const isPublicEvents = path === '/e' || path.startsWith('/e/') || path.startsWith('/e?');
  // A meeting invite link (/meetings/CODE?invite=…) opens for everyone, signed in or not.
  const meetingMatch = path.match(/^\/meetings\/([A-Za-z]{4}-?\d{3})(?:[/?]|$)/);
  const meetingCode = meetingMatch ? meetingMatch[1].toUpperCase().replace(/^([A-Z]{4})(\d{3})$/, '$1-$2') : null;
  const meetingInvite = meetingCode ? inviteFromLocation(path) : null;
  useEffect(() => {
    if (loading) return;
    if (user && authPath) { navigate('/dashboard'); return; }
    if (!user && !authPath && path !== '/' && !path.startsWith('/book/') && !path.startsWith('/group/') && !path.startsWith('/reset-password') && !path.startsWith('/invite/') && !path.startsWith('/join/') && !path.startsWith('/live/') && !isPublicEvents && !meetingInvite) {
      navigate('/');
    }
  }, [user, loading, path, authPath, isPublicEvents, meetingInvite, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <LoadingSpinner className="w-10 h-10" />
      </div>
    );
  }

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
            <main key={path.split(/[/?]/)[1] || 'dashboard'} className={cn('flex-1 px-4 lg:px-6 pt-5 lg:pt-6 animate-page-in', navOpen ? 'pb-6' : 'pb-[84px]')}>{renderPage()}</main>
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
          <SpacePage key={liveSpace} slug={liveSpace} />
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
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
