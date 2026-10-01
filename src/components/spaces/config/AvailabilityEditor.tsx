import { Infinity as InfinityIcon, CalendarClock, AlertCircle } from 'lucide-react';
import type { Persistence, ScheduleRecurrence, SpaceSchedule } from '@/types';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { describeSchedule, scheduleProblem } from '@/spatial/schedule';
import { cn } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REPEATS: { value: ScheduleRecurrence; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'On chosen days' },
  { value: 'once', label: 'Once, on a date' },
];

/** Always on, or open on a schedule (optionally tied to a SYNAPSE calendar). */
export function AvailabilityEditor({ persistence, schedule, calendars, onPersistence, onSchedule }: {
  persistence: Persistence;
  schedule: SpaceSchedule;
  calendars: { id: string; name: string }[];
  onPersistence: (p: Persistence) => void;
  onSchedule: (s: SpaceSchedule) => void;
}) {
  const set = (patch: Partial<SpaceSchedule>) => onSchedule({ ...schedule, ...patch });
  const problem = persistence === 'scheduled' ? scheduleProblem(schedule) : null;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Availability" className="grid gap-2.5 sm:grid-cols-2">
        {([
          { value: 'always_on', title: 'Always on', text: 'Open any time, like a real office.', icon: InfinityIcon },
          { value: 'scheduled', title: 'Scheduled', text: 'Opens and closes at set times.', icon: CalendarClock },
        ] as const).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={persistence === o.value}
            onClick={() => onPersistence(o.value)}
            className={cn(
              'rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
              persistence === o.value ? 'border-gold-400 bg-gold-50/50 shadow-[0_0_0_3px_rgba(228,169,60,0.15)]' : 'border-navy-100 bg-white hover:border-navy-200',
            )}
          >
            <span className="flex items-center gap-2 font-semibold text-navy-800"><o.icon className="h-4 w-4 text-gold-600" /> {o.title}</span>
            <span className="mt-1 block text-xs text-ivory-700">{o.text}</span>
          </button>
        ))}
      </div>

      {persistence === 'scheduled' && (
        <div className="space-y-3 rounded-xl border border-navy-100 bg-ivory-200/20 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-navy-700">Opens
              <input type="time" className="input-field mt-1" value={schedule.opens_at} onChange={(e) => set({ opens_at: e.target.value })} />
            </label>
            <label className="text-sm font-medium text-navy-700">Closes
              <input type="time" className="input-field mt-1" value={schedule.closes_at} onChange={(e) => set({ closes_at: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm font-medium text-navy-700">Repeat
            <select className="input-field mt-1" value={schedule.recurrence} onChange={(e) => set({ recurrence: e.target.value as ScheduleRecurrence })}>
              {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          {schedule.recurrence === 'weekly' && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
              {DAYS.map((d, i) => {
                const on = (schedule.days ?? []).includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ days: on ? (schedule.days ?? []).filter((x) => x !== i) : [...(schedule.days ?? []), i].sort() })}
                    className={cn('h-9 w-11 rounded-lg text-sm font-semibold transition', on ? 'bg-navy-800 text-white' : 'bg-white text-navy-700 ring-1 ring-navy-100 hover:ring-navy-200')}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          {schedule.recurrence === 'once' && (
            <label className="block text-sm font-medium text-navy-700">Date
              <input type="date" className="input-field mt-1" value={schedule.date ?? ''} onChange={(e) => set({ date: e.target.value })} />
            </label>
          )}
          <div className="block text-sm font-medium text-navy-700">Timezone
            <div className="mt-1"><TimezoneSelect value={schedule.timezone} onChange={(tz) => set({ timezone: tz })} /></div>
          </div>
          <label className="block text-sm font-medium text-navy-700">Link to a SYNAPSE calendar
            <select className="input-field mt-1" value={schedule.calendar_id ?? ''} onChange={(e) => set({ calendar_id: e.target.value || null })}>
              <option value="">Don't link a calendar</option>
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {calendars.length === 0 && <span className="mt-1 block text-xs font-normal text-ivory-700">You don't have any calendars yet.</span>}
          </label>
          {problem
            ? <p className="flex items-center gap-1.5 text-sm text-burgundy-600"><AlertCircle className="h-4 w-4" /> {problem}</p>
            : <p className="text-sm text-ivory-700">{describeSchedule(schedule)}. Admins can always enter.</p>}
        </div>
      )}
    </div>
  );
}
