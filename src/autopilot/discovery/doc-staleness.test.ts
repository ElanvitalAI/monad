import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessDeclaredRevision, assessDocStaleness, assessDocsStaleness, assessLineAnchors, assessOneDocStaleness, assessSourcePaths, classifyIdentifier, defaultStalenessRevisions, locateRemovedIdentifiers, REMOVED_IDENTIFIER_SITE_LIMIT, sourceIdentifierInventoryAtRevision, OLD_WINDOW_DAYS, RECENT_WINDOW_DAYS, STALE_SCORE_THRESHOLD } from './doc-staleness.js';
import type { DocEntry } from './doc-inventory.js';

const entry: DocEntry = { path: 'docs/PLAN-old-2020-01-01.md', filename: 'PLAN-old-2020-01-01.md', prefix: 'PLAN', topic: 'old', date: '2020-01-01', sizeBytes: 1, openBoxes: 0, doneBoxes: 0, subdir: '' };
const inventories = { current: new Set(['liveName']), recent: new Set(['goneRecently']), old: new Set(['goneLongAgo']) };

function assess(text: string, overrides: Partial<DocEntry> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doc-staleness-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  try {
    return assessDocStaleness({ ...entry, ...overrides }, text, { repoRoot: root, inventories, nowMs: Date.parse('2026-01-01'), vaultFiles: [entry.path] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('assessDeclaredRevision', () => {
  test('실측 v51 선언과 제공된 v54 이력의 뒤처짐 및 판 차를 보존한다', () => {
    const result = assessDeclaredRevision('참조 v41\n현재 판 = v51\n이력 v49', ['v51', 'v54']);
    expect(result).toMatchObject({ branch: 'behind', selection: 'current-revision-label', declaredRevision: 51, highestHistoryRevision: 54, gap: 3 });
    expect(result.declarations).toEqual([{ revision: 51, line: 2, text: '현재 판 = v51', rule: 'current-revision-label' }]);
  });

  test('동률·앞선 선언 및 숫자 경계를 서로 구분한다', () => {
    expect(assessDeclaredRevision('현재 버전: v54', ['v54'])).toMatchObject({ branch: 'equal', gap: 0 });
    expect(assessDeclaredRevision('current revision = v55', ['v54'])).toMatchObject({ branch: 'ahead', declaredRevision: 55, highestHistoryRevision: 54, gap: 1 });
    expect(assessDeclaredRevision('현재 판 = v0', ['v0', 'v10', 'v10', 'noise'])).toMatchObject({ branch: 'behind', highestHistoryRevision: 10, gap: 10 });
  });

  test('선언 부재와 읽은 빈 이력, 읽지 못한 이력은 같은 값이 아니다', () => {
    expect(assessDeclaredRevision('v54는 예전 판이다.', ['v54']).branch).toBe('no-declaration');
    expect(assessDeclaredRevision('현재 판 = v54', []).branch).toBe('history-empty');
    expect(assessDeclaredRevision('현재 판 = v54', null).branch).toBe('history-unavailable');
  });

  test('형식 오류·복수 선언·잡음 이력을 명시적으로 보존한다', () => {
    expect(assessDeclaredRevision('현재 판 = latest', ['v54'])).toMatchObject({ branch: 'invalid-declaration', declarations: [{ revision: null, line: 1, text: '현재 판 = latest', rule: 'current-revision-label' }] });
    const sameLine = assessDeclaredRevision('현재 판 = v51, current version = v54', ['v54']);
    expect(sameLine).toMatchObject({ branch: 'ambiguous-declaration', declaredRevision: null });
    expect(sameLine.declarations).toEqual([
      { revision: 51, line: 1, text: '현재 판 = v51, current version = v54', rule: 'current-revision-label' },
      { revision: 54, line: 1, text: '현재 판 = v51, current version = v54', rule: 'current-revision-label' },
    ]);
    expect(assessDeclaredRevision('현재 판 = v54', ['latest', '54']).branch).toBe('history-invalid');
  });

  test('완전한 라벨과 판 토큰만 선언으로 읽어 접두·접미부 오탐을 막는다', () => {
    expect(assessDeclaredRevision('현재 판 = v54beta', ['v54']).branch).toBe('invalid-declaration');
    expect(assessDeclaredRevision('current versioning = v54', ['v54']).branch).toBe('no-declaration');
    expect(assessDeclaredRevision('현재 판정 = v54', ['v54']).branch).toBe('no-declaration');
    expect(assessDeclaredRevision('notcurrent version = v54', ['v54']).branch).toBe('no-declaration');
    expect(assessDeclaredRevision('비현재 판 = v54', ['v54']).branch).toBe('no-declaration');
    expect(assessDeclaredRevision('current version = v54', ['v54']).branch).toBe('equal');
    expect(assessDeclaredRevision('현재 판 = v54', ['v54']).branch).toBe('equal');
  });
});

describe('classifyIdentifier', () => {
  test('아홉 갈래와 실제 늙음 두 갈래를 구분한다', () => {
    expect(classifyIdentifier('liveName', inventories).branch).toBe('current');
    expect(classifyIdentifier('goneRecently', inventories).branch).toBe('recently-removed');
    expect(classifyIdentifier('goneLongAgo', inventories).branch).toBe('long-removed');
    expect(classifyIdentifier('return', inventories).branch).toBe('javascript-keyword');
    expect(classifyIdentifier('Heading', inventories, '# Heading').branch).toBe('document-label');
    expect(classifyIdentifier('BLOCKED', inventories).branch).toBe('uppercase-status');
    expect(classifyIdentifier('quoted', inventories, '"quoted"').branch).toBe('string-literal');
    expect(classifyIdentifier('pythonName', inventories, 'scripts/foo.py pythonName').branch).toBe('non-typescript-source');
    expect(classifyIdentifier('unknownName', inventories, 'docs/foo.py unrelated text').branch).toBe('unclassified');
    expect(classifyIdentifier('unknownName', inventories).branch).toBe('unclassified');
  });
});

describe('assessDocStaleness', () => {
  test('frontmatter·사라진 식별자·링크 축을 독립적으로 판정하고 갈래를 보존한다', () => {
    const result = assess('---\nstatus: superseded\nsuperseded_by: docs/new.md\n---\n`goneRecently` [bad](missing.md)');
    expect(result).toMatchObject({ superseded: true, supersededBy: 'docs/new.md', removedIdentifiers: ['goneRecently'], brokenLinkCount: 1, hasAnySignal: true });
    expect(result.branches['recently-removed']).toBe(1);
    expect(result.branches['long-removed']).toBe(0);
  });

  test('staleScore 임계값은 «신호» 하나로 잡히되 «판정»은 아니다 — 판정은 축이 한다', () => {
    const result = assess('current', { date: '2020-01-01', openBoxes: 1 });
    expect(result.staleScore).toBeGreaterThanOrEqual(STALE_SCORE_THRESHOLD);
    expect(result.hasAnySignal).toBe(true);
    // ⛔ 그리고 이 문서는 «고유 축»에서는 늙지 않았다 — 사라진 식별자가 0이다
    expect(result.removedIdentifiers).toEqual([]);
  });
});

describe('assessSourcePaths', () => {
  test('treats bare, backticked, qualified, and backticked-qualified spellings as one canonical source-path claim', () => {
    const spellings = [
      'Edit src/present.ts now',
      'Edit `src/present.ts` now',
      'Edit src/present.ts:buildApplication now',
      'Edit `src/present.ts:buildApplication` now',
    ];

    for (const text of spellings) {
      const probes: string[] = [];
      const result = assessSourcePaths(text, 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => {
        probes.push(path);
        return 'present';
      });
      expect(result).toMatchObject({ checked: 1, missing: 0 });
      expect(probes).toEqual(['/repo/src/present.ts']);
    }
  });

  test('keeps canonical present and missing path claims distinct while ignoring unrelated colon code spans', () => {
    const probes: string[] = [];
    const result = assessSourcePaths('Edit `src/present.ts:buildApplication`, `src/missing.ts:missingApplication`, and `http://example.test:443`.', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => {
      probes.push(path);
      return path === '/repo/src/present.ts' ? 'present' : 'missing';
    });

    expect(result).toMatchObject({ checked: 2, missing: 1 });
    expect(probes).toEqual(expect.arrayContaining(['/repo/src/present.ts', '/repo/src/missing.ts']));
  });

  test('does not count an ESM .js specifier as an extension typo when the same-name .ts file exists', () => {
    const result = assessSourcePaths('import { x } from `src/mod.js`;', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => (
      path === '/repo/src/mod.ts' ? 'present' : 'missing'
    ));
    expect(result).toMatchObject({ checked: 1, missing: 0, extensionTypos: 0, excludedExamples: 0, esmSpecifierResolved: 1 });
  });

  test('counts a missing .js request with a sibling .ts as ESM-resolved, even when .tsx also exists', () => {
    const result = assessSourcePaths('`src/both.js`', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => (
      path === '/repo/src/both.ts' || path === '/repo/src/both.tsx' ? 'present' : 'missing'
    ));
    expect(result).toMatchObject({ checked: 1, missing: 0, extensionTypos: 0, esmSpecifierResolved: 1 });
  });

  test('keeps the reverse direction as an extension typo when the document wrote .ts but only .js exists', () => {
    const result = assessSourcePaths('`src/mod.ts`', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => (
      path === '/repo/src/mod.js' ? 'present' : 'missing'
    ));
    expect(result).toMatchObject({ checked: 1, missing: 0, extensionTypos: 1, esmSpecifierResolved: 0 });
  });

  test('counts a lone missing src/self-implement/running-runs.tsx citation as one extension typo', () => {
    const result = assessSourcePaths('`src/self-implement/running-runs.tsx`', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => (
      path === '/repo/src/self-implement/running-runs.ts' ? 'present' : 'missing'
    ));
    expect(result).toMatchObject({ checked: 1, missing: 0, extensionTypos: 1, esmSpecifierResolved: 0 });
  });

  test('does not treat a .js request with only a .jsx sibling as an ESM specifier', () => {
    const result = assessSourcePaths('`src/mod.js`', 'docs/PLAN-old-2020-01-01.md', '/repo', (path) => (
      path === '/repo/src/mod.jsx' ? 'present' : 'missing'
    ));
    expect(result).toMatchObject({ checked: 1, missing: 0, extensionTypos: 1, esmSpecifierResolved: 0 });
  });
});

describe('assessLineAnchors', () => {
  function repoWithSource(source: string): string {
    const root = mkdtempSync(join(tmpdir(), 'line-anchor-'));
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'target.ts'), source);
    return root;
  }

  test('path:line 과 심볼이 같은 문맥에 있으면 허용 범위 안의 심볼을 현재로 본다', () => {
    const root = repoWithSource(['export const before = 1;', 'export function runAskLaunchFlow() {', '  return before;', '}'].join('\n'));
    try {
      const result = assessLineAnchors('📍 심 src/target.ts:2 runAskLaunchFlow', 'docs/example.md', root);
      expect(result).toMatchObject({ checked: 1, symbolLessCitations: 0, tolerance: 5 });
      expect(result.mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('심볼이 허용 범위 밖이면 사람이 읽을 mismatch 진단을 낸다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 15 ? 'export function runAskLaunchFlow() {}' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors('📍 심 src/target.ts:2 runAskLaunchFlow', 'docs/example.md', root);
      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]!.diagnostic).toBe('line-anchor mismatch: src/target.ts:2 runAskLaunchFlow — ±5줄 안에 심볼 없음');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('허용 범위 경계 ±5줄의 심볼은 mismatch 가 아니다', () => {
    const root = repoWithSource(Array.from({ length: 10 }, (_, index) => index === 6 ? 'export const boundarySymbol = 1;' : `const line${index} = ${index};`).join('\n'));
    try {
      expect(assessLineAnchors('src/target.ts:2 boundarySymbol', 'docs/example.md', root).mismatches).toEqual([]);
      expect(assessLineAnchors('src/target.ts:1 boundarySymbol', 'docs/example.md', root).mismatches).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('파일이 없으면 source-paths 와 별도로 line-anchor mismatch 로 보존한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'line-anchor-missing-'));
    try {
      mkdirSync(join(root, 'docs'), { recursive: true });
      const result = assessLineAnchors('src/missing.ts:3 missingSymbol', 'docs/example.md', root);
      expect(result.mismatches).toMatchObject([{ sourcePath: 'src/missing.ts', citedLine: 3, symbol: 'missingSymbol', reason: 'missing-file' }]);
      expect(result.unavailable).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('읽기 실패는 mismatch 로 문서를 늙게 하지 않고 unavailable 로 보존한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'line-anchor-unavailable-'));
    try {
      mkdirSync(join(root, 'docs'), { recursive: true });
      mkdirSync(join(root, 'src', 'locked.ts'), { recursive: true });
      const result = assessLineAnchors('src/locked.ts:3 lockedSymbol', 'docs/example.md', root);
      expect(result.checked).toBe(1);
      expect(result.mismatches).toEqual([]);
      expect(result.unavailable).toHaveLength(1);
      expect(result.unavailable[0]).toMatchObject({ sourcePath: 'src/locked.ts', citedLine: 3, symbol: 'lockedSymbol' });
      expect(result.unavailable[0]!.diagnostic).toContain('line-anchor unavailable: src/locked.ts:3 lockedSymbol');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('path:line 앞뒤에 명시적으로 결합된 단일 코드 심볼만 판정한다', () => {
    const root = repoWithSource(Array.from({ length: 12 }, (_, index) => index === 10 ? 'export const boundSymbol = 1;' : `const line${index} = ${index};`).join('\n'));
    try {
      expect(assessLineAnchors('boundSymbol — src/target.ts:1', 'docs/example.md', root).mismatches[0]!.symbol).toBe('boundSymbol');
      expect(assessLineAnchors('참고 `boundSymbol` at src/target.ts:1', 'docs/example.md', root).mismatches[0]!.symbol).toBe('boundSymbol');
      expect(assessLineAnchors('src/target.ts:1 — `boundSymbol`', 'docs/example.md', root).mismatches[0]!.symbol).toBe('boundSymbol');
      expect(assessLineAnchors('src/target.ts:1: boundSymbol', 'docs/example.md', root).mismatches[0]!.symbol).toBe('boundSymbol');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('여러 backtick 인용을 연속 판정해도 정규식 상태가 다음 인용을 건너뛰지 않는다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 14 ? 'export const firstSymbol = 1;' : index === 16 ? 'export const secondSymbol = 2;' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors('src/target.ts:1 — `firstSymbol`\nsrc/target.ts:2 — `secondSymbol`', 'docs/example.md', root);
      expect(result.checked).toBe(2);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['firstSymbol', 'secondSymbol']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('같은 줄의 여러 path:line backtick 심볼 인용은 앵커별 인접 심볼만 결합한다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 14 ? 'export const firstSymbol = 1;' : index === 16 ? 'export const secondSymbol = 2;' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors('src/target.ts:1 `firstSymbol`; src/target.ts:2 `secondSymbol`', 'docs/example.md', root);
      expect(result.checked).toBe(2);
      expect(result.symbolLessCitations).toBe(0);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['firstSymbol', 'secondSymbol']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('같은 줄에서 backtick 심볼이 path:line 앞에 있으면 각 앵커는 가장 가까운 앞 심볼과 결합한다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 14 ? 'export const firstSymbol = 1;' : index === 16 ? 'export const secondSymbol = 2;' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors('`firstSymbol` src/target.ts:1; `secondSymbol` src/target.ts:2', 'docs/example.md', root);
      expect(result.checked).toBe(2);
      expect(result.symbolLessCitations).toBe(0);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['firstSymbol', 'secondSymbol']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('같은 줄에서 path:line 과 backtick 심볼 순서가 섞이면 앞뒤 실제 인접도 최단 후보와 결합한다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 14 ? 'export const firstSymbol = 1;' : index === 16 ? 'export const secondSymbol = 2;' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors('src/target.ts:1 `firstSymbol`; `secondSymbol` src/target.ts:2', 'docs/example.md', root);
      expect(result.checked).toBe(2);
      expect(result.symbolLessCitations).toBe(0);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['firstSymbol', 'secondSymbol']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('명시 결합된 소문자 심볼은 휴리스틱 대문자 조건 없이 판정한다', () => {
    const root = repoWithSource(Array.from({ length: 20 }, (_, index) => index === 14 ? 'export const foo = 1;' : index === 15 ? 'export function run() { return foo; }' : `const line${index} = ${index};`).join('\n'));
    try {
      const backtick = assessLineAnchors('src/target.ts:1 `foo`', 'docs/example.md', root);
      expect(backtick.checked).toBe(1);
      expect(backtick.mismatches).toMatchObject([{ sourcePath: 'src/target.ts', citedLine: 1, symbol: 'foo', reason: 'symbol-outside-tolerance' }]);
      const colon = assessLineAnchors('src/target.ts:1: foo\nsrc/target.ts:1: run', 'docs/example.md', root);
      expect(colon.checked).toBe(2);
      expect(colon.symbolLessCitations).toBe(0);
      expect(colon.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['foo', 'run']);
      const plainSentence = assessLineAnchors('src/target.ts:1 is stale', 'docs/example.md', root);
      expect(plainSentence.checked).toBe(0);
      expect(plainSentence.symbolLessCitations).toBe(1);
      expect(plainSentence.mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('일반 문구와 주변 제목 단어는 line-anchor 심볼로 추측하지 않는다', () => {
    const root = repoWithSource('export const present = 1;\n');
    try {
      const plainSentence = assessLineAnchors('src/target.ts:10 is stale', 'docs/example.md', root);
      expect(plainSentence.checked).toBe(0);
      expect(plainSentence.symbolLessCitations).toBe(1);
      expect(plainSentence.mismatches).toEqual([]);
      const neighboringTitle = assessLineAnchors('# RunAskLaunchFlow Notes\n문서에 나온 src/target.ts:10 is stale\n다음 문장은 buildApplication 을 설명한다', 'docs/example.md', root);
      expect(neighboringTitle.checked).toBe(0);
      expect(neighboringTitle.symbolLessCitations).toBe(1);
      expect(neighboringTitle.mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('path:line 뒤의 짧은 대문자 표 라벨은 line-anchor 심볼로 추측하지 않는다', () => {
    const root = repoWithSource('export const present = 1;\n');
    try {
      const result = assessLineAnchors([
        'src/index.ts:212      CLI      harness say 설명',
        'src/index.ts:213      TUI      slash command 설명',
        'src/index.ts:1470  CLI 옵션은 `--from-clarification` 하나뿐',
      ].join('\n'), 'docs/example.md', root);
      expect(result.checked).toBe(0);
      expect(result.symbolLessCitations).toBe(3);
      expect(result.mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('일곱 대표 stale-anchor 형태는 대문자 라벨 제외 뒤에도 mismatch 로 남는다', () => {
    const root = repoWithSource(Array.from({ length: 30 }, (_, index) => index === 24 ? 'export function actualNearbySymbol() {}' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors([
        'src/target.ts:1 runAskLaunchFlow',
        'runAskLaunchFlow — src/target.ts:1',
        '참고 `boundSymbol` at src/target.ts:1',
        'src/target.ts:1 — `afterBacktickSymbol`',
        'src/target.ts:1: colonBoundSymbol',
        'src/target.ts:1 snake_case_symbol',
        'src/target.ts:1 dollar$symbol',
      ].join('\n'), 'docs/example.md', root);
      expect(result.checked).toBe(7);
      expect(result.symbolLessCitations).toBe(0);
      expect(result.mismatches).toHaveLength(7);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual([
        'runAskLaunchFlow',
        'runAskLaunchFlow',
        'boundSymbol',
        'afterBacktickSymbol',
        'colonBoundSymbol',
        'snake_case_symbol',
        'dollar$symbol',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('PascalCase 와 전체 대문자 코드 심볼은 대문자 표 라벨 제외 뒤에도 mismatch 로 남는다', () => {
    const root = repoWithSource(Array.from({ length: 30 }, (_, index) => index === 24 ? 'export const nearby = 1;' : `const line${index} = ${index};`).join('\n'));
    try {
      const result = assessLineAnchors([
        'src/target.ts:1 Client',
        'src/target.ts:1 Config',
        'src/target.ts:1 Server',
        'src/target.ts:1 API',
        'src/target.ts:1 HTTP',
      ].join('\n'), 'docs/example.md', root);
      expect(result.checked).toBe(5);
      expect(result.symbolLessCitations).toBe(0);
      expect(result.mismatches).toHaveLength(5);
      expect(result.mismatches.map((mismatch) => mismatch.symbol)).toEqual(['Client', 'Config', 'Server', 'API', 'HTTP']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('심볼 없는 path:line 인용은 판정 대상이 아니다', () => {
    const root = repoWithSource('export const present = 1;\n');
    try {
      const result = assessLineAnchors('참고: src/target.ts:1', 'docs/example.md', root);
      expect(result.checked).toBe(0);
      expect(result.symbolLessCitations).toBe(1);
      expect(result.mismatches).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('sourceIdentifierInventoryAtRevision', () => {
  test('git archive 인벤토리를 만들고 작업 트리 밖 임시 디렉토리를 정리한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'doc-staleness-git-'));
    // ⛔⭐ **고정 접두 «경로의 부재»를 보면 안 된다**(리뷰 must-fix ⑤ · Goodhart).
    //   `mkdtempSync` 는 접두 뒤에 «무작위»를 붙이므로 `join(tmpdir(),'monad-doc-staleness-')` 자체는
    //   ***누수가 있든 없든 영영 존재하지 않는다*** ⇒ 그 단언은 항상 통과한다.
    //   ✅ 그래서 「그 접두로 «시작하는» 디렉토리의 «수»」를 전후로 센다.
    const leaked = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith('monad-doc-staleness-'));
    const before = leaked();
    try {
      execFileSync('git', ['init'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
      writeFileSync(join(root, 'old.ts'), 'export const historicalIdentifier = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: root });
      const inventory = sourceIdentifierInventoryAtRevision(root, 'HEAD');
      expect(inventory.has('historicalIdentifier')).toBe(true);
      // 이 호출이 «만들었다 지운» 것이 있으면 수가 늘어난 채로 남는다
      expect(leaked().filter((name) => !before.includes(name))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ⭐⭐ 이 세 시험이 무는 것은 «결과»가 아니라 ***전달 방식***이다.
  //   이 저장소의 아카이브는 실측 255 MB 라, 그것을 부모 프로세스로 들이면 한 판에 네 번 그 크기가 오간다.
  function repoWithShims(): { root: string; shims: string; fixtureArchive: string } {
    const root = mkdtempSync(join(tmpdir(), 'doc-staleness-shim-'));
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    writeFileSync(join(root, 'old.ts'), 'export const historicalIdentifier = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root });
    const fixtureArchive = join(root, 'fixture.tar');
    execFileSync('git', ['archive', '--output', fixtureArchive, 'HEAD'], { cwd: root });
    const shims = join(root, 'shims');
    mkdirSync(shims);
    return { root, shims, fixtureArchive };
  }

  function withPath<T>(shims: string, body: () => T): T {
    const previousPath = process.env.PATH;
    process.env.PATH = `${shims}:${previousPath}`;
    try { return body(); } finally { process.env.PATH = previousPath; }
  }

  test('아카이브를 «파일»로 받는다 — 부모의 표준출력으로 흘리면 이 시험이 깨진다', () => {
    const { root, shims, fixtureArchive } = repoWithShims();
    try {
      // ⛔ 이 가짜 git 은 `--output` 이 있을 때만 아카이브를 낸다. 표준출력으로는 «한 바이트도» 안 흘린다
      //   ⇒ 구현이 파이프/버퍼로 돌아가면 tar 가 «빈 입력»을 받아 실패하고 이 시험이 깨진다.
      writeFileSync(join(shims, 'git'), `#!/bin/sh
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
[ -n "$out" ] || exit 3
cp "$DOC_STALENESS_FIXTURE_ARCHIVE" "$out"
`);
      chmodSync(join(shims, 'git'), 0o755);
      process.env.DOC_STALENESS_FIXTURE_ARCHIVE = fixtureArchive;
      const inventory = withPath(shims, () => sourceIdentifierInventoryAtRevision(root, 'HEAD'));
      expect(inventory.has('historicalIdentifier')).toBe(true);
    } finally {
      delete process.env.DOC_STALENESS_FIXTURE_ARCHIVE;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  // ⛔⭐⭐ **최초 원인이 «덮이지» 않는다** — 옛 판(파이프)에서는 tar 가 먼저 죽으면 git 이 파이프 단절로
  //   따라 죽어, 「먼저 관측된 쪽」에 따라 같은 사건이 `git archive` 로도 `tar` 로도 보고됐다.
  //   ✅ 지금은 두 명령이 «순차»라 그 경합 자체가 없다 — 그것을 여기서 문다.
  test('tar 가 실패하면 그 오류가 서고 git 이 원인 자리를 차지하지 않는다', () => {
    const { root, shims } = repoWithShims();
    try {
      writeFileSync(join(shims, 'tar'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(shims, 'tar'), 0o755);
      let message = '';
      try { withPath(shims, () => sourceIdentifierInventoryAtRevision(root, 'HEAD')); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain('tar -x');
      expect(message).not.toContain('git archive');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('git archive 가 실패하면 tar 는 아예 돌지 않고 git 오류가 선다', () => {
    const { root, shims } = repoWithShims();
    try {
      // tar 가 «불렸는지»를 표식으로 센다 — git 이 실패했는데 tar 가 돌면 표식이 남는다
      const marker = join(root, 'tar-was-called');
      writeFileSync(join(shims, 'tar'), `#!/bin/sh\n: > "$DOC_STALENESS_TAR_MARKER"\nexit 0\n`);
      chmodSync(join(shims, 'tar'), 0o755);
      process.env.DOC_STALENESS_TAR_MARKER = marker;
      let message = '';
      try { withPath(shims, () => sourceIdentifierInventoryAtRevision(root, 'NOPE-NO-SUCH-REVISION')); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain('git archive');
      expect(existsSync(marker)).toBe(false);
    } finally {
      delete process.env.DOC_STALENESS_TAR_MARKER;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('defaultStalenessRevisions', () => {
  // ⛔⭐ 이 기본값이 «이 도구의 정확도 그 자체»다 — 초판은 HEAD~1/HEAD~20 이었고
  //   이 저장소에서 그것이 «세 시간 전»이라 전 문서가 「현재」로 판정됐다(리뷰 2R must-fix ②의 export 근거).
  function repoWithCommits(days: readonly number[], nowMs: number): string {
    const root = mkdtempSync(join(tmpdir(), 'doc-staleness-revs-'));
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    for (const daysAgo of days) {
      const when = new Date(nowMs - daysAgo * 86_400_000).toISOString();
      writeFileSync(join(root, `f${daysAgo}.ts`), `export const id${daysAgo} = 1;\n`);
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['commit', '-m', `c${daysAgo}`], {
        cwd: root,
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    }
    return root;
  }

  test('창을 «날짜»로 고른다 — 그 시점보다 «앞선» 커밋을 준다', () => {
    const nowMs = Date.parse('2026-08-12T00:00:00Z');
    const root = repoWithCommits([200, 120, 45, 1], nowMs);
    try {
      const revs = defaultStalenessRevisions(root, nowMs);
      const at = (rev: string) => execFileSync('git', ['log', '-1', '--format=%cI', rev], { cwd: root, encoding: 'utf-8' }).trim();
      const ageDays = (rev: string) => (nowMs - Date.parse(at(rev))) / 86_400_000;
      // recent 창은 30일, old 창은 90일 — 각 창보다 «오래된» 커밋이 뽑혀야 한다
      expect(ageDays(revs.recent)).toBeGreaterThanOrEqual(RECENT_WINDOW_DAYS);
      expect(ageDays(revs.old)).toBeGreaterThanOrEqual(OLD_WINDOW_DAYS);
      // 그리고 old 가 recent 보다 «더» 오래됐다
      expect(ageDays(revs.old)).toBeGreaterThan(ageDays(revs.recent));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('저장소가 창보다 «어리면» 루트 커밋으로 내려간다 — 빈 revision 을 내지 않는다', () => {
    const nowMs = Date.parse('2026-08-12T00:00:00Z');
    const root = repoWithCommits([1], nowMs);   // 하루짜리 저장소
    try {
      const revs = defaultStalenessRevisions(root, nowMs);
      const rootCommit = execFileSync('git', ['rev-list', '--max-parents=0', '-1', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
      expect(revs.recent).toBe(rootCommit);
      expect(revs.old).toBe(rootCommit);
      // ⛔ 빈 문자열이면 git archive 가 「없다」가 아니라 throw 한다
      expect(revs.recent.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('locateRemovedIdentifiers — 「어느 줄인가」', () => {
  // ⛔⭐ 이름만으로는 ***「지금 있다고 «주장»한다」와 「은퇴했다고 «기록»한다」***를 못 가른다.
  //   둘은 처방이 «반대»다. 줄 문면이 있으면 사람이 한 눈에 가른다.
  const doc = [
    '# t',                                   // 1
    '`gone` 을 지금 쓴다.',                   // 2  ← 현재 주장
    '보통 텍스트',                            // 3
    '> 정정 이력 — `gone` 은 은퇴했다.',      // 4  ← 기록(정당)
    '`gone` 셋째 줄',                        // 5
    '`gone` 넷째 줄',                        // 6  ← 상한 밖
    '`alive` 는 살아 있다.',                  // 7
  ].join('\n');

  test('백틱 인라인 코드가 있는 «줄 번호»와 그 줄 문면을 낸다', () => {
    const sites = locateRemovedIdentifiers(doc, ['gone']);
    expect(sites.map((s) => s.line)).toEqual([2, 4, 5]);          // 상한 3
    expect(sites[0]!.text).toBe('`gone` 을 지금 쓴다.');
    expect(sites[1]!.text).toContain('정정 이력');                 // ⭐ 「기록」임을 문면이 말한다
  });

  test('⛔ 상한을 넘으면 «센다» — 조용히 버리지 않는다', () => {
    const sites = locateRemovedIdentifiers(doc, ['gone']);
    expect(sites).toHaveLength(REMOVED_IDENTIFIER_SITE_LIMIT);
    expect(sites.every((s) => s.more === 1)).toBe(true);           // 4번째 줄이 「외 1줄」로 세어진다
  });

  test('백틱 «없는» 언급은 세지 않는다 — inlineCodeIdentifiers 와 «같은 자»여야 한다', () => {
    expect(locateRemovedIdentifiers('gone 이라고만 썼다', ['gone'])).toEqual([]);
  });

  test('긴 줄은 잘리고 «잘렸음»을 보인다', () => {
    const long = '`x` ' + 'ㄱ'.repeat(300);
    const [site] = locateRemovedIdentifiers(long, ['x']);
    expect(site!.text.endsWith('…')).toBe(true);
    expect(site!.text.length).toBeLessThanOrEqual(101);
  });

  test('사라진 이름이 없으면 빈 배열 — 문서를 훑지도 않는다', () => {
    expect(locateRemovedIdentifiers(doc, [])).toEqual([]);
  });
});

describe('assessOneDocStaleness — 세 갈래', () => {
  function repoWithAnchors(): string {
    const root = mkdtempSync(join(tmpdir(), 'doc-staleness-one-'));
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# claude\n');
    writeFileSync(join(root, 'AGENTS.md'), '# agents\n');
    writeFileSync(join(root, 'README.md'), '# readme\n');
    writeFileSync(join(root, 'docs', '_index.md'), '# index\n');
    writeFileSync(join(root, 'src', 'index.ts'), 'export const liveName = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: root });
    return root;
  }

  const revs = { recent: 'HEAD', old: 'HEAD' };

  test('루트 CLAUDE.md·AGENTS.md 는 후보에 들어 판정되고, 없는 경로와 사정거리 밖은 다른 값이다', () => {
    const root = repoWithAnchors();
    try {
      const claude = assessOneDocStaleness(root, 'CLAUDE.md', revs);
      const agents = assessOneDocStaleness(root, 'AGENTS.md', revs);
      const index = assessOneDocStaleness(root, 'docs/_index.md', revs);
      const missing = assessOneDocStaleness(root, 'NOPE-NOT-EXIST.md', revs);
      const outOfScope = assessOneDocStaleness(root, 'src/index.ts', revs);
      const otherRootMd = assessOneDocStaleness(root, 'README.md', revs);
      expect(claude).toMatchObject({ outcome: 'assessed', document: { path: 'CLAUDE.md' } });
      expect(agents).toMatchObject({ outcome: 'assessed', document: { path: 'AGENTS.md' } });
      expect(index).toMatchObject({ outcome: 'assessed', document: { path: 'docs/_index.md' } });
      expect(missing).toEqual({ outcome: 'missing' });
      expect(outOfScope).toEqual({ outcome: 'out-of-scope' });
      expect(otherRootMd).toEqual({ outcome: 'out-of-scope' });
      expect(missing).not.toEqual(outOfScope);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('전수 스캔은 docs/ 만 보고 루트 상시주입 문서를 후보에 넣지 않는다', () => {
    const root = repoWithAnchors();
    try {
      const summary = assessDocsStaleness(root, revs);
      expect(summary.checked).toBe(1);
      expect(summary.documents.every((document) => document.path.startsWith('docs/'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
