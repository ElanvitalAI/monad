// ── R3 시스템 소스 룩백 (진단 해상도 사다리) ───────────────────────────────
//
// R2 모순 감지(contradiction-detector)가 "시스템 의심"을 켜면, R3 는 격리 밖에서 mission-system
// 소스를 READ-ONLY 로 조사해 근본을 규명한다. 대표 지시(2026-07-13): "확신 없으면 소스 구조까지
// 가서 시스템을 의심·조사 · 주어진 정보만이 아니라 시스템 자체를 의심".
//
// 수정 권한 없음(대표 결정): "어디가 왜 결함이다 + 수정 후보"만 보고, 실 수정은 HITL. 이 모듈은
// 순수(의심 소스 매핑 + 프롬프트 빌더) — 실제 LLM 조사·소스 read 는 배선측(run-mission)이 수행.

import type { ContradictionKind, ContradictionSignal } from './contradiction-detector.js';

/** 모순 종류 → 의심 소스 파일(그 모순을 만들 수 있는 코드 경로). 순수·결정론. */
const SUSPECT_SOURCES: Record<ContradictionKind, string[]> = {
  'files-touched-but-empty-diff': [
    'src/autopilot/build/nocturnal-deps.ts',    // diff 캡처(git diff HEAD·untracked 포함)
    'src/autopilot/build/isolated-instance.ts', // worktree base(페이즈 스택)
    'scripts/run-mission.ts',                   // 페이즈 순회·baseBranch 전파
  ],
  'tests-pass-but-critique-fail': [
    'src/autopilot/mission-critique.ts',        // 비평 입력·판정 기준
    'src/autopilot/build/nocturnal-deps.ts',    // critique 에 넘기는 diff/changedFiles
  ],
  'diff-body-absent': [
    'src/autopilot/build/nocturnal-deps.ts',    // diff 본문 캡처
    'src/autopilot/mission-critique.ts',        // 비평 프롬프트에 diff 싣기
  ],
};

/** 감지된 모순들이 가리키는 의심 소스 파일 집합(중복 제거·순서 보존). */
export function suspectSourceFiles(signals: readonly ContradictionSignal[]): string[] {
  const seen = new Set<string>();
  for (const s of signals) for (const f of SUSPECT_SOURCES[s.kind] ?? []) seen.add(f);
  return [...seen];
}

/** R3 소스 룩백 프롬프트 — 모순 + 실패 컨텍스트 + 소스 발췌를 주고 "시스템 결함인가?"를 능동
 *  조사시킨다. READ-ONLY(수정 금지·보고만). ASCII+한글(agent 정책·특수문자 truncation 회피). */
export function buildLookbackPrompt(input: {
  phaseTitle: string;
  signals: readonly ContradictionSignal[];
  sourceExcerpts: { file: string; content: string }[];
}): string {
  const lines = [
    'You are a system-fault diagnostician for the elanous mission fabric. READ-ONLY: 코드를 수정하지 말고 진단만 하라.',
    '',
    `실패 페이즈: ${input.phaseTitle}`,
    '',
    '## 감지된 모순 (게이트 입력 vs 판정 불일치 — 시스템 결함 의심)',
    ...input.signals.map((s) => `- [${s.kind}] ${s.detail}`),
    '',
    '## 의심 소스 (이 모순을 만들 수 있는 코드 경로)',
    ...input.sourceExcerpts.map((e) => `### ${e.file}\n${e.content.slice(0, 4000)}`),
    '',
    '## 지시',
    '이 모순의 근본이 위 소스에 있는지 조사하라. 페이즈 산출물이 실제로 유효한데 시스템(캡처/전파/',
    '비평)이 잘못 판정한 것인가? 다음을 한국어로 간결히 출력하라:',
    '1. 시스템 결함 여부 (예/아니오 + 근거)',
    '2. 결함이면 정확한 위치 (파일:라인) 와 왜',
    '3. 수정 후보 (구체적/최소 · 실 수정은 하지 말 것)',
    '주어진 정보만이 아니라 소스 자체를 의심하라. 확신이 없으면 "불확실" 과 추가 확인 지점을 남겨라.',
  ];
  return lines.join('\n');
}
