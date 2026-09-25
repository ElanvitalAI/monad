// ── 하니스 외부 target gate 감지 (#25 P1 · 2026-07-21) ──────────────────────────
//
// 외부 repo(~/source/*)는 monad `bun test` 가 안 맞는다 → target 의 manifest 로 테스트 명령을 감지한다.
// 대표 결정(DESIGN-harness-target-generalization-2026-07-21): manifest 감지 → 없으면 skip-with-warn.
// monad 자신은 이 경로를 안 탄다(o.repoRoot 미설정 → 종전 runIntegrityGate/bun test 유지·회귀 0).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedGate { cmd: string; args: string[]; label: string }

/** 외부 target 디렉토리의 manifest 로 테스트 명령 감지. 순서=구체적 생태계 우선. 없으면 null(skip-with-warn).
 *  파일 존재/읽기만 하는 순수-ish 함수(테스트 가능). package.json 은 scripts.test 있을 때만(빈 test 회피). */
export function detectGateCommand(dir: string): DetectedGate | null {
  const has = (f: string): boolean => existsSync(join(dir, f));
  // JS/TS — package.json scripts.test 존재 시. bun.lock* 있으면 bun, 아니면 npm.
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
      if (pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim()) {
        const runner = has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
        return { cmd: runner, args: ['test'], label: `${runner} test` };
      }
    } catch { /* 파싱 실패 — 아래 생태계로 폴스루 */ }
  }
  if (has('Cargo.toml')) return { cmd: 'cargo', args: ['test'], label: 'cargo test' };
  if (has('pyproject.toml') || has('setup.py') || has('pytest.ini') || has('tox.ini')) {
    return { cmd: 'python', args: ['-m', 'pytest'], label: 'pytest' };
  }
  if (has('go.mod')) return { cmd: 'go', args: ['test', './...'], label: 'go test' };
  if (has('Makefile') || has('makefile')) {
    // Makefile 에 test 타깃이 있을 때만(없는데 make test 하면 에러).
    try {
      const mk = readFileSync(join(dir, has('Makefile') ? 'Makefile' : 'makefile'), 'utf-8');
      if (/^test\s*:/m.test(mk)) return { cmd: 'make', args: ['test'], label: 'make test' };
    } catch { /* skip */ }
  }
  return null; // 감지 실패 → skip-with-warn(검증은 HITL diff 리뷰로)
}
