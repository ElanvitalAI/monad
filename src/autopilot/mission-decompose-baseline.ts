// ── 증분 재분해(incremental redecompose) baseline 재사용/무효화 (대표 2026-07-21) ──────────────
//
// 문제(audit): 재분해 sol 이 이전 분해 전체를 baseline 으로 안 받아 매번 처음부터 전체 재생성한다
// (130~223초 reasoning). 요약 1-2줄만 능동회상하므로 sol 이 baseline 없이 전부 다시 만든다.
//
// 설계: 재분해(revise/narrow-redecompose) 시 이전 분해 전체(아크 + 페이즈 + preflightVerdict)를
// objective 에 별도 섹션으로 주입해 "증분 수정"을 지시 → sol reasoning·시간 단축.
//
// ★ invalidate(대표 최우선 강조 — 놓치면 mirage 답습·오분해) : baseline 재사용은 **엄격한 조건**에서만.
//   하나라도 어긋나면 baseline 폐기 → 전체 재분해 폴백. 무효화 트리거:
//     (a) redesign — 전제 전환(reviseContext 가 골 자체를 바꿈)          → 폐기
//     (b) 골 텍스트 변경(goalHash 불일치·maturity-split 골 범위 축소 포함) → 폐기
//     (c) --fresh — 진짜 리셋                                            → 폐기
//     (d) 이전 분해 없음/손상(페이즈 0)                                  → 폐기
//     (e) grounded 파일 스코프 SHA 변경(전제 무효·기존 grounding invalidate 신호 존중) → 폐기
//   기본 OFF(config `autopilot.incrementalRedecompose`) — opt-in. 미설정=종전 전체 재생성(무회귀).
//
// 순수 판정(decideBaselineReuse)·순수 포맷(formatBaselineSection)은 단위테스트. fingerprint I/O
// (load/save)는 seam(미션 디렉토리 sidecar·fail-soft·비파괴).

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { monadStateRoot } from './state-paths.js';

/** 이전 분해 아크 뷰(baseline 섹션 렌더용·순수). */
export interface BaselineArcView {
  name: string;
  intent?: string;
  phaseTitles: readonly string[];
  /** grounded pre-flight 판정 — mirage/over_scope 는 "전제가 틀렸으니 반드시 교정" 대상. */
  verdict?: 'founded' | 'mirage' | 'over_scope';
  reason?: string;
  action?: 'keep' | 'narrow' | 'descope' | 'merge';
}

/** 이전 분해 페이즈 뷰(아크 미분류 폴백·flat). */
export interface BaselinePhaseView { title: string; acceptance: readonly string[] }

/** 이전 분해 전체 baseline(재사용 주입 재료). */
export interface DecompBaseline {
  arcs: readonly BaselineArcView[];
  /** 아크 미분류(flat) 페이즈 — arcs 비었을 때만 사용. */
  phases: readonly BaselinePhaseView[];
  phaseCount: number;
}

/** baseline 유효성 지문(무효화 판정 근거) — 분해 성공 시 저장, 재분해 시 비교. */
export interface BaselineFingerprint {
  /** 분해 시점 골 해시(hashGoal). 골 변경 감지. */
  goalHash: string;
  /** 분해 시점 grounded 파일 스코프 SHA(filesScopeSha). 전제 파일 변경 감지. */
  groundingFilesSha: string;
  at: string;
  generation?: number;
}

/** decideBaselineReuse 입력 신호(전부 호출측이 조립·순수 판정). */
export interface BaselineReuseSignals {
  /** config autopilot.incrementalRedecompose(기본 OFF). false 면 항상 no-reuse. */
  enabled: boolean;
  /** revise/narrow-redecompose 맥락(reviseContext=comment 존재). 재분해가 아니면 no-reuse. */
  hasReviseContext: boolean;
  /** redesign(전제 전환) 재-spawn → 무효(a). */
  redesign: boolean;
  /** --fresh(진짜 리셋) → 무효(c). */
  fresh: boolean;
  /** 이전 분해 페이즈 수(store). 0 → 무효(d). */
  baselinePhaseCount: number;
  /** 저장된 지문(없으면 null → 무효·첫 분해엔 지문 없음). */
  fingerprint: BaselineFingerprint | null;
  /** 현재 골 해시. fingerprint.goalHash 와 불일치 → 무효(b). */
  currentGoalHash: string;
  /** 현재 grounded 파일 스코프 SHA. fingerprint.groundingFilesSha 와 불일치 → 무효(e). */
  currentGroundingFilesSha: string;
}

export interface BaselineReuseDecision { reuse: boolean; reason: string }

/**
 * baseline 재사용 판정(순수·대표 최우선 강조=invalidate 놓치지 말 것). 재사용은 모든 조건 충족 시에만:
 *   enabled + revise 맥락 + !redesign + !fresh + 이전 분해 존재(≥1) + 지문 존재 + 골 동일 + grounded SHA 동일.
 * 하나라도 어긋나면 폐기(전체 재분해). reason 은 관측(baseline-reuse|baseline-invalidate)에 남긴다.
 */
export function decideBaselineReuse(s: BaselineReuseSignals): BaselineReuseDecision {
  if (!s.enabled) return { reuse: false, reason: 'disabled(config autopilot.incrementalRedecompose 미설정)' };
  if (!s.hasReviseContext) return { reuse: false, reason: 'no-revise-context(신규/일방 분해 — baseline 무관)' };
  if (s.redesign) return { reuse: false, reason: 'redesign(전제 전환 — baseline 폐기)' };
  if (s.fresh) return { reuse: false, reason: 'fresh(진짜 리셋 — baseline 폐기)' };
  if (s.baselinePhaseCount < 1) return { reuse: false, reason: 'no-baseline(이전 분해 없음/손상)' };
  if (!s.fingerprint) return { reuse: false, reason: 'no-fingerprint(지문 없음 — 안전 재분해)' };
  if (s.currentGoalHash !== s.fingerprint.goalHash) return { reuse: false, reason: 'goal-changed(골 텍스트/범위 변경·maturity-split)' };
  // grounded 파일 스코프 SHA 불일치 → 전제 무효(기존 grounding invalidate 신호 존중). 빈 SHA(git 실패)도 불일치로 안전 폐기.
  if (!s.currentGroundingFilesSha || s.currentGroundingFilesSha !== s.fingerprint.groundingFilesSha) {
    return { reuse: false, reason: 'grounding-sha-changed(전제 파일 변경/미상 — baseline 폐기)' };
  }
  return { reuse: true, reason: 'reuse(revise·골 동일·파일 SHA 동일·지문 유효)' };
}

/**
 * baseline 섹션 렌더(순수) — objective 에 주입할 "## 이전 분해(baseline)" 블록. 아크가 있으면 아크별
 * (verdict 포함) 로, 없으면 flat 페이즈로. mirage/over_scope 아크는 "전제 교정 필수" 로 명시(답습 방지).
 * maxChars 상한(slice)으로 토큰 폭증 방지 — reasoning 감소로 순 시간 단축이 목표.
 */
export function formatBaselineSection(baseline: DecompBaseline, maxChars = 2000): string {
  const lines: string[] = [];
  lines.push('## 이전 분해 (baseline — 아래를 기준으로 증분 수정하라. 전체를 처음부터 새로 만들지 마라)');
  const flagged: string[] = [];
  if (baseline.arcs.length) {
    baseline.arcs.forEach((a, i) => {
      const bad = a.verdict && a.verdict !== 'founded';
      const tag = bad ? ` [전제 ${a.verdict}=반드시 교정]` : '';
      lines.push(`아크 ${i + 1}. ${a.name}${tag}`);
      if (a.intent) lines.push(`   의도: ${a.intent}`);
      if (bad && a.reason) { lines.push(`   ⚠ 잘못된 전제: ${a.reason}`); flagged.push(a.name); }
      for (const t of a.phaseTitles) lines.push(`   - ${t}`);
    });
  } else if (baseline.phases.length) {
    baseline.phases.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.title}`);
      if (p.acceptance.length) lines.push(`   검증: ${p.acceptance.slice(0, 3).join(' · ')}`);
    });
  }
  lines.push('');
  lines.push('★ 증분 지시(반드시 준수):');
  if (flagged.length) {
    lines.push(`- 전제가 틀렸다고 표시된 아크(${flagged.join(', ')})는 그 전제를 올바른 진입점/대상으로 반드시 교정하라(이전 분해를 그대로 답습 금지).`);
  }
  lines.push('- founded(정상) 아크와 그 페이즈는 유지·미세조정하고, 지적된 부분만 고쳐라. 정상 부분을 통째로 재생성하지 마라.');
  const out = lines.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(baseline 축약)` : out;
}

// ── fingerprint I/O seam(fail-soft·미션 sidecar) ────────────────────────────────
export function baselineFingerprintPath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return join(monadStateRoot(), 'conatus/missions', safe, 'decompose-baseline.json');
}

/** 분해 성공 시 지문 저장(다음 재분해 무효화 비교용). fail-soft. */
export function saveBaselineFingerprint(missionId: string, fp: BaselineFingerprint): void {
  try {
    const p = baselineFingerprintPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(fp));
  } catch { /* fail-soft — 지문 미저장 시 다음 재분해가 안전 폐기(전체 재분해) */ }
}

/** 지문 조회 — 없거나 깨졌으면 null(→ 재사용 안 함·안전). 순수 조회. */
export function loadBaselineFingerprint(missionId: string): BaselineFingerprint | null {
  try {
    const p = baselineFingerprintPath(missionId);
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o !== 'object' || typeof o.goalHash !== 'string' || typeof o.groundingFilesSha !== 'string') return null;
    return { goalHash: o.goalHash, groundingFilesSha: o.groundingFilesSha, at: String(o.at ?? ''), ...(typeof o.generation === 'number' ? { generation: o.generation } : {}) };
  } catch { return null; }
}

/** 지문 삭제(fresh/rerun 리셋 시). fail-soft. */
export function invalidateBaselineFingerprint(missionId: string): boolean {
  try {
    const p = baselineFingerprintPath(missionId);
    if (!existsSync(p)) return false;
    rmSync(p);
    return true;
  } catch { return false; }
}
