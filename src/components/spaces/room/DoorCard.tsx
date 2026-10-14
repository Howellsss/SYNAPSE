import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { loadDepartments, type Department } from '@/lib/team';
import { usePresenceCounts } from '@/spatial/net/usePresenceCounts';
import type { Space } from '@/types';

/**
 * The office door: the account's other spaces, grouped by department, with how many people are
 * in each. Walking through it opens the space you pick (you leave this one).
 */
export function DoorCard({ here, spaces, onGo, onAll }: {
  here: Pick<Space, 'id' | 'name'>;
  spaces: Pick<Space, 'id' | 'name' | 'slug' | 'config'>[];
  onGo: (slug: string) => void;
  onAll: () => void;
}) {
  const { workspace } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  useEffect(() => { if (workspace) loadDepartments(workspace.id).then((r) => setDepartments(r.data)); }, [workspace]);
  const others = spaces.filter((s) => s.id !== here.id);
  const counts = usePresenceCounts(others.map((s) => s.id));
  const groups = useMemo(() => {
    const byDept = new Map<string, { name: string; items: typeof others }>();
    for (const s of others) {
      const dept = departments.find((d) => d.id === s.config?.department_id);
      const key = dept?.id ?? '';
      if (!byDept.has(key)) byDept.set(key, { name: dept?.name ?? 'Other spaces', items: [] });
      byDept.get(key)!.items.push(s);
    }
    return [...byDept.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0)).map(([, g]) => g);
  }, [others, departments]);

  return (
    <div className="absolute left-3 top-1/2 z-20 w-72 -translate-y-1/2 rounded-2xl bg-white p-4 text-navy-800 shadow-popover sm:left-4" role="dialog" aria-label="Door to other spaces">
      <p className="flex items-center gap-2 text-sm font-semibold"><DoorOpen className="h-4 w-4 text-gold-600" /> Door to other spaces</p>
      {others.length === 0 ? (
        <p className="mt-2 text-sm text-ivory-700">This is the only space in your account. Create more (one per department works well) and they show up here.</p>
      ) : (
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.name}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-ivory-700">{g.name}</p>
              <ul className="mt-1 space-y-1">
                {g.items.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onGo(s.slug)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ivory-50">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="shrink-0 text-xs text-ivory-700">{counts[s.id] ?? 0} here</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-navy-600" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onAll} className="mt-3 text-xs font-semibold text-gold-700 underline">All workspaces</button>
    </div>
  );
}
