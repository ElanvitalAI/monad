import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectCliDocCoverage } from './cli-doc-coverage.js';

const temporaryRoots: string[] = [];
afterEach(() => temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-doc-coverage-'));
  temporaryRoots.push(root);
  for (const directory of ['.rules', 'docs/manual']) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, '.rules', 'rule.md'), 'elanous alpha run\n');
  writeFileSync(join(root, 'docs/manual', 'manual.md'), 'elanous gamma run\n');
  writeFileSync(join(root, 'CLAUDE.md'), 'elanous beta run\n');
  writeFileSync(join(root, 'AGENTS.md'), 'elanous delta run\n');
  writeFileSync(join(root, 'ignored.md'), 'elanous orphan run\n');
  return root;
}

const patch = `diff --git a/src/cli/alpha.ts b/src/cli/alpha.ts
--- a/src/cli/alpha.ts
+++ b/src/cli/alpha.ts
@@ -1,0 +1,3 @@
+const alpha = program.command('alpha');
+alpha
+  .command('run <target>');
diff --git a/src/cli/beta.ts b/src/cli/beta.ts
--- a/src/cli/beta.ts
+++ b/src/cli/beta.ts
@@ -1,0 +1,2 @@
+const beta = program.command('beta');
+const ignored = beta.command('run <target>');
diff --git a/src/cli/deleted.ts b/src/cli/deleted.ts
--- a/src/cli/deleted.ts
+++ b/src/cli/deleted.ts
@@ -0,0 +1 @@
+program.command('deleted');`;

const sources: Record<string, string | undefined> = {
  'src/cli/alpha.ts': "const alpha = program.command('alpha');\nalpha\n  .command('run <target>');",
  'src/cli/beta.ts': "const beta = program.command('beta');\nconst ignored = beta.command('run <target>');",
  'src/cli/deleted.ts': undefined,
};

describe('CLI documentation coverage observation', () => {
  test('attributes multiline chained additions to their complete source-local path', () => {
    const result = collectCliDocCoverage({ inventory: ['alpha', 'alpha run', 'beta', 'beta run', 'gamma', 'gamma run'], patch, corpus: 'elanous alpha run\n', readSource: (source) => sources[source] });
    expect(result.recent).toBe(2);
    expect(result.candidates).toEqual([{ path: 'beta run', source: 'src/cli/beta.ts', mentions: 0, proseMentions: 0 }]);
  });

  test('does not attribute a duplicate leaf under another parent in the same source', () => {
    const duplicatePatch = `+++ b/src/cli/dupes.ts
@@ -1,0 +1,4 @@
+const alpha = program.command('alpha');
+const beta = program.command('beta');
+alpha.command('list');
+beta.command('list');`;
    const result = collectCliDocCoverage({
      inventory: ['alpha', 'alpha list', 'beta', 'beta list'],
      patch: duplicatePatch,
      corpus: '',
      readSource: () => "const alpha = program.command('alpha');\nconst beta = program.command('beta');\nalpha.command('list');\nbeta.command('list');",
    });
    expect(result.candidates).toEqual([
      { path: 'alpha list', source: 'src/cli/dupes.ts', mentions: 0, proseMentions: 0 },
      { path: 'beta list', source: 'src/cli/dupes.ts', mentions: 0, proseMentions: 0 },
    ]);
  });

  // ⛔⭐⭐⭐ **위 테스트는 정밀도를 «물지 않는다»** — 무인 리뷰 2R 지적이 맞았고, 실측으로 확정했다:
  //   `registration.receiver === addition.receiver` 를 «지우고» 돌려도 여섯 개가 «전부 통과»했다.
  //   기전: 위 patch 가 두 receiver 의 `list` 를 «둘 다» 추가해 둬서, receiver 를 안 봐도 답이 같다.
  //   ⇒ 🧩 「대조군이 없는 대조」다. 아래가 «한쪽만» 추가된 진짜 대조군이다.
  test('a leaf added under one parent does not pull in the same leaf under another parent', () => {
    const onlyAlphaAdded = `+++ b/src/cli/dupes.ts
@@ -3,0 +4,1 @@
+alpha.command('list');`;
    const source = "const alpha = program.command('alpha');\nconst beta = program.command('beta');\nalpha.command('list');\nbeta.command('list');";
    const result = collectCliDocCoverage({
      inventory: ['alpha', 'alpha list', 'beta', 'beta list'],
      patch: onlyAlphaAdded,
      corpus: '',
      readSource: () => source,
    });
    // ⭐ `beta list` 는 소스에 «실재»하고 인벤토리에도 «있다». 그런데 이번 창에 «안 생겼다».
    //   receiver 를 안 보면 이것이 딸려 들어온다 — 그게 이 저장소가 겪은 오탐의 형태다.
    expect(result.candidates).toEqual([{ path: 'alpha list', source: 'src/cli/dupes.ts', mentions: 0, proseMentions: 0 }]);
    expect(result.recent).toBe(1);
  });

  // ⛔⭐⭐ 무인 리뷰 3R must-fix — **다음 파일 헤더가 대상 밖이면 `source` 를 «지워야» 한다.**
  //   안 지우면 그 뒤 비-TS 파일의 추가 줄이 «직전 TS 파일»에 귀속된다. `git log` 산출은 한 커밋에
  //   여러 파일을 실으므로 흔한 배치다. ⇒ 「못 읽었다」가 아니라 «남의 것으로 읽었다»라 침묵보다 나쁘다.
  test('does not attribute additions from a following non-target file to the previous source', () => {
    const mixedPatch = `+++ b/src/cli/alpha.ts
@@ -1,0 +1,1 @@
+const alpha = program.command('alpha');
+++ b/docs/manual/whatever.md
@@ -1,0 +1,1 @@
+alpha.command('ghost');`;
    const result = collectCliDocCoverage({
      inventory: ['alpha', 'alpha ghost'],
      patch: mixedPatch,
      corpus: '',
      readSource: () => "const alpha = program.command('alpha');\nalpha.command('ghost');",
    });
    // ⭐ `alpha ghost` 는 소스에도 인벤토리에도 «있다». 그러나 그것을 추가한 줄은 «문서 파일»에 있었다.
    //   헤더에서 `source` 를 안 지우면 이 유령이 `src/cli/alpha.ts` 의 새 명령으로 잡힌다.
    expect(result.candidates).toEqual([]);
    expect(result.recent).toBe(0);
  });

  // ⛔⭐⭐⭐ 무인 리뷰 4R·5R — **수신자 줄이 «안 바뀐» 체인 계속 호출.**
  //   4R 판은 그것을 «못 읽고» 간극으로만 남겼다. 5R 이 「그러면 recent 가 불완전하다」고 물었고 맞았다.
  //   🩹 그래서 «이을 수 있으면 잇고, 모호하면 세고 넘어간다» — 아래 둘이 그 두 갈래다.
  test('links an unambiguous chain continuation whose receiver line did not change', () => {
    const chainOnly = `+++ b/src/cli/chain.ts
@@ -3,0 +4,1 @@
+  .command('run');`;
    const result = collectCliDocCoverage({
      inventory: ['alpha', 'alpha run'],
      patch: chainOnly,
      corpus: '',
      readSource: () => "const alpha = program.command('alpha');\nalpha\n  .command('run');",
    });
    expect(result.recent).toBe(1);
    expect(result.unresolvedCalls).toBe(0);
    expect(result.candidates).toEqual([{ path: 'alpha run', source: 'src/cli/chain.ts', mentions: 0, proseMentions: 0 }]);
  });

  test('refuses to guess a parent when the leaf name is ambiguous, and counts the refusal', () => {
    const chainOnly = `+++ b/src/cli/chain.ts
@@ -5,0 +6,1 @@
+  .command('run');`;
    const result = collectCliDocCoverage({
      inventory: ['alpha', 'alpha run', 'beta', 'beta run'],
      patch: chainOnly,
      corpus: '',
      readSource: () => "const alpha = program.command('alpha');\nconst beta = program.command('beta');\nalpha.command('run');\nbeta.command('run');",
    });
    // ⭐ 부모가 «둘»이라 찍지 않는다 — 틀린 부모에 귀속하는 것이 안 잇는 것보다 나쁘다.
    expect(result.recent).toBe(0);
    expect(result.candidates).toEqual([]);
    // ⛔ 그러나 «0 으로 사라지지 않는다» — 거절한 사실이 값으로 남는다.
    expect(result.unresolvedCalls).toBe(1);
  });

  // ⛔⭐⭐ 무인 리뷰 6R must-fix 둘 — **접두에 왼쪽 경계가 없었고**, 「호출로 안 쓰였다」를
  //   「아예 안 나온다」로 접고 있었다. 앞은 내가 만든 버그(`deelanous …` 가 매치), 뒤는 내 «판단 오류»다.
  test('separates a prose mention from an invocation, and does not match a glued prefix', () => {
    const shared = {
      inventory: ['alpha', 'alpha run'],
      patch: `+++ b/src/cli/alpha.ts\n@@ -1,0 +1,2 @@\n+const alpha = program.command('alpha');\n+alpha.command('run');`,
      readSource: () => "const alpha = program.command('alpha');\nalpha.command('run');",
    };
    // ⓐ 산문으로만 나온다 — 결손이 «아니다». 후보에서 빠지고 `proseOnly` 로 «따로» 센다.
    const prose = collectCliDocCoverage({ ...shared, corpus: '⛔ `alpha run` 을 쓸 땐 셋을 안다' });
    expect(prose.candidates).toEqual([]);
    expect(prose.proseOnly).toBe(1);
    // ⓑ 붙어 있는 접두는 «호출이 아니다». 왼쪽 경계가 없으면 이것이 호출로 세어졌다.
    const glued = collectCliDocCoverage({ ...shared, corpus: 'deelanous alpha run' });
    expect(glued.candidates).toEqual([]);          // 산문으로는 잡히므로 결손은 아니고…
    expect(glued.proseOnly).toBe(1);               // …「호출로는 0」이 유지돼야 한다
    // ⓒ 진짜 호출은 호출로 센다.
    const invoked = collectCliDocCoverage({ ...shared, corpus: 'bun bin/elanous.mjs alpha run' });
    expect(invoked.proseOnly).toBe(0);
    expect(invoked.candidates).toEqual([]);
  });

  test('excludes deleted current sources rather than collapsing unavailable data into zero', () => {
    const result = collectCliDocCoverage({ inventory: ['alpha', 'alpha run', 'deleted'], patch, corpus: '', readSource: (source) => sources[source] });
    expect(result).toMatchObject({ inventory: 3, recent: 1, undocumented: 1 });
    expect(result.candidates).toEqual([{ path: 'alpha run', source: 'src/cli/alpha.ts', mentions: 0, proseMentions: 0 }]);
  });

  test('uses only the fixed prescription corpus boundary', () => {
    const root = fixtureRoot();
    const result = collectCliDocCoverage({
      root,
      inventory: ['alpha', 'alpha run', 'orphan', 'orphan run'],
      patch: `+++ b/src/cli/alpha.ts\n@@ -1,0 +1 @@\n+alpha.command('run')\n+++ b/src/cli/orphan.ts\n@@ -1,0 +1 @@\n+orphan.command('run')`,
      readSource: (source) => source.includes('alpha') ? "const alpha = program.command('alpha'); alpha.command('run');" : "const orphan = program.command('orphan'); orphan.command('run');",
    });
    expect(result.candidates).toEqual([{ path: 'orphan run', source: 'src/cli/orphan.ts', mentions: 0, proseMentions: 0 }]);
  });

  test('runs git exactly once when collecting a live patch', () => {
    let calls = 0;
    const result = collectCliDocCoverage({ inventory: ['alpha', 'alpha run'], corpus: '', runGit: () => { calls++; return `+++ b/src/cli/alpha.ts\n@@ -1,0 +1 @@\n+alpha.command('run')`; }, readSource: () => "const alpha = program.command('alpha'); alpha.command('run');" });
    expect(calls).toBe(1);
    expect(result.recent).toBe(1);
  });

  test('the executable prints exactly one JSON measurement line', () => {
    // ⭐⭐ **이 실행에만 있는 표지**를 만든다 — 밀리초까지 있는 ISO 시각이라 실행마다 다르다.
    //   ⛔ 이것이 «필요한» 이유(실측): 처음엔 도착 판정을 `inventory` 값으로 했는데, 그 값이 실행마다
    //   같아서 ***sink 를 떼도 옛 레코드가 단언을 만족시켰다.*** 반증으로 확인하고서야 드러났다.
    //   ⇒ 🧩 「도착을 잰다」면서 실은 「과거에 한 번 도착한 적 있다」를 재고 있었다.
    //   ⊕ 21일 창을 그대로 유지한다 — 표지를 만들려고 재는 «대상»을 바꾸지 않는다.
    const marker = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    // ⛔⭐⭐⭐ **`NODE_ENV` 를 «벗겨서» 띄운다** — 안 벗기면 이 단언이 «항상» 실패한다.
    //   📏 실측(2026-08-09 · 이 창에서 확정): 같은 스크립트를 셸에서 돌리면 기록이 `logs.db` 에 «도착»하는데,
    //   `bun test` 안에서 spawn 하면 «안 온다». 차이는 자식이 물려받는 `NODE_ENV` 하나였다(벗기니 도착).
    //   ⇒ 🧩 그대로 두면 ***「배선이 없다」와 「테스트라서 안 쓴다」가 같은 값***이 되어, 이 단언이
    //   회귀를 잡는 게 아니라 «항상 빨간불»인 죽은 칸이 된다. 벗기는 것이 «실물 조건»에 맞추는 것이다.
    //   ⊕ ⭐⭐ **로그 저장소를 «격리»한다**(무인 리뷰 7R must-fix) — `ELANOUS_STATE_DIR` 로 임시 뿌리를 주면
    //   스크립트도 조회도 «그 저장소»를 쓴다(실측: `<tmp>/logs/logs.db` 가 생기고 거기서 읽힌다).
    //   ⇒ 공유 저장소에 영속 부작용을 안 남기고, 「최근 200건에 밀린다」는 플레이크 원인도 사라진다.
    const logRoot = mkdtempSync(join(tmpdir(), 'cli-doc-coverage-logs-'));
    temporaryRoots.push(logRoot);
    const liveEnv: Record<string, string> = { ELANOUS_STATE_DIR: logRoot };
    for (const [key, value] of Object.entries(process.env)) if (key !== 'NODE_ENV' && value !== undefined) liveEnv[key] = value;
    liveEnv.ELANOUS_STATE_DIR = logRoot;
    const subprocess = Bun.spawnSync(['bun', 'scripts/cli-doc-coverage.ts', '--json', `--since=${marker}`], { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: liveEnv });
    expect(subprocess.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(subprocess.stdout).trim();
    expect(stdout.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout) as { inventory: number; undocumented: number; recent: number; candidates: unknown[] };
    // ⭐ 여기서 재는 것은 ***「이 실행 경로가 도는가」***지 「지금 저장소에 결손이 몇 개인가」가 아니다.
    //   ⛔ `inventory` 만 「0보다 크다」를 요구한다 — 그 값이 0 이면 `program` 을 못 걸은 것이라
    //   ***스크립트가 「돌았는데 아무것도 못 봤다」***는 뜻이고, 그건 진짜 결함이다.
    expect(parsed.inventory).toBeGreaterThan(0);
    // ⛔⭐⭐ `recent`·`undocumented` 에 **하한을 걸지 않는다.** 그 둘은 «저장소의 오늘 상태»다 —
    //   결손을 다 메우면 0 이 되고, 21일 창 밖으로 커밋이 밀려도 0 이 된다.
    //   📏 실측(2026-08-09): 직전 판이 `undocumented > 0` 을 요구해 ***결손이 0 인 순간 테스트가 깨졌다***
    //   ⇒ 🧩 「고치면 깨지는 테스트」는 Goodhart 의 역방향이다. 계약은 «모양»만 문다.
    expect(Number.isInteger(parsed.recent)).toBe(true);
    expect(parsed.undocumented).toBe(parsed.candidates.length);

    // ⛔⭐⭐⭐ **「남겼다」가 아니라 「도착했다」를 잰다** (무인 리뷰가 «세 라운드» 요구했고 그가 옳았다).
    //   📏 이 창의 실측: `registerStandaloneLogSink` 가 «없을 때» 스크립트는 정상 종료하고 JSON 도 냈지만
    //   `elanous logs --category cli.doc-coverage` 가 **0건**이었다. 위 stdout 단언만으로는 그 상태가 «초록»이다.
    //   ⇒ 🧩 `#6701`·`I-T8` 이 이미 적은 형태 — ***호출을 재는 것과 도착을 재는 것은 다른 축이다.***
    //   ⛔ `logs.db` 를 직접 열지 않는다(저장소 규율) — 1급 CLI 로만 읽는다.
    // ⛔⭐ **도착은 «즉시»가 아니다** — sink 기록에 지연이 있어 자식 종료 직후 조회하면 놓친다
    //   (실측: 바로 조회 → 없음 · 2초 뒤 → 있음). ⇒ 「없다」로 단정하기 전에 «기다린다».
    //   ⛔ 고정 sleep 이 아니라 «찾으면 즉시 끝나는» 폴링이다 — 느린 기계에서만 오래 기다린다.
    type LogRow = { event?: string; data?: { since?: string } };
    const arrived = (): boolean => {
      const logs = Bun.spawnSync(
        ['bun', 'bin/elanous.mjs', 'logs', '--category', 'cli.doc-coverage', '--limit', '20', '--json', '--json-data'],
        { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: liveEnv },
      );
      if (logs.exitCode !== 0) return false;
      return new TextDecoder().decode(logs.stdout).trim().split('\n')
        .map((line) => { try { return JSON.parse(line) as LogRow; } catch { return undefined; } })
        .some((row) => row?.event === 'measured' && row.data?.since === marker);
    };
    let found = false;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      found = arrived();
      if (!found) Bun.sleepSync(1000);
    }
    // ⭐ 「옛 레코드가 남아 있다」가 아니라 ***「방금 이 실행이 도착했다」***를 판정한다 — 표지로 가른다.
    expect(found).toBe(true);
    // ⛔ 기본 5,000ms 로는 «항상» 시간 초과다 — 이 테스트는 자식 프로세스를 «둘» 띄우고 각각
    //   `src/index.ts` 전체를 import 한다(실측 4.4~5.2초 + 로그 조회). 기본값이면 «코드와 무관하게» 빨간불이다.
  }, 120_000);
});
