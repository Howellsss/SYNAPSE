import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { useGmailReturnNotice } from '@/lib/email-accounts';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { AuthPage } from '@/pages/AuthPage';
import { HomePage } from '@/pages/HomePage';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { Dashboard } from '@/pages/Dashboard';
import { ContactsPage } from '@/pages/ContactsPage';
import { ContactDetailPage } from '@/pages/ContactDetailPage';
import { CalendarsPage } from '@/pages/CalendarsPage';
import { FormsPage } from '@/pages/FormsPage';
import { FormBuilder } from '@/pages/FormBuilder';
import { WorkflowsPage } from '@/pages/WorkflowsPage';
import { RecordingsPage } from '@/pages/RecordingsPage';
import { AIAgentPage } from '@/pages/AIAgentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { MeetingRoomPage } from '@/pages/MeetingRoomPage';
import { BookingPage } from '@/pages/BookingPage';
import { GroupCalendarSettingsPage } from '@/pages/GroupCalendarSettingsPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';
import { CreateSpaceWizard } from '@/pages/CreateSpaceWizard';
import { SpacePage } from '@/pages/SpacePage';
import { GuestJoinPage } from '@/pages/GuestJoinPage';
import { EventsHomePage } from '@/pages/events/EventsHomePage';
import { EventDetailPage } from '@/pages/events/EventDetailPage';
import { TicketPage } from '@/pages/events/TicketPage';
import { EventsPage } from '@/pages/events/EventsPage';
import { EventBuilder } from '@/pages/events/EventBuilder';
import { EventManagePage } from '@/pages/events/EventManagePage';
import { MonitorPlay, MessagesSquare, FolderOpen } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/States';

function AppContent() {
  const { user, loading } = useAuth();
  const [path, navigate] = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  useGmailReturnNotice(path);

  const authPath = path === '/signin' || path === '/signup';
  // Public events pages: /e, /e/<slug>, /e/ticket/<token>. Open to everyone, signed in or not.
  const isPublicEvents = path === '/e' || path.startsWith('/e/') || path.startsWith('/e?');
  useEffect(() => {
    if (loading) return;
    if (user && authPath) { navigate('/dashboard'); return; }
    if (!user && !authPath && path !== '/' && !path.startsWith('/book/') && !path.startsWith('/group/') && !path.startsWith('/reset-password') && !path.startsWith('/invite/') && !path.startsWith('/join/') && !isPublicEvents) {
      navigate('/');
    }
  }, [user, loading, path, authPath, isPublicEvents, navigate]);

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

  // Guest link for a workspace (no account needed)
  if (path.startsWith('/join/')) {
    const token = path.split('/')[2]?.split('?')[0] ?? '';
    return <GuestJoinPage token={token} />;
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
  const meetingMatch = path.match(/^\/meetings\/([A-Za-z]{4}-?\d{3})(?:[/?]|$)/);
  if (meetingMatch) {
    const code = meetingMatch[1].toUpperCase().replace(/^([A-Z]{4})(\d{3})$/, '$1-$2');
    return <MeetingRoomPage key={code} code={code} />;
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
    if (path.startsWith('/workflows')) return <WorkflowsPage />;
    if (path.startsWith('/recordings')) return <RecordingsPage />;
    if (path.startsWith('/ai-hub')) return <AIAgentPage />;
    if (path.startsWith('/settings')) return <SettingsPage />;
    if (path.startsWith('/meetings')) return <MeetingsPage />;
    if (path === '/events/new') return <EventBuilder />;
    const eventMatch = path.match(/^\/events\/([0-9a-f-]{36})(\/edit)?(?:[/?]|$)/);
    if (eventMatch) return eventMatch[2] ? <EventBuilder key={eventMatch[1]} eventId={eventMatch[1]} /> : <EventManagePage key={eventMatch[1]} eventId={eventMatch[1]} />;
    if (path.startsWith('/events')) return <EventsPage />;
    if (path.startsWith('/webinars')) return <ComingSoonPage title="Webinars" description="Host live and on-demand webinars" icon={MonitorPlay} />;
    if (path.startsWith('/conversations')) return <ComingSoonPage title="Conversations" description="Manage messages across channels" icon={MessagesSquare} />;
    if (path.startsWith('/media-library')) return <ComingSoonPage title="Media Library" description="Store and organize your media assets" icon={FolderOpen} />;
    const spaceMatch = path.match(/^\/workspace\/([a-z0-9-]+)(?:[/?]|$)/);
    if (spaceMatch) return <SpacePage key={spaceMatch[1]} slug={spaceMatch[1]} />;
    if (/^\/workspaces?(?:[/?]|$)/.test(path)) return <WorkspacesPage />;
    return <Dashboard />;
  };

  // Inside a space the world fills the screen next to the sidebar: no top bar, no padding.
  const inSpace = /^\/workspace\/[a-z0-9-]+(?:[/?]|$)/.test(path);
  if (inSpace) {
    return (
      <div className="h-[100dvh] overflow-hidden bg-white">
        <Sidebar currentPath={path} onNavigate={navigate} />
        <main className="h-full lg:ml-[240px]">{renderPage()}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Sidebar currentPath={path} onNavigate={navigate} />
      <div className="lg:ml-[240px] flex flex-col min-h-screen">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onQuickCreate={() => navigate('/calendars')}
        />
        {/* Each section fades in with a slight rise when you move to it. */}
        <main key={path.split(/[/?]/)[1] || 'dashboard'} className="flex-1 px-4 lg:px-10 py-6 lg:py-8 animate-page-in">{renderPage()}</main>
      </div>
    </div>
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
