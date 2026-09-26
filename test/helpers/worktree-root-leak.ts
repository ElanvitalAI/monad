import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { configuredWorktreeRoot } from '../../src/user-config.js';

/** ⭐ 시험이 «인스턴스 뿌리»를 남기는 것을 막는다.
 *
 *  🩸 실측 2026-09-08: `~/.elanous/worktrees/` 에 시험이 만든 인스턴스 뿌리가 **434개** 쌓여 있었다
 *    (`seam-integration-base-*` 328 · `elanous-dev-behind-*` 36 · `dev-auto-worktree-*` 25 …).
 *    ⛔ 전부 «빈 껍데기(0B)»라 디스크가 아니라 «디렉토리 수»가 자랐다.
 *    ⛔ `harness clean` 은 접두 `self-impl/` ⊕ 한 인스턴스만 보므로 ***원리상 이것을 못 본다***.
 *
 *  🔑 왜 각 시험의 정리기로 안 잡히나: 워크트리를 «자식 프로세스»가 만들거나(추적 불가),
 *    실패 롤백이 워크트리만 걷고 «담고 있던 디렉토리»는 남기기 때문이다.
 *
 *  ⛔ 그래서 이 자는 **「이 시험이 도는 동안 «새로 나타났고» 지금 «비어 있는» 것」**만 지운다 —
 *    글롭으로 이름을 맞추지 않는다(남의 디렉토리를 지울 수 있다). */
export function snapshotWorktreeRoot(): ReadonlySet<string> {
  const root = configuredWorktreeRoot();
  try { return new Set(readdirSync(root)); } catch { return new Set(); }
}

/** 스냅숏 뒤 «새로 생겼고 비어 있는» 인스턴스 뿌리를 걷는다. ⛔ 실패는 조용히 넘긴다(시험을 안 죽인다).
 *  @returns 실제로 지운 이름들 — ⛔ 「0」과 「못 셌음」을 가르기 위해 «수»가 아니라 «목록»을 낸다. */
export function sweepNewEmptyWorktreeRoots(before: ReadonlySet<string>): readonly string[] {
  const root = configuredWorktreeRoot();
  const swept: string[] = [];
  let names: string[];
  try { names = readdirSync(root); } catch { return swept; }
  for (const name of names) {
    if (before.has(name)) continue;                       // 내가 만든 것이 아니다
    const dir = join(root, name);
    try {
      // 안쪽 `*.worktrees` 컨테이너가 «전부 비어» 있을 때만 걷는다.
      const inner = readdirSync(dir);
      if (inner.some((child) => readdirSync(join(dir, child)).length > 0)) continue;
      for (const child of inner) rmdirSync(join(dir, child));
      if (existsSync(dir) && readdirSync(dir).length === 0) { rmdirSync(dir); swept.push(name); }
    } catch { /* 정리 실패가 시험을 죽이지 않는다 */ }
  }
  return swept;
}
