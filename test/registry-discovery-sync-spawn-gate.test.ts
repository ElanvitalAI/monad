// 발굴 소스에 «동기» 자식프로세스 호출을 금지하는 관문.
//
// ⛔ 왜 시험으로 막나 — 라우트의 전체 상한은 «타이머»이고, 타이머는 이벤트 루프가
//    돌아야 발화한다. 소스가 `spawnSync`/`execFileSync` 로 루프를 «막으면»
//    ***그 상한은 원리상 발화할 수 없다.*** 즉 이 관문이 없으면 상한이 언제든
//    다시 「장식」이 될 수 있고, 그때 증상은 「데몬 전체 무응답」이다.
// 📏 실제로 그렇게 났다: 2026-08-31, firecrawl 소스의 spawnSync 하나가
//    데몬 전 라우트를 121,970ms 멈췄다(#14925 에서 걷어냄).
//
// 같은 계열: src/git-fs/spawn-discipline.test.ts (거기는 git 축).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src/registry/discovery/', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// ⚠️ **이 관문이 «보장하는 범위»** (리뷰 지적으로 좁혀 적음):
//   ✅ 잡는다 — 직접 호출(`spawnSync(...)`), ⊕ `node:child_process` 에서 그 심볼을
//      «가져오는 것 자체»(별칭 `spawnSync as run` 포함).
//      ⊕ ***namespace 형*** `cp.spawnSync(...)` 와 ***CJS 형*** `require(...).execFileSync(...)` 도
//        잡는다 — 호출 정규식의 `\b` 가 `.` 뒤에서 매치하기 때문이다(fixture 로 «확인»했다).
//      ⊕ ***대괄호 리터럴*** `cp['spawnSync']` · `cp["execSync"]` · `cp[\`execFileSync\`]`
//        (홑따옴표·쌍따옴표·백틱, 정확 키만 — `obj['spawnSyncHelper']` 같은 더 긴 키는 안 잡는다).
//   ⛔ 못 잡는다 — 문자열 조합(`cp['spawn'+'Sync']`), 동적 import 로 런타임에 꺼내 쓰는 경우.
//      그건 AST/타입 기반 검사가 필요하고 이 판의 축이 아니다.
//      ⇒ 이 한 칸이 「전체 상한」의 ***잔여 회귀 위험***이고, 아래 시험이 그것을 «명시»한다.
//   ⇒ 그래서 시험 이름에서 「anywhere」를 뺐다. ***관문은 자기가 못 보는 것을 말해야 한다.***
/** 한 파일의 소스에서 위반을 찾는다. ⛔ 관문 «자신»도 시험 대상이라 함수로 뺐다 —
 *  자가 깨지면 「위반 0건」 칸이 전부 통과하므로, 아래 fixture 가 알려진 양성·음성
 *  «양쪽»에 이 자를 눌러 본다. */
function findSyncSpawnOffenders(src: string): string[] {
  const found: string[] = [];
  // ⛔ import 는 «파일 전체»로 본다 — 줄 단위면 여러 줄 import 를 놓친다.
  const importStatements = src.match(/import[\s\S]*?from\s*['"][^'"]+['"]/g) ?? [];
  for (const stmt of importStatements) {
    if (!/from\s*['"]node:child_process['"]/.test(stmt)) continue;
    if (!stmt.includes('{')) continue;
    const body = stmt.slice(stmt.indexOf('{') + 1, stmt.lastIndexOf('}'));
    for (const spec of body.split(',')) {
      if (/^\s*type\s/.test(spec)) continue;   // 타입 전용은 실행을 못 막는다
      const name = spec.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && ['spawnSync', 'execSync', 'execFileSync'].includes(name)) {
        found.push(`import ${name}`);
      }
    }
  }
  for (const text of src.split('\n')) {
    const code = text.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (
      /\b(spawnSync|execSync|execFileSync)\s*\(/.test(code) ||
      /Bun\.spawnSync\s*\(/.test(code) ||
      /\b[A-Za-z_$][\w$]*\s*\[\s*(['"`])(spawnSync|execSync|execFileSync)\1\s*\]/.test(code)
    ) {
      found.push(`call ${text.trim().slice(0, 60)}`);
    }
  }
  return found;
}

describe('the gate itself — pressed on known positives AND a known negative', () => {
  test('catches a single-line aliased import', () => {
    expect(findSyncSpawnOffenders(
      `import { spawn, spawnSync as run } from 'node:child_process';`,
    )).toHaveLength(1);
  });

  test('catches a MULTI-LINE aliased import (the repo default format)', () => {
    expect(findSyncSpawnOffenders([
      'import {',
      '  spawn,',
      '  spawnSync as run,',
      "  type ChildProcess,",
      "} from 'node:child_process';",
    ].join('\n'))).toHaveLength(1);
  });

  test('catches a direct call', () => {
    expect(findSyncSpawnOffenders(`const r = execFileSync('firecrawl', ['--version']);`)).toHaveLength(1);
  });

  test('catches the NAMESPACE form — cp.spawnSync(...)', () => {
    expect(findSyncSpawnOffenders(
      `import * as cp from 'node:child_process';\ncp.spawnSync('x');`,
    )).toHaveLength(1);
  });

  test('catches the CJS form — require(...).execFileSync(...)', () => {
    expect(findSyncSpawnOffenders(
      `const r = require('node:child_process').execFileSync('x');`,
    )).toHaveLength(1);
  });

  test('does NOT flag a type-only import (known negative — no false positive)', () => {
    expect(findSyncSpawnOffenders([
      'import {',
      '  spawn,',
      '  type SpawnSyncOptions,',
      "} from 'node:child_process';",
    ].join('\n'))).toEqual([]);
  });

  test('catches single-quoted identifier bracket access — cp[\'spawnSync\']', () => {
    expect(findSyncSpawnOffenders(
      `import * as cp from 'node:child_process';\nconst f = cp['spawnSync']; f('x');`,
    )).toHaveLength(1);
  });

  test('catches double-quoted identifier bracket access — cp["spawnSync"]("echo", ["x"])', () => {
    expect(findSyncSpawnOffenders(
      `import * as cp from 'node:child_process';\ncp["spawnSync"]("echo", ["x"]);`,
    )).not.toEqual([]);
  });

  test('catches double-quoted identifier bracket access — cp["execSync"]', () => {
    expect(findSyncSpawnOffenders(
      `import * as cp from 'node:child_process';\ncp["execSync"]("echo", ["x"]);`,
    )).toHaveLength(1);
  });

  test('catches backtick identifier bracket access — cp[`execFileSync`]', () => {
    expect(findSyncSpawnOffenders(
      'import * as cp from \'node:child_process\';\ncp[`execFileSync`]("echo", ["x"]);',
    )).toHaveLength(1);
  });

  test('does NOT flag longer bracket keys (spawnSyncHelper / execSync_label)', () => {
    expect(findSyncSpawnOffenders(
      `const obj: Record<string, unknown> = {}; const v = obj['spawnSyncHelper'];\nconst map: Record<string, number> = {}; const n = map['execSync_label'];`,
    )).toEqual([]);
    expect(findSyncSpawnOffenders(
      `const m: Record<string, number> = {}; const v = m["spawnSyncHelper"];`,
    )).toEqual([]);
  });

  test('does NOT flag a comment explaining why we avoid it', () => {
    expect(findSyncSpawnOffenders('// ⛔ spawnSync() 를 쓰지 않는다 — 루프를 막는다')).toEqual([]);
  });

  test('does NOT flag commented identifier bracket access', () => {
    expect(findSyncSpawnOffenders("// const f = cp['spawnSync']; f('x');")).toEqual([]);
  });

  test('KNOWN GAP: computed string concatenation is not caught (documented, not a surprise)', () => {
    // ⛔ 이 시험은 「고쳐야 할 것」이 아니라 ***관문이 «못 보는 것»을 못 박는 자리***다.
    //    이 줄이 언젠가 깨지면 그건 개선이고, 그때 위 머리말도 같이 고친다.
    expect(findSyncSpawnOffenders(
      `import * as cp from 'node:child_process';\nconst f = cp['spawn'+'Sync']; f('x');`,
    )).toEqual([]);
  });

  test('KNOWN GAP: dynamic import is not caught (documented, not a surprise)', () => {
    expect(findSyncSpawnOffenders(
      `const { spawnSync: run } = await import('node:child_process');\nrun('echo', ['x']);`,
    )).toEqual([]);
  });
});

describe('discovery sources must never block the event loop', () => {
  test('no direct sync child_process call, and no import of one, under src/registry/discovery', () => {
    const offenders: Array<{ file: string; found: string[] }> = [];
    const files = walk(ROOT);
    // ⛔ 분모를 먼저 확정한다 — 0개를 훑고 「위반 없음」이라 말하면 안 된다.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith('sources/firecrawl-crawl.ts'))).toBe(true);
    for (const file of files) {
      const found = findSyncSpawnOffenders(readFileSync(file, 'utf-8'));
      if (found.length > 0) offenders.push({ file: file.slice(ROOT.length), found });
    }
    expect(offenders).toEqual([]);
  });
});
