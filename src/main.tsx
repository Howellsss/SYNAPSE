import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import { reloadForUpdate } from './lib/staleBuild';
import { movedAddress } from './lib/publicUrl';
import { prefetchEventFor } from './lib/eventPrefetch';
import { publicEventsPath, shortEventPath } from './lib/eventPaths';

// SYNAPSE moved to synapseconnector.com: the old address opens the same page there.
const moved = movedAddress(window.location.href);
if (moved) window.location.replace(moved);

// A new version went live while this tab was open: its old page files are gone, so reload once.
window.addEventListener('vite:preloadError', (event) => { if (reloadForUpdate()) event.preventDefault(); });

const root = createRoot(document.getElementById('root')!);

if (!import.meta.env.VITE_SUPABASE_URL || !(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)) {
  root.render(
    <div style={{ fontFamily: 'Inter, sans-serif', padding: '48px 24px', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Configuration required</h1>
      <p style={{ lineHeight: 1.6, color: '#555' }}>
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your hosting
        environment variables, then redeploy.
      </p>
    </div>
  );
} else {
  // Event links (/e/…) start in a small shell that loads only the events pages; everything else loads the full app.
  // Two separate imports (not one with a choice inside), so each only fetches its own files.
  // Older event links (/e/unscathed) show the short address (/unscathed).
  const short = !window.location.hash && shortEventPath(window.location.pathname + window.location.search);
  if (short) window.history.replaceState(null, '', short);
  const start = window.location.hash.slice(1) || window.location.pathname;
  const eventsPath = publicEventsPath(start);
  const render = (App: () => JSX.Element) => root.render(<StrictMode><App /></StrictMode>);
  if (eventsPath) {
    prefetchEventFor(eventsPath, import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);
    void import('./PublicEvents.tsx').then((m) => render(m.default));
  } else {
    void import('./App.tsx').then((m) => render(m.default));
  }
}
