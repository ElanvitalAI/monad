// ── Managed memory/knowledge DB paths — 정본 위치 + legacy 자가치유 (2026-07-19) ──
//
// elanous 의 "기억" DB(에피소드 surface_events · 시맨틱 knowledge)는 종전 메인 state dir
// `~/.elanous/conatus/`(시그널·미션·스케줄·로그가 다 뒤섞인 junk drawer)에 얹혀 있었다.
// 이들을 **전용 `~/.elanous/memory/` 네임스페이스**로 모아 관리 표면을 통일한다.
//
// 일반화: DB 마다 경로/마이그레이션을 하드코딩(surface-events 인라인 선례)하지 않고, 이 한
// 헬퍼로 등록만 하면 (1) 정본 경로 해석 (2) conatus→memory 자가치유 이전을 공유한다.
//
//   전부 scoped — ELANOUS_STATE_DIR 격리 인스턴스는 각자 파일(인스턴스별 self-log). knowledge 도
//   Phase E(2026-07-24)에서 global→scoped 전환(격리 test 가 prod 회상 코퍼스 오염 차단). ★global
//   opt-in 은 은퇴(Phase F) — "인스턴스 무관 공유"는 격리를 뚫는 leak 벡터라 되살리지 말 것.

import { existsSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** managed 메모리/지식 DB 의 정본 경로. ELANOUS_STATE_DIR 격리 인스턴스는 자기 파일, 아니면
 *  `~/.elanous/memory/`. (global opt-in 은퇴 — 전부 scoped·격리 불변식.) */
export function memoryDbPath(name: string): string {
  const stateDir = process.env.ELANOUS_STATE_DIR?.trim();
  if (stateDir) return join(stateDir, name);
  return join(homedir(), '.elanous', 'memory', name);
}

/** legacy `~/.elanous/conatus/<name>` → 정본 memory/ 자가치유 이전. 신 경로 부재 + legacy 존재
 *  일 때만 rename(같은 fs·원자적·WAL/SHM 동반). ★open 前(재시작 시점)에만 도므로 라이브 안전
 *  (POSIX rename 은 열린 fd 를 따라감). scoped 격리 인스턴스는 legacy 없음 → skip. */
export function migrateLegacyMemoryDb(name: string): void {
  const target = memoryDbPath(name);
  // scoped 격리(ELANOUS_STATE_DIR)엔 conatus legacy 가 없다 — prod(미설정)만 이전.
  if (process.env.ELANOUS_STATE_DIR?.trim()) return;
  if (existsSync(target)) return;
  const legacy = join(homedir(), '.elanous', 'conatus', name);
  if (legacy === target || !existsSync(legacy)) return;
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(legacy, target);
    for (const suf of ['-wal', '-shm']) {
      if (existsSync(legacy + suf)) { try { renameSync(legacy + suf, target + suf); } catch { /* */ } }
    }
  } catch { /* best-effort — 실패 시 정본 경로에 새로 생성(이력만 유실·기능 정상) */ }
}
