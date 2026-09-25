// ── 미션 산출물 규율(artifact-first) — 조사 페이즈 예산 소진 근본 대응(대표 2026-07-13) ──
//
// 근본(P2 실측): 조사 에이전트가 서술을 장황하게 뽑아 출력 예산을 소진하고, 필수 산출물
// (.artifacts/investment-deep-research.json)을 저장하지 못해 acceptance 미충족. 예산을
// 128k->256k->512k 4배 올려도 반복 실패 — 예산이 클수록 서술 공간만 늘어 오히려 역효과.
//
// 대응(예방): artifactFirstInstruction — 필수 산출물 뼈대를 "먼저" 저장하고 항목마다 append,
// 서술은 항목당 2-3문장으로 제한. 예산이 소진돼도 부분 산출물이 디스크에 남는다.
// (판별): extractRequiredArtifacts — 적응형 재시도 triage(후속 PR)가 "규율 실패(산출물
// 없음+장황) vs 진짜 예산 부족"을 결정론 신호로 가르는 근거. 순수함수·부수효과 없음.
//
// PLAN: 적응형 재시도 triage(2번째 실패부터 LLM 관찰->동적 예산/전략). run-mission walker 배선.

import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// 필수 산출물 경로 패턴 — .artifacts/ 하위 파일 참조를 지시/acceptance 텍스트에서 추출.
// 확장자 화이트리스트로 산문 내 우연한 매치를 방지(문장 부호가 뒤따라도 확장자에서 끊김).
const ARTIFACT_RE = /\.artifacts\/[A-Za-z0-9._-]+\.(?:json|jsonl|ndjson|md|csv|txt)/g;

/** 지시/acceptance 텍스트에서 선언된 필수 산출물 경로를 추출(중복 제거·등장 순서 보존). 순수·정규식. */
export function extractRequiredArtifacts(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(ARTIFACT_RE)) {
    const p = m[0];
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

/** artifact-first 규율 지시문 — 필수 산출물이 있을 때만 프롬프트에 주입(대표 2026-07-13).
 *  예산 소진 근본(장황) 예방: 뼈대를 먼저 저장하고 append, 서술 최소화. 필수 산출물이
 *  없으면 빈 문자열(주입 없음). 순수함수·ASCII+한글만(에이전트 프롬프트 truncation 방지). */
export function artifactFirstInstruction(paths: string[]): string {
  if (!paths.length) return '';
  const list = paths.join(', ');
  return [
    '',
    '[산출물 우선(artifact-first) 규율 · 대표 지시]',
    `이 페이즈의 필수 산출물: ${list}`,
    '예산 소진으로 실패하지 않도록 반드시 이 순서로 하라:',
    '1) 조사 착수 직후, 필수 산출물 파일에 최소 스키마 뼈대(빈 배열/필드)를 먼저 저장하라.',
    '2) 각 항목을 조사할 때마다 그 파일에 append/갱신하라(끝에 한 번에 몰아쓰지 말 것).',
    '3) 서술 설명은 항목당 2-3문장으로 제한하라 — 장황한 산문이 예산을 소진한다.',
    '4) VERDICT PASS 전에 그 파일을 실제로 읽어 저장을 확인하고, 경로를 보고에 인용하라.',
    '산출물 파일이 디스크에 없으면 acceptance 미충족(VERDICT FAIL)이다.',
  ].join('\n');
}

/** 시도 후 산출물 상태 — 존재/크기. 적응형 재시도 triage(후속)의 결정 신호:
 *  존재X + 장황한 서술 = 규율 실패(예산 아님) · 부분 존재(size>0) + 미충족 = 진짜 부족. */
export interface ArtifactState { path: string; exists: boolean; sizeBytes: number }

/** 시도 후 필수 산출물의 디스크 존재/크기 확인 — 규율실패 vs 진짜부족을 가르는 결정론 신호.
 *  statFn 은 DI(테스트용); 기본은 node:fs statSync(cwd 기준 상대경로 해석). 항상 non-throw. */
export function checkArtifactExistence(
  paths: string[],
  deps: { cwd: string; statFn?: (abs: string) => { size: number } | null },
): ArtifactState[] {
  const statFn = deps.statFn ?? ((abs) => { try { return { size: statSync(abs).size }; } catch { return null; } });
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : join(deps.cwd, p);
    const st = statFn(abs);
    return { path: p, exists: st !== null, sizeBytes: st?.size ?? 0 };
  });
}
