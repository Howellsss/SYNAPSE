import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Check, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Buenos_Aires',
  'America/Bogota', 'America/Lima', 'America/Santiago',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Dublin', 'Europe/Lisbon',
  'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Accra',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Asia/Hong_Kong', 'Asia/Seoul', 'Asia/Bangkok', 'Asia/Karachi',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
  'Pacific/Auckland', 'Pacific/Honolulu',
];

const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value ?? '';
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
    return `${city} (${offset})`;
  } catch {
    return tz;
  }
}

export function TimezoneSelect({
  value,
  onChange,
  className,
  placeholder = 'Select time zone',
}: {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const list = search ? ALL_TIMEZONES : COMMON_TIMEZONES;
    const lower = search.toLowerCase();
    return list.filter(tz => {
      if (!search) return true;
      const label = formatTzLabel(tz).toLowerCase();
      return label.includes(lower) || tz.toLowerCase().includes(lower);
    });
  }, [search]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [search]);

  const currentLabel = formatTzLabel(value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex items-center gap-2 text-left w-full"
      >
        <Globe className="w-4 h-4 text-ivory-400 shrink-0" />
        <span className={cn('flex-1 truncate text-sm', !value && 'text-ivory-600')}>{value ? currentLabel : placeholder}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-navy-100 bg-white shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-navy-50">
            <div className="flex items-center gap-2 rounded-lg bg-ivory-50 px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-ivory-400" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlightIdx]) { onChange(filtered[highlightIdx]); setOpen(false); setSearch(''); } }
                  else if (e.key === 'Escape') { setOpen(false); setSearch(''); }
                }}
                placeholder="Search timezone..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-ivory-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ivory-500 text-center">No timezones found.</p>
            ) : (
              filtered.map((tz, i) => (
                <button
                  key={tz}
                  type="button"
                  onClick={() => { onChange(tz); setOpen(false); setSearch(''); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors',
                    i === highlightIdx ? 'bg-ivory-100' : 'hover:bg-ivory-50',
                    value === tz && 'text-gold-700 font-medium',
                  )}
                >
                  <span className="flex-1 truncate">{formatTzLabel(tz)}</span>
                  {value === tz && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
