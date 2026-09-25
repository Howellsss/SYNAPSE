import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTriggerCategories, TRIGGER_CATEGORIES } from '@/lib/workflow-constants';
import type { TriggerType } from '@/types';

interface TriggerSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (trigger: TriggerType) => void;
}

export function TriggerSelector({ open, onClose, onSelect }: TriggerSelectorProps) {
  const [search, setSearch] = useState('');
  const categories = getTriggerCategories();
  const filtered = TRIGGER_CATEGORIES.filter((t) =>
    t.label.toLowerCase().includes(search.toLowerCase()),
  );

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-[420px] rounded-2xl border border-navy-100 bg-white shadow-popover">
      <div className="flex items-center justify-between border-b border-navy-100 p-4">
        <div>
          <h3 className="text-sm font-bold text-navy-800">Add Trigger</h3>
          <p className="mt-0.5 text-xs text-ivory-600">Choose what starts this workflow</p>
        </div>
        <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
      </div>
      <div className="border-b border-navy-100 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search triggers..."
            className="input-field h-9 pl-9 text-sm"
          />
        </div>
      </div>
      <div className="max-h-[400px] overflow-y-auto p-3">
        {categories.map((category) => {
          const items = filtered.filter((t) => t.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category} className="mb-4 last:mb-0">
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-ivory-500">{category}</p>
              <div className="grid grid-cols-1 gap-1">
                {items.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.value}
                      onClick={() => { onSelect(t.value); onClose(); }}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gold-50/60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ivory-100 text-navy-600">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium text-navy-700">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-ivory-500">No triggers found</p>
        )}
      </div>
    </div>
  );
}

interface ActionSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (actionType: string) => void;
  title?: string;
}

export function ActionSelector({ open, onClose, onSelect, title = 'Add Step' }: ActionSelectorProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const categories = ['all', ...getActionCategories()];
  const allActions = ACTION_CATEGORIES_FOR_SELECTOR;
  const filtered = allActions.filter((a) => {
    const matchesSearch = a.label.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'all' || a.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div ref={ref} className="absolute left-1/2 top-full z-30 mt-2 w-[480px] -translate-x-1/2 rounded-2xl border border-navy-100 bg-white shadow-popover">
      <div className="flex items-center justify-between border-b border-navy-100 p-4">
        <div>
          <h3 className="text-sm font-bold text-navy-800">{title}</h3>
          <p className="mt-0.5 text-xs text-ivory-600">Add the next step to your workflow</p>
        </div>
        <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
      </div>
      <div className="border-b border-navy-100 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions..."
            className="input-field h-9 pl-9 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-navy-100 p-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
              activeCategory === cat ? 'bg-gold-50 text-gold-700' : 'text-ivory-600 hover:bg-ivory-50',
            )}
          >
            {cat === 'all' ? 'All' : cat}
          </button>
        ))}
      </div>
      <div className="max-h-[360px] overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-1">
          {filtered.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.value}
                onClick={() => { onSelect(a.value); onClose(); }}
                className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gold-50/60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ivory-100 text-navy-600">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-navy-700">{a.label}</span>
                  <span className="mt-0.5 block text-xs text-ivory-500">{a.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-ivory-500">No actions found</p>
        )}
      </div>
    </div>
  );
}

// Re-export from constants for the selector
import { ACTION_CATEGORIES } from '@/lib/workflow-constants';
const ACTION_CATEGORIES_FOR_SELECTOR = ACTION_CATEGORIES;
