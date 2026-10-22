import { useMemo, useState } from 'react';
import {
  Search, X, type LucideIcon,
  AlignLeft, Bot, BriefcaseBusiness, Building, Building2, Cake, Calendar, ChevronsUpDown, CircleDot, Clock, CloudUpload, Columns2, Columns3, CreditCard, DollarSign, EyeOff, Flag, Gauge, Globe, Hash, Heading1, IdCard, Image, ImagePlus, Link2, ListChecks, Mail, Mailbox, Map as MapIcon, MapPin, MousePointerClick, MoveVertical, PanelTop, PenTool, Phone, Pilcrow, SeparatorHorizontal, ShieldCheck, Square, SquareCheck, Star, TextCursorInput, ToggleLeft, Type, User,
} from 'lucide-react';
import { ELEMENT_LIBRARY, ELEMENT_GROUPS, type ElementLibraryItem, type ElementType } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';
import { Segmented } from './builder-ui';

interface ElementLibraryProps {
  /** Add it at the end of the selected section (or the page). */
  onAddElement: (type: ElementType) => void;
  /** Layout tiles: a new section with this many columns. */
  onAddSection: (columns: 1 | 2 | 3, card?: boolean) => void;
}

/** The tile's icon, by its lucide name. */
const ICONS: Record<string, LucideIcon> = { AlignLeft, Bot, BriefcaseBusiness, Building, Building2, Cake, Calendar, ChevronsUpDown, CircleDot, Clock, CloudUpload, Columns2, Columns3, CreditCard, DollarSign, EyeOff, Flag, Gauge, Globe, Hash, Heading1, IdCard, Image, ImagePlus, Link2, ListChecks, Mail, Mailbox, Map: MapIcon, MapPin, MousePointerClick, MoveVertical, PanelTop, PenTool, Phone, Pilcrow, SeparatorHorizontal, ShieldCheck, Square, SquareCheck, Star, TextCursorInput, ToggleLeft, Type, User };

function TileIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Square;
  return <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />;
}

/**
 * Everything that can go on a form, as tiles to click or drag onto the form: fields grouped the
 * way people look for them (personal info, contact, address…), then content and layout.
 */
export function ElementLibrary({ onAddElement, onAddSection }: ElementLibraryProps) {
  const [tab, setTab] = useState<'fields' | 'layout'>('fields');
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (i: ElementLibraryItem) => !q || i.label.toLowerCase().includes(q) || (i.keywords ?? '').includes(q);
    return ELEMENT_GROUPS
      .filter((g) => q || g.tab === tab)
      .map((g) => ({ ...g, items: ELEMENT_LIBRARY.filter((i) => i.group === g.group && match(i)) }))
      .filter((g) => g.items.length > 0);
  }, [search, tab]);

  const add = (item: ElementLibraryItem) => {
    if (item.isContainer) onAddSection(item.columns ?? 1, item.type === 'card');
    else onAddElement(item.type);
  };

  return (
    <div className="flex h-full flex-col border-r border-black/[0.06] bg-[#FBFBFD]">
      <div className="space-y-2.5 px-3.5 pb-3 pt-3.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#8E8E93]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search elements" aria-label="Search elements"
            className="h-9 w-full rounded-[10px] bg-[#EFEFF2] pl-8 pr-8 text-[13px] text-[#1D1D1F] outline-none transition placeholder:text-[#8E8E93] focus:bg-white focus:ring-[3px] focus:ring-[#0071E3]/15" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[#8E8E93] hover:bg-black/5"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {!search && (
          <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'fields', label: 'Fields' }, { value: 'layout', label: 'Content & layout' }]} />
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3.5 pb-24">
        {groups.length === 0 && <p className="px-1 pt-6 text-center text-[13px] text-[#8E8E93]">Nothing called “{search}”.</p>}
        {groups.map((g) => (
          <div key={g.group}>
            <p className="mb-2 px-0.5 text-[11.5px] font-semibold text-[#6E6E73]">{g.label}</p>
            <div className="grid grid-cols-3 gap-2">
              {g.items.map((item) => (
                <button key={item.type} type="button" title={`Add ${item.label}`}
                  onClick={() => add(item)}
                  draggable={!item.isContainer}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.type); e.dataTransfer.effectAllowed = 'copy'; }}
                  className={cn('group flex aspect-[1/0.92] flex-col items-center justify-center gap-1.5 rounded-[12px] bg-white px-1 text-center ring-1 ring-black/[0.07] transition-all',
                    'hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] hover:ring-[#0071E3]/40 active:translate-y-0 active:shadow-none',
                    !item.isContainer && 'cursor-grab active:cursor-grabbing')}>
                  <span className="text-[#3A3A3C] transition-colors group-hover:text-[#0071E3]"><TileIcon name={item.icon} /></span>
                  <span className="text-[11px] font-medium leading-tight text-[#3A3A3C]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="px-1 text-[11.5px] leading-relaxed text-[#8E8E93]">Click a tile to add it, or drag it to the exact spot on the form.</p>
      </div>
    </div>
  );
}
