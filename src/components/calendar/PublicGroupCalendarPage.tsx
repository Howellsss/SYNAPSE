import {
  Calendar as CalendarIcon, Clock, Search,
  Video, Phone, MapPin, User, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HowellsLogo } from '@/components/layout/Sidebar';
import type { Calendar as CalendarType } from '@/types';
import {
  type GroupPageConfig, type NavItem, type ChildCalendarPresentation,
  headingSizePx, bodySizePx, letterSpacingCss, lineHeightCss,
  maxContentWidthCss, pageSpacingPx, coverHeightPx, fontStack, isLightColor,
  leftPanelWidthCss, getChildPresentation,
} from '@/lib/group-page-config';

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  one_on_one: 'Personal',
  group: 'Group',
  round_robin: 'Round Robin',
  collective: 'Collective',
  event: 'Event',
  service: 'Service',
};

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
  Globe: Globe,
};

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

  const allNavItems = [...calendarNavItems.map(c => ({ ...c, type: 'calendar' as const })), ...extraNav.map(n => ({ ...n, type: n.type as const }))];

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
  const leftMutedColor = leftIsLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';

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

  // Split layout (default) — two-panel composition
  if (l.layout === 'split') {
    return (
      <div className="min-h-screen flex flex-col relative" style={bgStyle}>
        {overlayStyle && <div style={overlayStyle} />}

        {/* Accent bar */}
        {h.showAccentBar && (
          <div className="h-1.5 relative z-[1]" style={{ backgroundColor: b.primaryAccent }} />
        )}

        {/* Navigation bar */}
        <nav
          className="border-b sticky top-0 z-20 backdrop-blur-sm relative z-[1]"
          style={{ borderColor: navBorder, backgroundColor: isLight ? 'rgba(255,255,255,0.9)' : 'rgba(9,19,43,0.9)' }}
        >
          <div className={cn('mx-auto flex items-center px-4 sm:px-6 py-3', maxContentWidthCss(l.maxContentWidth))}>
            {b.logoUrl && h.showLogo && (
              <img src={b.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover mr-3 shrink-0" />
            )}
            {b.organizationName && (
              <span className="text-sm font-semibold mr-4 shrink-0 hidden sm:inline" style={{ color: textColor, fontFamily: headingFont }}>
                {b.organizationName}
              </span>
            )}
            <div className="flex items-center gap-0.5 overflow-x-auto flex-1">
              {allNavItems.map(item => {
                const Icon = item.icon ? ICON_MAP[item.icon] : null;
                const isActive = item.type === 'calendar' && item.calendar?.id === selectedCalendarId;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item)}
                    className={cn('flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium transition whitespace-nowrap rounded-lg')}
                    style={
                      isActive
                        ? { backgroundColor: b.primaryAccent, color: isLightColor(b.primaryAccent) ? '#1a1a1a' : '#fff' }
                        : { color: mutedColor }
                    }
                  >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Main two-panel content */}
        <div className={cn('flex-1 relative z-[1]', pageSpacingPx(l.pageSpacing))}>
          <div className={cn('mx-auto px-4 sm:px-6', maxContentWidthCss(l.maxContentWidth))}>
            <div className={cn('grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-0 lg:gap-8 items-start', leftPanelWidthCss(l.leftPanelWidth))}>
              {/* LEFT PANEL */}
              <div
                className="relative overflow-hidden rounded-none lg:rounded-2xl p-8 sm:p-10 min-h-[300px] lg:min-h-[500px] flex flex-col"
                style={{
                  backgroundColor: leftBgColor,
                  ...(leftBgImage ? { backgroundImage: `url(${leftBgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
                }}
              >
                {leftBgImage && <div className="absolute inset-0 bg-black/30" />}
                <div className="relative z-[1] flex flex-col flex-1">
                  {/* Label/number */}
                  {leftLabel && (
                    <span
                      className="text-xs font-semibold uppercase tracking-widest mb-4"
                      style={{ color: b.primaryAccent, fontFamily: bodyFont }}
                    >
                      {leftLabel}
                    </span>
                  )}
                  {/* Logo */}
                  {h.showLogo && b.logoUrl && (
                    <img src={b.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover mb-6" />
                  )}
                  {/* Heading */}
                  <h2
                    className={cn(headingSizePx(t.headingSize), 'font-bold tracking-tight mb-4')}
                    style={{
                      color: leftTextColor,
                      fontFamily: headingFont,
                      fontWeight: t.headingWeight,
                      letterSpacing: letterSpacingCss(t.letterSpacing),
                      lineHeight: lineHeightCss(t.lineHeight),
                    }}
                  >
                    {leftHeading}
                  </h2>
                  {/* Description */}
                  {leftDesc && (
                    <p
                      className={cn(bodySizePx(t.bodySize), 'leading-relaxed max-w-md')}
                      style={{ color: leftMutedColor, fontFamily: bodyFont, lineHeight: lineHeightCss(t.lineHeight) }}
                    >
                      {leftDesc}
                    </p>
                  )}
                  {/* Image */}
                  {leftImage && (
                    <div className="mt-6 rounded-xl overflow-hidden">
                      <img src={leftImage} alt="" className="w-full h-40 object-cover" />
                    </div>
                  )}
                  {/* Duration/location metadata */}
                  {selectedCal && (
                    <div className="mt-auto pt-8 space-y-3">
                      <div className="flex items-center gap-2 text-sm" style={{ color: leftMutedColor, fontFamily: bodyFont }}>
                        <Clock className="w-4 h-4" style={{ color: b.primaryAccent }} />
                        {selectedCal.duration_minutes} minutes
                      </div>
                      <div className="flex items-center gap-2 text-sm" style={{ color: leftMutedColor, fontFamily: bodyFont }}>
                        {selectedCal.location_type === 'synapse_meeting' ? <Video className="w-4 h-4" /> : selectedCal.location_type === 'phone' ? <Phone className="w-4 h-4" /> : selectedCal.location_type === 'in_person' ? <MapPin className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                        {selectedCal.location_type === 'synapse_meeting' ? 'SYNAPSE Meeting' : selectedCal.location_type === 'phone' ? 'Phone Call' : selectedCal.location_type === 'in_person' ? 'In Person' : selectedCal.location_type.replace('_', ' ')}
                      </div>
                      <div className="flex items-center gap-2 text-sm" style={{ color: leftMutedColor, fontFamily: bodyFont }}>
                        <User className="w-4 h-4" style={{ color: b.primaryAccent }} />
                        {CALENDAR_TYPE_LABELS[selectedCal.calendar_type] ?? selectedCal.calendar_type.replace('_', ' ')}
                      </div>
                      {selectedCal.price != null && selectedCal.price > 0 && (
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: b.primaryAccent, fontFamily: bodyFont }}>
                          ${selectedCal.price} {selectedCal.currency}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANEL */}
              <div className="bg-white rounded-none lg:rounded-2xl shadow-sm lg:shadow-xl overflow-hidden min-h-[400px] flex flex-col">
                {rightPanelLabel && (
                  <div className="px-6 sm:px-8 pt-6 pb-2 border-b border-gray-100">
                    <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{rightPanelLabel}</span>
                  </div>
                )}
                <div className="flex-1 p-6 sm:p-8">
                  {children ?? (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      Select an appointment type above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timezone selector */}
        {visitorTz && onVisitorTzChange && (
          <div className={cn('relative z-[1] mx-auto px-4 sm:px-6 pb-6', maxContentWidthCss(l.maxContentWidth))}>
            <div className="flex items-center gap-2 pt-4 border-t" style={{ borderColor: navBorder, color: mutedColor }}>
              <Globe className="w-4 h-4" style={{ color: b.primaryAccent }} />
              <select
                value={visitorTz}
                onChange={e => onVisitorTzChange(e.target.value)}
                className="bg-transparent text-sm border-none cursor-pointer focus:outline-none"
                style={{ color: textColor }}
              >
                {getTimezoneOptions(visitorTz).map((tz: string) => (
                  <option key={tz} value={tz} className="bg-white text-gray-800">{tz}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Footer */}
        {f.visible && (
          <footer className="border-t mt-auto relative z-[1]" style={{ borderColor: navBorder }}>
            <div className={cn('mx-auto px-4 sm:px-6 py-6', maxContentWidthCss(l.maxContentWidth))}>
              {f.text && <p className="text-xs text-center" style={{ color: mutedColor, fontFamily: bodyFont }}>{f.text}</p>}
              {f.showPoweredBy && (
                <p className="text-xs text-center mt-2" style={{ color: mutedColor, fontFamily: bodyFont }}>
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
