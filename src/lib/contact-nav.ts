// The contact list's current order, handed from ContactsPage to ContactDetailPage
// so the detail page can offer previous/next arrows ("2 / 2111").
export const CONTACT_NAV_KEY = 'synapse.contactNav';

export interface ContactNav {
  ids: string[];
  offset: number;
  total: number;
}

export function saveContactNav(nav: ContactNav): void {
  try { sessionStorage.setItem(CONTACT_NAV_KEY, JSON.stringify(nav)); } catch { /* storage unavailable */ }
}

export function readContactNav(): ContactNav | null {
  try { return JSON.parse(sessionStorage.getItem(CONTACT_NAV_KEY) ?? 'null'); } catch { return null; }
}
