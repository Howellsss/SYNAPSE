import { Plus, Trash2 } from 'lucide-react';
import type { Config, Step, Trigger } from '@/workflows/model';
import { APPOINTMENT_STATUSES, CONTACT_FIELDS, DND_CHANNELS, MONTHS, WEEKDAYS } from '@/workflows/catalog';
import type { Options } from '@/workflows/data';
import { Field, MergeFields, MultiPick, Segmented, Select, Switch, TagInput, TextArea, TextInput, inputCls } from './ui';
import { cn } from '@/lib/utils';

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const people = (o: Options) => o.people.map((p) => ({ value: p.id, label: p.name }));
const opts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

// ---------------------------------------------------------------- triggers

/** Tag rules for Contact Created / Contact DND: every rule must pass (AND). */
function TagRules({ value, onChange, tags }: { value: Config[]; onChange: (v: Config[]) => void; tags: string[] }) {
  return (
    <Field label="Only contacts whose tags…" hint="Optional. Every rule must match. Tags are checked at the moment it happens.">
      <div className="space-y-2">
        {value.map((r, i) => (
          <div key={i} className="rounded-[10px] p-2.5 ring-1 ring-inset ring-navy-100">
            <div className="mb-2 flex items-center gap-2">
              <select aria-label={`Rule ${i + 1}`} value={s(r.op) || 'any_of'} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))} className={cn(inputCls, 'h-9 flex-1')}>
                <option value="any_of">include any of</option>
                <option value="equals">include all of</option>
                <option value="none_of">include none of</option>
                <option value="not_equals">don't include all of</option>
              </select>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove rule ${i + 1}`} className="rounded-lg p-2 text-navy-500 hover:bg-navy-50"><Trash2 className="h-4 w-4" /></button>
            </div>
            <TagInput label="Tags" value={arr(r.tags)} onChange={(t) => onChange(value.map((x, j) => (j === i ? { ...x, tags: t } : x)))} options={tags} />
          </div>
        ))}
        <button type="button" onClick={() => onChange([...value, { op: 'any_of', tags: [] }])} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-700 hover:text-gold-800"><Plus className="h-4 w-4" /> Add a tag rule</button>
      </div>
    </Field>
  );
}

function OffsetDays({ f, set, what }: { f: Config; set: (p: Config) => void; what: string }) {
  return (
    <>
      <Segmented label="When" value={(s(f.offset) || 'on') as 'on' | 'before' | 'after'} onChange={(v) => set({ offset: v, days: v === 'on' ? 0 : Math.max(1, Number(f.days) || 1) })}
        options={[{ value: 'on', label: `On ${what}` }, { value: 'before', label: 'Days before' }, { value: 'after', label: 'Days after' }]} />
      {f.offset && f.offset !== 'on' && <TextInput label="How many days" type="number" value={s(f.days)} onChange={(v) => set({ days: Math.max(0, Number(v) || 0) })} />}
    </>
  );
}

export function TriggerEditor({ t, onChange, o }: { t: Trigger; onChange: (t: Trigger) => void; o: Options }) {
  const f = t.filters;
  const set = (p: Config) => onChange({ ...t, filters: { ...f, ...p } });
  let body: React.ReactNode = null;
  switch (t.type) {
    case 'contact_created':
      body = <TagRules value={(f.tag_rules as Config[]) ?? []} onChange={(v) => set({ tag_rules: v })} tags={o.tags} />;
      break;
    case 'contact_changed':
      body = (
        <>
          <Select label="Field to watch" value={s(f.field)} onChange={(v) => set({ field: v })} options={[...CONTACT_FIELDS, { value: 'owner_id', label: 'Assigned user' }]} />
          <Segmented label="Fire when it" value={(s(f.op) || 'has_changed') as 'has_changed' | 'has_changed_to'} onChange={(v) => set({ op: v })} options={[{ value: 'has_changed', label: 'Changes at all' }, { value: 'has_changed_to', label: 'Changes to…' }]} />
          {f.op === 'has_changed_to' && (f.field === 'owner_id'
            ? <Select label="New assigned user" value={s(f.value)} onChange={(v) => set({ value: v })} options={[{ value: '', label: 'Choose…' }, ...people(o)]} />
            : <TextInput label="New value" value={s(f.value)} onChange={(v) => set({ value: v })} placeholder={f.field === 'contact_type' ? 'customer' : ''} hint="Not case-sensitive." />)}
        </>
      );
      break;
    case 'contact_tag':
      body = (
        <>
          <Segmented label="When a tag is" value={(s(f.event) || 'added') as 'added' | 'removed' | 'any'} onChange={(v) => set({ event: v })} options={[{ value: 'added', label: 'Added' }, { value: 'removed', label: 'Removed' }, { value: 'any', label: 'Either' }]} />
          <TagInput label="Tags" value={arr(f.tags)} onChange={(v) => set({ tags: v })} options={o.tags} hint="Fires when any of these tags changes." />
        </>
      );
      break;
    case 'contact_dnd':
      body = (
        <>
          <Select label="Do Not Disturb was" value={s(f.flag) || 'enabled_all'} onChange={(v) => set({ flag: v })} options={[
            { value: 'enabled_all', label: 'Turned on for all channels' }, { value: 'enabled_specific', label: 'Turned on for some channels' },
            { value: 'disabled_all', label: 'Turned off for all channels' }, { value: 'disabled_specific', label: 'Turned off for some channels' }, { value: 'any', label: 'Changed in any way' },
          ]} />
          {/specific/.test(s(f.flag)) && <MultiPick label="Channels" value={arr(f.channels)} onChange={(v) => set({ channels: v })} options={DND_CHANNELS} />}
          <TagRules value={(f.tag_rules as Config[]) ?? []} onChange={(v) => set({ tag_rules: v })} tags={o.tags} />
        </>
      );
      break;
    case 'note_added':
      body = (
        <>
          <Select label="Only contacts with tag" value={s(f.has_tag)} onChange={(v) => set({ has_tag: v })} options={[{ value: '', label: 'Any contact' }, ...o.tags.map((x) => ({ value: x, label: x }))]} />
          <Select label="Except contacts with tag" value={s(f.not_tag)} onChange={(v) => set({ not_tag: v })} options={[{ value: '', label: 'No exception' }, ...o.tags.map((x) => ({ value: x, label: x }))]} />
        </>
      );
      break;
    case 'birthday_reminder':
      body = (
        <>
          <OffsetDays f={f} set={set} what="the birthday" />
          <Select label="Born in (optional)" value={s(f.month)} onChange={(v) => set({ month: v })} options={[{ value: '', label: 'Any month' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
          <p className="rounded-[10px] bg-gold-50 px-3 py-2.5 text-xs text-navy-800 ring-1 ring-inset ring-gold-200">Runs at 8 AM in your account’s time zone. Contacts need a date of birth (on their contact page). Turn on <b>Allow re-entry</b> in Settings to greet them every year.</p>
        </>
      );
      break;
    case 'custom_date_reminder':
      body = (
        <>
          <Select label="Date" value={s(f.field) || 'date_of_birth'} onChange={(v) => set({ field: v })} options={[{ value: 'date_of_birth', label: 'Date of birth' }, { value: 'created_at', label: 'Date added' }]} />
          <OffsetDays f={f} set={set} what="the date" />
          <Switch label="Match the year too" description="On: fires once, on that exact date. Off: fires every year on the day and month." checked={!!f.match_year} onChange={(v) => set({ match_year: v })} />
          <Select label="Only contacts with tag" value={s(f.has_tag)} onChange={(v) => set({ has_tag: v })} options={[{ value: '', label: 'Any contact' }, ...o.tags.map((x) => ({ value: x, label: x }))]} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Only on" value={s(f.weekday)} onChange={(v) => set({ weekday: v })} options={[{ value: '', label: 'Any day' }, ...WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))]} />
            <Select label="Only in" value={s(f.month)} onChange={(v) => set({ month: v })} options={[{ value: '', label: 'Any month' }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))]} />
          </div>
        </>
      );
      break;
    case 'task_added':
      body = <MultiPick label="Assigned to" value={arr(f.users)} onChange={(v) => set({ users: v })} options={people(o)} hint="Nothing ticked: any task." />;
      break;
    case 'task_reminder':
      body = <><OffsetDays f={{ ...f, offset: f.offset === 'on' ? 'before' : f.offset }} set={set} what="the due date" /><p className="text-xs text-ivory-700">Runs at 8 AM. Tasks without a due date never fire. Finished tasks still fire, so check with an If / Else if needed.</p></>;
      break;
    case 'task_completed':
      body = (
        <>
          <Select label="Assigned user" value={s(f.user_op) || 'any'} onChange={(v) => set({ user_op: v })} options={[
            { value: 'any', label: 'Anyone' }, { value: 'is', label: 'Is…' }, { value: 'is_not', label: 'Is not…' }, { value: 'is_empty', label: 'Nobody (unassigned)' }, { value: 'is_not_empty', label: 'Somebody' },
          ]} />
          {(f.user_op === 'is' || f.user_op === 'is_not') && <MultiPick label="Users" value={arr(f.users)} onChange={(v) => set({ users: v })} options={people(o)} />}
        </>
      );
      break;
    case 'customer_booked_appointment':
      body = <MultiPick label="Calendars" value={arr(f.calendars)} onChange={(v) => set({ calendars: v })} options={opts(o.calendars)} empty="You have no calendars yet." hint="Nothing ticked: any calendar." />;
      break;
    case 'appointment_status':
      body = (
        <>
          <MultiPick label="Status becomes" value={arr(f.statuses)} onChange={(v) => set({ statuses: v })} options={APPOINTMENT_STATUSES} hint="Nothing ticked: any status change." />
          <MultiPick label="Calendars" value={arr(f.calendars)} onChange={(v) => set({ calendars: v })} options={opts(o.calendars)} empty="You have no calendars yet." hint="Nothing ticked: any calendar." />
        </>
      );
      break;
    case 'form_submitted':
      body = <MultiPick label="Forms" value={arr(f.forms)} onChange={(v) => set({ forms: v })} options={opts(o.forms)} empty="You have no forms yet." hint="Nothing ticked: any form." />;
      break;
    case 'event_registered':
      body = <MultiPick label="Events" value={arr(f.events)} onChange={(v) => set({ events: v })} options={opts(o.events)} empty="You have no events yet." hint="Nothing ticked: any event." />;
      break;
    case 'customer_replied':
      body = <MultiPick label="Channel" value={arr(f.channels)} onChange={(v) => set({ channels: v })} options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }]} hint="Nothing ticked: any channel." />;
      break;
  }
  return (
    <div className="space-y-4">
      <TextInput label="Trigger name" value={t.name} onChange={(v) => onChange({ ...t, name: v })} hint="Shown on the canvas and in the logs, e.g. “Tag added – Interested”." />
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- steps

const CONDITION_FIELDS = [{ value: 'tag', label: 'Tag' }, ...CONTACT_FIELDS.filter((x) => !x.date), { value: 'owner_id', label: 'Assigned user' }, { value: 'dnd_all', label: 'Do Not Disturb (all)' }];
function opsFor(field: string) {
  if (field === 'tag') return [{ value: 'has', label: 'has' }, { value: 'not_has', label: 'doesn’t have' }];
  if (field === 'dnd_all') return [{ value: 'is_true', label: 'is on' }, { value: 'is_false', label: 'is off' }];
  return [{ value: 'equals', label: 'is' }, { value: 'not_equals', label: 'is not' }, { value: 'contains', label: 'contains' }, { value: 'is_empty', label: 'is empty' }, { value: 'is_not_empty', label: 'is not empty' }];
}

export function StepEditor({ step, onChange, o, selfId }: { step: Step; onChange: (s: Step) => void; o: Options; selfId: string | null }) {
  const c = step.config;
  const set = (p: Config) => onChange({ ...step, config: { ...c, ...p } });
  const append = (key: string) => (f: string) => set({ [key]: `${s(c[key])}${s(c[key]) && !/\s$/.test(s(c[key])) ? ' ' : ''}${f}` });
  let body: React.ReactNode = null;
  switch (step.type) {
    case 'add_tag':
    case 'remove_tag':
      body = <TagInput label="Tags" value={arr(c.tags)} onChange={(v) => set({ tags: v })} options={o.tags} hint={step.type === 'add_tag' ? 'New tags are created for you.' : undefined} />;
      break;
    case 'update_field': {
      const date = CONTACT_FIELDS.find((x) => x.value === c.field)?.date;
      body = (
        <>
          <Select label="Field" value={s(c.field)} onChange={(v) => set({ field: v, value: '' })} options={CONTACT_FIELDS} />
          {c.field === 'contact_type'
            ? <Select label="New value" value={s(c.value)} onChange={(v) => set({ value: v })} options={[{ value: '', label: 'Choose…' }, { value: 'lead', label: 'Lead' }, { value: 'customer', label: 'Customer' }]} />
            : <TextInput label="New value" type={date ? 'date' : 'text'} value={s(c.value)} onChange={(v) => set({ value: v })} hint={date ? undefined : 'You can use merge fields like {{contact.first_name}}. Leave empty to clear the field.'} />}
        </>
      );
      break;
    }
    case 'assign_user':
      body = <Select label="Assign to" value={s(c.user_id)} onChange={(v) => set({ user_id: v })} options={[{ value: '', label: 'Choose…' }, ...people(o)]} />;
      break;
    case 'remove_assigned_user':
      body = <p className="text-sm text-ivory-700">The contact will have no assigned user after this step.</p>;
      break;
    case 'set_dnd':
      body = (
        <>
          <Segmented label="Do Not Disturb" value={(s(c.mode) || 'enable') as 'enable' | 'disable'} onChange={(v) => set({ mode: v })} options={[{ value: 'enable', label: 'Turn on' }, { value: 'disable', label: 'Turn off' }]} />
          <Segmented label="For" value={(s(c.scope) || 'all') as 'all' | 'channels'} onChange={(v) => set({ scope: v })} options={[{ value: 'all', label: 'All channels' }, { value: 'channels', label: 'Some channels' }]} />
          {c.scope === 'channels' && <MultiPick label="Channels" value={arr(c.channels)} onChange={(v) => set({ channels: v })} options={DND_CHANNELS} />}
        </>
      );
      break;
    case 'add_note':
      body = <><TextArea label="Note" value={s(c.text)} onChange={(v) => set({ text: v })} placeholder="e.g. Asked about pricing on {{contact.company}}" /><MergeFields onPick={append('text')} /></>;
      break;
    case 'add_task':
      body = (
        <>
          <TextInput label="Title" value={s(c.title)} onChange={(v) => set({ title: v })} placeholder="Call {{contact.name}}" />
          <TextArea label="Details (optional)" rows={3} value={s(c.body)} onChange={(v) => set({ body: v })} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Due in (days)" type="number" value={s(c.due_in_days)} onChange={(v) => set({ due_in_days: String(Math.max(0, Number(v) || 0)) })} hint="0 = today" />
            <Select label="Assign to" value={s(c.assign) || 'owner'} onChange={(v) => set({ assign: v })} options={[{ value: 'owner', label: 'Contact’s assigned user' }, { value: '', label: 'Nobody' }, ...people(o)]} />
          </div>
        </>
      );
      break;
    case 'send_email':
      body = (
        <>
          <Select label="Send from" value={s(c.account_id)} onChange={(v) => set({ account_id: v })} options={[{ value: '', label: 'The workflow’s sender (Settings)' }, ...o.accounts.map((a) => ({ value: a.id, label: a.display_name ? `${a.display_name} <${a.email}>` : a.email }))]}
            hint={o.accounts.length ? undefined : 'Connect your Gmail in Settings → Email first.'} />
          <TextInput label="Subject" value={s(c.subject)} onChange={(v) => set({ subject: v })} placeholder="Hi {{contact.first_name}}" />
          <TextArea label="Message" rows={8} value={s(c.body)} onChange={(v) => set({ body: v })} placeholder="Write your email…" />
          <MergeFields onPick={append('body')} />
          <p className="text-xs text-ivory-700">Skipped for contacts with Do Not Disturb on for email, and held until the sending window if you set one in Settings.</p>
        </>
      );
      break;
    case 'notify':
      body = (
        <>
          <Segmented label="Notify" value={(s(c.to) || 'owner') as 'owner' | 'users' | 'everyone'} onChange={(v) => set({ to: v })} options={[{ value: 'owner', label: 'Assigned user' }, { value: 'users', label: 'Choose people' }, { value: 'everyone', label: 'Everyone' }]} />
          {c.to === 'users' && <MultiPick label="People" value={arr(c.users)} onChange={(v) => set({ users: v })} options={people(o)} />}
          <TextInput label="Title" value={s(c.title)} onChange={(v) => set({ title: v })} placeholder="{{contact.name}} needs a call" />
          <TextArea label="Message (optional)" rows={3} value={s(c.body)} onChange={(v) => set({ body: v })} />
          <MergeFields onPick={append('title')} />
        </>
      );
      break;
    case 'wait':
      body = (
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <TextInput label="Wait for" type="number" value={s(c.amount)} onChange={(v) => set({ amount: Math.max(1, Number(v) || 1) })} />
          <Segmented label="Unit" value={(s(c.unit) || 'hours') as 'minutes' | 'hours' | 'days'} onChange={(v) => set({ unit: v })} options={[{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }]} />
        </div>
      );
      break;
    case 'if_else': {
      const conds = (Array.isArray(c.conditions) ? c.conditions : []) as Config[];
      const setCond = (i: number, p: Config) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, ...p } : x)) });
      body = (
        <>
          <Segmented label="Go Yes when" value={(s(c.match) || 'all') as 'all' | 'any'} onChange={(v) => set({ match: v })} options={[{ value: 'all', label: 'All conditions match' }, { value: 'any', label: 'Any condition matches' }]} />
          <div className="space-y-2">
            {conds.map((cd, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-[10px] p-2.5 ring-1 ring-inset ring-navy-100">
                <Select label="Field" value={s(cd.field)} onChange={(v) => setCond(i, { field: v, op: opsFor(v)[0].value, value: '' })} options={CONDITION_FIELDS} />
                <Select label="Is" value={s(cd.op)} onChange={(v) => setCond(i, { op: v })} options={opsFor(s(cd.field))} />
                <button type="button" onClick={() => set({ conditions: conds.filter((_, j) => j !== i) })} aria-label={`Remove condition ${i + 1}`} className="mb-0.5 rounded-lg p-2.5 text-navy-500 hover:bg-navy-50"><Trash2 className="h-4 w-4" /></button>
                {!['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(s(cd.op)) && (
                  <div className="col-span-3">
                    {cd.field === 'tag'
                      ? <Select label="Tag" value={s(cd.value)} onChange={(v) => setCond(i, { value: v })} options={[{ value: '', label: 'Choose…' }, ...o.tags.map((x) => ({ value: x, label: x }))]} />
                      : cd.field === 'owner_id'
                        ? <Select label="User" value={s(cd.value)} onChange={(v) => setCond(i, { value: v })} options={[{ value: '', label: 'Choose…' }, ...people(o)]} />
                        : <TextInput label="Value" value={s(cd.value)} onChange={(v) => setCond(i, { value: v })} />}
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={() => set({ conditions: [...conds, { field: 'tag', op: 'has', value: '' }] })} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-700 hover:text-gold-800"><Plus className="h-4 w-4" /> Add a condition</button>
          </div>
        </>
      );
      break;
    }
    case 'add_to_workflow':
      body = <Select label="Workflow" value={s(c.workflow_id)} onChange={(v) => set({ workflow_id: v })} options={[{ value: '', label: 'Choose…' }, ...o.workflowList.filter((w) => w.id !== selfId).map((w) => ({ value: w.id, label: w.name }))]} hint="It must be published to run." />;
      break;
    case 'remove_from_workflow':
      body = <Select label="Remove from" value={s(c.workflow_id) || 'current'} onChange={(v) => set({ workflow_id: v })} options={[{ value: 'current', label: 'This workflow' }, ...o.workflowList.filter((w) => w.id !== selfId).map((w) => ({ value: w.id, label: w.name }))]} />;
      break;
    case 'end':
      body = <p className="text-sm text-ivory-700">Contacts stop here. Steps after this one won’t run.</p>;
      break;
    case 'webhook':
      body = <><TextInput label="Address (URL)" value={s(c.url)} onChange={(v) => set({ url: v.trim() })} placeholder="https://hooks.example.com/…" /><p className="text-xs text-ivory-700">SYNAPSE POSTs JSON with the workflow, the contact’s details and tags, and what started the workflow.</p></>;
      break;
  }
  return (
    <div className="space-y-4">
      <TextInput label="Step name" value={step.name} onChange={(v) => onChange({ ...step, name: v })} hint="Optional. A clear name makes the canvas and logs easier to read." />
      {body}
    </div>
  );
}
