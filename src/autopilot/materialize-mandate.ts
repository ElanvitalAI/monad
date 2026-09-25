// ── Autopilot Materialize Mandate (ML1 · 2026-07-09) ──────────────────────
//
// 대표 지시: "매번 또 승인은 사용성 저해 — 이미 한번 승인한 내용." 매매 mandate
// (finance-trade-mandate.json)와 동형으로, 오토파일럿 자율 구체화의 **범위를 한 번
// 승인**한다(부류 승인·approve-once). 범위 안이면 미션별 재승인 없이 auto-materialize.
//
// 안전: git 밖 전용 json(대표 편집) · 부재/손상 = fail-closed(disarmed) · command
// 자동생성은 여전히 금지(commandSources 화이트리스트로 출처만 제한).
//
// 전역 arming 플래그(arming.materialize)를 대체 — 이쪽이 범위·상한까지 담는 authority.

import { readFileSync, existsSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';
import { join } from 'node:path';

/** [ISO-3] MONAD_STATE_DIR 존중(lazy) — test 루트에 부재 = fail-closed. */
export function materializeMandatePath(): string {
  return join(monadStateRoot(), 'autopilot-materialize-mandate.json');
}

export interface MaterializeMandate {
  /** 마스터 — 기본 false(fail-closed). */
  armed: boolean;
  scope: {
    /** 자율 구체화 허용 실행모델(예: scheduler·task). 비면 아무것도 허용 안 함. */
    models: string[];
    /** command 출처 화이트리스트(예: "scripts/"). 비면 command 있는 잡 자율 금지(안전). */
    commandSources: string[];
  };
  /** 자율 생성(running·auto) 활성 상한. 초과 시 대기. */
  maxActiveJobs: number;
}

/** fail-closed 기본값 — disarmed·범위 없음. */
export const DISARMED_MANDATE: MaterializeMandate = {
  armed: false,
  scope: { models: [], commandSources: [] },
  maxActiveJobs: 0,
};

/** ~/.monad/autopilot-materialize-mandate.json 로드 — 부재/손상/타입불일치 = fail-closed. */
export function loadMaterializeMandate(path: string = materializeMandatePath()): MaterializeMandate {
  try {
    if (!existsSync(path)) return DISARMED_MANDATE;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, any>;
    const models = Array.isArray(raw?.scope?.models) ? raw.scope.models.filter((x: unknown) => typeof x === 'string') : [];
    const commandSources = Array.isArray(raw?.scope?.commandSources) ? raw.scope.commandSources.filter((x: unknown) => typeof x === 'string') : [];
    const maxActiveJobs = Number.isInteger(raw?.maxActiveJobs) && raw.maxActiveJobs >= 0 ? raw.maxActiveJobs : 0;
    return { armed: raw?.armed === true, scope: { models, commandSources }, maxActiveJobs };
  } catch {
    return DISARMED_MANDATE; // 손상 = fail-closed
  }
}

export interface MandateEvalInput {
  executionModel: string | null;
  command?: string;        // scheduler 등 — spec.command
  activeCount: number;     // 현재 자율 생성 활성 잡 수
}
export interface MandateEvalResult { allowed: boolean; reason: string }

/** 미션 1건이 mandate 범위 안에서 자율 materialize 가능한가(순수 게이트). */
export function evaluateMaterializeMandate(m: MaterializeMandate, input: MandateEvalInput): MandateEvalResult {
  if (!m.armed) return { allowed: false, reason: 'mandate disarmed(기본 off)' };
  if (!input.executionModel || !m.scope.models.includes(input.executionModel))
    return { allowed: false, reason: `실행모델 '${input.executionModel}' 범위 밖(scope.models)` };
  // command 있는 잡은 출처 화이트리스트 통과 필수(임의 명령 자율 실행 방지).
  if (input.command) {
    if (m.scope.commandSources.length === 0)
      return { allowed: false, reason: 'commandSources 비어있음 — command 자율 금지(안전)' };
    if (!m.scope.commandSources.some(s => input.command!.includes(s)))
      return { allowed: false, reason: 'command 가 commandSources 화이트리스트 밖' };
  }
  if (input.activeCount >= m.maxActiveJobs)
    return { allowed: false, reason: `자율 활성 잡 상한 도달(${m.maxActiveJobs})` };
  return { allowed: true, reason: 'mandate 범위 내 승인' };
}
