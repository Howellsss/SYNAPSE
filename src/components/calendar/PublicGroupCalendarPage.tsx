import {
  Calendar as CalendarIcon, Clock,
  Video, Phone, MapPin, User, Globe,
  MessageCircle, Briefcase, Mail, Feather, Heart, Users, BookOpen, Mic, Star, GraduationCap, Stethoscope, HandHeart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Calendar as CalendarType } from '@/types';
import {
  type GroupPageConfig,
  headingSizePx, bodySizePx, letterSpacingCss, lineHeightCss,
  maxContentWidthCss, pageSpacingPx, fontStack, isLightColor,
  getChildPresentation,
} from '@/lib/group-page-config';

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland',
];

export function getTimezoneOptions(currentTz: string): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    const set = new Set([...COMMON_TIMEZONES, ...all]);
    if (currentTz && !set.has(currentTz)) set.add(currentTz);
    return [...set].sort();
  } catch {
    return [...COMMON_TIMEZONES].sort();
  }
}

const ICON_MAP: Record<string, typeof CalendarIcon> = {
  Calendar: CalendarIcon,
  Clock: Clock,
  Video: Video,
  Phone: Phone,
  MapPin: MapPin,
  User: User,
  Users: Users,
  Globe: Globe,
  Feather: Feather,
  MessageCircle: MessageCircle,
  Briefcase: Briefcase,
  Mail: Mail,
  Heart: Heart,
  HandHeart: HandHeart,
  BookOpen: BookOpen,
  Mic: Mic,
  Star: Star,
  GraduationCap: GraduationCap,
  Stethoscope: Stethoscope,
};

/** Icon shown on a calendar tab when the page designer hasn't set one. */
function defaultIconFor(cal: CalendarType): typeof CalendarIcon {
  if (cal.location_type === 'phone') return Phone;
  if (cal.location_type === 'in_person') return MapPin;
  if (cal.location_type === 'synapse_meeting') return Video;
  return CalendarIcon;
}

interface Props {
  config: GroupPageConfig;
  groupName: string;
  groupDescription: string | null;
  calendars: CalendarType[];
  selectedCalendarId: string | null;
  onSelectCalendar: (cal: CalendarType) => void;
  visitorTz?: string;
  onVisitorTzChange?: (tz: string) => void;
  /** Content for the right panel: form, date/time picker, confirmation, etc. */
  children?: React.ReactNode;
  /** Optional step label shown above right panel content */
  rightPanelLabel?: string;
  preview?: boolean;
}

export function PublicGroupCalendarPage({
  config, groupName, groupDescription, calendars, selectedCalendarId,
  onSelectCalendar, visitorTz, onVisitorTzChange, children, rightPanelLabel,
  preview = false,
}: Props) {
  const { branding: b, typography: t, layout: l, header: h, footer: f } = config;

  const headingFont = fontStack(t.headingFont);
  const bodyFont = fontStack(t.bodyFont);

  const isLight = isLightColor(b.backgroundColor);
  const textColor = isLight ? '#1a1a1a' : '#fff';
  const mutedColor = isLight ? '#6b6b6b' : 'rgba(255,255,255,0.55)';
  const navBorder = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';

  // Build nav items from child calendars + any custom nav items
  const calendarNavItems = calendars.map((cal, idx) => {
    const pres = getChildPresentation(config, cal.id);
    const customNav = config.navigation.find(n => n.type === 'calendar' && n.target === cal.id);
    return {
      id: cal.id,
      label: pres?.navLabel ?? customNav?.label ?? cal.name,
      icon: pres?.navIcon ?? customNav?.icon ?? null,
      calendar: cal,
      sort_order: idx,
    };
  });

  // Add non-calendar nav items (external, section)
  const extraNav = config.navigation.filter(n => n.type !== 'calendar' && n.visible);

  type TabItem = {
    id: string;
    label: string;
    icon: string | null;
    type: GroupPageConfig['navigation'][number]['type'];
    calendar?: CalendarType;
    target?: string | null;
  };
  const allNavItems: TabItem[] = [
    ...calendarNavItems.map(c => ({ ...c, type: 'calendar' as const })),
    ...extraNav.map(n => ({ id: n.id, label: n.label, icon: n.icon, type: n.type, target: n.target })),
  ];

  const selectedCal = calendars.find(c => c.id === selectedCalendarId) ?? null;
  const selectedPres = selectedCal ? getChildPresentation(config, selectedCal.id) : null;

  // Left panel content
  const leftHeading = selectedPres?.heading ?? (selectedCal?.name ?? groupName);
  const leftDesc = selectedPres?.description ?? (selectedCal?.description ?? groupDescription);
  const leftLabel = selectedPres?.label ?? null;
  const leftImage = selectedPres?.image ?? null;
  const leftBgImage = selectedPres?.backgroundImage ?? null;
  const leftBgColor = selectedPres?.leftPanelColor ?? b.leftPanelColor;
  const leftIsLight = isLightColor(leftBgColor);
  const leftTextColor = leftIsLight ? '#1a1a1a' : '#fff';

  // Page background style
  const bgStyle: React.CSSProperties = {
    backgroundColor: b.backgroundColor,
    fontFamily: bodyFont,
    color: textColor,
  };
  if (b.backgroundImage) {
    bgStyle.backgroundImage = `url(${b.backgroundImage})`;
    bgStyle.backgroundSize = 'cover';
    bgStyle.backgroundPosition = b.backgroundPosition;
    bgStyle.backgroundAttachment = 'fixed';
  }

  const overlayStyle: React.CSSProperties | undefined = b.backgroundImage && b.backgroundOverlay > 0
    ? { position: 'fixed' as const, inset: 0, backgroundColor: b.backgroundColor, opacity: b.backgroundOverlay / 100, pointerEvents: 'none' as const, zIndex: 0 }
    : undefined;

  function handleNavClick(item: { type: string; calendar?: CalendarType; target?: string | null }) {
    if (preview) return;
    if (item.type === 'calendar' && item.calendar) {
      onSelectCalendar(item.calendar);
    } else if (item.type === 'external' && item.target) {
      window.open(item.target, '_blank', 'noopener');
    }
  }

  // Split layout (default): one editorial card. Calendar tabs run across the top; below them a
  // coloured left panel (number, heading, description) sits flush against a white right panel
  // holding the selected calendar's form or date/time picker.
  if (l.layout === 'split') {
    const leftWidth = l.leftPanelWidth === 'narrow' ? '30%' : l.leftPanelWidth === 'wide' ? '40%' : '34%';
    const selectedIndex = calendarNavItems.findIndex(c => c.id === selectedCalendarId);
    const panelNumber = leftLabel ?? (selectedIndex >= 0 ? String(selectedIndex + 1).padStart(2, '0') : null);
    const tabCount = Math.max(allNavItems.length, 1);

    return (
      <div className="min-h-screen flex flex-col relative" style={bgStyle}>
        {overlayStyle && <div style={overlayStyle} />}

        <div className={cn('flex-1 relative z-[1] flex flex-col justify-center', pageSpacingPx(l.pageSpacing === 'normal' ? 'spacious' : l.pageSpacing))}>
          <div className={cn('mx-auto w-full px-4 sm:px-6', maxContentWidthCss(l.maxContentWidth))}>
            {(b.organizationName || (b.logoUrl && h.showLogo)) && (
              <div className="mb-6 flex items-center gap-3">
                {b.logoUrl && h.showLogo && <img src={b.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />}
                {b.organizationName && (
                  <span className="text-sm font-semibold tracking-wide" style={{ color: textColor, fontFamily: headingFont }}>{b.organizationName}</span>
                )}
              </div>
            )}

            <div className="overflow-hidden bg-white shadow-2xl">
              {/* Calendar tabs */}
              <nav aria-label="Booking options" className="overflow-x-auto border-b border-gray-200 bg-white">
                <div className="flex min-w-full lg:grid" style={{ gridTemplateColumns: `repeat(${tabCount}, minmax(0, 1fr))` }}>
                  {allNavItems.map(item => {
                    const Icon = (item.icon && ICON_MAP[item.icon]) || (item.type === 'calendar' && item.calendar ? defaultIconFor(item.calendar) : CalendarIcon);
                    const isActive = item.type === 'calendar' && item.calendar?.id === selectedCalendarId;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNavClick(item)}
                        aria-current={isActive ? 'page' : undefined}
                        className="group relative flex shrink-0 items-center gap-3 whitespace-nowrap px-6 py-6 text-left text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors sm:px-8"
                        style={{ color: isActive ? '#071A3D' : '#6B7280', fontFamily: bodyFont }}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" style={{ color: b.primaryAccent }} />
                        <span className="group-hover:text-[#071A3D]">{item.label}</span>
                        <span
                          aria-hidden
                          className="absolute bottom-0 left-6 right-6 h-[3px] transition-opacity sm:left-8 sm:right-8"
                          style={{ backgroundColor: b.primaryAccent, opacity: isActive ? 1 : 0 }}
                        />
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* Panels */}
              <div className="grid grid-cols-1 lg:grid-cols-[var(--gcal-left)_minmax(0,1fr)]" style={{ ['--gcal-left' as string]: leftWidth }}>
                {/* LEFT PANEL */}
                <div
                  className="relative flex min-h-[260px] flex-col overflow-hidden p-8 sm:p-12 lg:min-h-[560px]"
                  style={{
                    backgroundColor: leftBgColor,
                    ...(leftBgImage ? { backgroundImage: `url(${leftBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
                  }}
                >
                  {leftBgImage && <div className="absolute inset-0 bg-black/35" />}
                  <div className="relative z-[1] flex flex-1 flex-col">
                    {panelNumber && (
                      <span className="font-mono text-sm font-medium" style={{ color: b.primaryAccent }}>{panelNumber}</span>
                    )}
                    <div className="mt-10 lg:mt-16">
                      <h2
                        className={cn(headingSizePx(t.headingSize), 'tracking-tight')}
                        style={{
                          color: leftTextColor,
                          fontFamily: headingFont,
                          fontWeight: t.headingWeight,
                          letterSpacing: letterSpacingCss(t.letterSpacing),
                          lineHeight: 1.08,
                        }}
                      >
                        {leftHeading}
                      </h2>
                      {leftDesc && (
                        <p
                          className={cn(bodySizePx(t.bodySize), 'mt-6 max-w-sm')}
                          style={{ color: leftIsLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)', fontFamily: bodyFont, lineHeight: 1.65 }}
                        >
                          {leftDesc}
                        </p>
                      )}
                      {leftImage && (
                        <div className="mt-8 overflow-hidden">
                          <img src={leftImage} alt="" className="h-44 w-full object-cover" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIGHT PANEL */}
                <div
                  className="gcal-editorial min-w-0 bg-white p-8 sm:p-12"
                  style={{ ['--gcal-accent' as string]: b.primaryAccent, ['--gcal-button' as string]: b.buttonColor, ['--gcal-button-text' as string]: isLightColor(b.buttonColor) ? '#1A160C' : '#ffffff' }}
                >
                  {children ?? (
                    <div className="flex h-full items-center justify-center text-sm text-gray-400">
                      Select an option above.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Timezone selector */}
            {visitorTz && onVisitorTzChange && (
              <div className="mt-5 flex items-center gap-2 text-sm" style={{ color: mutedColor }}>
                <Globe className="h-4 w-4" style={{ color: b.primaryAccent }} />
                <label htmlFor="gcal-tz" className="sr-only">Your time zone</label>
                <select
                  id="gcal-tz"
                  value={visitorTz}
                  onChange={e => onVisitorTzChange(e.target.value)}
                  className="cursor-pointer border-none bg-transparent text-sm focus:outline-none"
                  style={{ color: textColor }}
                >
                  {getTimezoneOptions(visitorTz).map((tz: string) => (
                    <option key={tz} value={tz} className="bg-white text-gray-800">{tz}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {f.visible && (f.text || f.showPoweredBy) && (
          <footer className="relative z-[1] mt-auto border-t" style={{ borderColor: navBorder }}>
            <div className={cn('mx-auto px-4 py-6 sm:px-6', maxContentWidthCss(l.maxContentWidth))}>
              {f.text && <p className="text-center text-xs" style={{ color: mutedColor, fontFamily: bodyFont }}>{f.text}</p>}
              {f.showPoweredBy && (
                <p className="mt-2 text-center text-xs" style={{ color: mutedColor, fontFamily: bodyFont }}>
                  Powered by <span style={{ color: b.primaryAccent, fontWeight: 600 }}>SYNAPSE</span>
                </p>
              )}
            </div>
          </footer>
        )}
      </div>
    );
  }

  // All public group layouts use the form-first split composition.
  // This keeps the selected calendar in the navigation while its booking experience stays in place.
  return (
    <div className="min-h-screen flex flex-col relative" style={bgStyle}>
      {overlayStyle && <div style={overlayStyle} />}

      {h.showAccentBar && <div className="h-1.5 relative z-[1]" style={{ backgroundColor: b.primaryAccent }} />}

      {/* Navigation */}
      <nav className="border-b sticky top-0 z-20 backdrop-blur-sm relative z-[1]" style={{ borderColor: navBorder, backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(9,19,43,0.9)' }}>
        <div className={cn('mx-auto flex items-center px-4 sm:px-6 py-3', maxContentWidthCss(l.maxContentWidth))}>
          {b.logoUrl && h.showLogo && <img src={b.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover mr-3 shrink-0" />}
          {b.organizationName && <span className="text-sm font-semibold mr-4 shrink-0 hidden sm:inline" style={{ color: textColor, fontFamily: headingFont }}>{b.organizationName}</span>}
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1">
            {allNavItems.map(item => {
              const Icon = item.icon ? ICON_MAP[item.icon] : null;
              const isActive = item.type === 'calendar' && item.calendar?.id === selectedCalendarId;
              return (
                <button key={item.id} onClick={() => handleNavClick(item)} className={cn('flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium transition whitespace-nowrap rounded-lg')}
                  style={isActive ? { backgroundColor: b.primaryAccent, color: isLightColor(b.primaryAccent) ? '#1a1a1a' : '#fff' } : { color: mutedColor }}>
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className={cn('flex-1 relative z-[1]', pageSpacingPx(l.pageSpacing))}>
        <div className={cn('mx-auto px-4 sm:px-6', maxContentWidthCss(l.maxContentWidth))}>
          {h.visible && (
            <div className={cn('mb-8', h.alignment === 'center' ? 'text-center' : 'text-left')}>
              <h1 className={cn(headingSizePx(t.headingSize), 'font-bold tracking-tight mb-3')} style={{ color: b.primaryAccent, fontFamily: headingFont, fontWeight: t.headingWeight, letterSpacing: letterSpacingCss(t.letterSpacing), lineHeight: lineHeightCss(t.lineHeight) }}>{h.title || groupName}</h1>
              {(h.description || groupDescription) && <p className={cn(bodySizePx(t.bodySize), 'max-w-xl leading-relaxed')} style={{ color: mutedColor, fontFamily: bodyFont, lineHeight: lineHeightCss(t.lineHeight), ...(h.alignment === 'center' ? { marginLeft: 'auto', marginRight: 'auto' } : {}) }}>{h.description || groupDescription}</p>}
            </div>
          )}

          {selectedCal && children && (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-5xl mx-auto">
              {rightPanelLabel && (
                <div className="px-6 sm:px-8 pt-6 pb-2 border-b border-gray-100">
                  <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{rightPanelLabel}</span>
                </div>
              )}
              <div className="p-6 sm:p-8">{children}</div>
            </div>
          )}

          {!selectedCal && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center" style={{ color: mutedColor }}>
              Select an appointment type above.
            </div>
          )}
        </div>
      </div>

      {f.visible && (
        <footer className="border-t mt-auto relative z-[1]" style={{ borderColor: navBorder }}>
          <div className={cn('mx-auto px-4 sm:px-6 py-6', maxContentWidthCss(l.maxContentWidth))}>
            {f.text && <p className="text-xs text-center" style={{ color: mutedColor, fontFamily: bodyFont }}>{f.text}</p>}
            {f.showPoweredBy && <p className="text-xs text-center mt-2" style={{ color: mutedColor, fontFamily: bodyFont }}>Powered by <span style={{ color: b.primaryAccent, fontWeight: 600 }}>SYNAPSE</span></p>}
          </div>
        </footer>
      )}
    </div>
  );
}
