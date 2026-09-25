// ── Self-Evolution SE2 · 로드맵 → 멀티페이즈 플랜 (기존 TOX 재사용·2026-07-11) ──
//
// 발굴된 미구현 로드맵을 monad 정식 TOX 분해(TaskGenerator.decompose·dependsOn 그래프·
// acceptance 검증·재귀·비용)로 "검토 가능한 멀티페이즈 플랜"으로 렌더. 새 분해기 금지.
// 프롬프트는 4대 에이전트 보강본(generator-prompt.ts·[[RESEARCH-multiphase-decomposition-4agents]]).
//
// 비용 주의: decompose 는 LLM 1콜(~$6). 발굴 크론 기본은 template(비용0), --decompose 시만 심화.
// 순수 렌더 + 주입 decomposer(seam·테스트/비용 격리).

import type { DecomposeProposal } from '../../task-orchestrator/generator-schema.js';
import type { ProposalSeed } from './draft-plan.js';

/** 로드맵 텍스트 → TOX decompose 호출(주입). null = 실패(호출측 fallback). */
export type RoadmapDecomposer = (objective: string, roadmapPath: string) => Promise<DecomposeProposal | null>;

/** 로드맵 본문에서 미완 체크박스 추출(분해 objective 컨텍스트). */
export function extractOpenItems(roadmapText: string, limit = 20): string[] {
  return roadmapText.split('\n')
    .filter(l => /^\s*[-*]\s*\[ \]/.test(l))
    .map(l => l.trim().replace(/^[-*]\s*\[ \]\s*/, ''))
    .slice(0, limit);
}

/** 발굴 seed + 로드맵 본문 → decompose objective 프롬프트. */
export function buildRoadmapObjective(seed: ProposalSeed, roadmapText: string): string {
  const openItems = extractOpenItems(roadmapText);
  const title = (roadmapText.match(/^#\s*(.+)$/m)?.[1] ?? seed.title).trim();
  return [
    `내부 미구현 로드맵 "${title}"을 monad 에 구현한다.`,
    `근거: ${seed.rationale}`,
    `미완 항목 ${openItems.length}개(발췌):`,
    ...openItems.map((it, i) => `  ${i + 1}. ${it}`),
    '',
    '위 로드맵을 실행 가능한 멀티페이즈 태스크로 분해하라. 각 태스크는 검증 가능(acceptance)하고,',
    '건드릴 파일과 재사용할 기존 함수를 description 에 명시하며, dependsOn 으로 순서를 표현하라.',
  ].join('\n');
}

/** TOX DecomposeProposal → 멀티페이즈 플랜 markdown(대표 검토·SE4 입력). */
export function renderPhasedPlanMarkdown(seed: ProposalSeed, proposal: DecomposeProposal): string {
  const L: string[] = [];
  L.push(`# PLAN(멀티페이즈) · ${seed.title}`);
  L.push('');
  L.push('> ⚠️ Self-Evolution 자동 제안(TOX 분해). 대표 승인 전 구현 금지.');
  L.push(`> 출처: ${seed.source === 'internal-roadmap' ? '내부 미구현 로드맵(1순위)' : '외부 참조 repo(2순위)'} · 페이즈 ${proposal.tasks.length}개`);
  L.push('');
  L.push('## 분해 근거');
  L.push(proposal.rationale);
  L.push('');
  L.push('## 페이즈 (의존성 그래프)');
  for (const t of proposal.tasks) {
    const deps = t.dependsOn?.length ? ` ← 의존[${t.dependsOn.join(', ')}]` : ' (독립·병렬 가능)';
    L.push(`### [${t.index}] ${t.title}${deps}`);
    L.push(`- 실행: ${t.surface.kind} · 우선순위: ${t.priority ?? 'medium'}${t.estimateUsd ? ` · ~$${t.estimateUsd}` : ''}`);
    if (t.description) L.push(`- ${t.description}`);
    if (t.acceptance?.criteria?.length) {
      L.push('- 검증(acceptance):');
      for (const c of t.acceptance.criteria) L.push(`  - [ ] ${c}`);
    }
    const checks = t.acceptance?.checks?.map(c => c.kind).join(', ');
    if (checks) L.push(`- 결정론 체크: ${checks}`);
    L.push('');
  }
  L.push('## 안전·경계');
  L.push('- 격리 worktree + disarmed config(정식 무오염). 불변 코어 수정 금지.');
  L.push('- 각 페이즈 무결성 게이트(bun test) green → 다음 페이즈. merge HITL.');
  L.push('');
  L.push(`*자동 생성(TOX 분해·재사용) · 대표 승인 후 SE4 격리 구현.*`);
  return L.join('\n');
}

/** 로드맵 → 멀티페이즈 플랜 markdown(decompose 성공 시) 또는 null(호출측 template fallback). */
export async function decomposeRoadmapToPlan(
  seed: ProposalSeed,
  roadmapText: string,
  roadmapPath: string,
  decompose: RoadmapDecomposer,
): Promise<string | null> {
  try {
    const proposal = await decompose(buildRoadmapObjective(seed, roadmapText), roadmapPath);
    if (!proposal || !proposal.tasks.length) return null;
    return renderPhasedPlanMarkdown(seed, proposal);
  } catch { return null; }
}
