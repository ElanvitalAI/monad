// ── Intent Gate — 미션 마커 파서 (Narrow Waist V1 · 2026-07-09) ────────────
//
// 대표 결정(§8): 의도 종류 분류 = **명시 마커만**(결정론·LLM 오탐 0). 마커가 붙은
// 자연어 발화 = 미션 의도. 마커 없으면 기존 동작(chat/agent) passthrough.
// 설계 SoT: 내부 문서 `DESIGN-intent-narrow-waist-2026-07-09` §8 마커 문법.
//
// 채널 무관(텔레그램·PWA·음성 공통) 순수 함수 — 표면은 어댑터, 여기는 허리.

/** ★ 분해 검증 마커(대표 지시 2026-07-11) — 외부조사 보강 + 멀티페이즈 분해 후 HITL 까지만
 *  (작은 골도 강제 분해·실행 없음). 순수 미션 마커보다 먼저 검사(접두가 "미션"으로 겹침). */
const VERIFY_MARKERS = ['미션 분해 검증', '분해 검증', 'decompose 검증', 'mission decompose verify'];
/** 접두 콜론 마커 (대소문자 무시). ★ 미션 과 콜론 사이 공백/전각공백 허용 —
 *  대표 실사례(2026-07-17): "미션 : <골>" 처럼 공백콜론으로 던진 제출이 종전
 *  정확일치("미션:")에 안 걸려 passthrough → chat 으로 샌 사건. 반각/탭/전각공백만
 *  허용(콜론 필수)하므로 "미션 목록 보여줘"(콜론 없음)는 여전히 passthrough(오탐 0). */
const PREFIX_RE = /^(?:미션|mission)[ \t　]*:/i;
/** ★ 첫 줄 단독 마커 — 첫 줄이 정확히 "미션"/"mission" 뿐이면(콜론 없이 줄바꿈) 마커로 인정.
 *  실사례(2026-07-14): 대표가 "미션\n\n<골>" 로 던진 제출이 콜론 부재로 passthrough → 챗
 *  에이전트가 재량 처리(codex 위임 승인 프롬프트)로 새는 사건. 한 줄에 다른 단어가 동반되면
 *  ("미션 목록 보여줘") 여전히 passthrough — 결정론·오탐 0 원칙(§8) 유지. */
const BARE_LINE_MARKERS = ['미션', 'mission'];
/** 문두 구절 마커 — 뒤에 콜론/쉼표/공백 등 구분자 허용. */
const LEADING_PHRASES = ['이건 미션이야', '이거 미션이야', '이건 미션', '이거 미션'];
/** 슬래시 형태 `/mission[@bot] <text>`. */
const SLASH_RE = /^\/mission(?:@[A-Za-z0-9_]+)?\s+([\s\S]*)$/i;

export interface MissionMarker {
  /** 마커가 붙었고 골 텍스트가 비지 않았는가. */
  isMission: boolean;
  /** 마커 제거 후 남은 미션 골(여러 문장 허용). */
  goal: string;
  /** ★ 분해 검증 마커 — 크기 무관 강제 멀티페이즈 분해(리서치 포함) + HITL 까지만(실행 없음). */
  forceDecompose?: boolean;
}

/** 마커 감지·제거 → 미션 골. 마커 없거나 마커 뒤 골이 비면 isMission=false(passthrough). */
export function parseMissionMarker(text: string): MissionMarker {
  const t = (text ?? '').trim();
  if (!t) return { isMission: false, goal: '' };
  const lower = t.toLowerCase();

  // 0) 분해 검증 마커 — 미션: 보다 먼저(접두 "미션" 겹침). 뒤 구분자(콜론/쉼표/공백) 정리.
  for (const v of VERIFY_MARKERS) {
    if (lower.startsWith(v.toLowerCase())) {
      const rest = t.slice(v.length).replace(/^[\s:,.\-·]+/, '');
      const m = finalize(rest);
      return m.isMission ? { ...m, forceDecompose: true } : m;
    }
  }

  // 1) 슬래시 /mission <text>
  const s = SLASH_RE.exec(t);
  if (s) return finalize(s[1] ?? '');

  // 2) 접두 콜론 마커 (미션: / mission: · 미션-콜론 사이 공백 허용)
  const pm = PREFIX_RE.exec(t);
  if (pm) return finalize(t.slice(pm[0].length));

  // 3) 문두 구절 (이건 미션이야 …) — 구분자 정리
  for (const p of LEADING_PHRASES) {
    if (t.startsWith(p)) {
      const rest = t.slice(p.length).replace(/^[\s:,.\-·]+/, '');
      return finalize(rest);
    }
  }

  // 4) 첫 줄 단독 마커 — 첫 줄이 "미션"/"mission" 뿐이면 나머지 전체가 골.
  const nl = t.indexOf('\n');
  if (nl > 0) {
    const firstLine = t.slice(0, nl).trim().toLowerCase();
    if (BARE_LINE_MARKERS.includes(firstLine)) return finalize(t.slice(nl + 1));
  }
  return { isMission: false, goal: '' };
}

function finalize(rest: string): MissionMarker {
  const goal = rest.trim();
  return goal ? { isMission: true, goal } : { isMission: false, goal: '' };
}
