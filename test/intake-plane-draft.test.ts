import { lookupEntrance } from '../src/self-dev/entrance-registry.js';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { buildIntakeDraftFromRaw, createIntakeStore, normalizeIntakeText } from '../src/intake-plane/index.js';
import { coerceDecomposition, type MemoDecomposition, type ProposedMemoTask } from '../src/intake-plane/decompose.js';
import type { EnrichedTask } from '../src/intake-plane/enrich.js';
import type { PipelineRunResult } from '../src/intake-plane/pipeline-runner.js';
import { INTAKE_SLASH_SUBCOMMANDS, resolveIntakeSlash, translateIntakeTaskToHarnessAsk } from '../src/intake-plane/slash.js';
import {
  isConcreteIntakeTaskDecisionSignal,
  isConcreteIntakeTaskInvariant,
} from '../src/intake-plane/types.js';

const enrichedTask = (overrides: Partial<EnrichedTask> = {}): EnrichedTask => ({
  id: 't-1',
  title: 'Implement researched intake launch',
  intent: 'Use prior research in the harness request',
  refs: ['src/intake-plane/slash.ts'],
  keywords: ['research-aware launch'],
  urls: ['https://example.test/research'],
  confidence: 'high',
  // ⛔ 두 골이 «같은 파일»에 병렬로 착지하며 이 헬퍼가 갈렸다 — v1(#14592)이 게이트 칸을
  //   «필수»로 만들었고 v2(#14600)는 그 «전» 트리에서 짜 이 헬퍼에 안 넣었다.
  //   각자 게이트는 초록이었고 합쳐진 main 에서만 3 fail 이 났다(2026-08-31 실측).
  //   ⭐ 더미 문자열은 isConcreteIntakeTaskInvariant 가 «거부»하므로 구체적으로 쓴다.
  invariants: [{
    condition: 'slash.ts 의 기존 서브커맨드 동작을 바꾸지 않는다',
    verification: 'src/intake-plane/slash.ts 의 분기를 읽는다',
    expected: '기존 분기가 모두 남아 있다',
  }],
  decisionSignals: [{
    condition: '리서치 문맥이 자식 ask 에 실린다',
    observation: '낸 ask 안의 keywords 원소 수를 센다',
    expected: '1 이상이다',
  }],
  context: {
    enrichments: [{
      kind: 'keyword',
      source: 'research-aware launch',
      fetchedAt: '2026-08-31T00:00:00.000Z',
      summary: 'Prior research proves the child must receive this context.',
    }],
  },
  ...overrides,
});

const harnessTask = (id: string, ref: string): ProposedMemoTask => ({
  id,
  title: `Implement ${id}`,
  intent: `Deliver ${id} behavior`,
  refs: [ref],
  confidence: 'high',
  invariants: [{
    condition: `${id} remains reachable through resolveIntakeSlash`,
    verification: 'bun test test/intake-plane-draft.test.ts',
    expected: 'the focused resolver assertions pass',
  }],
  decisionSignals: [{
    condition: `${id} is translated for implementation`,
    observation: 'captured harness objective list in the focused resolver test',
    expected: `the objective contains ${ref}`,
  }],
});

function pipelineFor(tasks: ProposedMemoTask[]): PipelineRunResult {
  const decomposition: MemoDecomposition = {
    rationale: 'test decomposition', fallback: false,
    missions: [{ id: 'm-1', title: 'Implementation', tasks }],
  };
  return {
    intakeId: 'intake-fixed',
    decomposition,
    enriched: {
      ...decomposition,
      missions: decomposition.missions.map((mission) => ({
        ...mission,
        tasks: mission.tasks.map((task) => ({
          ...task,
          context: {
            enrichments: [{
              kind: 'repo' as const,
              source: task.refs[0] ?? 'unresolved',
              fetchedAt: '2026-08-31T00:00:00.000Z',
              summary: `Research for ${task.title}`,
            }],
          },
        })),
      })),
    },
  } as PipelineRunResult;
}

describe('normalizeIntakeText', () => {
  test('splits bullets and removes separators', () => {
    const chunks = normalizeIntakeText(['- first item', '  continued detail', '======', '- second item', '', 'plain trailing note'].join('\n'));
    expect(chunks.map((chunk) => chunk.text)).toEqual(['first item continued detail', 'second item', 'plain trailing note']);
  });
});

describe('translateIntakeTaskToHarnessAsk', () => {
  test('includes task-local keywords, URLs, references, and enrichment in the child ask', () => {
    const ask = translateIntakeTaskToHarnessAsk(enrichedTask());
    expect(ask).toContain('research-aware launch');
    expect(ask).toContain('https://example.test/research');
    expect(ask).toContain('src/intake-plane/slash.ts');
    expect(ask).toContain('Prior research proves the child must receive this context.');
  });

  test('changes the child ask when enrichment is removed', () => {
    const researched = translateIntakeTaskToHarnessAsk(enrichedTask());
    const withoutResearch = translateIntakeTaskToHarnessAsk(enrichedTask({ context: { enrichments: [] } }));
    expect(withoutResearch).not.toEqual(researched);
    expect(withoutResearch).not.toContain('Prior research proves the child must receive this context.');
  });

  test('does not leak sibling research into another task ask', () => {
    const ask = translateIntakeTaskToHarnessAsk(enrichedTask());
    const sibling = translateIntakeTaskToHarnessAsk(enrichedTask({
      id: 't-2',
      title: 'Sibling task',
      keywords: ['sibling-only-keyword'],
      urls: ['https://example.test/sibling'],
      context: { enrichments: [{ kind: 'url', source: 'https://example.test/sibling', fetchedAt: '2026-08-31T00:00:00.000Z', summary: 'Sibling-only research.' }] },
    }));
    expect(ask).not.toContain('sibling-only-keyword');
    expect(ask).not.toContain('Sibling-only research.');
    expect(sibling).not.toContain('Prior research proves the child must receive this context.');
  });
});

describe('buildIntakeDraftFromRaw', () => {
  test('classifies mixed scratch note heuristically', () => {
    const draft = buildIntakeDraftFromRaw({
      intakeId: 'intake-1', source: 'tui-scratch',
      rawText: ['- screen recording source check needed', '- capability absorb from hyper frame', '- image preview bug why not working'].join('\n'),
      attachments: [], receivedAt: '2026-04-30T12:00:00.000Z',
    });
    expect(draft.items).toHaveLength(3);
    expect(draft.items.map((item) => item.kind)).toEqual(['research', 'capability-absorb', 'bug']);
    expect(draft.suggestedMode).toBe('mixed');
  });

  test('adds a clarify question when no actionable chunks are found', () => {
    const draft = buildIntakeDraftFromRaw({ intakeId: 'intake-empty', source: 'tui-scratch', rawText: '\n\n====\n', attachments: [], receivedAt: '2026-04-30T12:00:00.000Z' });
    expect(draft.items).toHaveLength(0);
    expect(draft.openQuestions).toHaveLength(1);
    expect(draft.confidence).toBeLessThan(0.3);
  });
});

describe('/intake implement', () => {
  test('translates one concrete task into one ask with exactly one target-path label', () => {
    const ask = translateIntakeTaskToHarnessAsk(harnessTask('t-1', 'src/intake-plane/slash.ts'));
    expect(ask.match(/대상 경로:/g)).toHaveLength(1);
    expect(ask).toContain('src/intake-plane/slash.ts');
    expect(ask).toContain('bun test test/intake-plane-draft.test.ts');
    expect(ask).toContain('captured harness objective list');
  });

  test('help exposes implement as a fifteenth command', async () => {
    const result = await resolveIntakeSlash(['help'], { store: createIntakeStore({ archiveDir: null }) });
    expect(result.output).toContain('/intake implement');
    expect(result.output.split('\n').filter((line) => line.includes('/intake ')).length).toBeGreaterThan(14);
  });

  test('launches one independent harness goal per decomposed task in order', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'implement both'], { store, createIntakeId: () => 'intake-fixed' });
    const objectives: string[] = [];
    const result = await resolveIntakeSlash(['implement'], {
      store,
      runPipeline: async () => pipelineFor([harnessTask('t-1', 'src/intake-plane/slash.ts'), harnessTask('t-2', 'src/intake-plane/decompose.ts')]),
      dispatchHarness: async ({ objective }, context) => {
        objectives.push(objective);
        expect(context?.cwd).toBe(process.cwd());
        expect(context?.signal).toBeInstanceOf(AbortSignal);
        expect(context?.userText).toBe('/intake implement intake-fixed');
        return { output: 'started' };
      },
    });
    expect(objectives).toHaveLength(2);
    expect(objectives[0]).toContain('src/intake-plane/slash.ts');
    expect(objectives[0]).toContain('Research for Implement t-1');
    expect(objectives[1]).toContain('src/intake-plane/decompose.ts');
    expect(result.output).toContain('launched 2/2 independent harness goals');
  });

  test('preserves incomplete draft tasks but rejects them at the harness boundary', () => {
    const draft = coerceDecomposition({
      missions: [{ title: 'Incomplete', tasks: [{ title: 'Missing refs and gates' }] }],
    });
    expect(draft?.missions[0]?.tasks[0]).toMatchObject({ refs: [], invariants: [], decisionSignals: [] });
    expect(() => translateIntakeTaskToHarnessAsk(draft!.missions[0]!.tasks[0]!)).toThrow('no researched target refs');
    expect(isConcreteIntakeTaskInvariant({ condition: 'TBD', verification: 'bun test x', expected: 'pass' })).toBe(false);
    expect(isConcreteIntakeTaskDecisionSignal({ condition: 'done', observation: 'TODO', expected: 'pass' })).toBe(false);
  });

  test('does not dispatch fallback work without researched launchable tasks', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'implement only after clarification'], { store, createIntakeId: () => 'intake-fixed' });
    const result = await resolveIntakeSlash(['implement'], {
      store,
      runPipeline: async () => pipelineFor([{
        id: 't-1',
        title: 'Clarification draft',
        intent: 'needs research before launch',
        refs: [],
        confidence: 'low',
        invariants: [],
        decisionSignals: [],
      }]),
      dispatchHarness: async () => { throw new Error('must not dispatch'); },
    });
    expect(result.output).toContain('launched 0/1 independent harness goals');
    expect(result.output).toContain('not launched: task \'t-1\' has no researched target refs');
    expect(store.getSession('intake-fixed')).toBeDefined();
  });

  test('reports launch failure without deleting or rolling back the intake session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'implement once'], { store, createIntakeId: () => 'intake-fixed' });
    const before = store.getSession('intake-fixed');
    const result = await resolveIntakeSlash(['implement'], {
      store,
      runPipeline: async () => pipelineFor([harnessTask('t-1', 'src/intake-plane/slash.ts')]),
      dispatchHarness: async () => { throw new Error('harness unavailable'); },
    });
    expect(result.output).toContain('launched 0/1 independent harness goals');
    expect(result.output).toContain('not launched: harness unavailable');
    expect(store.getSession('intake-fixed')).toEqual(before);
  });
});

describe('/intake implement — 은퇴한 입구로 발사하지 않는다', () => {
  // ⛔ 반증: 기본 dispatch 를 dispatchRunDevHarness(= entrance-registry 가 retired 로 선언한
  //   nl-run-dev-harness)로 되돌리면 이 시험이 «빨개진다». 초록만으로는 그 되돌림을 못 잡는다.
  test('slash.ts 가 은퇴 입구를 참조하지 않는다', () => {
    const source = readFileSync(new URL('../src/intake-plane/slash.ts', import.meta.url), 'utf8');
    expect(source.includes('dispatchRunDevHarness')).toBe(false);
    expect(source.includes('dispatchSelfImplement')).toBe(true);
  });

  test('entrance-registry 가 그 입구를 여전히 retired 라 말한다', () => {
    const entrance = lookupEntrance('nl-run-dev-harness');
    expect(entrance?.status).toBe('retired');
  });
});

describe('/intake → 하니스 ask — 판정 신호가 «파서가 무는» 문면이다', () => {
  // ⛔ 반증: 이 문면을 옛 형태(`- condition: …; observation: …; expected: …`)로 되돌리면
  //   하니스 `ASK_DECISION_SIGNAL` 이 extracted:false 를 내고 자식은 판정할 수 없다.
  //   📏 2026-08-31 실측으로 그 상태였고, 이 시험이 그 되돌림을 «빨갛게» 만든다.
  test('한국어 3부 라벨 ⊕ = ⊕ 불릿 없음', () => {
    const ask = translateIntakeTaskToHarnessAsk({
      id: 't-1', title: 't', intent: 'i',
      refs: ['src/cli/logs-cli.ts'], keywords: [], urls: [], confidence: 'high',
      invariants: [{
        condition: '기존 logs-cli 플래그를 제거하지 않는다',
        verification: 'src/cli/logs-cli.ts 의 옵션 정의를 읽는다',
        expected: '기존 플래그가 모두 남아 있다',
      }],
      decisionSignals: [{
        condition: '--since 가 조회 창을 실제로 좁힌다',
        observation: '같은 질의를 --since 있이/없이 쳐서 반환 행 수를 센다',
        expected: '있을 때가 없을 때보다 작다',
      }],
    } as never);
    expect(ask).toContain('판정 신호: 조건 = --since 가 조회 창을 실제로 좁힌다; 관측 =');
    expect(ask).not.toContain('- condition:');
  });
});

describe('채널 라우터 ↔ 슬래시 — 서브커맨드 목록이 «갈리지 않는다»', () => {
  // ⛔ 반증: 채널이 자기 사본을 들면 이 시험이 빨개진다.
  //   📏 2026-08-31 실측: 사본이 9개인 동안 슬래시는 16개였고, 차이 «일곱»
  //     (draft·events·help·implement·replay·search·show)이 조용히 인라인 capture 로 떨어졌다.
  //     `/intake help` 가 도움말이 아니라 「help」라는 제목의 «새 세션»을 만들었다.
  test('슬래시가 분기하는 것을 채널이 «전부» 안다', () => {
    const channelSrc = readFileSync(new URL('../src/intake-plane/channel-command.ts', import.meta.url), 'utf8');
    expect(channelSrc).toContain('INTAKE_SLASH_SUBCOMMANDS');
    expect(channelSrc).not.toMatch(/EXISTING_SESSION_SUBCOMMANDS = new Set\(\[/);
  });

  test('그 목록이 slash.ts 의 실제 분기를 덮는다', () => {
    const slashSrc = readFileSync(new URL('../src/intake-plane/slash.ts', import.meta.url), 'utf8');
    const branches = new Set(Array.from(slashSrc.matchAll(/sub === '([a-z]+)'/g), (m) => m[1]!));
    const missing = [...branches].filter((b) => !INTAKE_SLASH_SUBCOMMANDS.has(b));
    expect(missing).toEqual([]);
  });
});
