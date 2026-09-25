// U4b — agent-mission mission CLI 액션 글루(테스트 가능 seam).
//
// index.ts 의 인라인 액션 로직(backend 검증·mission-file/text·evidence 구성·spec 빌드·runDevPipeline 실행)을
// 주입 가능한 함수로 추출 → process.exit/console 없이 전 글루를 단위 검증한다(성공경로·모든 옵션·에러경로).
// 액션은 이 함수를 호출하고 I/O(print/exit)만 담당.

import { readFileSync } from 'node:fs';
import type { AgentBackend, AgentMissionResult, EvidenceMode } from './driver.js';
import { buildAgentMissionDevSpec, executeAgentMissionReroute, type runDevPipeline } from '../self-dev/dev-pipeline.js';
import { parsePositiveInt } from '../self-dev/dev-cli.js';

export interface MissionCliOpts {
  missionFile?: string;
  branch: string;
  base?: string;
  backend?: string;
  evidence?: string; // 'doc' | 'tsc' | 'test'
  docDir?: string;
  docGlob?: string;
  testPath?: string;
  file?: string;
  maxRounds: string;
  commit?: boolean; // commander --no-commit → false
  screens?: string;
  deliverable?: string;
  enhance?: boolean; // commander --no-enhance → false
}

export interface MissionCliDeps {
  resolveBackend: (name?: string) => AgentBackend;
  readFile?: (path: string) => string;
  runDevPipeline?: typeof runDevPipeline;
}

export type MissionCliOutcome =
  | { ok: false; message: string; exitCode: number }
  | { ok: true; result: AgentMissionResult; exitCode: number };

/** mission CLI 글루 — 검증/구성/실행. process.exit·console 없음(호출부가 I/O). */
export async function runAgentMissionCliCommand(
  textParts: string[],
  opts: MissionCliOpts,
  deps: MissionCliDeps,
): Promise<MissionCliOutcome> {
  // ── backend 검증(fail-fast·단일 resolve) ──
  let agentBackend: AgentBackend;
  try { agentBackend = deps.resolveBackend(opts.backend); }
  catch (e) { return { ok: false, message: String((e as { message?: string })?.message ?? e), exitCode: 1 }; }

  // ── mission 텍스트(verbatim: --mission-file 우선) ──
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  let mission: string;
  if (opts.missionFile) {
    try { mission = readFile(opts.missionFile); }
    catch (e) { return { ok: false, message: `--mission-file 읽기 실패: ${String((e as { message?: string })?.message ?? e)}`, exitCode: 1 }; }
  } else {
    mission = Array.isArray(textParts) ? textParts.join(' ') : String(textParts ?? '');
  }
  if (!mission.trim()) return { ok: false, message: '미션 텍스트가 비었다 — <text...> 또는 --mission-file 필요', exitCode: 1 };

  // ── evidence 모드 ──
  let evidence: EvidenceMode;
  if (opts.evidence === 'doc') {
    evidence = { kind: 'doc', dirRel: opts.docDir ?? 'docs/plans', glob: new RegExp(opts.docGlob || '^PLAN-.*\\.md$', 'i') };
  } else if (opts.evidence === 'test') {
    if (!opts.testPath) return { ok: false, message: 'test 모드엔 --test-path 필요', exitCode: 1 };
    evidence = { kind: 'test', testPath: opts.testPath, ...(opts.file ? { fileRel: opts.file } : {}) };
  } else {
    evidence = { kind: 'tsc' };
  }

  let maxRounds: number;
  try {
    maxRounds = parsePositiveInt(opts.maxRounds, '--max-rounds');
  } catch (e) {
    return { ok: false, message: String((e as { message?: string })?.message ?? e), exitCode: 1 };
  }

  // ── spec 빌드 + 통일 진입점 실행(재라우팅) ──
  const spec = buildAgentMissionDevSpec({
    mission,
    backend: agentBackend.name,
    branch: opts.branch,
    ...(opts.base ? { base: opts.base } : {}),
    ...(opts.enhance === false ? { enhanceOff: true } : {}),
    evidence,
    maxRounds,
    commit: opts.commit !== false,
    ...(opts.deliverable ? { deliverableHint: opts.deliverable } : {}),
    ...(opts.screens ? { screensDir: opts.screens } : {}),
  });
  const { result, exitCode } = await executeAgentMissionReroute(
    spec, agentBackend,
    deps.runDevPipeline ? { runDevPipeline: deps.runDevPipeline } : undefined,
  );
  return { ok: true, result, exitCode };
}
