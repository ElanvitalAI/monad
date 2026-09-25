// 하니스 도메인 executor 프리셋 — objective 유형별 실행 레시피 (트랙 R2 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion §트랙 R2: "objective 유형별 레시피 — fan-out(투자=market+kr-flow+
// apify-X 병렬)+chain(크롤→보고서→배포)". 도메인은 **명시 `domain` 파라미터**로 선택(자동 텍스트분류 대신
// 명시 = 오라우팅 방지 — 코드 골이 'market' 을 언급해도 오작동 안 함). 프리셋 = X1 skill executor
// (buildSkillDomainExecute) 설정(고정 skill 세트 fan-out 또는 chain 스텝). 미지정/미매칭 → null(코드
// executor·무회귀·안전).
// 이 파일은 전달된 domain 문자열만 보고 executor를 선택한다.
//
// ⚠️ X3 규율: 프리셋은 read-only 수집/리포트까지(allowlist={omni-market,kr-flow,omni-digest}·격리 실행).
//    투자 "집행"(주문·송금)은 여기 없다 — 별도 HITL·금액한도·자동집행 금지([[feedback_signal_wiring_via_mission]]).

import { buildSkillDomainExecute, type DomainExecute, type SkillExecutorOpts } from './skill-executor.js';
import { buildWebDomainExecute, defaultWebPublish } from './web-executor.js';   // ★ 웹 게시 전용 executor
import { buildGenericSkillExecute, defaultGenericSkill } from './generic-skill-executor.js';   // ★ 수습 P0 범용 스킬 executor
import { debug } from '../debug/log.js';

/** 도메인 프리셋 레지스트리 — 도메인명 → skill executor 설정. 모든 skill 은 allowlist 내(격리·read-only). */
export const DOMAIN_PRESETS: Record<string, SkillExecutorOpts> = {
  // 투자 리서치 — 시장 데이터 + 한국 수급을 병렬(fan-out) 수집해 브리프 리포트(집행 아님).
  invest: { skills: ['omni-market', 'kr-flow'], outputFile: 'investment-brief.md' },
  // 일반 리서치 — luna 픽 fan-out(관련 read-only skill 자동) → 리포트.
  research: { outputFile: 'research-report.md' },
  // 참고자료 요약 — omni-digest(URL/문서) 실행 → 요약 리포트.
  digest: { skills: ['omni-digest'], outputFile: 'digest.md' },
};

export const DOMAIN_PRESET_NAMES = Object.keys(DOMAIN_PRESETS);

/**
 * R2 — 명시 domain 파라미터로 도메인 executor 를 해석. 매칭되면 X1 skill executor(프리셋 설정)를 반환해
 * 하니스 execute 를 코드 implement 대신 skill 실행형으로 라우팅. 미지정/미매칭 → null(코드 executor·무회귀).
 */
export function resolveDomainExecute(domain: unknown): DomainExecute | null {
  if (typeof domain !== 'string' || !domain.trim()) return null;
  const key = domain.trim().toLowerCase();
  // ★ 웹 게시(트랙 X·2026-07-22) — 프리셋(skill fan-out·read-only 격리)과 별개 전용 executor. content-to-web 은
  //   Write 필요·HARNESS_EXEC_ALLOWLIST 밖이라 격리 fan-out 경로 재사용 불가. A3 저위험(실배포 허용·게이트 불필요).
  if (key === 'web' || key === 'publish') {
    try { debug.log('harness.executor', 'domain-web', { domain: key }); } catch { /* fail-soft */ }
    return buildWebDomainExecute({ publish: defaultWebPublish() });
  }
  const preset = DOMAIN_PRESETS[key];
  if (preset) {
    try { debug.log('harness.executor', 'domain-preset', { domain: key, skills: preset.skills ?? 'luna', chain: !!preset.chain }); } catch { /* fail-soft */ }
    return buildSkillDomainExecute(preset);
  }
  // ★ 수습 P0(대표 지적·비확장 하드코딩 탈피) — 프리셋에 안 걸리는 스킬은 **범용 경로**로. `--domain skill`(명시) 또는
  //   임의 도메인 문자열 → luna 발견 top 스킬(Write 허용 실행)→아티팩트. 스킬이 늘어도 시스템 층 수술 불필요.
  //   ⚠️ 'code'/'self' 등 코드 신호는 제외(코드 executor 로 폴백·무회귀). 미래 투자(자동 라우팅·capability tier)=로드맵.
  if (key === 'code' || key === 'self') return null;
  try { debug.log('harness.executor', 'domain-generic-skill', { domain: key }); } catch { /* fail-soft */ }
  return buildGenericSkillExecute(defaultGenericSkill());
}
