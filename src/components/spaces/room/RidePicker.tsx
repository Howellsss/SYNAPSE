import { Bike, Car, MapPin, X } from 'lucide-react';

export interface RideTarget { id: string; name: string; x: number; z: number }

/** Where to ride a bike or drive a car to: the places of the campus, or the Hub's doorways. */
export function RidePicker({ kind, targets, onPick, onClose }: {
  kind: 'bike' | 'car';
  targets: RideTarget[];
  onPick: (t: RideTarget) => void;
  onClose: () => void;
}) {
  const Icon = kind === 'car' ? Car : Bike;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-end justify-center bg-navy-950/30 p-4 sm:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'car' ? 'Drive a car' : 'Ride a bike'}
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-navy-900 text-white shadow-popover ring-1 ring-gold-400/30"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Icon className="h-5 w-5 text-gold-300" />
          <h2 className="flex-1 text-sm font-semibold">{kind === 'car' ? 'Drive a car to…' : 'Ride a bike to…'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        {targets.length ? (
          <ul className="max-h-[50vh] overflow-y-auto p-2">
            {targets.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onPick(t)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-white/90 hover:bg-white/10">
                  <MapPin className="h-4 w-4 text-gold-300" /> {t.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-white/70">There's nowhere to ride to from here.</p>
        )}
      </section>
    </div>
  );
}
