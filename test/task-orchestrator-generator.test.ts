import { describe, expect, test } from 'bun:test';
import {
  TaskGenerator,
  DecomposeError,
  DECOMPOSE_MAX_DEPTH,
  DECOMPOSE_DEFAULT_MAX_TASKS,
  BUDGET_APPROVAL_RATIO,
  type DecomposeCallable,
} from '../src/task-orchestrator/generator.ts';
import { validateProposal } from '../src/task-orchestrator/generator-schema.js';
import { buildDecomposePrompt } from '../src/task-orchestrator/generator-prompt.js';

// ───────────────────── Validator ─────────────────────

describe('validateProposal', () => {
  const validTask = {
    index: 0,
    title: 'fetch',
    surface: { kind: 'skill', skillName: 'omni-crawl' },
  };

  test('accepts minimal valid proposal', () => {
    const r = validateProposal({
      rationale: 'simple',
      tasks: [validTask],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposal.tasks).toHaveLength(1);
  });

  test('rejects non-object', () => {
    const r = validateProposal('not an object');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('NOT_OBJECT');
  });

  test('rejects missing tasks', () => {
    const r = validateProposal({ rationale: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('MISSING_TASKS');
  });

  test('rejects empty tasks', () => {
    const r = validateProposal({ rationale: 'x', tasks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('EMPTY_TASKS');
  });

  test('rejects missing rationale', () => {
    const r = validateProposal({ tasks: [validTask] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'MISSING_RATIONALE')).toBe(true);
  });

  // ★ checks 완화(대표 2026-07-16) — malformed acceptance.checks 는 전체 거부 대신 drop.
  test('malformed acceptance.checks 는 drop(전체 거부 X)·유효 checks·criteria 는 유지', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [{
        ...validTask,
        acceptance: {
          criteria: ['빌드 통과'],
          checks: [
            '자연어 체크(형식 위반)',                     // malformed → drop
            { kind: 'exit-code', expected: 0 },           // valid → 유지
            { kind: 'nope', foo: 1 },                     // malformed kind → drop
            { kind: 'file-exists', path: 'src/x.ts' },    // valid → 유지
          ],
        },
      }],
    });
    expect(r.ok).toBe(true); // 분해 살아남음
    if (r.ok) {
      const acc = r.proposal.tasks[0].acceptance;
      expect(acc?.criteria).toEqual(['빌드 통과']);
      expect(acc?.checks).toHaveLength(2); // 유효한 2개만 유지
      expect(acc?.checks?.map((c) => c.kind).sort()).toEqual(['exit-code', 'file-exists']);
    }
  });

  test('전부 malformed 면 checks 생략·criteria 로 acceptance 유지', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [{ ...validTask, acceptance: { criteria: ['LLM 리뷰로 판정'], checks: ['자연어만'] } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.tasks[0].acceptance?.criteria).toEqual(['LLM 리뷰로 판정']);
      expect(r.proposal.tasks[0].acceptance?.checks).toBeUndefined();
    }
  });

  test('rejects title > 80 chars', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [{ ...validTask, title: 'x'.repeat(81) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('TASK_SHAPE');
  });

  test('rejects invalid surface', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [{ index: 0, title: 't', surface: { kind: 'bogus' } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'TASK_SHAPE')).toBe(true);
  });

  test('rejects forward dependency', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [
        { index: 0, title: 't0', surface: validTask.surface, dependsOn: [1] },
        { index: 1, title: 't1', surface: validTask.surface },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'FORWARD_DEPENDENCY')).toBe(true);
  });

  test('rejects duplicate index', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [
        { index: 0, title: 't0', surface: validTask.surface },
        { index: 0, title: 't1', surface: validTask.surface },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'DUPLICATE_INDEX')).toBe(true);
  });

  test('rejects task with surface kind outside allowedSurfaces', () => {
    const r = validateProposal(
      {
        rationale: 'x',
        tasks: [{ index: 0, title: 't', surface: { kind: 'terminal-pane', spec: {} } }],
      },
      { allowedSurfaces: ['llm-direct', 'skill'] }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'TASK_SHAPE')).toBe(true);
  });

  test('flags too-many-tasks but still aggregates other errors', () => {
    const tasks = [];
    for (let i = 0; i < 20; i++) {
      tasks.push({ index: i, title: `t${i}`, surface: validTask.surface });
    }
    const r = validateProposal({ rationale: 'x', tasks }, { maxTasks: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'TOO_MANY_TASKS')).toBe(true);
  });

  test('accepts acceptance shape with deterministic checks', () => {
    const r = validateProposal({
      rationale: 'x',
      tasks: [
        {
          index: 0,
          title: 't',
          surface: validTask.surface,
          acceptance: {
            criteria: ['works'],
            checks: [{ kind: 'exit-code', expected: 0 }],
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

// ───────────────────── Prompt builder ─────────────────────

describe('buildDecomposePrompt', () => {
  test('includes objective + maxTasks', () => {
    const p = buildDecomposePrompt(
      { objective: 'Fix auth bug' },
      { maxTasks: 5 }
    );
    expect(p).toContain('Fix auth bug');
    expect(p).toContain('maxTasks: 5');
  });

  test('includes retry errors when provided', () => {
    const p = buildDecomposePrompt(
      { objective: 'x' },
      {
        maxTasks: 7,
        retryErrors: [{ code: 'TASK_SHAPE', message: 'foo' }],
      }
    );
    expect(p).toContain('Retry: prior output failed validation');
    expect(p).toContain('TASK_SHAPE');
  });

  test('includes context sections when present', () => {
    const p = buildDecomposePrompt(
      {
        objective: 'x',
        context: {
          priorResults: [{ taskId: 'task:a', title: 'did X', output: 'result' }],
          attachedFiles: [{ path: 'a.ts', kind: 'code' }],
          activeSummary: 'goal overview',
        },
      },
      { maxTasks: 7 }
    );
    expect(p).toContain('Prior results');
    expect(p).toContain('task:a');
    expect(p).toContain('Attached files');
    expect(p).toContain('a.ts');
    expect(p).toContain('Active goal summary');
    expect(p).toContain('goal overview');
  });

  // ── AXON P6 wrap-up B1 — acx-session 8th surface + goalKind hint ──

  test('surface union enumerates 8 kinds incl. acx-session', () => {
    const p = buildDecomposePrompt({ objective: 'x' }, { maxTasks: 7 });
    // 8 surface kinds in the JSON schema line
    for (const kind of ['llm-direct', 'skill', 'subagent', 'chat-prompt', 'terminal-pane', 'vw-slot', 'cron', 'acx-session']) {
      expect(p).toContain(`"${kind}"`);
    }
    // surface shapes block contains acx-session entry
    expect(p).toContain('- acx-session:');
    expect(p).toContain('agentBrand');
  });

  test('default allowedSurfaces text mentions "any of the 8"', () => {
    const p = buildDecomposePrompt({ objective: 'x' }, { maxTasks: 7 });
    expect(p).toContain('any of the 8');
    expect(p).not.toContain('any of the 7');
  });

  test('goalKind="coding" appends recommended-surface section', () => {
    const p = buildDecomposePrompt(
      { objective: 'fix the build', goalKind: 'coding' },
      { maxTasks: 7 }
    );
    expect(p).toContain('Recommended surface for coding/refactor goals');
    expect(p).toContain('acx-session');
    expect(p).toContain('DualRoleManager');
  });

  test('goalKind="refactor" also triggers recommended-surface section', () => {
    const p = buildDecomposePrompt(
      { objective: 'rename module', goalKind: 'refactor' },
      { maxTasks: 7 }
    );
    expect(p).toContain('Recommended surface for coding/refactor goals');
  });

  test('goalKind="agent-driven" also triggers (variant alias)', () => {
    const p = buildDecomposePrompt(
      { objective: 'investigate', goalKind: 'agent-driven' },
      { maxTasks: 7 }
    );
    expect(p).toContain('Recommended surface for coding/refactor goals');
  });

  test('goalKind="research" does NOT trigger (non-coding goal)', () => {
    const p = buildDecomposePrompt(
      { objective: 'survey RSS feeds', goalKind: 'research' },
      { maxTasks: 7 }
    );
    expect(p).not.toContain('Recommended surface for coding/refactor goals');
  });

  test('goalKind absent → no recommended-surface section', () => {
    const p = buildDecomposePrompt({ objective: 'x' }, { maxTasks: 7 });
    expect(p).not.toContain('Recommended surface for coding/refactor goals');
  });

  test('case-insensitive goalKind match', () => {
    const p = buildDecomposePrompt(
      { objective: 'x', goalKind: 'CODING' },
      { maxTasks: 7 }
    );
    expect(p).toContain('Recommended surface for coding/refactor goals');
  });
});

// ───────────────────── Generator ─────────────────────

function mockCallable(text: string | (() => string)): DecomposeCallable {
  return async () => ({
    text: typeof text === 'function' ? text() : text,
    costUsd: 0.01,
    tokenUsage: { input: 500, output: 200 },
    modelId: 'mock-model',
  });
}

const validJson = JSON.stringify({
  rationale: 'linear pipeline: fetch then summarise',
  tasks: [
    {
      index: 0,
      title: 'fetch rss',
      surface: { kind: 'skill', skillName: 'omni-crawl' },
      estimateUsd: 0.05,
    },
    {
      index: 1,
      title: 'summarise',
      surface: { kind: 'llm-direct', prompt: 'summarise {{prev}}' },
      dependsOn: [0],
      estimateUsd: 0.03,
    },
  ],
});

describe('TaskGenerator.decompose — happy path', () => {
  test('parses valid JSON response → returns proposal', async () => {
    const g = new TaskGenerator({ callable: mockCallable(validJson) });
    const res = await g.decompose({ objective: 'daily RSS digest' });
    expect(res.proposal.tasks).toHaveLength(2);
    expect(res.proposal.rationale).toContain('pipeline');
    expect(res.retries).toBe(0);
    expect(res.estimatedTotalUsd).toBeCloseTo(0.08, 2);
    expect(res.applyToken).toMatch(/^tx-[0-9a-f]+$/);
    expect(res.generatorModelId).toBe('mock-model');
  });

  test('tolerates fenced JSON output', async () => {
    const fenced = '```json\n' + validJson + '\n```';
    const g = new TaskGenerator({ callable: mockCallable(fenced) });
    const res = await g.decompose({ objective: 'x' });
    expect(res.proposal.tasks).toHaveLength(2);
  });

  test('tolerates leading prose + trailing prose', async () => {
    const noisy = `Here is my plan:\n\n${validJson}\n\nLet me know if you want changes.`;
    const g = new TaskGenerator({ callable: mockCallable(noisy) });
    const res = await g.decompose({ objective: 'x' });
    expect(res.proposal.tasks).toHaveLength(2);
  });
});

describe('TaskGenerator.decompose — retry on validation failure', () => {
  test('first call bad JSON → second call valid → success', async () => {
    let call = 0;
    const callable: DecomposeCallable = async () => {
      call++;
      if (call === 1) return { text: 'not json at all' };
      return { text: validJson };
    };
    const g = new TaskGenerator({ callable });
    const res = await g.decompose({ objective: 'x' });
    expect(res.retries).toBe(1);
    expect(res.proposal.tasks).toHaveLength(2);
    expect(call).toBe(2);
  });

  test('both calls bad → throws DecomposeError(VALIDATION_FAILED)', async () => {
    const g = new TaskGenerator({ callable: mockCallable('garbage') });
    await expect(g.decompose({ objective: 'x' })).rejects.toThrow(/VALIDATION_FAILED/);
    try {
      await g.decompose({ objective: 'x' });
    } catch (err) {
      expect(err).toBeInstanceOf(DecomposeError);
      if (err instanceof DecomposeError) {
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.validationErrors).toBeDefined();
      }
    }
  });
});

describe('TaskGenerator.decompose — depth cap', () => {
  test('depth >= MAX throws DEPTH_EXCEEDED without calling LLM', async () => {
    let called = false;
    const callable: DecomposeCallable = async () => {
      called = true;
      return { text: validJson };
    };
    const g = new TaskGenerator({ callable });
    await expect(g.decompose({ objective: 'x', depth: DECOMPOSE_MAX_DEPTH })).rejects.toThrow(
      /DEPTH_EXCEEDED/
    );
    expect(called).toBe(false);
  });
});

describe('TaskGenerator.decompose — requiresApproval heuristics', () => {
  test('budget 30%+ → requiresApproval', async () => {
    const g = new TaskGenerator({ callable: mockCallable(validJson) });
    const res = await g.decompose({
      objective: 'x',
      constraints: { budgetUsdRemaining: 0.1 }, // total est 0.08 / 0.1 = 80% > 30%
    });
    expect(res.requiresApproval).toBe(true);
    expect(res.approvalReasons.some((r) => r.includes('remaining'))).toBe(true);
  });

  test('budget < 30% → no approval needed', async () => {
    const g = new TaskGenerator({ callable: mockCallable(validJson) });
    const res = await g.decompose({
      objective: 'x',
      constraints: { budgetUsdRemaining: 10 }, // 0.08 / 10 = 0.8% < 30%
    });
    expect(res.requiresApproval).toBe(false);
  });

  test('destructive command detected → requiresApproval', async () => {
    const destructive = JSON.stringify({
      rationale: 'dangerous',
      tasks: [
        {
          index: 0,
          title: 'clean workspace',
          description: 'rm -rf node_modules to force fresh install',
          surface: { kind: 'terminal-pane', spec: { command: 'rm -rf node_modules' } },
        },
      ],
    });
    const g = new TaskGenerator({ callable: mockCallable(destructive) });
    const res = await g.decompose({ objective: 'clean' });
    expect(res.requiresApproval).toBe(true);
    expect(res.approvalReasons.some((r) => r.includes('destructive'))).toBe(true);
  });

  test('surface monoculture vs. preferredSurfaces diversity', async () => {
    const monoculture = JSON.stringify({
      rationale: 'all skill',
      tasks: [
        { index: 0, title: 'a', surface: { kind: 'skill', skillName: 'x1' } },
        { index: 1, title: 'b', surface: { kind: 'skill', skillName: 'x2' } },
        { index: 2, title: 'c', surface: { kind: 'skill', skillName: 'x3' } },
      ],
    });
    const g = new TaskGenerator({ callable: mockCallable(monoculture) });
    const res = await g.decompose({
      objective: 'x',
      constraints: { preferredSurfaces: ['skill', 'llm-direct', 'subagent'] },
    });
    expect(res.requiresApproval).toBe(true);
    expect(res.approvalReasons.some((r) => r.includes('monoculture'))).toBe(true);
  });
});

describe('TaskGenerator.decompose — applyToken', () => {
  test('token format tx-<hex>', async () => {
    const g = new TaskGenerator({
      callable: mockCallable(validJson),
      randomHex: (bytes) => 'a'.repeat(bytes * 2),
    });
    const res = await g.decompose({ objective: 'x' });
    expect(res.applyToken).toBe('tx-' + 'a'.repeat(12));
  });

  test('two decomposes produce distinct tokens', async () => {
    const g = new TaskGenerator({ callable: mockCallable(validJson) });
    const a = await g.decompose({ objective: 'x' });
    const b = await g.decompose({ objective: 'x' });
    expect(a.applyToken).not.toBe(b.applyToken);
  });
});

describe('TaskGenerator.decompose — maxTasks cap', () => {
  test('hard cap of 15 enforced', async () => {
    const tasks = [];
    for (let i = 0; i < 20; i++) {
      tasks.push({
        index: i,
        title: `t${i}`,
        surface: { kind: 'llm-direct', prompt: 'x' },
      });
    }
    const bigJson = JSON.stringify({ rationale: 'x', tasks });
    const g = new TaskGenerator({ callable: mockCallable(bigJson) });
    // maxTasks defaults to 7, but hard max is 15 — both are rejected
    await expect(g.decompose({ objective: 'x' })).rejects.toThrow(/VALIDATION_FAILED/);
  });
});

describe('Constants', () => {
  test('DECOMPOSE_MAX_DEPTH = 4', () => {
    expect(DECOMPOSE_MAX_DEPTH).toBe(4);
  });

  test('defaults + ratio constants exposed', () => {
    expect(DECOMPOSE_DEFAULT_MAX_TASKS).toBe(7);
    expect(BUDGET_APPROVAL_RATIO).toBe(0.3);
  });
});
