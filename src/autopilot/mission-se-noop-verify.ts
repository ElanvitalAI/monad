// ── SE 페이즈 "이미 충족됐나" grounded 검증 (대표 지시 2026-07-14) ────────────
//
// 문제: SE 게이트가 실패(가짜 no-op·budget 소진)를 반환하기 전에, 그 페이즈가 실은
// **이미 코드에 구현돼 있는지**를 확인하지 않았다. 게이트 텍스트·비평만 보고 판정해
// 진짜 no-op(이미 됨)을 실패로 오판 → 미션이 멈추고 불필요한 HITL 요구(실측: 멱등
// proposal 억제 서브페이즈 — idempotencyKey 가 이미 doc-curation.ts:174 에 있었음).
//
// 대표 통찰: 시스템엔 정황 증거·grounding 장치가 많다(코드베이스·워킹메모리·형제 페이즈
// 산출). 실패 반환 직전에 LLM 이 **실제 코드를 읽어** "의도가 이미 충족됐나"를 grounded
// 로 한 번 더 거른다. 충족 확증(file:line 근거) → 자동 PASS(사람 확인 불요). 확증 못 하면
// 보수적으로 실패 유지(진짜 미완의 false-PASS 금지 — KGS 연쇄 가짜성공 사건 방어 유지).

import { tierModel } from '../llm/model-defaults.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groundMissionInCodebase } from './mission-codebase-gate.js';
import { adaptiveGround, isImplementationFile } from './mission-grounding-ladder.js';

export interface NoopVerdict {
  /** 페이즈 의도가 이미 코드에 충족돼 있나(grounded 확증). */
  satisfied: boolean;
  /** satisfied 일 때 근거(파일/심볼·가능하면 file:line). */
  evidence: string;
  /** 미충족 시 무엇이 빠졌나(실패 카드에 노출). */
  missing: string;
  /**
   * ★ 자기인지(적응형 디깅·2026-07-14) — 실제 구현 코드를 충분히 파고 판정했나(confidence!=='low').
   * false 면 "문서만 봤거나 근거 불충분" = 판정 신뢰 낮음("못 봤다"). 호출측이 unmet(깨짐) 과
   * unverified(판정 불가)를 구분해 false arc-revise(grounding miss 를 dead-code 로 오판)를 막는다.
   */
  grounded: boolean;
}

export interface NoopVerifyDeps {
  /** 코드베이스 grounding(기본 groundMissionInCodebase). 테스트 주입. */
  ground?: (goal: string) => Promise<{ grounded: boolean; context: string; files: string[] }>;
  /** grounded 파일 내용 읽기(기본 실 fs·상한). 테스트 주입. */
  readFiles?: (files: string[], repoRoot: string) => string;
  /** LLM 판정(기본 streamLLM·sol 리즈닝). 테스트 주입·NODE_ENV=test 는 필수 주입. */
  classify?: (prompt: string) => Promise<string>;
  /**
   * ★ 선언된 증거 파일(적응형 디깅 시드·2026-07-14) — intent 재유도가 놓치는 실제 구현 파일을 명시
   * 시드로 앞세운다(아크 reuseBoundaries·페이즈 파일참조). grounding miss(문서만 읽음) 방지 핵심.
   */
  seedFiles?: string[];
  /** 적응형 디깅 grounding 주입(기본 adaptiveGround). 미주입 시 얕은 ground 폴백(테스트 하위호환). */
  adaptiveGround?: (query: string, ctx: { seedFiles?: string[]; acceptance?: string[] }) => Promise<{ context: string; files: string[]; grounded: boolean; confidence: string }>;
  repoRoot?: string;
}

/** grounded 파일들의 앞부분을 모아 판정 컨텍스트로(파일당 ~120줄·최대 6파일·안전 상한). */
function defaultReadFiles(files: string[], repoRoot: string): string {
  const parts: string[] = [];
  for (const f of files.slice(0, 6)) {
    try {
      const body = readFileSync(join(repoRoot, f), 'utf-8').split('\n').slice(0, 120).join('\n');
      parts.push(`### ${f}\n${body}`);
    } catch { /* 파일 접근 실패는 스킵 */ }
  }
  return parts.join('\n\n');
}

async function defaultClassify(prompt: string): Promise<string> {
  const { streamLLM } = await import('../llm.js');
  return streamLLM([{ role: 'user', content: prompt }], () => {}, {
    model: process.env.ELANOUS_NOOP_VERIFY_MODEL || process.env.ELANOUS_DECOMPOSE_MODEL || tierModel('better'),
    reasoningEffort: 'medium',
  });
}

/** 판정 프롬프트 — 의도+acceptance+실제 코드로 "이미 충족?" 를 엄격히. 애매하면 미충족. */
function buildVerifyPrompt(intent: string, acceptance: string[], groundContext: string, code: string): string {
  return [
    '아래 "페이즈 의도"와 "완료 기준"이 아래 "실제 코드"에 **이미 완전히 구현돼 있는지** 판정하라.',
    '엄격 기준: 의도의 핵심 산출물이 코드에 실재하고 완료 기준을 충족할 때만 satisfied=true.',
    '조금이라도 빠졌거나 코드에서 확인 불가하면 satisfied=false(미완의 false-PASS 는 금물).',
    'satisfied=true 면 evidence 에 근거를 파일/심볼(가능하면 file:line)로 구체 인용하라.',
    'satisfied=false 면 missing 에 무엇이 빠졌는지 한 줄로.',
    'JSON 한 줄만 출력: {"satisfied":true|false,"evidence":"...","missing":"..."}',
    '',
    `## 페이즈 의도\n${intent.slice(0, 1200)}`,
    '',
    `## 완료 기준(acceptance)\n${acceptance.length ? acceptance.map((c, i) => `${i + 1}. ${c}`).join('\n') : '(명시 없음)'}`,
    '',
    `## grounding(관련 파일)\n${groundContext.slice(0, 800)}`,
    '',
    `## 실제 코드\n${code.slice(0, 8000)}`,
  ].join('\n');
}


/** LLM 출력 → NoopVerdict. JSON 파싱 실패/애매 → satisfied=false(보수적). grounded 는 호출측이 세팅. 순수. */
export function parseNoopVerdict(raw: string): NoopVerdict {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { satisfied: false, evidence: '', missing: '판정 파싱 실패(보수적 미충족)', grounded: false };
    const o = JSON.parse(m[0]) as { satisfied?: unknown; evidence?: unknown; missing?: unknown };
    const satisfied = o.satisfied === true;
    return {
      satisfied,
      evidence: typeof o.evidence === 'string' ? o.evidence.slice(0, 400) : '',
      missing: typeof o.missing === 'string' ? o.missing.slice(0, 400) : (satisfied ? '' : '미상'),
      grounded: false,
    };
  } catch {
    return { satisfied: false, evidence: '', missing: '판정 파싱 오류(보수적 미충족)', grounded: false };
  }
}

/** 페이즈 의도가 이미 코드에 충족됐는지 grounded 검증. 실패 반환 직전 "한 번 더 거르기".
 *  fail-soft — grounding/LLM/파싱 오류는 전부 satisfied=false(보수적·false-PASS 금지). */
export async function verifyPhaseAlreadySatisfied(
  intent: string, acceptance: string[], deps: NoopVerifyDeps = {},
): Promise<NoopVerdict> {
  try {
    const repoRoot = deps.repoRoot ?? process.cwd();
    // ★ 적응형 디깅(2026-07-14) — 얕은 단발 대신 상황 따라 판다. deps.ground/readFiles 주입(테스트·커스텀)
    //   시엔 얕은 경로 보존(하위호환). 프로덕션은 adaptiveGround 로 skim→read→git→verify.
    let context: string;
    let groundedReal: boolean;
    if (deps.ground || deps.readFiles) {
      const g = await (deps.ground ?? groundMissionInCodebase)(intent);
      const files = [...new Set([...(deps.seedFiles ?? []), ...g.files])];
      if (files.length === 0) return { satisfied: false, evidence: '', missing: '관련 코드 미발견(grounding 실패) — 자동 확증 불가', grounded: false };
      context = (deps.readFiles ?? defaultReadFiles)(files, repoRoot);
      groundedReal = files.some(isImplementationFile);
    } else {
      const ag = deps.adaptiveGround ?? ((q, c) => adaptiveGround(q, c, { repoRoot }));
      const r = await ag(intent, { seedFiles: deps.seedFiles, acceptance });
      context = r.context;
      groundedReal = r.grounded;
    }
    if (!context.trim()) return { satisfied: false, evidence: '', missing: '근거 코드 미확보 — 자동 확증 불가', grounded: false };
    const classify = deps.classify ?? defaultClassify;
    const raw = await classify(buildVerifyPrompt(intent, acceptance, '', context));
    return { ...parseNoopVerdict(raw), grounded: groundedReal };
  } catch {
    return { satisfied: false, evidence: '', missing: '검증 오류(fail-soft·보수적 미충족)', grounded: false };
  }
}
