// ── 모순 감지기 (Contradiction Detector) — 진단 해상도 사다리 R2 진입점 ──────────
//
// 대표 지시(2026-07-13): 진단이 "주어진 정보(게이트 사유)"로만 "미완" 결론 내지 말고, 게이트
// 입력과 판정 사이의 **모순**을 감지해 "시스템 자체를 의심"하게 한다. 이번 dogfood(price-guard
// 페이즈0/2)의 근본은 "변경 파일은 있는데 diff 본문이 비어 검증 불가 FAIL"이라는 모순이었고,
// 시스템은 이를 못 읽고 "과대→분할"로 오진했다. 이 감지기가 그 모순을 1급 신호로 승격한다.
//
// systemSuspect=true 신호가 하나라도 있으면, 해상도를 **예산 축(재시도)이 아니라 조사 축**으로
// 올려야 한다: 자기 산출물 대조 → 게이트 입력 검사 → mission system 소스 룩백(R3). 순수·결정론.

export type ContradictionKind =
  | 'files-touched-but-empty-diff'   // changedFiles>0 인데 diff 본문 빈 = 캡처/전파 결함
  | 'tests-pass-but-critique-fail'   // 무결성 통과인데 비평 FAIL = 판정 불일치
  | 'diff-body-absent';              // 비평 사유가 "diff 본문 없음"인데 변경은 인지

export interface ContradictionSignal {
  kind: ContradictionKind;
  systemSuspect: true;
  detail: string;
}

export interface GateInputs {
  /** 게이트가 인식한 변경 파일 목록(porcelain·노이즈 제외 후). */
  changedFiles?: readonly string[];
  /** 비평에 실제로 전달된 diff 본문. */
  diffBody?: string;
  /** 무결성 게이트(bun test) 통과 여부. */
  testsPassed?: boolean;
  /** 자동 비평 판정. */
  critiqueVerdict?: 'pass' | 'fail';
  /** 실패 사유 텍스트(비평 findings·next). */
  failText?: string;
}

/** 게이트 입력 ↔ 판정 불일치(시스템 결함 의심)를 감지. 순수·결정론.
 *  "주어진 정보로만 미완 결론"을 내던 진단이 시스템 자체를 의심하도록 하는 진입점(R2). */
export function detectContradictions(g: GateInputs): ContradictionSignal[] {
  const out: ContradictionSignal[] = [];
  const files = g.changedFiles ?? [];
  const diff = (g.diffBody ?? '').trim();
  const failText = g.failText ?? '';

  // ① 변경 파일은 있는데 diff 본문이 비었다 = 캡처/전파 결함(price-guard 페이즈0 근본).
  //    git diff HEAD 가 untracked 새 파일을 누락했거나, 페이즈 스택 base 가 이전 산출물을
  //    포함 못한 경우. 예산/모델 증액으로 안 풀린다.
  if (files.length > 0 && diff.length === 0) {
    out.push({
      kind: 'files-touched-but-empty-diff', systemSuspect: true,
      detail: `변경 파일 ${files.length}건 있으나 diff 본문 0 — 캡처/전파 결함 의심(diff 가 untracked 누락? 페이즈 스택 base 미포함?). 예산 증액 무의미, 시스템 소스 룩백 필요.`,
    });
  }

  // ② 무결성(테스트) 통과인데 비평 FAIL = 판정 기준/입력 불일치.
  if (g.testsPassed === true && g.critiqueVerdict === 'fail') {
    out.push({
      kind: 'tests-pass-but-critique-fail', systemSuspect: true,
      detail: '무결성 테스트 통과인데 비평 FAIL — 비평 입력/기준 불일치 의심(비평이 본 diff 가 실제와 다른가?).',
    });
  }

  // ③ 비평 사유가 "diff 본문 없음/제공되지 않아"인데 변경 파일은 인지 = 본문 미전달(캡처 결함).
  if (files.length > 0 && /diff\s*본문[이]?\s*(없|제공되지)|본문이\s*제공되지\s*않|실제\s*diff\s*(내용|본문)이?\s*(없|제공되지)/i.test(failText)) {
    out.push({
      kind: 'diff-body-absent', systemSuspect: true,
      detail: '비평이 "diff 본문 없음"으로 검증 불가 판정 — 변경은 있으나 본문 미전달(시스템 캡처 결함). 산출물 존재 여부부터 재확인.',
    });
  }

  return out;
}

/** 모순 신호가 하나라도 있으면 "시스템 의심" — 재시도(예산)가 아니라 조사 해상도를 올려야 한다. */
export function hasSystemSuspect(g: GateInputs): boolean {
  return detectContradictions(g).length > 0;
}

const CONTRADICTION_KINDS: readonly ContradictionKind[] = [
  'files-touched-but-empty-diff', 'tests-pass-but-critique-fail', 'diff-body-absent',
];

/** ★ 셀프힐 배선(대표 2026-07-13) — 모순 신호를 task.notes 영속 포맷으로. escalate 버튼은 나중에
 *  탭되므로(콜백은 64byte), 실패 시점의 신호를 `[SUSPECT:kind] detail` 로 남겨 escalate 핸들러가
 *  그대로 복원(diffSummary 는 재구성 불가라 post-hoc 재감지 불가·저장이 유일한 경로). 순수. */
export function renderSuspectNotes(signals: readonly ContradictionSignal[]): string[] {
  return signals.map((s) => `[SUSPECT:${s.kind}] ${s.detail}`);
}

/** notes → 모순 신호 복원(`[SUSPECT:kind] detail`). 알 수 없는 kind 는 skip. 순수·역파싱. */
export function parseSuspectNotes(notes: readonly string[]): ContradictionSignal[] {
  const out: ContradictionSignal[] = [];
  for (const n of notes) {
    const m = /^\[SUSPECT:([\w-]+)\]\s*(.*)$/s.exec(n);
    if (!m) continue;
    const kind = CONTRADICTION_KINDS.find((k) => k === m[1]);
    if (!kind) continue;
    out.push({ kind, systemSuspect: true, detail: (m[2] ?? '').trim() });
  }
  return out;
}

/** 진단 narrative 에 실을 시스템 의심 요약(없으면 빈 문자열). */
export function renderSystemSuspect(g: GateInputs): string {
  const sigs = detectContradictions(g);
  if (sigs.length === 0) return '';
  return `🔬 시스템 결함 의심(모순 ${sigs.length}건) — ${sigs.map((s) => s.detail).join(' / ')}`;
}
