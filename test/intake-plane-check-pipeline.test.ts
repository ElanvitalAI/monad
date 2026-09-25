import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveRuler,
  documentTextForCheck,
  GAP_VERDICTS,
  groundProposals,
  loadIntakeCheckInput,
  parseCompareCallerText,
  parsePreprocessCallerText,
  PREPROCESS_LENSES,
  runIntakeCheck,
  runIntakeCheckDocument,
  type IntakeCheckDeps,
  type IntakeCheckItem,
  type IntakeCheckRuler,
  type IntakeCompareProposal,
} from '../src/intake-plane/check.js';
import { buildIntakeDocumentStageCallables } from '../src/intake-plane/runtime-callables.js';
import { resolveRoleLlm, type UserConfig } from '../src/user-config.js';

const FIVE = [
  '- 영상에서 Opus 가 창작 3연승을 했다',
  '- 영상 화면의 점수판은 7대1이다',
  '- 영상 썸네일의 문구는 비용 정규화다',
  '- 같은 폴더에서 두 에이전트가 충돌했다',
  '- 사람이 손으로 잰 충돌 횟수를 CLI 로 다시 잴 수 있다',
].join('\n');

const TRANSFER = [
  {
    text: 'monad 는 다른 에이전트가 같은 파일을 쓰는 것을 감지하는가',
    quote: '같은 폴더에서 두 에이전트가 충돌했다',
    lens: 'L3 하니스 운영',
  },
  {
    text: 'monad 는 손으로 잰 충돌 횟수를 1급 CLI 로 재는가',
    quote: '사람이 손으로 잰 충돌 횟수를 CLI 로 다시 잴 수 있다',
    lens: 'L4 관측·측정',
  },
];

const DISCARDS = [
  { quote: '영상에서 Opus 가 창작 3연승을 했다', reason: '영상에만 관한 사실' },
  { quote: '영상 화면의 점수판은 7대1이다', reason: '영상에만 관한 사실' },
  { quote: '영상 썸네일의 문구는 비용 정규화다', reason: '영상에만 관한 사실' },
];

function preprocessJson(): string {
  return JSON.stringify({ claims: TRANSFER, discards: DISCARDS });
}

function deps(over: Partial<IntakeCheckDeps> = {}): IntakeCheckDeps {
  const root = join(import.meta.dir, '..');
  const draftDir = mkdtempSync(join(tmpdir(), 'intake-pipe-'));
  return {
    root,
    readFile: (abs) => readFileSync(abs, 'utf8'),
    commit: () => 'test-commit',
    log: () => {},
    draftDir,
    recall: () => [],
    ...over,
  };
}

function cleanup(d: IntakeCheckDeps): void {
  if (d.draftDir) rmSync(d.draftDir, { recursive: true, force: true });
}

describe('intake check document pipeline', () => {
  test('five bullets become two claims and three discards, and raw bullets fail this case', async () => {
    let calls = 0;
    const d = deps({
      preprocess: () => {
        calls += 1;
        return preprocessJson();
      },
    });
    const loaded = loadIntakeCheckInput({ file: undefined, stdin: FIVE, root: d.root });
    expect(loaded.facts).toHaveLength(5);
    const report = await runIntakeCheckDocument(loaded.facts, d, {
      document: FIVE,
      sourceBulletCount: loaded.facts.length,
    });
    expect(calls).toBe(1);
    expect(report.keptClaims).toBe(2);
    expect(report.discardedFacts).toBe(3);
    expect(report.items).toHaveLength(2);
    expect(report.discards?.map((row) => row.reason)).toEqual([
      '영상에만 관한 사실',
      '영상에만 관한 사실',
      '영상에만 관한 사실',
    ]);
    expect(report.items.every((item) => !FIVE.split('\n').some((line) => line.replace(/^- /, '') === item.fact))).toBe(true);
    const raw = runIntakeCheck(loaded.facts, { ...d, preprocess: undefined });
    expect(raw.items).toHaveLength(5);
    expect(raw.items).not.toHaveLength(2);
    cleanup(d);
  });

  test('a throwing preprocess caller reports 못 쟀다(선가공 실패) and writes zero drafts', async () => {
    const d = deps({
      preprocess: () => {
        throw new Error('lens caller down');
      },
    });
    const report = await runIntakeCheckDocument(parseFactListSafe(FIVE), d, {
      document: FIVE,
      sourceBulletCount: 5,
    });
    expect(report.goalDraftPaths).toHaveLength(0);
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.current).toContain('못 쟀다(선가공 실패)');
    expect(report.items[0]?.current).toContain('lens caller down');
    expect(report.items[0]?.verdict).toBe('못 쟀다');
    const fallback = runIntakeCheck(parseFactListSafe(FIVE), { ...d, preprocess: undefined });
    expect(fallback.items.length).toBeGreaterThan(0);
    expect(fallback.items[0]?.current ?? '').not.toContain('선가공 실패');
    cleanup(d);
  });

  test('--fact does not call preprocess and keeps today verdict', () => {
    let calls = 0;
    const d = deps({
      preprocess: () => {
        calls += 1;
        return preprocessJson();
      },
    });
    const fact = '`--role-llm` 으로 역할별 LLM 을 고른다';
    const loaded = loadIntakeCheckInput({ fact, root: d.root });
    const withCaller = runIntakeCheck(loaded.facts, d);
    const without = runIntakeCheck(loaded.facts, { ...d, preprocess: undefined, compare: undefined });
    expect(calls).toBe(0);
    expect(withCaller.items[0]?.verdict).toBe(without.items[0]?.verdict);
    expect(withCaller.keptClaims).toBeUndefined();
    cleanup(d);
  });

  test('a synergy of two real ruler names stays, an unknown name is 근거 없음 and writes no draft', () => {
    const d = deps();
    const ruler = deriveRuler(d);
    expect(ruler.capabilities.length + ruler.surfaces.length).toBeGreaterThan(1);
    const cap = ruler.capabilities[0]?.id;
    const surface = ruler.surfaces[0]?.name;
    expect(cap && surface).toBeTruthy();
    const item: IntakeCheckItem = {
      fact: 'monad 는 두 입구를 같이 쓰는가',
      quotes: ['quote'],
      verdict: '없음',
      line: 'line',
      current: '없음',
      evidence: [{ axis: 'surface', summary: 'hit', path: 'src/index.ts', line: 12 }],
      patterns: [],
      failures: [],
    };
    const proposals: IntakeCompareProposal[] = [
      {
        kind: '시너지',
        fact: item.fact,
        contrast: 'src/index.ts:12',
        surfaces: [cap!, surface!],
      },
      {
        kind: '시너지',
        fact: item.fact,
        contrast: 'src/index.ts:12',
        surfaces: [cap!, 'zzz-not-on-the-ruler'],
      },
    ];
    const grounded = groundProposals(proposals, [item], ruler);
    expect(grounded[0]?.ungrounded).toBeUndefined();
    expect(grounded[1]?.ungrounded).toBe('근거 없음');
    const caller = () => JSON.stringify({
      proposals: proposals.map((row) => ({
        kind: row.kind,
        fact: row.fact,
        contrast: row.contrast,
        surfaces: row.surfaces,
      })),
    });
    const report = runIntakeCheck([
      { text: item.fact, quote: 'quote' },
    ], {
      ...d,
      compare: caller,
      comparer: () => ({
        verdict: '없음',
        current: 'forced',
        evidence: item.evidence,
        patterns: [],
        failures: [],
      }),
    });
    const kept = report.proposals?.filter((row) => !row.ungrounded) ?? [];
    const dropped = report.proposals?.filter((row) => row.ungrounded === '근거 없음') ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0]?.draftPath && readFileSync(kept[0].draftPath, 'utf8')).toContain('시너지');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.draftPath).toBeUndefined();
    expect(GAP_VERDICTS).toEqual(['없음']);
    cleanup(d);
  });

  test('a proposal citing a path:line absent from contrast is 근거 없음', () => {
    const d = deps();
    const ruler = deriveRuler(d);
    const item: IntakeCheckItem = {
      fact: 'monad 는 없는 경로를 근거로 받지 않는다',
      quotes: ['q'],
      verdict: '없음',
      line: 'line',
      current: '없음',
      evidence: [{ axis: 'repo', summary: 'real', path: 'src/intake-plane/check.ts', line: 28 }],
      patterns: [],
      failures: [],
    };
    const text = JSON.stringify({
      proposals: [
        { kind: '추가', fact: item.fact, contrast: 'docs/nowhere.md:9' },
        { kind: '추가', fact: item.fact, contrast: 'src/intake-plane/check.ts:28' },
      ],
    });
    expect(parseCompareCallerText(text)).toHaveLength(2);
    const grounded = groundProposals(parseCompareCallerText(text), [item], ruler);
    expect(grounded.find((row) => row.contrast === 'docs/nowhere.md:9')?.ungrounded).toBe('근거 없음');
    expect(grounded.find((row) => row.contrast === 'src/intake-plane/check.ts:28')?.ungrounded).toBeUndefined();
    const report = runIntakeCheck([{ text: item.fact }], {
      ...d,
      compare: () => text,
      comparer: () => ({
        verdict: '없음',
        current: 'forced',
        evidence: item.evidence,
        patterns: [],
        failures: [],
      }),
    });
    const candidates = report.proposals?.filter((row) => row.draftPath) ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.contrast).toBe('src/intake-plane/check.ts:28');
    expect(report.proposals?.some((row) => row.ungrounded === '근거 없음' && row.contrast === 'docs/nowhere.md:9')).toBe(true);
    cleanup(d);
  });

  test('document stage callers resolve provider from roleLlm, not the default provider', () => {
    const config = {
      llm: { provider: 'openai' },
      roleLlm: { classify: { provider: 'grok' } },
    } as UserConfig;
    const role = resolveRoleLlm('classify', { config });
    expect(role.provider).toBe('grok');
    const stages = buildIntakeDocumentStageCallables({
      resolveRoleProvider: () => ({ provider: { name: role.provider }, model: role.model }),
      streamLLM: async () => '{"claims":[],"discards":[{"quote":"x","reason":"y"}]}',
    });
    expect(stages.providerName).toBe('grok');
    const ignored = buildIntakeDocumentStageCallables({
      resolveProvider: () => ({ name: 'openai' }),
      providers: { openai: { name: 'openai' }, grok: { name: 'grok' } },
      resolveRoleProvider: () => ({ provider: { name: 'grok' } }),
      streamLLM: async () => '{}',
    });
    expect(ignored.providerName).toBe('grok');
    expect(ignored.providerName).not.toBe('openai');
  });

  test('preprocess JSON keeps quote and lens, and 못 쟀다 does not invent a proposal kind', () => {
    const parsed = parsePreprocessCallerText(preprocessJson(), FIVE);
    expect(parsed.claims).toHaveLength(2);
    expect(parsed.claims.every((row) => row.quote.length > 0 && PREPROCESS_LENSES.includes(row.lens))).toBe(true);
    expect(parsed.discards).toHaveLength(3);
    const kinds = parseCompareCallerText(JSON.stringify({
      proposals: [{ kind: '못 쟀다', fact: 'x', contrast: 'a:1' }, { kind: '추가', fact: 'x', contrast: 'a:1' }],
    }));
    expect(kinds.map((row) => row.kind)).toEqual(['추가']);
  });

  test('file, url, and stdin are document mode; fact is not', () => {
    const root = join(import.meta.dir, '..');
    const file = loadIntakeCheckInput({
      file: 'package.json',
      root,
    });
    expect(file.document).toContain('package.json');
    const url = loadIntakeCheckInput({
      url: 'https://example.test/note',
      root,
      fetchText: () => FIVE,
    });
    expect(url.document).toBe('https://example.test/note');
    expect(url.facts).toHaveLength(5);
    const stdin = loadIntakeCheckInput({ stdin: FIVE, root });
    expect(stdin.facts).toHaveLength(5);
    const fact = loadIntakeCheckInput({ fact: '이미 주장이다', root });
    expect(fact.document).toBeUndefined();
    expect(fact.facts).toEqual([{ text: '이미 주장이다', quote: '이미 주장이다' }]);
  });
});

function parseFactListSafe(text: string) {
  return loadIntakeCheckInput({ stdin: text, root: join(import.meta.dir, '..') }).facts;
}

void (null as IntakeCheckRuler | null);

describe('intake check 문서 모드 — CLI 가 선가공에 넘기는 것은 «원문»이다', () => {
  test('파일 입력이면 선가공은 파일 «경로»가 아니라 «본문»을 받는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'intake-doc-text-'));
    const file = join(dir, 'note.md');
    const bodyMarker = ['body', 'only', 'marker', '9c1e'].join('-');
    writeFileSync(file, `# 노트\n- ${bodyMarker} 가 본문에만 있다\n`);
    const loaded = loadIntakeCheckInput({ file, root: dir });
    const text = documentTextForCheck(loaded, { factMode: false });
    expect(text).toContain(bodyMarker);
    expect(text).not.toBe(file);
    let seen = '';
    await runIntakeCheckDocument(loaded.facts, {
      root: dir,
      readFile: () => '',
      commit: () => 'test',
      log: () => {},
      preprocess: (input) => {
        seen = input.document;
        return '{"claims":[],"discards":[]}';
      },
    } as IntakeCheckDeps, { document: text!, sourceBulletCount: loaded.facts.length });
    expect(seen).toContain(bodyMarker);
  });

  test('--fact 이면 원문을 넘기지 않는다', () => {
    const loaded = loadIntakeCheckInput({ facts: ['사실'], root: tmpdir() });
    expect(documentTextForCheck(loaded, { factMode: true })).toBeUndefined();
  });
});

describe('intake check 문서 모드 — 운영 비교 호출자는 «비동기»다', () => {
  test('비동기 비교 호출자의 제안이 문서 모드 산출에 실린다 (compare-failed 로 0 이 되지 않는다)', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const report = await runIntakeCheckDocument([], {
      root: join(import.meta.dir, '..'),
      readFile: (abs: string) => readFileSync(abs, 'utf8'),
      commit: () => 'test',
      log: (event: string, data: Record<string, unknown>) => { events.push({ event, data }); },
      draftDir: mkdtempSync(join(tmpdir(), 'intake-async-compare-')),
      preprocess: async () => JSON.stringify({
        claims: [{ text: '`--role-llm` 으로 역할별 LLM 을 고른다', quote: 'q', lens: 'L3' }],
        discards: [],
      }),
      compare: async () => JSON.stringify({ proposals: [{ kind: '보강', fact: '`--role-llm` 으로 역할별 LLM 을 고른다', contrast: 'src/index.ts:1' }] }),
    } as IntakeCheckDeps, { document: '- 원문', sourceBulletCount: 1 });
    expect(events.some((row) => row.event === 'compare-failed')).toBe(false);
    expect(report.proposalCount).toBe(1);
  });
});
