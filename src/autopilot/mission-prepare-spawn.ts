// ── se-mission-prepare 스폰 헬퍼 (공용) ──────────────────────────────────────
// intent-gate(신규 준비)와 mission-hitl-callback(정정 재분해)이 공유. 데몬 무차단 detached.
//
// ★ 관측성(대표 2026-07-13) — 재분해는 조사→grounding→중복체크→분해 단계로 수 분 걸리는데,
// 그간 stdio:'ignore' 라 단계 로그(se-mission-prepare 의 console.error)가 버려져 "ING"만 알 수
// 있었다. 이제 미션별 로그 파일로 리다이렉트해 `autopilot prepare-log <id>` 로 진행을 관측한다
// (SE 빌드 관측·run.log 동형). LLM 내부 스트리밍은 아니지만 단계 전이는 실시간으로 보인다.

import { spawn } from 'node:child_process';
import { existsSync, openSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getMonadConfigDir } from '../monad-config-dir.js';
import { monadStateRoot } from './state-paths.js';

/** 재분해 관측 로그 경로 — 미션별(id 의 ascii hash 세그먼트). 순수·결정론. detached 로그를 여기로
 *  리다이렉트해 단계 진행(조사/grounding/중복/분해)을 tail 로 본다. 여러 재분해는 append(구분자).
 *  ★ 인스턴스 스코프(ISO·2026-07-14) — homedir 고정 은퇴. `MONAD_STATE_DIR` 존중 → 격리 테스트
 *  데몬의 준비 로그는 test 루트에, 운영은 ~/.monad 에(로그 누수 방지·surface-events 동형). */
export function missionPrepareLogPath(missionId: string): string {
  const seg = (missionId.split('_').pop() ?? missionId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'mission';
  return join(monadStateRoot(), 'conatus', `mission-prepare-${seg}.log`);
}

/** scripts/se-mission-prepare.ts <id> 를 detached 로 spawn(데몬 무차단). forceDecompose=크기무관
 *  강제 멀티페이즈, comment=정정 재분해 지시(대표 프리셋/직접입력). 스크립트 없으면 no-op.
 *  ★단계 로그를 missionPrepareLogPath 로 리다이렉트(관측)·반환=로그 경로(실패/skip 시 null).
 *  테스트 격리(NODE_ENV=test 는 skip — 실 spawn 방지·seam 사용). */
export function spawnMissionPrepare(
  missionId: string,
  opts: { forceDecompose?: boolean; comment?: string; decomposeModel?: string; clarified?: boolean; arcHint?: number; redesign?: boolean; rerunFrom?: string; fresh?: boolean } = {},
): string | null {
  if (process.env.NODE_ENV === 'test') return null;
  const candidates = [
    join(process.cwd(), 'scripts/se-mission-prepare.ts'),
    join(import.meta.dir, '../../scripts/se-mission-prepare.ts'),
  ];
  const script = candidates.find((p) => existsSync(p));
  if (!script) return null;
  const args = [script, missionId];
  if (opts.forceDecompose) args.push('--force');
  if (opts.comment) args.push('--comment', opts.comment);
  // ★ Intake clarify 재-spawn(RFC-mission-intake-qa-agent) — 답변이 comment(확정 설계)로 이미
  //   fold 됐음을 표식. 자식이 clarify 게이트를 재발동하지 않고 바로 분해한다(무한 되묻기 방지).
  if (opts.clarified) args.push('--clarified');
  // ★ H5(2026-07-20) — 리디자인 재-spawn 표식. 자식이 research 캐시를 강제 무효(전제 전환·재조사).
  if (opts.redesign) args.push('--redesign');
  // ★ P4(2026-07-20) — re-drive: 저장 프레임 seed 로 그 단계부터 재구동(정상 pre/clarify/post 우회).
  if (opts.rerunFrom) args.push('--rerun-from', opts.rerunFrom);
  // ★ fresh 리셋(2026-07-20) — 조사 캐시 무효화 + clarify 재발동(진짜 처음부터). comment/clarified 미전달(clarify 발동 조건).
  if (opts.fresh) args.push('--fresh');
  // ★ arcHint 구조화 배선(2026-07-17) — Intake clarify 확정 아크 수를 텍스트가 아닌 구조화 인자로
  //   전달(자식이 decomposeMissionToPhases arcHint 로 넘김). "5아크→5페이즈" 손실 체인 근본 수복.
  if (opts.arcHint !== undefined && opts.arcHint >= 1) args.push('--arc-hint', String(opts.arcHint));
  // ★ Opus 폴백(대표 2026-07-15) — 분해 모델 override(Codex transient 실패 후 Opus 재분해).
  if (opts.decomposeModel) args.push('--decompose-model', opts.decomposeModel);
  // ★ 인스턴스 스코프 전파(ISO·2026-07-14) — config-dir 는 setMonadConfigDir in-process
  // override 라 env 로 상속 안 됨(config-dir-unify: env 미러 제거). bg-launch 처럼 argv 로
  // 재전달해야 자식 se-mission-prepare 가 같은 tasks.db/config(격리 테스트면 .monad-test)를
  // 연다. 미전파 시 자식이 운영 스토어에서 미션을 찾다 즉사(대표 발견). MONAD_STATE_DIR
  // (origin/surface)은 데몬 env 에 이미 있어 자식이 상속하므로 config-dir 만 넘기면 충분.
  // 자식이 첫 줄에서 --config-dir 을 strip(applyConfigDirFlagFromArgv) → argv[2]=missionId 유지.
  args.push('--config-dir', getMonadConfigDir());
  // ★ 단계 로그를 파일로(관측) — fd 열기 실패 시 기존처럼 ignore(fail-soft·재분해 자체는 진행).
  const logPath = missionPrepareLogPath(missionId);
  let stdio: 'ignore' | ['ignore', number, number] = 'ignore';
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    stdio = ['ignore', fd, fd];
  } catch { stdio = 'ignore'; }
  const child = spawn('bun', args, { detached: true, stdio });
  child.unref();
  return stdio === 'ignore' ? null : logPath;
}
