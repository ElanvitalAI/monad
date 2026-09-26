// ── 시스템 수리 미션 opt-in (2026-07-13 · 대표 지시) ───────────────────────
//
// IMMUTABLE_CORE(매매·arming·safety·재부팅·데몬감독 — safety.ts)는 self-improving 이 자기
// 안전장치를 잘못 고쳐 brick/매매 사고 내는 걸 막는 자기수정 금지 구역이다. 그런데 **대표가
// 의도를 갖고 던진 "시스템 수리 미션"**(예: 진단 fabric·게이트 로직 수리)은 그 코어까지
// worktree 에서 수정·PR 할 수 있어야 한다. 이 모듈은 그 예외를 **명시 opt-in** 으로만 연다.
//
// 설계(대표 결정): 명시 플래그 방식 — arming.json 과 동형으로 파일에 미션 id 를 등재한 미션만
// 예외. fail-closed(파일/항목 없으면 예외 0). 자율 발굴(discover) 미션은 여기 못 들어온다
// (대표만 명시 등재). merge 는 이 예외와 무관하게 여전히 HITL(worktree·PR 까지만 허용).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { elanousStateRoot } from './state-paths.js';
import { join, dirname } from 'node:path';

/** [ISO-3] ELANOUS_STATE_DIR 존중(lazy). */
export function systemRepairPath(): string {
  return join(elanousStateRoot(), 'autopilot/system-repair.json');
}

interface SystemRepairAuth {
  authorizedMissions: string[];
}

function load(path: string): SystemRepairAuth {
  try {
    if (!existsSync(path)) return { authorizedMissions: [] };
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const list = Array.isArray(raw?.authorizedMissions)
      ? raw.authorizedMissions.filter((x): x is string => typeof x === 'string')
      : [];
    return { authorizedMissions: list };
  } catch {
    return { authorizedMissions: [] }; // 손상 = fail-closed
  }
}

function save(path: string, auth: SystemRepairAuth): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`);
}

/** 이 미션이 IMMUTABLE_CORE 수정을 명시 승인받았는가(대표 opt-in). 기본 false(fail-closed).
 *  path 주입으로 테스트 가능(arming.ts 패턴). 캐시 없음 — 매 호출 파일 read(즉시 반영). */
export function isSystemRepairAuthorized(missionId: string, path: string = systemRepairPath()): boolean {
  if (!missionId) return false;
  return load(path).authorizedMissions.includes(missionId);
}

/** 미션을 시스템 수리 예외로 등재(대표 명시 opt-in). 멱등. */
export function authorizeSystemRepair(missionId: string, path: string = systemRepairPath()): void {
  const cur = load(path);
  if (!cur.authorizedMissions.includes(missionId)) cur.authorizedMissions.push(missionId);
  save(path, cur);
}

/** 시스템 수리 예외 해제. 멱등. */
export function revokeSystemRepair(missionId: string, path: string = systemRepairPath()): void {
  const cur = load(path);
  cur.authorizedMissions = cur.authorizedMissions.filter((id) => id !== missionId);
  save(path, cur);
}

/** 현재 예외 등재된 미션 id 목록. */
export function listSystemRepairAuthorized(path: string = systemRepairPath()): string[] {
  return load(path).authorizedMissions;
}
