import { useState, useMemo } from 'react';
import {
  Search, Heading, Type, AlignLeft, Image, ImagePlus, Minus, MoveVertical,
  MousePointerClick, SquareStack, Box, Columns3, LayoutPanelTop,
  User, Phone, Mail, Hash, Calendar, Clock, Globe, MapPin,
  CircleDot, CheckSquare, ChevronDown, ListChecks, ToggleLeft,
  Star, SlidersHorizontal, Upload, PenTool, ShieldCheck, EyeOff,
  Plus,
} from 'lucide-react';
import { ELEMENT_LIBRARY, ELEMENT_GROUPS, type ElementType } from '@/lib/form-builder-types';

const ICON_MAP: Record<string, typeof Heading> = {
  Heading, Type, AlignLeft, Image, ImagePlus, Minus, MoveVertical, MousePointerClick,
  SquareStack, Box, Columns3, LayoutPanelTop,
  User, Phone, Mail, Hash, Calendar, Clock, Globe, MapPin,
  CircleDot, CheckSquare, ChevronDown, ListChecks, ToggleLeft,
  Star, SlidersHorizontal, Upload, PenTool, ShieldCheck, EyeOff,
};

interface ElementLibraryProps {
  onAddElement: (type: ElementType) => void;
  onAddSection: () => void;
}

export function ElementLibrary({ onAddElement, onAddSection }: ElementLibraryProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return ELEMENT_LIBRARY;
    const q = search.toLowerCase();
    return ELEMENT_LIBRARY.filter(item => item.label.toLowerCase().includes(q));
  }, [search]);

  const grouped = useMemo(() => {
    return ELEMENT_GROUPS.map(group => ({ ...group, items: filtered.filter(item => item.category === group.category) })).filter(g => g.items.length > 0);
  }, [filtered]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-navy-100">
      <div className="px-4 py-3 border-b border-navy-100">
        <h3 className="text-sm font-semibold text-navy-800 mb-3">Elements</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ivory-500" />
          <input className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-navy-100 focus:outline-none focus:border-gold-400 transition-colors" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search elements..." />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <button onClick={onAddSection} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-navy-200 text-navy-600 hover:border-gold-400 hover:text-gold-700 hover:bg-gold-50/30 transition-all text-sm font-medium">
          <Plus className="w-4 h-4" /> Add Section
        </button>

        {grouped.map(group => (
          <div key={group.category}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2 px-1">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const Icon = ICON_MAP[item.icon] || Type;
                return (
                  <button key={item.type} onClick={() => onAddElement(item.type)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-navy-700 hover:bg-ivory-50 transition-colors group" draggable onDragStart={e => { e.dataTransfer.setData('text/plain', item.type); e.dataTransfer.effectAllowed = 'copy'; }}>
                    <div className="w-7 h-7 rounded-md bg-ivory-100 flex items-center justify-center shrink-0 group-hover:bg-gold-100 transition-colors">
                      <Icon className="w-3.5 h-3.5 text-navy-600 group-hover:text-gold-700" />
                    </div>
                    <span className="text-xs font-medium">{item.label}</span>
                    <Plus className="w-3 h-3 ml-auto text-ivory-400 group-hover:text-gold-600 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
