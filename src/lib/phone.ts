/**
 * Phone numbers with a country code: the Phone field's country picker. The answer is saved as
 * "+234 8031234567" (the code, a space, the number without its leading 0).
 */

// ISO 3166 code → calling code, for every country people live in.
const DIAL_DATA = 'AF93 AX358 AL355 DZ213 AS1684 AD376 AO244 AI1264 AG1268 AR54 AM374 AW297 AU61 AT43 AZ994 BS1242 BH973 BD880 BB1246 BY375 BE32 BZ501 BJ229 BM1441 BT975 BO591 BQ599 BA387 BW267 BR55 IO246 BN673 BG359 BF226 BI257 CV238 KH855 CM237 CA1 KY1345 CF236 TD235 CL56 CN86 CX61 CC61 CO57 KM269 CG242 CD243 CK682 CR506 CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1767 DO1809 EC593 EG20 SV503 GQ240 ER291 EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233 GI350 GR30 GL299 GD1473 GP590 GU1671 GT502 GG44 GN224 GW245 GY592 HT509 VA39 HN504 HK852 HU36 IS354 IN91 ID62 IR98 IQ964 IE353 IM44 IL972 IT39 JM1876 JP81 JE44 JO962 KZ7 KE254 KI686 KP850 KR82 KW965 KG996 LA856 LV371 LB961 LS266 LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 MU230 YT262 MX52 FM691 MD373 MC377 MN976 ME382 MS1664 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 NI505 NE227 NG234 NU683 NF672 MK389 MP1670 NO47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PN64 PL48 PT351 PR1787 QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1869 LC1758 MF590 PM508 VC1784 WS685 SM378 ST239 SA966 SN221 RS381 SC248 SL232 SG65 SX1721 SK421 SI386 SB677 SO252 ZA27 SS211 ES34 LK94 SD249 SR597 SJ47 SE46 CH41 SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1868 TN216 TR90 TM993 TC1649 TV688 UG256 UA380 AE971 GB44 US1 UY598 UZ998 VU678 VE58 VN84 VG1284 VI1340 WF681 EH212 YE967 ZM260 ZW263 XK383';

export const DIAL: Record<string, string> = Object.fromEntries(DIAL_DATA.split(' ').map((s) => [s.slice(0, 2), s.slice(2)]));
// Where several places share a code, the one a saved number is read back as.
const MAIN: Record<string, string> = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 64: 'NZ', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW' };

/** The flag for a country code, drawn from its two letters. */
export const flagOf = (iso: string) => iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

let list: { iso: string; name: string; dial: string }[] | null = null;
/** Every country with its calling code, A to Z by name. */
export function dialCountries(): { iso: string; name: string; dial: string }[] {
  if (list) return list;
  let name = (iso: string) => iso;
  try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); name = (iso) => dn.of(iso) ?? iso; } catch { /* old browsers: codes only */ }
  list = Object.entries(DIAL).map(([iso, dial]) => ({ iso, name: name(iso), dial })).sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

/** A saved answer split into its country and the number typed (the field's country when there's no code). */
export function splitPhone(value: string, fallbackIso: string): { iso: string; number: string } {
  const m = /^\+(\d{1,4})\s+(.*)$/.exec(value.trim());
  if (m) {
    // Several countries share a code (+1, +44, +7…): keep the field's own country when it matches.
    const iso = DIAL[fallbackIso] === m[1] ? fallbackIso : MAIN[m[1]] ?? Object.keys(DIAL).find((k) => DIAL[k] === m[1]) ?? fallbackIso;
    return { iso, number: m[2] };
  }
  return { iso: fallbackIso, number: value };
}

/** "+234 8031234567": the code and the number, without the 0 people put in front at home. Empty stays empty. */
export function joinPhone(iso: string, typed: string): string {
  const t = typed.trim();
  if (!t) return '';
  if (t.startsWith('+')) return t; // they typed a full international number themselves
  return `+${DIAL[iso] ?? ''} ${t.replace(/^0(?=\d)/, '')}`;
}
