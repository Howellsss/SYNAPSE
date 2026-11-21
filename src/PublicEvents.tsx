import { lazy, Suspense } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { LoadingSpinner } from '@/components/ui/States';
import { useRouter } from '@/lib/router';
import { publicEventsPath } from '@/lib/eventPaths';

/*
  The public events pages (/e, /e/<event>, /e/<event>/<type>, /e/ticket/…, /e/door/…) are what
  people open from a shared link, mostly on phones. They start here instead of in the full app, so
  they download only what they show: no workspace menu, dashboard or sign-in page, and they don't
  wait for the account to load. Leaving the events pages (e.g. "Host an event") loads the full app.
*/

const App = lazy(() => import('./App'));
const EventsHomePage = lazy(() => import('@/pages/events/EventsHomePage').then((m) => ({ default: m.EventsHomePage })));
const EventDetailPage = lazy(() => import('@/pages/events/EventDetailPage').then((m) => ({ default: m.EventDetailPage })));
const TicketPage = lazy(() => import('@/pages/events/TicketPage').then((m) => ({ default: m.TicketPage })));
const DoorPassPage = lazy(() => import('@/pages/events/DoorPassPage').then((m) => ({ default: m.DoorPassPage })));
const EventRegisterPage = lazy(() => import('@/pages/events/EventRegisterPage').then((m) => ({ default: m.EventRegisterPage })));

const spinner = <div className="min-h-screen bg-white flex items-center justify-center"><LoadingSpinner className="w-10 h-10" /></div>;

function EventsRoute({ path }: { path: string }) {
  const [, , a, b] = path.split('?')[0].split('/');
  if (a === 'ticket' && b) return <TicketPage key={b} token={b} />;
  if (a === 'door' && b) return <DoorPassPage key={b} token={b} />;
  if (a && b) return <EventRegisterPage key={`${a}/${b}`} slug={decodeURIComponent(a)} type={decodeURIComponent(b)} />;
  if (a) return <EventDetailPage key={a} slug={decodeURIComponent(a)} />;
  return <EventsHomePage />;
}

export default function PublicEvents() {
  const [raw] = useRouter();
  const path = publicEventsPath(raw);
  if (!path) return <Suspense fallback={spinner}><App /></Suspense>;
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary what="this page" onBack={() => { window.location.hash = '#/e'; window.location.reload(); }} backLabel="See all events">
          <Suspense fallback={spinner}><EventsRoute path={path} /></Suspense>
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}
