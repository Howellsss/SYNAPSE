import { describe, expect, it } from 'vitest';
import { compile, duplicateStep, flatten, fromLegacy, insertStep, issues, moveStep, removeStep, settingsFrom, type Step, type Trigger } from './model';
import { RECIPES } from './recipes';
import { STEPS, TRIGGERS, EMPTY_LOOKUPS, grouped } from './catalog';

const st = (id: string, type: Step['type'] = 'add_note', extra: Partial<Step> = {}): Step => ({ id, type, name: '', config: { text: 'x' }, ...extra });

describe('workflow model', () => {
  it('compiles a tree with an If/Else into the engine graph', () => {
    const steps = [st('a'), st('b', 'if_else', { config: { conditions: [{ field: 'tag', op: 'has', value: 'vip' }] }, yes: [st('c'), st('d')], no: [st('e')] })];
    const d = compile([], steps);
    expect(d.start).toBe('a');
    expect(d.graph.a.next).toBe('b');
    expect(d.graph.b).toMatchObject({ yes: 'c', no: 'e', next: '' });
    expect(d.graph.c.next).toBe('d');
    expect(d.graph.d.next).toBe('');
    expect(d.graph.e.next).toBe('');
    expect(flatten(steps).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('inserting an If/Else moves the following steps into its Yes branch; nothing can follow it', () => {
    let steps = [st('a'), st('b'), st('c')];
    steps = insertStep(steps, { parent: null, branch: null }, 1, st('if', 'if_else'));
    expect(steps.map((s) => s.id)).toEqual(['a', 'if']);
    expect(steps[1].yes!.map((s) => s.id)).toEqual(['b', 'c']);
    expect(insertStep(steps, { parent: null, branch: null }, 2, st('z'))).toBe(steps);
    steps = insertStep(steps, { parent: 'if', branch: 'no' }, 0, st('n'));
    expect(steps[1].no!.map((s) => s.id)).toEqual(['n']);
  });

  it('removes, moves and duplicates', () => {
    let steps = [st('a'), st('if', 'if_else', { yes: [st('y')], no: [st('n')] })];
    expect(removeStep(steps, 'if').map((s) => s.id)).toEqual(['a', 'y']);
    expect(removeStep(steps, 'n')[1].no).toEqual([]);
    steps = [st('a'), st('b')];
    expect(moveStep(steps, 'b', -1).map((s) => s.id)).toEqual(['b', 'a']);
    const dup = duplicateStep(steps, 'a');
    expect(dup).toHaveLength(3);
    expect(dup[1].id).not.toBe('a');
  });

  it('finds problems before publishing', () => {
    const settings = settingsFrom({});
    expect(issues([], [], settings).map((i) => i.message)).toEqual(['Add a trigger: what starts this workflow?', 'Add at least one step.']);
    const tr: Trigger = { id: 't', type: 'contact_tag', name: 'Tag', filters: { event: 'added', tags: [] } };
    const msgs = issues([tr], [st('e', 'send_email', { config: { subject: '', body: '' } })], settings).map((i) => i.message);
    expect(msgs).toContain('Choose at least one tag.');
    expect(msgs).toContain('Add a subject.');
    expect(msgs).toContain('Choose the email account to send from (Settings → Sender).');
  });

  it('every recipe is complete apart from the sender account', () => {
    for (const r of RECIPES) {
      const b = r.build();
      const left = issues(b.triggers, b.steps, settingsFrom({ sender: { account_id: 'acc' } }));
      expect(left, r.key).toEqual([]);
    }
  });

  it('turns older workflows into triggers and steps', () => {
    const out = fromLegacy('appointment_no_show', [
      { node_type: 'action', action_type: 'send_email', config: { subject: 'S', body: 'B' } },
      { node_type: 'delay', action_type: null, config: { duration_value: 2, duration_unit: 'days' } },
      { node_type: 'action', action_type: 'add_tag', config: { tag: 'Lost' } },
      { node_type: 'action', action_type: 'send_sms', config: { body: 'x' } },
    ]);
    expect(out.triggers[0]).toMatchObject({ type: 'appointment_status', filters: { statuses: ['no_show'] } });
    expect(out.steps.map((s) => s.type)).toEqual(['send_email', 'wait', 'add_tag']);
    expect(out.steps[1].config).toEqual({ amount: 2, unit: 'days' });
    expect(out.dropped).toEqual(['send_sms']);
  });

  it('catalogue: every item has a summary and defaults; search groups results', () => {
    for (const d of TRIGGERS) expect(typeof d.summary(d.defaults(), EMPTY_LOOKUPS)).toBe('string');
    for (const d of STEPS) expect(typeof d.summary(d.defaults(), EMPTY_LOOKUPS)).toBe('string');
    expect(grouped(STEPS, 'email').flatMap(([, i]) => i.map((x) => x.type))).toContain('send_email');
  });
});

import { sketch } from './describe';
describe('describe it', () => {
  it('sketches a workflow from a sentence', () => {
    const r = sketch('When someone submits my intake form, send them an email, wait 1 day, then create a call task and text them');
    expect(r.triggers[0].type).toBe('form_submitted');
    expect(r.steps.map((s) => s.type)).toEqual(['send_email', 'wait', 'add_task']);
    expect(r.steps[1].config).toMatchObject({ amount: 1, unit: 'days' });
    expect(r.unknown[0]).toMatch(/SMS/);
    expect(sketch('When a contact is tagged "VIP", notify the owner').triggers[0]).toMatchObject({ type: 'contact_tag', filters: { tags: ['VIP'] } });
    expect(sketch('After a no-show, email them').triggers[0].filters).toMatchObject({ statuses: ['no_show'] });
  });
});
