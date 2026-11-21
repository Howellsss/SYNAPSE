// Link previews for event pages (WhatsApp, Instagram, Facebook, X, Telegram, iMessage, LinkedIn…).
// Those apps read the page's meta tags without running the app, so they'd only ever see the SYNAPSE
// homepage card. vercel.json sends their requests for /e/<slug> here; people's browsers never come here.
// Returns the normal page with the event's own title, date, place and poster. Any problem: the
// normal page, unchanged.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://parmtumfpsdtdtgwvscq.supabase.co';
// The public (anon) key: already in the site's JavaScript, safe to have here.
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhcm10dW1mcHNkdGR0Z3d2c2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzI5NDAsImV4cCI6MjEwNTk0ODk0MH0.3U_cY1tshBU1WYvUjGa8LGwZKM8UqUeox62Jipe2SQ4';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function whenText(e) {
  if (!e.starts_at) return 'Date to be announced';
  const tz = e.timezone ? { timeZone: e.timezone } : {};
  const s = new Date(e.starts_at);
  const day = s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...tz });
  const note = (e.time_note || '').trim();
  if (note) return day + ' · ' + note;
  return day + ' · ' + s.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz });
}

export function placeText(e) {
  if (e.mode === 'online') return 'Online';
  return [e.venue_name, e.city].filter(Boolean).join(', ');
}

/** Swaps the homepage's title, description, image and address for the event's. */
export function withEventTags(html, e, url) {
  const title = [e.title, e.tagline].filter(Boolean).join(' · ');
  const desc = [whenText(e), placeText(e)].filter(Boolean).join(' · ') + (e.summary ? '. ' + e.summary : '');
  const img = e.cover_url || '';
  const set = (re, value) => { html = html.replace(re, (m, a, b) => a + esc(value) + b); };
  set(/(<title>)[^<]*(<\/title>)/, title);
  set(/(<meta name="description" content=")[^"]*(")/, desc);
  set(/(<meta property="og:url" content=")[^"]*(")/, url);
  set(/(<meta property="og:title" content=")[^"]*(")/, title);
  set(/(<meta property="og:description" content=")[^"]*(")/, desc);
  set(/(<meta name="twitter:title" content=")[^"]*(")/, title);
  set(/(<meta name="twitter:description" content=")[^"]*(")/, desc);
  set(/(<meta property="og:site_name" content=")[^"]*(")/, e.organiser_name || 'SYNAPSE Events');
  if (img) {
    set(/(<meta property="og:image" content=")[^"]*(")/, img);
    set(/(<meta name="twitter:image" content=")[^"]*(")/, img);
    set(/(<meta property="og:image:alt" content=")[^"]*(")/, title);
    // The poster's own shape, not the homepage card's.
    html = html.replace(/\s*<meta property="og:image:width"[^>]*>\s*<meta property="og:image:height"[^>]*>/, '');
  }
  return html;
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'synapseconnector.com';
  const origin = 'https://' + host;
  const slug = String(req.query.slug || '').split('/')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  let html;
  try {
    html = await (await fetch(origin + '/index.html', { headers: { 'user-agent': 'synapse-preview' } })).text();
  } catch {
    res.statusCode = 302; res.setHeader('Location', origin + '/'); return res.end();
  }
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/public_event', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(4000),
    });
    const e = r.ok ? await r.json() : null;
    if (e && e.title) html = withEventTags(html, e, origin + '/e/' + slug);
  } catch { /* the normal page */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.end(html);
}
