// ── 미션 CLI 스토어 스코프 가드 (2026-07-14 · 자기사고 계기) ──────────────────
//
// 미션 스토어(tasks.db)는 config-dir 스코프(tasksRoot→getMonadConfigDir)인데,
// autopilot 의 다른 스토어(origin·surface·schedules)는 MONAD_STATE_DIR 스코프다.
// 데몬은 --test 시 둘을 같은 test 루트로 맞춘다(applyTestStateDirFlagFromArgv).
// 그런데 수동 CLI 에서 MONAD_STATE_DIR 만 test 로 두고 --config-dir 를 빠뜨리면
// 미션 CRUD 가 **운영 스토어에 조용히 작동**한다 — 실측 사고(테스트 취소하려다
// 운영 promote 미션 삭제). ISO 부팅 불변식은 데몬만 보호하고 수동 CLI 는 무방비였다.
//
// 가드: MONAD_STATE_DIR 이 config-dir 와 어긋나면(둘 다 test 루트로 안 맞으면)
// mutating 미션 명령을 **거부**하고 --config-dir 를 함께 넘기라고 안내한다(fail-closed).

import { resolve } from 'node:path';
import { getMonadConfigDir } from '../monad-config-dir.js';

/** MONAD_STATE_DIR 과 미션 스토어(config-dir)의 정합 검사. 정합/무설정이면 null,
 *  어긋나면 사고 방지 에러 문자열. 순수(env·getMonadConfigDir 읽기만). */
export function missionCliScopeError(): string | null {
  const stateDir = process.env.MONAD_STATE_DIR?.trim();
  if (!stateDir) return null; // 운영 디폴트(또는 --config-dir 단독) — 검사 대상 아님
  const configDir = getMonadConfigDir();
  if (resolve(stateDir) === resolve(configDir)) return null; // 정합(데몬은 둘 다 맞춤)
  return (
    `⚠️ 스토어 스코프 불일치 — MONAD_STATE_DIR=${stateDir} 인데 미션 스토어(config-dir)=${configDir}. ` +
    `미션 CLI 는 config-dir 스코프다(MONAD_STATE_DIR 아님). 테스트 인스턴스를 대상하려면 ` +
    `--config-dir ${stateDir} 를 함께 넘겨라 — 안 넘기면 운영 스토어에 작동한다(사고 방지 거부).`
  );
}

/** 스코프를 바꾸는(mutating) 미션 액션 — 이들만 가드한다. 읽기(list·trace·history·
 *  phases·prepare-log·revise-suggest)는 무해하므로 통과. */
export const MISSION_MUTATING_ACTIONS: ReadonlySet<string> = new Set([
  'approve', 'arm', 'materialize', 'cancel', 'pause', 'resume', 'revise',
  'rebuild', 'skip', 'split', 'add-phase', 'inject', 'check', 'escalate', 'reconcile',
]);
