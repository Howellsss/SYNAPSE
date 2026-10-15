import { useState, type ComponentType } from 'react';
import {
  Armchair, BookOpen, Coffee, Droplets, Fence, Flower2, Frame, Gamepad2, Hammer, Lamp, LampFloor, LayoutGrid, Loader2, Monitor,
  Mountain, Move, Presentation, TreePalm, Umbrella, Flame, Wine, Store, Lightbulb, Waves, Theater, Tent, RectangleHorizontal, RotateCw, Shrub, Sofa, Sprout, Table2, Trash2, TreeDeciduous, TreePine, Tv, Users, X,
} from 'lucide-react';
import { KIT, KIT_BY_ID, KIT_CATEGORIES, type KitCategory } from '@/spatial/scene/campus/kit';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string }>;
const ICONS: Record<string, Icon> = {
  workstation: Monitor, office_chair: Armchair, divider: RectangleHorizontal, meeting_table: Users, screen_console: Tv,
  sofa: Sofa, armchair: Armchair, beanbag: Armchair, cafe_set: Coffee, coffee_table: Table2, side_table: Table2, credenza: Table2,
  coffee_bar: Coffee, pool_table: Table2, bookshelf: BookOpen, wall_art: Frame, rug_navy: LayoutGrid, rug_gold: LayoutGrid,
  rug_green: LayoutGrid, big_screen: Presentation, podium: Presentation, arcade: Gamepad2, arc_lamp: LampFloor, lamp_post: Lamp,
  monstera: Sprout, monstera_tall: Sprout, palm_pot: Sprout, planter_small: Sprout, tree: TreeDeciduous, blossom: TreeDeciduous,
  pine: TreePine, bush: Shrub, flowers: Flower2, hedge: Fence, bench: Sofa, fountain: Droplets, boulder: Mountain,
};
/** Pieces drawn in code, by what they are (covers every colour of a sofa, seat, booth…). */
const PROC_ICONS: Record<string, Icon> = {
  oak: TreeDeciduous, palm: TreePalm, bush_flower: Shrub, flowers_round: Flower2, reeds: Waves, planter_tree: TreeDeciduous,
  potted_tree: Sprout, string_lights: Lightbulb, pergola: Tent, gazebo: Tent, fire_pit: Flame, picnic: Table2, umbrella_set: Umbrella,
  led_wall: Presentation, theatre_seat: Theater, booth: Store, sofa_p: Sofa, lounge_chair: Armchair, dining_set: Coffee,
  bar_counter: Wine, bar_stool: Wine, bottle_wall: Wine, fireplace: Flame, reception: Table2, bookcase: BookOpen,
  conference: Users, ping_pong: Table2, rug: LayoutGrid,
};

/**
 * Build mode on the campus: pick a piece from the catalog and click the floor to place it,
 * or click a piece to turn, move or remove it. Changes are saved to the workspace for everyone.
 */
export function BuildPanel({ picking, selected, saving, onPick, onTurn, onMove, onRemove, onDeselect, onClose }: {
  /** The catalog piece being placed (or the piece being moved). */
  picking: { kind: string; moving: boolean } | null;
  /** The piece clicked in the world. */
  selected: { kind: string } | null;
  saving: boolean;
  onPick: (kind: string | null) => void;
  onTurn: () => void;
  onMove: () => void;
  onRemove: () => void;
  onDeselect: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<KitCategory>('desks');
  const items = KIT.filter((i) => !i.hidden && i.category === tab);
  const pickedName = picking ? KIT_BY_ID.get(picking.kind)?.name : null;
  const selectedName = selected ? KIT_BY_ID.get(selected.kind)?.name : null;

  return (
    <section
      aria-label="Build"
      className="pointer-events-auto flex max-h-[min(560px,calc(100dvh-220px))] w-[min(320px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl bg-navy-900/95 text-white shadow-popover ring-1 ring-gold-400/30 backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Hammer className="h-4 w-4 text-gold-300" />
        <h2 className="flex-1 text-sm font-semibold">Build</h2>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-gold-300" aria-label="Saving" />}
        <button type="button" onClick={onClose} aria-label="Close build mode" className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </header>

      {picking ? (
        <div className="space-y-3 px-4 py-3 text-sm">
          <p className="font-semibold text-gold-300">{picking.moving ? `Moving: ${pickedName}` : pickedName}</p>
          <p className="text-white/75">Click the floor to {picking.moving ? 'put it there' : 'place it'}. Gold means it fits, red means something's in the way.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onTurn} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 font-semibold hover:bg-white/20"><RotateCw className="h-4 w-4" /> Turn <kbd className="ml-1 rounded bg-white/15 px-1 text-[10px]">R</kbd></button>
            <button type="button" onClick={() => onPick(null)} className="inline-flex flex-1 items-center justify-center rounded-lg bg-white/10 px-3 py-2 font-semibold hover:bg-white/20">{picking.moving ? 'Cancel' : 'Done'} <kbd className="ml-1 rounded bg-white/15 px-1 text-[10px]">Esc</kbd></button>
          </div>
        </div>
      ) : selected ? (
        <div className="space-y-3 px-4 py-3 text-sm">
          <p className="font-semibold text-gold-300">{selectedName}</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onTurn} disabled={saving} className="flex flex-col items-center gap-1 rounded-lg bg-white/10 px-2 py-2 text-xs font-semibold hover:bg-white/20 disabled:opacity-50"><RotateCw className="h-4 w-4" /> Turn</button>
            <button type="button" onClick={onMove} disabled={saving} className="flex flex-col items-center gap-1 rounded-lg bg-white/10 px-2 py-2 text-xs font-semibold hover:bg-white/20 disabled:opacity-50"><Move className="h-4 w-4" /> Move</button>
            <button type="button" onClick={onRemove} disabled={saving} className="flex flex-col items-center gap-1 rounded-lg bg-burgundy-500/80 px-2 py-2 text-xs font-semibold hover:bg-burgundy-500 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Remove</button>
          </div>
          <button type="button" onClick={onDeselect} className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">Back to the catalog</button>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Kinds of pieces" className="flex flex-wrap gap-1 px-3 pt-3 pb-2">
            {KIT_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={tab === c.id}
                onClick={() => setTab(c.id)}
                className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition', tab === c.id ? 'bg-gold-400 text-navy-900' : 'bg-white/10 text-white/80 hover:bg-white/20')}
              >
                {c.label}
              </button>
            ))}
          </div>
          <ul className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
            {items.map((i) => {
              const ItemIcon = ICONS[i.id] ?? ('proc' in i ? PROC_ICONS[i.proc] : undefined) ?? LayoutGrid;
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => onPick(i.id)} className="flex h-full w-full flex-col items-center gap-1.5 rounded-xl bg-white/[0.07] px-2 py-3 text-center text-xs font-semibold text-white/90 ring-1 ring-white/10 transition hover:bg-white/15 hover:ring-gold-400/60">
                    <ItemIcon className="h-6 w-6 text-gold-300" />
                    {i.name}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-white/10 px-4 py-2 text-[11px] text-white/60">Pick a piece, then click the floor. Click a piece in the world to turn, move or remove it.</p>
        </>
      )}
    </section>
  );
}
