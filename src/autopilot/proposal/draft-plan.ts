// ── Self-Evolution SE2 · 플랜 초안 생성기 (2026-07-09) ─────────────────────
//
// 대표: "큰 기능 단위로 알아서 생각하고, elanous 우선순위를 보며 신규 피처 플랜을 제안하라.
// 승인받으면 별도로 구현." 발굴(SE1 내부 미구현 / 외부 흡수 후보)을 신규 피처 PLAN 문서
// 초안으로. 대표가 읽고 승인/기각(SE2 큐). 승인 시 SE4 야간 러너 입력.
//
// 결정론 템플릿(발굴 데이터 채움) + LLM 심화는 seam(주입·선택). 순수 함수.

export interface ProposalSeed {
  slug: string;              // kebab (파일명·id)
  title: string;
  source: 'internal-roadmap' | 'external-repo' | 'preexisting-red';
  rationale: string;         // 왜 지금 이 기능인가(elanous 우선순위 관점)
  evidence: string[];        // 근거 refs(doc 경로·repo 영역·커밋 메시지)
  tier: 'light' | 'heavy';
  /** 큰 기능 단위 범위 스케치(있으면). */
  scopeSketch?: string[];
}

/** PLAN 초안 markdown — 내부 문서 `PLAN-<slug>-draft` 본문. */
export function buildPlanDraft(seed: ProposalSeed): string {
  const sourceLabel = seed.source === 'internal-roadmap' ? '내부 미구현 로드맵(1순위)'
    : seed.source === 'external-repo' ? '외부 참조 repo 흡수(2순위)'
    : 'gate.baseline preexisting 빨강';
  const L: string[] = [];
  L.push(`# PLAN(초안) · ${seed.title}`);
  L.push('');
  L.push(`> ⚠️ Self-Evolution SE2 자동 제안 초안. 대표 승인 전 구현 금지(승인 큐 대기).`);
  L.push(`> 출처: ${sourceLabel} · tier: ${seed.tier === 'heavy' ? '무거움' : '가벼움'} · slug: ${seed.slug}`);
  L.push('');
  L.push('## 왜 (rationale)');
  L.push(seed.rationale);
  L.push('');
  L.push('## 근거 (evidence)');
  for (const e of seed.evidence) L.push(`- ${e}`);
  L.push('');
  L.push('## 범위 (큰 기능 단위)');
  if (seed.scopeSketch && seed.scopeSketch.length) {
    for (const s of seed.scopeSketch) L.push(`- [ ] ${s}`);
  } else {
    L.push('- [ ] (승인 시 SE4 러너가 플랜을 구체화하며 채움)');
  }
  L.push('');
  L.push('## 안전·경계');
  L.push('- 격리 worktree + 별 데몬(정식 :31415 무오염) 에서만 구현.');
  L.push('- 불변 코어(매매·재부팅·안전·arming) 수정 금지.');
  L.push('- 구현 후 무결성 게이트(bun test·build·nexus build) green → PR 초안(merge HITL).');
  L.push('');
  L.push(`*자동 생성 · ${seed.source} · 대표 승인(SE2 큐) 후 SE4 격리 구현.*`);
  return L.join('\n');
}

/** 발굴 → seed slug 안전화(파일명용). */
export function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'proposal';
}
