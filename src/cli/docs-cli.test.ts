// ⛔⭐ `mock.module()` 을 «쓰지 않는다»(`.rules/30-harness/testing-gates.md` `R-TST8`).
//   초판은 `mock.module('../autopilot/discovery/doc-staleness.js', …)` 로 «부분 목»을 걸었고,
//   그 목이 process-wide 라 같은 런의 `doc-staleness.test.ts` 가 그것을 상속받아
//   `Export named 'assessDocStaleness' not found` 로 죽었다 — ***게이트가 세 라운드 실패한 실제 원인이다.***
//   ⇒ 지금은 `runDocsStale` 의 네 번째 인자(주입 심)로 가른다. 목은 «이 파일 안»에서 끝난다.
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDocsRevision, runDocsStale, type DocsRevisionDeps, type DocsStaleDeps } from './docs-cli.js';
import { assessLineAnchors, assessSourcePaths, formatDocStaleness, isRemovedIdentifierLine } from '../autopilot/discovery/doc-staleness.js';
import { setGitCommandRunnerForTesting } from '../git-fs/runner.js';

afterEach(() => setGitCommandRunnerForTesting(undefined));

const branches = {
  current: 0, 'recently-removed': 0, 'long-removed': 1, 'javascript-keyword': 0,
  'document-label': 0, 'uppercase-status': 0, 'string-literal': 0, 'non-typescript-source': 0, unclassified: 0,
} as const;

const document = {
  path: 'docs/example.md', superseded: false, supersededBy: null, staleScore: 0,
  removedIdentifiers: ['oldName'], brokenLinkCount: 0,
  sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 },
  lineAnchors: { checked: 0, mismatches: [], unavailable: [], symbolLessCitations: 0, tolerance: 5 },
  branches: { ...branches }, hasAnySignal: true,
  removedIdentifierSites: [{ identifier: 'oldName', line: 42, text: '`oldName` 을 쓴다', more: 2 }],
};

function harness(overrides: Partial<DocsStaleDeps> = {}) {
  const printed: string[] = [];
  const errors: string[] = [];
  const logs: { category: string; event: string; data?: Record<string, unknown> }[] = [];
  const deps: Partial<DocsStaleDeps> = {
    assessOne: () => ({ outcome: 'assessed' as const, document: document as never }),
    assessAll: () => ({
      checked: 1, withAnySignal: 1,
      byAxis: { removedIdentifiers: 1, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
      sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' }, sourcePathDocuments: [],
      lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [],
      branches: { ...branches }, documents: [document],
    }) as never,
    format: (doc: { path: string }, stale: boolean) => `${doc.path}: ${stale ? '늙음' : '현재'}`,
    emptyBranches: () => ({ ...branches }) as never,
    log: (category, event, data) => { logs.push({ category, event, ...(data ? { data } : {}) }); },
    print: (line) => { printed.push(line); },
    printError: (line) => { errors.push(line); },
    ...overrides,
  };
  return { deps, printed, errors, logs };
}

function revisionHarness(overrides: Partial<DocsRevisionDeps> = {}) {
  const printed: string[] = [];
  const errors: string[] = [];
  const deps: Partial<DocsRevisionDeps> = {
    readDocument: () => '현재 판 = v51',
    readHistory: () => ['v51', 'v54'],
    print: (line) => { printed.push(line); },
    printError: (line) => { errors.push(line); },
    ...overrides,
  };
  return { deps, printed, errors };
}

test('docs revision은 뒤처짐과 판 차를 사람이 읽을 산출로 내고 관문이 되지 않는다', async () => {
  const { deps, printed } = revisionHarness();
  expect(await runDocsRevision('docs/MANUAL.md', {}, '/repo', deps)).toBe(0);
  expect(printed).toEqual(['docs revision — docs/MANUAL.md: 선언 v51 < 이력 최고 v54 — 3판 뒤처짐']);
});

test('docs revision은 선언 없음과 이력 못 읽음을 서로 다른 성공 산출로 보존한다', async () => {
  const noDeclaration = revisionHarness({ readDocument: () => 'v54는 과거 판이다.' });
  expect(await runDocsRevision('docs/no-declaration.md', {}, '/repo', noDeclaration.deps)).toBe(0);
  expect(noDeclaration.printed[0]).toContain('판 선언 없음 — 검사 대상 아님');
  const unavailable = revisionHarness({ readHistory: () => null });
  expect(await runDocsRevision('docs/unavailable.md', {}, '/repo', unavailable.deps)).toBe(0);
  expect(unavailable.printed[0]).toContain('이력 못 읽음 — 비교 불가');
  expect(unavailable.printed[0]).not.toBe(noDeclaration.printed[0]);
});

test('docs revision은 형식 오류·애매함·일치·앞섬·빈/무효 이력을 구별하고 JSON에 원 판정을 보존한다', async () => {
  const cases: Array<{ text: string; history: readonly string[] | null; expected: string }> = [
    { text: '현재 판 = latest', history: ['v54'], expected: '판 선언 형식 오류' },
    { text: '현재 판 = v51, current version = v54', history: ['v54'], expected: '판 선언 2개 — 어느 선언을 쓸지 애매함' },
    { text: '현재 판 = v54', history: ['v54'], expected: '일치' },
    { text: '현재 판 = v55', history: ['v54'], expected: '1판 앞섬' },
    { text: '현재 판 = v54', history: [], expected: '읽은 이력에 판 없음' },
    { text: '현재 판 = v54', history: ['latest'], expected: '이력에 유효한 vN 없음' },
  ];
  for (const { text, history, expected } of cases) {
    const { deps, printed } = revisionHarness({ readDocument: () => text, readHistory: () => history });
    expect(await runDocsRevision('docs/example.md', {}, '/repo', deps)).toBe(0);
    expect(printed[0]).toContain(expected);
  }
  const json = revisionHarness();
  expect(await runDocsRevision('docs/example.md', { json: true }, '/repo', json.deps)).toBe(0);
  expect(JSON.parse(json.printed[0]!)).toMatchObject({ path: 'docs/example.md', branch: 'behind', gap: 3 });
});

test('docs revision 기본 이력 경로는 빈 Git 제목을 history-invalid로 보존하고 성공 종료한다', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'docs-revision-cli-'));
  const path = 'docs/example.md';
  const printed: string[] = [];
  const errors: string[] = [];
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, path), '현재 판 = v54\n');
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['add', path], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty-message', '-m', ''], { cwd: repo });
    expect(await runDocsRevision(path, {}, repo, {
      print: (line) => { printed.push(line); },
      printError: (line) => { errors.push(line); },
    })).toBe(0);
    expect(printed).toEqual(['docs revision — docs/example.md: 선언 v54 · 이력에 유효한 vN 없음']);
    expect(errors).toEqual([]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('docs revision 기본 이력 경로는 문서 커밋이 없을 때만 history-empty를 낸다', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'docs-revision-cli-empty-'));
  const path = 'docs/example.md';
  const printed: string[] = [];
  const errors: string[] = [];
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, path), '현재 판 = v54\n');
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), 'unrelated\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'unrelated commit'], { cwd: repo });
    expect(await runDocsRevision(path, {}, repo, {
      print: (line) => { printed.push(line); },
      printError: (line) => { errors.push(line); },
    })).toBe(0);
    expect(printed).toEqual(['docs revision — docs/example.md: 선언 v54 · 읽은 이력에 판 없음']);
    expect(errors).toEqual([]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('docs revision 기본 이력 경로는 공용 심 stdout을 제목 이력으로 소비한다', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'docs-revision-cli-ok-'));
  const path = 'docs/example.md';
  const printed: string[] = [];
  const errors: string[] = [];
  const seen: Array<{ cwd: string; args: string[]; encoding: unknown }> = [];
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, path), '현재 판 = v54\n');
    setGitCommandRunnerForTesting((cwd, args, options) => {
      seen.push({ cwd, args: [...args], encoding: options.encoding });
      return { status: 0, stdout: 'v51\0v54\0', stderr: '' };
    });
    expect(await runDocsRevision(path, {}, repo, {
      print: (line) => { printed.push(line); },
      printError: (line) => { errors.push(line); },
    })).toBe(0);
    expect(seen).toEqual([{ cwd: repo, args: ['log', '--format=%s%x00', '--', path], encoding: 'utf-8' }]);
    expect(printed).toEqual(['docs revision — docs/example.md: 선언 v54 = 이력 최고 v54 — 일치']);
    expect(errors).toEqual([]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('docs revision 기본 이력 경로는 Git status 실패를 성공 출력과 같은 값으로 접지 않는다', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'docs-revision-cli-status-'));
  const path = 'docs/example.md';
  const printed: string[] = [];
  const errors: string[] = [];
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, path), '현재 판 = v54\n');
    setGitCommandRunnerForTesting((_cwd, _args, options) => {
      expect(options).toEqual({ encoding: 'utf-8' });
      return { status: 128, stdout: 'v54\0', stderr: 'fatal: not a git repository' };
    });
    expect(await runDocsRevision(path, {}, repo, {
      print: (line) => { printed.push(line); },
      printError: (line) => { errors.push(line); },
    })).toBe(0);
    expect(printed).toEqual(['docs revision — docs/example.md: 선언 v54 · 이력 못 읽음 — 비교 불가']);
    expect(printed[0]).not.toContain('일치');
    expect(errors).toEqual([]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('docs revision은 경로 누락·문서 부재만 오류로 내고 이력 조회는 실패로 접지 않는다', async () => {
  const missingPath = revisionHarness();
  expect(await runDocsRevision(undefined, {}, '/repo', missingPath.deps)).toBe(1);
  expect(missingPath.errors[0]).toContain('문서 경로가 필요합니다');
  const missingDocument = revisionHarness({ readDocument: () => null });
  expect(await runDocsRevision('docs/missing.md', {}, '/repo', missingDocument.deps)).toBe(1);
  expect(missingDocument.errors[0]).toContain('docs/missing.md');
});

test('docs stale 단일 문서는 branches 를 docs.stale 결과 관측으로 남기고 사람이 읽을 산출을 낸다', async () => {
  const { deps, printed, logs } = harness();
  expect(await runDocsStale('docs/example.md', {}, '/repo', deps)).toBe(0);
  expect(printed[0]).toBe('docs/example.md: 늙음');
  expect(logs[0]).toEqual({ category: 'docs.stale', event: 'assessment-start', data: { path: 'docs/example.md' } });
  expect(logs[1]?.event).toBe('assessment-result');
  expect(logs[1]?.data).toMatchObject({ checked: 1, stale: 1 });   // ⭐ 여기 stale 은 «축 판정»이다
  expect((logs[1]?.data?.branches as Record<string, number>)['long-removed']).toBe(1);
});

test('이력 인자 없으면 기존 산출을 한 바이트도 보강하지 않고 이력 조회도 하지 않는다', async () => {
  let calls = 0;
  const { deps, printed } = harness({ enrichHistory: () => { calls++; throw new Error('기본 경로는 이력을 읽지 않는다'); } });
  expect(await runDocsStale('docs/example.md', {}, '/repo', deps)).toBe(0);
  expect(calls).toBe(0);
  expect(printed).toEqual([
    'docs/example.md: 늙음',
    '    oldName  docs/example.md:42 (외 2줄)',
    '      `oldName` 을 쓴다',
  ]);
});

test('--history 는 찾은 커밋과 못 찾음을 서로 다른 값으로 내고 같은 커밋을 이름마다 보인다', async () => {
  const multi = { ...document, removedIdentifiers: ['oldName', 'oldAlias'] };
  const { deps, printed, logs } = harness({
    assessOne: () => ({ outcome: 'assessed' as const, document: multi as never }),
    enrichHistory: (doc) => ({ ...doc, removedIdentifierHistory: [
      { identifier: 'oldName', status: 'found', commit: { shortId: 'abc1234', title: 'retire old names' } },
      { identifier: 'oldAlias', status: 'found', commit: { shortId: 'abc1234', title: 'retire old names' } },
    ] }),
    now: (() => { let time = 100; return () => (time += 25); })(),
  });
  expect(await runDocsStale('docs/example.md', { history: true }, '/repo', deps)).toBe(0);
  expect(printed).toContain('    oldName → abc1234 retire old names');
  expect(printed).toContain('    oldAlias → abc1234 retire old names');
  expect(printed).toContain('    이력 조회 25ms');
  expect(logs.find((entry) => entry.event === 'history-result')?.data).toMatchObject({ identifiers: 2, found: 2, elapsedMs: 25 });
});

test('삭제 이력은 식별자 토큰 경계로만 귀속해 foo를 foobar 제거 커밋에 붙이지 않는다', () => {
  expect(isRemovedIdentifierLine('foo', '- export const foobar = 1;')).toBe(false);
  expect(isRemovedIdentifierLine('foo', '- export const foo = 1;')).toBe(true);
});

test('--history 는 이력 실패를 명령 실패나 빈 값으로 접지 않고 못 찾았다고 낸다', async () => {
  const { deps, printed } = harness({
    enrichHistory: (doc) => ({ ...doc, removedIdentifierHistory: [{ identifier: 'oldName', status: 'not-found' }] }),
    now: (() => { let time = 0; return () => (time += 10); })(),
  });
  expect(await runDocsStale('docs/example.md', { history: true }, '/repo', deps)).toBe(0);
  expect(printed).toContain('    oldName → 못 찾았다');
  expect(printed).toContain('    이력 조회 10ms');
});

test('문서를 못 찾으면 exit 1 이고 산출이 아니라 오류로 낸다', async () => {
  const { deps, printed, errors } = harness({ assessOne: () => ({ outcome: 'missing' as const }) });
  expect(await runDocsStale('docs/missing.md', {}, '/repo', deps)).toBe(1);
  expect(printed).toEqual([]);
  expect(errors[0]).toBe('monad docs stale: 문서를 찾을 수 없음 (docs/missing.md)');
});

test('실재하나 사정거리 밖이면 찾을 수 없음과 다른 오류 문면을 낸다', async () => {
  const missing = harness({ assessOne: () => ({ outcome: 'missing' as const }) });
  const outOfScope = harness({ assessOne: () => ({ outcome: 'out-of-scope' as const }) });
  expect(await runDocsStale('NOPE-NOT-EXIST.md', {}, '/repo', missing.deps)).toBe(1);
  expect(await runDocsStale('src/index.ts', {}, '/repo', outOfScope.deps)).toBe(1);
  expect(missing.errors[0]).toBe('monad docs stale: 문서를 찾을 수 없음 (NOPE-NOT-EXIST.md)');
  expect(outOfScope.errors[0]).toBe('monad docs stale: 파일이 실재하지만 판정 사정거리 밖 (src/index.ts)');
  expect(outOfScope.errors[0]).not.toBe(missing.errors[0]);
  expect(outOfScope.errors[0]).toContain('사정거리');
});

test('경로 없이 부르면 전수 요약을 내고 검사 수·늙음 수를 관측에 싣는다', async () => {
  const { deps, printed, logs } = harness();
  expect(await runDocsStale(undefined, {}, '/repo', deps)).toBe(0);
  // ⛔⭐ 기본은 «고유 판별자» 축이다(3R must-fix ①) — 합집합은 --axis all 로만 준다
  expect(printed[0]).toBe('docs stale — 1개 검사 · [--axis removed-identifiers] 늙음 1개');
  expect(printed[1]).toContain('사라진 식별자 1');
  expect(printed[1]).toContain('신호 하나라도 1');
  expect(logs[1]?.data).toMatchObject({ checked: 1, stale: 1 });   // ⭐ 여기 stale 은 «축 판정»이다
});

test('평가가 던지면 exit 1 이고 사유를 오류로 낸다 — 「0건」으로 접히지 않는다', async () => {
  const { deps, errors } = harness({ assessAll: () => { throw new Error('git archive 실패'); } });
  expect(await runDocsStale(undefined, {}, '/repo', deps)).toBe(1);
  expect(errors[0]).toContain('git archive 실패');
});

test('--axis removed-identifiers 는 고유 축만 남긴다 — 부가 신호로만 늙은 문서는 빠진다', async () => {
  const linkOnly = { ...document, removedIdentifiers: [] as string[], brokenLinkCount: 3, path: 'docs/link-only.md' };
  const { deps, printed, logs } = harness({
    assessAll: () => ({
      checked: 2, withAnySignal: 2,
      byAxis: { removedIdentifiers: 1, brokenLinks: 1, supersededMarked: 0, staleScoreOverThreshold: 0 },
      sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const },
      sourcePathDocuments: [], lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [], branches: { ...branches }, documents: [document, linkOnly],
    }) as never,
  });
  expect(await runDocsStale(undefined, {}, '/repo', deps)).toBe(0);   // ⭐ «기본»이 고유 축이다
  expect(printed[0]).toBe('docs stale — 2개 검사 · [--axis removed-identifiers] 늙음 1개');
  expect(printed).toContain('docs/example.md: 늙음');
  expect(printed).not.toContain('docs/link-only.md: 늙음');
  expect(logs[1]?.data).toMatchObject({ axis: 'removed-identifiers', stale: 1, withAnySignal: 2 });
});

test('source-paths 는 명시했을 때만 경로 부재를 늙음으로 판정하고 기본 축은 바뀌지 않는다', async () => {
  const pathOnly = {
    ...document, path: 'docs/path-only.md', removedIdentifiers: [] as string[], hasAnySignal: false,
    sourcePaths: { checked: 2, missing: 1, extensionTypos: 1, excludedExamples: 1, resolvedFromDocument: 1, esmSpecifierResolved: 0 },
  };
  const typoOnly = {
    ...document, path: 'docs/typo-only.md', removedIdentifiers: [] as string[], hasAnySignal: false,
    sourcePaths: { checked: 1, missing: 0, extensionTypos: 1, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 },
  };
  const summary = {
    checked: 2, withAnySignal: 1,
    byAxis: { removedIdentifiers: 1, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 3, missing: 1, extensionTypos: 2, excludedExamples: 1, resolvedFromDocument: 1, esmSpecifierResolved: 0, status: 'ok' as const }, sourcePathDocuments: [pathOnly, typoOnly],
    lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [],
    branches: { ...branches }, documents: [document],
  };
  const defaultRun = harness({ assessAll: () => summary as never });
  expect(await runDocsStale(undefined, {}, '/repo', defaultRun.deps)).toBe(0);
  expect(defaultRun.printed[0]).toContain('늙음 1개');
  expect(defaultRun.printed).not.toContain('docs/path-only.md: 늙음');
  const selectedRun = harness({ assessAll: () => summary as never });
  expect(await runDocsStale(undefined, { axis: 'source-paths' }, '/repo', selectedRun.deps)).toBe(0);
  expect(selectedRun.printed[0]).toContain('[--axis source-paths] 늙음 2개');
  expect(selectedRun.printed).toContain('docs/path-only.md: 늙음');
  expect(selectedRun.printed).toContain('docs/typo-only.md: 늙음');
  expect(selectedRun.printed[1]).toContain('없는 소스 경로 1 · 확장자 오기 2');
  expect(selectedRun.printed[1]).toContain('예시 제외 1 · 문서 기준 해석 1 · ESM 지정자 해석 0');
});

test('line-anchors 는 명시했을 때만 줄 앵커 mismatch 를 늙음으로 판정하고 진단을 출력한다', async () => {
  const mismatch = {
    sourcePath: 'src/self-dev/ask-launch-flow.ts',
    citedLine: 305,
    symbol: 'runAskLaunchFlow',
    documentLine: 4237,
    reason: 'symbol-outside-tolerance' as const,
    diagnostic: 'line-anchor mismatch: src/self-dev/ask-launch-flow.ts:305 runAskLaunchFlow — ±5줄 안에 심볼 없음',
  };
  const anchorOnly = {
    ...document,
    path: 'docs/current-state.md',
    removedIdentifiers: [] as string[],
    removedIdentifierSites: [],
    hasAnySignal: false,
    lineAnchors: { checked: 1, mismatches: [mismatch], unavailable: [], symbolLessCitations: 0, tolerance: 5 },
  };
  const summary = {
    checked: 1, withAnySignal: 0,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const }, sourcePathDocuments: [],
    lineAnchors: { checked: 1, mismatches: 1, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [anchorOnly],
    branches: { ...branches }, documents: [],
  };
  const defaultRun = harness({ assessAll: () => summary as never });
  expect(await runDocsStale(undefined, {}, '/repo', defaultRun.deps)).toBe(0);
  expect(defaultRun.printed[0]).toContain('[--axis removed-identifiers] 늙음 0개');
  expect(defaultRun.printed).not.toContain('docs/current-state.md: 늙음');
  const selectedRun = harness({ assessAll: () => summary as never, format: formatDocStaleness });
  expect(await runDocsStale(undefined, { axis: 'line-anchors' }, '/repo', selectedRun.deps)).toBe(0);
  expect(selectedRun.printed[0]).toContain('[--axis line-anchors] 늙음 1개');
  expect(selectedRun.printed[1]).toContain('늙은 줄 앵커 1');
  expect(selectedRun.printed).toContain('docs/current-state.md: 늙음 (staleScore 0) — 늙은 줄 앵커 1건');
  expect(selectedRun.printed).toContain('    line-anchor mismatch: src/self-dev/ask-launch-flow.ts:305 runAskLaunchFlow — ±5줄 안에 심볼 없음 (문서 docs/current-state.md:4237)');
});

test('line-anchors 축은 읽기 실패 unavailable 을 늙음 판정에 넣지 않고 별도 요약으로 보존한다', async () => {
  const unavailableOnly = {
    ...document,
    path: 'docs/unavailable-anchor.md',
    removedIdentifiers: [] as string[],
    removedIdentifierSites: [],
    hasAnySignal: false,
    lineAnchors: {
      checked: 1,
      mismatches: [],
      unavailable: [{
        sourcePath: 'src/private.ts',
        citedLine: 7,
        symbol: 'privateSymbol',
        documentLine: 12,
        reason: '파일 읽기 실패 (EACCES)',
        diagnostic: 'line-anchor unavailable: src/private.ts:7 privateSymbol — 파일 읽기 실패 (EACCES)',
      }],
      symbolLessCitations: 0,
      tolerance: 5,
    },
  };
  const summary = {
    checked: 1, withAnySignal: 0,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const }, sourcePathDocuments: [],
    lineAnchors: { checked: 1, mismatches: 0, unavailable: 1, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [],
    branches: { ...branches }, documents: [],
  };
  const run = harness({ assessAll: () => summary as never, format: formatDocStaleness });
  expect(await runDocsStale(undefined, { axis: 'line-anchors' }, '/repo', run.deps)).toBe(0);
  expect(run.printed[0]).toContain('[--axis line-anchors] 늙음 0개');
  expect(run.printed[1]).toContain('늙은 줄 앵커 0 · 줄 앵커 못 셈 1');
  expect(run.printed).not.toContain('docs/unavailable-anchor.md: 늙음');
});

test('line-anchors 단건 축은 assessOne 결과에서 직접 mismatch 줄을 낸다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-stale-line-anchor-cli-'));
  const printed: string[] = [];
  const errors: string[] = [];
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# claude\n');
    writeFileSync(join(root, 'AGENTS.md'), '# agents\n');
    writeFileSync(join(root, 'docs', 'example.md'), '📍 심 src/target.ts:1 runAskLaunchFlow\n');
    writeFileSync(join(root, 'src', 'target.ts'), Array.from({ length: 10 }, (_, index) => index === 8 ? 'export function runAskLaunchFlow() {}' : `const line${index} = ${index};`).join('\n'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'seed'], { cwd: root });
    expect(await runDocsStale('docs/example.md', { axis: 'line-anchors' }, root, { print: (line) => { printed.push(line); }, printError: (line) => { errors.push(line); } })).toBe(0);
    expect(errors).toEqual([]);
    expect(printed[0]).toContain('docs/example.md: 늙음');
    expect(printed[1]).toContain('src/target.ts:1 runAskLaunchFlow');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runDocsStale line-anchors 경로는 CLI/TUI 표 라벨을 거르고 실제 PascalCase stale anchor 는 출력한다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-stale-line-anchor-labels-'));
  const printed: string[] = [];
  const errors: string[] = [];
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# claude\n');
    writeFileSync(join(root, 'AGENTS.md'), '# agents\n');
    writeFileSync(join(root, 'docs', 'example.md'), [
      '📍 src/target.ts:1      CLI      harness say 설명',
      '📍 src/target.ts:1      TUI      slash command 설명',
      '📍 src/target.ts:1 Client',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'target.ts'), Array.from({ length: 12 }, (_, index) => index === 10 ? 'export class Client {}' : `const line${index} = ${index};`).join('\n'));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'seed'], { cwd: root });
    expect(await runDocsStale('docs/example.md', { axis: 'line-anchors' }, root, { print: (line) => { printed.push(line); }, printError: (line) => { errors.push(line); } })).toBe(0);
    expect(errors).toEqual([]);
    expect(printed[0]).toContain('docs/example.md: 늙음');
    expect(printed.join('\n')).toContain('line-anchor mismatch: src/target.ts:1 Client');
    expect(printed.join('\n')).not.toContain('line-anchor mismatch: src/target.ts:1 CLI');
    expect(printed.join('\n')).not.toContain('line-anchor mismatch: src/target.ts:1 TUI');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('filesystem probe가 unavailable이면 CLI 구조화·사람 산출 모두 0건과 다르게 보존한다', async () => {
  const sourcePaths = assessSourcePaths('`src/private.ts`', 'docs/example.md', '/repo', () => 'unavailable');
  expect(sourcePaths).toMatchObject({ checked: 1, missing: 0, status: 'unavailable' });
  const unavailable = {
    checked: 1, withAnySignal: 0,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { ...sourcePaths, status: 'unavailable' as const, reason: sourcePaths.reason! }, sourcePathDocuments: [],
    lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [],
    branches: { ...branches }, documents: [],
  };
  const jsonRun = harness({ assessAll: () => unavailable as never });
  expect(await runDocsStale(undefined, { json: true }, '/repo', jsonRun.deps)).toBe(0);
  expect(JSON.parse(jsonRun.printed[0]!).sourcePaths).toMatchObject({ status: 'unavailable', missing: 0 });
  const textRun = harness({ assessAll: () => unavailable as never });
  expect(await runDocsStale(undefined, {}, '/repo', textRun.deps)).toBe(0);
  expect(textRun.printed[1]).toContain('못 셈: 소스 경로 확인 불가');
});

test('전수 산출은 ESM 지정자 해석 칸을 기존 예시 제외·문서 기준 해석과 같은 방식으로 찍는다', async () => {
  const summary = {
    checked: 1, withAnySignal: 0,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 3, status: 'ok' as const },
    sourcePathDocuments: [], lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [], branches: { ...branches }, documents: [],
  };
  const textRun = harness({ assessAll: () => summary as never });
  expect(await runDocsStale(undefined, {}, '/repo', textRun.deps)).toBe(0);
  expect(textRun.printed[1]).toContain('확장자 오기 0 · 예시 제외 0 · 문서 기준 해석 0 · ESM 지정자 해석 3');
  const jsonRun = harness({ assessAll: () => summary as never });
  expect(await runDocsStale(undefined, { json: true }, '/repo', jsonRun.deps)).toBe(0);
  expect(JSON.parse(jsonRun.printed[0]!).sourcePaths).toMatchObject({ extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 3 });
});

test('확장자 오기와 문서 디렉터리 상대경로는 경로 부재로 오판하지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-stale-cli-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'apps', 'pwa', 'docs', 'guide'), { recursive: true });
    mkdirSync(join(root, 'apps', 'pwa', 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'component.tsx'), 'export {};');
    writeFileSync(join(root, 'apps', 'pwa', 'src', 'live.ts'), 'export {};');
    const signals = assessSourcePaths('`src/component.ts` `../../src/live.ts`', 'apps/pwa/docs/guide/guide.md', root);
    expect(signals).toEqual({ checked: 2, missing: 0, extensionTypos: 1, excludedExamples: 0, resolvedFromDocument: 1, esmSpecifierResolved: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('경로 토큰 전체가 허용 형식일 때만 세어 절대경로·URL·다른 접두 내부의 src를 축약하지 않는다', () => {
  const probed: string[] = [];
  const signals = assessSourcePaths(
    '`/src/a.ts` `https://example.com/src/a.ts` `packages/x/src/a.ts` `docs/guide.md:src/a.ts` `<src/placeholder.ts>` `src/live.ts`',
    'docs/guide.md',
    '/repo',
    (path) => { probed.push(path); return 'present'; },
  );
  expect(signals).toEqual({ checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 1, resolvedFromDocument: 0, esmSpecifierResolved: 0 });
  expect(probed).toEqual(['/repo/src/live.ts']);
});

test('파일처럼 보이는 디렉터리는 대상 경로나 확장자 대안으로 인정하지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-stale-cli-'));
  try {
    mkdirSync(join(root, 'src', 'target.ts'), { recursive: true });
    mkdirSync(join(root, 'src', 'alternative.tsx'), { recursive: true });
    const signals = assessSourcePaths('`src/target.ts` `src/alternative.ts`', 'docs/guide.md', root);
    expect(signals).toEqual({ checked: 2, missing: 2, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('단건 assessOne 경로는 unavailable을 텍스트와 JSON에서 0건과 다르게 보존한다', async () => {
  const unavailableDocument = {
    ...document,
    removedIdentifiers: [] as string[],
    hasAnySignal: false,
    sourcePaths: { checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'unavailable' as const, reason: '소스 경로 확인 불가 (src/private.ts)' },
  };
  const textRun = harness({ assessOne: () => ({ outcome: 'assessed' as const, document: unavailableDocument as never }), format: formatDocStaleness });
  expect(await runDocsStale('docs/example.md', {}, '/repo', textRun.deps)).toBe(0);
  expect(textRun.printed[0]).toContain('소스 경로 못 셈: 소스 경로 확인 불가');
  const jsonRun = harness({ assessOne: () => ({ outcome: 'assessed' as const, document: unavailableDocument as never }) });
  expect(await runDocsStale('docs/example.md', { json: true }, '/repo', jsonRun.deps)).toBe(0);
  expect(JSON.parse(jsonRun.printed[0]!).sourcePaths).toMatchObject({ status: 'unavailable', missing: 0 });
});

test('문서 상대경로가 저장소 밖으로 나가면 밖의 실재 파일로 정상 판정하지 않는다', () => {
  const parent = mkdtempSync(join(tmpdir(), 'docs-stale-cli-'));
  const repo = join(parent, 'repo');
  const outside = join(parent, 'src');
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'outside.ts'), 'export {};');
    expect(assessSourcePaths('`../src/outside.ts`', 'docs/example.md', repo)).toEqual({ checked: 1, missing: 1, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('모르는 --axis 는 exit 2 이고 «허용 목록»을 말한다 — 조용히 all 로 넘어가지 않는다', async () => {
  const { deps, errors } = harness();
  expect(await runDocsStale(undefined, { axis: 'nope' }, '/repo', deps)).toBe(2);
  expect(errors[0]).toContain('removed-identifiers');
  expect(errors[0]).toContain('nope');
});

test('⭐ 기본 전수 모드의 「늙음」 수 = 사라진 식별자 보유 문서 수 (3R must-fix ③)', async () => {
  // ⛔ 이 단언이 이 도구의 «계약»이다 — 합집합이 기본으로 새어 나오면 여기서 깨진다.
  const linkOnly = { ...document, removedIdentifiers: [] as string[], brokenLinkCount: 9, path: 'docs/link.md' };
  const scoreOnly = { ...document, removedIdentifiers: [] as string[], brokenLinkCount: 0, staleScore: 99, path: 'docs/score.md' };
  const byAxis = { removedIdentifiers: 1, brokenLinks: 1, supersededMarked: 0, staleScoreOverThreshold: 1 };
  const { deps, printed, logs } = harness({
    assessAll: () => ({ checked: 3, withAnySignal: 3, byAxis, sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const }, sourcePathDocuments: [], lineAnchors: { checked: 0, mismatches: 0, unavailable: 0, symbolLessCitations: 0, tolerance: 5 }, lineAnchorDocuments: [], branches: { ...branches }, documents: [document, linkOnly, scoreOnly] }) as never,
  });
  expect(await runDocsStale(undefined, {}, '/repo', deps)).toBe(0);
  expect(printed[0]).toContain(`늙음 ${byAxis.removedIdentifiers}개`);           // ⭐ 3 이 아니라 1
  expect(printed.filter((line) => line.endsWith(': 늙음'))).toEqual(['docs/example.md: 늙음']);
  expect(logs[1]?.data).toMatchObject({ axis: 'removed-identifiers', stale: byAxis.removedIdentifiers, withAnySignal: 3 });
});

test('단건도 «같은 계약» — 깨진 링크만으로는 기본 축에서 「늙음」이 아니다 (3R must-fix ②)', async () => {
  const linkOnly = { ...document, removedIdentifiers: [] as string[], brokenLinkCount: 4, path: 'docs/link.md' };
  const { deps, printed, logs } = harness({
    assessOne: () => ({ outcome: 'assessed' as const, document: { ...linkOnly, removedIdentifierSites: [] } as never }),
    format: (doc: { path: string }, stale: boolean) => `${doc.path}: ${stale ? '늙음' : '현재'}`,
  });
  expect(await runDocsStale('docs/link.md', {}, '/repo', deps)).toBe(0);
  expect(printed).toEqual(['docs/link.md: 현재']);
  expect(logs[1]?.data).toMatchObject({ stale: 0, hasAnySignal: 1, axis: 'removed-identifiers' });
});

test('⭐ 단건 모드는 «줄 번호와 문면»을 낸다 — 「주장 ↔ 기록」을 사람이 한 눈에 가른다', async () => {
  const { deps, printed } = harness();
  expect(await runDocsStale('docs/example.md', {}, '/repo', deps)).toBe(0);
  expect(printed[0]).toBe('docs/example.md: 늙음');
  expect(printed[1]).toBe('    oldName  docs/example.md:42 (외 2줄)');
  expect(printed[2]).toBe('      `oldName` 을 쓴다');
});

test('⛔ 전수 모드에는 줄 정보가 «새지 않는다» — 46편에 줄까지 내면 산출이 감당 안 된다', async () => {
  const { deps, printed } = harness();
  expect(await runDocsStale(undefined, {}, '/repo', deps)).toBe(0);
  expect(printed.some((line) => line.includes(':42'))).toBe(false);
});

test('⛔ 「현재」로 판정된 문서에는 줄을 «내지 않는다» — 판정과 판정문이 어긋나면 그게 오독이다', async () => {
  const linkOnly = {
    ...document, removedIdentifiers: [] as string[], brokenLinkCount: 4, path: 'docs/link.md',
    removedIdentifierSites: [{ identifier: 'stale', line: 9, text: '`stale`', more: 0 }],
  };
  const { deps, printed } = harness({
    assessOne: () => ({ outcome: 'assessed' as const, document: linkOnly as never }),
    format: (doc: { path: string }, stale: boolean) => `${doc.path}: ${stale ? '늙음' : '현재'}`,
  });
  expect(await runDocsStale('docs/link.md', {}, '/repo', deps)).toBe(0);
  expect(printed).toEqual(['docs/link.md: 현재']);          // ⭐ 줄이 «따라오지 않는다»
});

test('docs stale CLAUDE.md·AGENTS.md 는 첫 줄이 그 파일명으로 시작하는 판정문을 낸다', async () => {
  for (const filename of ['CLAUDE.md', 'AGENTS.md'] as const) {
    const { deps, printed } = harness({
      assessOne: () => ({ outcome: 'assessed' as const, document: { ...document, path: filename, removedIdentifiers: [] as string[], removedIdentifierSites: [] } as never }),
      format: formatDocStaleness,
    });
    expect(await runDocsStale(filename, {}, '/repo', deps)).toBe(0);
    expect(printed[0]!.startsWith(`${filename}:`)).toBe(true);
  }
});

test('docs/_index.md 단건 첫 줄은 formatDocStaleness 문면 그대로다', async () => {
  const indexDocument = { ...document, path: 'docs/_index.md', removedIdentifiers: [] as string[], removedIdentifierSites: [] };
  const { deps, printed } = harness({
    assessOne: () => ({ outcome: 'assessed' as const, document: indexDocument as never }),
    format: formatDocStaleness,
  });
  expect(await runDocsStale('docs/_index.md', {}, '/repo', deps)).toBe(0);
  expect(printed[0]).toBe(formatDocStaleness(indexDocument as never, false));
  expect(printed[0]!.startsWith('docs/_index.md:')).toBe(true);
});

test('실물 assessOne 경로는 루트 상시주입 문서를 판정하고 사정거리 밖과 없음을 다른 오류로 낸다', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'docs-stale-anchors-'));
  const printed: string[] = [];
  const errors: string[] = [];
  const io = { print: (line: string) => { printed.push(line); }, printError: (line: string) => { errors.push(line); } };
  try {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'CLAUDE.md'), '# claude\n');
    writeFileSync(join(repo, 'AGENTS.md'), '# agents\n');
    writeFileSync(join(repo, 'docs', '_index.md'), '# index\n');
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const liveName = 1;\n');
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'seed'], { cwd: repo });
    printed.length = 0;
    expect(await runDocsStale('CLAUDE.md', {}, repo, io)).toBe(0);
    expect(printed[0]!.startsWith('CLAUDE.md:')).toBe(true);
    printed.length = 0;
    expect(await runDocsStale('AGENTS.md', {}, repo, io)).toBe(0);
    expect(printed[0]!.startsWith('AGENTS.md:')).toBe(true);
    printed.length = 0;
    expect(await runDocsStale('docs/_index.md', {}, repo, io)).toBe(0);
    expect(printed[0]!.startsWith('docs/_index.md:')).toBe(true);
    errors.length = 0;
    expect(await runDocsStale('src/index.ts', {}, repo, io)).toBe(1);
    const outOfScope = errors[0]!;
    errors.length = 0;
    expect(await runDocsStale('NOPE-NOT-EXIST.md', {}, repo, io)).toBe(1);
    const missing = errors[0]!;
    expect(outOfScope).not.toBe(missing);
    expect(outOfScope).toContain('사정거리');
    expect(missing).toBe('monad docs stale: 문서를 찾을 수 없음 (NOPE-NOT-EXIST.md)');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ⭐ 2026-09-02 · 🅣 136차 — 단건 문장이 「못 쟀다」를 «말해야» 한다.
//   🩸 계기: `MANUAL-harness-unified-usage` §2 가 10일 늙어 이 창을 실제로 오판시켰는데,
//     그 문서를 이 자로 재면 `현재 (staleScore 4)` 였다. 전수 요약은 `심볼 없는 줄 인용 N` 을
//     «이미» 냈지만 ***단건 문장에는 그 칸이 없었다***(origin/main 실측: 그 함수에 0건).
//   ⛔ 이 시험이 못 보는 것: 「±5줄 심볼 탐지가 «옳은가»」는 안 잰다 — 「못 쟀다고 «말하는가»」만 잰다.
const unjudgedBase = {
  path: 'docs/x.md', superseded: false, supersededBy: null, staleScore: 4,
  removedIdentifiers: [], removedIdentifierSites: [], brokenLinkCount: 0,
  sourcePaths: { status: 'ok', checked: 2, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 },
  branches,
} as const;

test('formatDocStaleness ★ 양성 — 미판정 인용이 있으면 그 수를 «댄다»', () => {
  const line = formatDocStaleness({
    ...unjudgedBase,
    lineAnchors: { checked: 0, mismatches: [], unavailable: [], symbolLessCitations: 222, tolerance: 5 },
  } as never, false);
  expect(line).toContain('줄 앵커 미판정 222건');
  expect(line).toContain('안 쟀다');
});

test('formatDocStaleness ★ 음성 — 미판정이 0이면 그 칸을 «안 낸다»(빈칸으로 소음 만들지 않는다)', () => {
  const line = formatDocStaleness({
    ...unjudgedBase,
    lineAnchors: { checked: 3, mismatches: [], unavailable: [], symbolLessCitations: 0, tolerance: 5 },
  } as never, false);
  expect(line).not.toContain('미판정');
});

// ⭐ 2026-09-02 · 🅣 136차 — 「미판정 N건」만으로는 «고칠 수가 없다». 어느 줄인지 말해야 한다.
//   📌 계기: 관행 ⑴(`path:line` ⊕ 백틱 심볼 · 🅕 합의)을 «실행»하려면 위치가 필요한데 도구는 수만 냈다.
//     나는 그 위치를 «손으로 rg 해서» 찾았다 — 그 절차를 도구로 옮긴다.
//   ⛔ 이 시험이 못 보는 것: 「그 인용을 «정말» 고쳐야 하나」는 안 잰다 — 「어디인지 말하는가」만 잰다.
test('미판정 «자리»를 줄까지 대고, 상한 때문에 «안 보여 준» 수를 같이 낸다', async () => {
  const mismatch = { sourcePath: 'src/z.ts', citedLine: 1, symbol: 'Z', documentLine: 2, reason: 'symbol-missing' as const, diagnostic: 'z' };
  const doc = {
    path: 'docs/x.md', superseded: false, supersededBy: null, staleScore: 0,
    removedIdentifiers: [], removedIdentifierSites: [], brokenLinkCount: 0,
    sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const },
    lineAnchors: {
      checked: 1, mismatches: [mismatch], unavailable: [], tolerance: 5,
      symbolLessCitations: 3,
      symbolLessSites: [{ sourcePath: 'src/a.ts', citedLine: 12, documentLine: 34 }],
    },
    branches: { ...branches },
  };
  const summary = {
    checked: 1, withAnySignal: 1,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const },
    sourcePathDocuments: [],
    lineAnchors: { checked: 1, mismatches: 1, unavailable: 0, symbolLessCitations: 3, tolerance: 5 },
    lineAnchorDocuments: [doc],
    branches: { ...branches }, documents: [doc],
  };
  const run = harness({ assessAll: () => summary as never, format: formatDocStaleness });
  expect(await runDocsStale(undefined, { axis: 'line-anchors' }, '/repo', run.deps)).toBe(0);
  const all = run.printed.join('\n');
  expect(all).toContain('line-anchor 미판정: src/a.ts:12');
  expect(all).toContain('docs/x.md:34');
  // ⛔ 상한 때문에 «안 보여 준» 수를 스스로 말해야 한다 — 목록 길이를 전수로 오독하지 못하게.
  expect(all).toContain('미판정 2건 더 있음');
});

test('자리가 «전부» 보이면 「더 있음」 줄을 안 낸다(빈칸으로 소음 만들지 않는다)', async () => {
  const mismatch = { sourcePath: 'src/z.ts', citedLine: 1, symbol: 'Z', documentLine: 2, reason: 'symbol-missing' as const, diagnostic: 'z' };
  const doc = {
    path: 'docs/x.md', superseded: false, supersededBy: null, staleScore: 0,
    removedIdentifiers: [], removedIdentifierSites: [], brokenLinkCount: 0,
    sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const },
    lineAnchors: {
      checked: 1, mismatches: [mismatch], unavailable: [], tolerance: 5,
      symbolLessCitations: 1,
      symbolLessSites: [{ sourcePath: 'src/a.ts', citedLine: 12, documentLine: 34 }],
    },
    branches: { ...branches },
  };
  const summary = {
    checked: 1, withAnySignal: 1,
    byAxis: { removedIdentifiers: 0, brokenLinks: 0, supersededMarked: 0, staleScoreOverThreshold: 0 },
    sourcePaths: { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0, status: 'ok' as const },
    sourcePathDocuments: [],
    lineAnchors: { checked: 1, mismatches: 1, unavailable: 0, symbolLessCitations: 1, tolerance: 5 },
    lineAnchorDocuments: [doc],
    branches: { ...branches }, documents: [doc],
  };
  const run = harness({ assessAll: () => summary as never, format: formatDocStaleness });
  expect(await runDocsStale(undefined, { axis: 'line-anchors' }, '/repo', run.deps)).toBe(0);
  const all = run.printed.join('\n');
  expect(all).toContain('line-anchor 미판정: src/a.ts:12');
  expect(all).not.toContain('더 있음');
});
