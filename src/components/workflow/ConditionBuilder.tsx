import { Plus, Trash2, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONDITION_OPERATORS, CONDITION_FIELDS, DYNAMIC_VARIABLES } from '@/lib/workflow-constants';
import type { WorkflowCondition } from '@/types';

interface ConditionBuilderProps {
  conditions: WorkflowCondition[];
  logic: 'AND' | 'OR';
  onLogicChange: (logic: 'AND' | 'OR') => void;
  onConditionsChange: (conditions: WorkflowCondition[]) => void;
}

export function ConditionBuilder({ conditions, logic, onLogicChange, onConditionsChange }: ConditionBuilderProps) {
  const addCondition = () => {
    onConditionsChange([...conditions, { field: '', operator: 'is', value: '' }]);
  };

  const updateCondition = (idx: number, patch: Partial<WorkflowCondition>) => {
    onConditionsChange(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeCondition = (idx: number) => {
    onConditionsChange(conditions.filter((_, i) => i !== idx));
  };

  const groupedFields = CONDITION_FIELDS.reduce<Record<string, typeof CONDITION_FIELDS>>((acc, f) => {
    if (!acc[f.group]) acc[f.group] = [];
    acc[f.group].push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-navy-700">Match</span>
        <div className="flex rounded-lg border border-navy-100 p-0.5">
          {(['AND', 'OR'] as const).map((l) => (
            <button
              key={l}
              onClick={() => onLogicChange(l)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                logic === l ? 'bg-gold-50 text-gold-700' : 'text-ivory-600 hover:bg-ivory-50',
              )}
            >
              {l === 'AND' ? 'All (AND)' : 'Any (OR)'}
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold text-navy-700">of the following</span>
      </div>

      {conditions.map((cond, idx) => {
        const operator = CONDITION_OPERATORS.find((o) => o.value === cond.operator);
        const showValue = cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && cond.operator !== 'exists';
        return (
          <div key={idx} className="flex flex-wrap items-center gap-2 rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
            {idx > 0 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-100 text-[10px] font-bold uppercase text-navy-600">
                {logic}
              </span>
            )}
            <select
              value={cond.field}
              onChange={(e) => updateCondition(idx, { field: e.target.value })}
              className="input-field h-8 w-44 py-0 text-xs"
            >
              <option value="">Select field…</option>
              {Object.entries(groupedFields).map(([group, fields]) => (
                <optgroup key={group} label={group}>
                  {fields.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(idx, { operator: e.target.value })}
              className="input-field h-8 w-36 py-0 text-xs"
            >
              {CONDITION_OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {showValue && (
              <input
                value={cond.value}
                onChange={(e) => updateCondition(idx, { value: e.target.value })}
                placeholder="Value"
                className="input-field h-8 flex-1 py-0 text-xs"
              />
            )}
            <button
              onClick={() => removeCondition(idx)}
              className="text-ivory-500 transition-colors hover:text-burgundy-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        onClick={addCondition}
        className="flex items-center gap-2 rounded-lg border border-dashed border-navy-200 px-3 py-2 text-xs font-medium text-navy-600 transition-colors hover:border-gold-300 hover:text-gold-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Add condition
      </button>
    </div>
  );
}

interface VariablePickerProps {
  onInsert: (variable: string) => void;
}

export function VariablePicker({ onInsert }: VariablePickerProps) {
  const grouped = DYNAMIC_VARIABLES.reduce<Record<string, typeof DYNAMIC_VARIABLES>>((acc, v) => {
    if (!acc[v.group]) acc[v.group] = [];
    acc[v.group].push(v);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([group, vars]) => (
        <div key={group}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ivory-500">{group}</p>
          <div className="flex flex-wrap gap-1.5">
            {vars.map((v) => (
              <button
                key={v.key}
                onClick={() => onInsert(`{{${v.key}}}`)}
                className="rounded-lg border border-navy-100 bg-ivory-50 px-2.5 py-1.5 text-xs font-medium text-navy-700 transition-colors hover:border-gold-300 hover:bg-gold-50/50"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
