import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  parseUpdatePlanArgs, dispatchUpdatePlan,
  getPlanState, subscribePlanUpdate, setPlanToolPlanModeGuard,
  _resetPlanStateForTesting, _clearPlanListenersForTesting,
  renderPlanBoard,
} from '../../src/code-edit/index.js';

beforeAll(() => { chalk.level = 3; });
afterEach(() => {
  _resetPlanStateForTesting();
  _clearPlanListenersForTesting();
  setPlanToolPlanModeGuard(null);
});

describe('parseUpdatePlanArgs — validation', () => {
  test('happy path: 3 pending steps', () => {
    const r = parseUpdatePlanArgs({
      plan: [
        { step: 'a', status: 'pending' },
        { step: 'b', status: 'pending' },
        { step: 'c', status: 'pending' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok !== true) throw new Error();
    expect(r.args.plan).toHaveLength(3);
  });

  test('empty plan rejected', () => {
    const r = parseUpdatePlanArgs({ plan: [] });
    expect(r.ok).toBe(false);
  });

  test('missing step text rejected', () => {
    const r = parseUpdatePlanArgs({ plan: [{ step: '   ', status: 'pending' }] });
    expect(r.ok).toBe(false);
  });

  test('unknown status rejected', () => {
    const r = parseUpdatePlanArgs({ plan: [{ step: 'a', status: 'done' }] });
    expect(r.ok).toBe(false);
    if (r.ok === true) throw new Error();
    expect(r.reason).toContain('status');
  });

  test('two in_progress steps rejected (single in_progress invariant)', () => {
    const r = parseUpdatePlanArgs({
      plan: [
        { step: 'a', status: 'in_progress' },
        { step: 'b', status: 'in_progress' },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok === true) throw new Error();
    expect(r.reason).toContain('one step');
  });

  test('optional explanation preserved', () => {
    const r = parseUpdatePlanArgs({
      plan: [{ step: 'a', status: 'pending' }],
      explanation: 'initial draft',
    });
    if (r.ok !== true) throw new Error();
    expect(r.args.explanation).toBe('initial draft');
  });
});

describe('dispatchUpdatePlan — state + events', () => {
  test('updates singleton state with monotonic version', async () => {
    await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'pending' }] });
    const s1 = getPlanState();
    expect(s1.steps).toHaveLength(1);
    expect(s1.version).toBe(1);

    await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'in_progress' }] });
    const s2 = getPlanState();
    expect(s2.steps[0]!.status).toBe('in_progress');
    expect(s2.version).toBe(2);
  });

  test('publishes state to subscribers', async () => {
    const seen: number[] = [];
    subscribePlanUpdate((s) => seen.push(s.version));
    await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'pending' }] });
    await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'completed' }] });
    expect(seen).toEqual([1, 2]);
  });

  test('invalid input returns "update_plan failed:" without changing state', async () => {
    await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'pending' }] });
    const before = getPlanState().version;
    const r = await dispatchUpdatePlan({ plan: [] });
    expect(r.output).toMatch(/failed/);
    expect(getPlanState().version).toBe(before);
  });

  test('output carries "n/m complete — now: <step>" summary', async () => {
    const r = await dispatchUpdatePlan({
      plan: [
        { step: 'parse token', status: 'completed' },
        { step: 'validate signature', status: 'in_progress' },
        { step: 'check expiry', status: 'pending' },
      ],
    });
    expect(r.output).toContain('1/3 complete');
    expect(r.output).toContain('validate signature');
  });

  test('plan-mode guard rejects the call + never mutates state', async () => {
    setPlanToolPlanModeGuard(() => 'plan mode is active');
    const before = getPlanState().version;
    const r = await dispatchUpdatePlan({ plan: [{ step: 'a', status: 'pending' }] });
    expect(r.output).toContain('plan mode is active');
    expect(getPlanState().version).toBe(before);
  });
});

describe('renderPlanBoard', () => {
  test('empty state → empty rows', () => {
    expect(renderPlanBoard(getPlanState())).toEqual([]);
  });

  test('title + per-step glyphs', async () => {
    // IDX-6 Phase 6 migration — glyphs now resolve through
    // theme-icons (`done` / `running` / `backlog` slots). The default
    // theme ships emoji (✅ 🟢 ⚪); ASCII mode swaps to `[v]` / `[>]` /
    // `[ ]`. Assertions use `includes` so either set is acceptable,
    // which matches real user runtime where ELANOUS_ASCII_ICONS decides.
    await dispatchUpdatePlan({
      explanation: 'kicking off',
      plan: [
        { step: 'parse token', status: 'completed' },
        { step: 'validate signature', status: 'in_progress' },
        { step: 'check expiry', status: 'pending' },
      ],
    });
    const rows = renderPlanBoard(getPlanState(), { noColor: true });
    const joined = rows.join('\n');
    expect(rows[0]).toContain('Plan');
    expect(rows[0]).toContain('kicking off');
    expect(joined).toContain('parse token');
    expect(joined).toContain('validate signature');
    expect(joined).toContain('check expiry');
    // Each step still carries a glyph before its number — the exact
    // glyph is theme-dependent, but a prefix cell is always present.
    expect(joined).toMatch(/ [\S]+ 1\. parse token/);
    expect(joined).toMatch(/ [\S]+ 2\. validate signature/);
    expect(joined).toMatch(/ [\S]+ 3\. check expiry/);
  });

  test('noColor drops ANSI escapes', async () => {
    await dispatchUpdatePlan({ plan: [{ step: 'x', status: 'pending' }] });
    const rows = renderPlanBoard(getPlanState(), { noColor: true });
    expect(rows.join('\n')).not.toMatch(/\x1b\[/);
  });

  test('default render contains ANSI', async () => {
    await dispatchUpdatePlan({ plan: [{ step: 'x', status: 'pending' }] });
    const rows = renderPlanBoard(getPlanState());
    expect(rows.join('\n')).toMatch(/\x1b\[/);
  });
});
