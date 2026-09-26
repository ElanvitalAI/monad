// ── 실행 진입 정책 (entry-independent 기억·관측 + mode-gated 인핸싱) ──
//
// 실행 substrate 통합 설계(PLAN §6e FIX)의 SSOT. "TUI 기본 장치"를 3개로 분해:
//   - 프롬프트 인핸싱 = 진입 민감(누구의 지능이 프롬프트를 짜나) → mode-gated 기본값.
//   - 기억(recall+write) = 진입 무관 → 항상 ON(가산 grounding·프롬프트 무접촉).
//   - 관측성 = 진입 무관 → 항상 ON(공유 버스).
//
// 대칭: TUI/elanous-apparatus = elanous 오리지널 존중·능력 평가(인핸싱 ON) /
//       external-verbatim(외부 Claude 크래프트·중첩) = 외부가 프롬프트 엔지니어(인핸싱 OFF).
// 어느 진입이든 기억·관측은 보장 → "다 허용"이 안전(직행이 기억·눈을 잃지 않음).

/**
 * 진입 클래스.
 * - `elanous-apparatus`: 사람이 elanous 를 통해(TUI·서피스) 또는 elanous 가 원문을 prep 하는 미션(codex mission 등).
 *   elanous 의 프롬프트 엔지니어링 역량을 쓴다 → 인핸싱 기본 ON.
 * - `external-verbatim`: 외부 에이전트(Claude Code 등)가 스스로 프롬프트를 크래프트했거나 상위 elanous 가
 *   엔지니어인 중첩. 외부/상위가 프롬프트 엔지니어 → 인핸싱 기본 OFF(verbatim 존중).
 */
export type IngestionEntry = 'elanous-apparatus' | 'external-verbatim';

export interface IngestionPolicy {
  entry: IngestionEntry;
  /** 인핸싱 적용 여부(mode-gated·명시 override 우선). */
  enhance: boolean;
  /** 기억 recall/write 적용(entry-independent·항상 true). */
  memory: boolean;
  /** 관측 적용(entry-independent·항상 true). */
  observe: boolean;
}

export interface ResolveIngestionOpts {
  entry: IngestionEntry;
  /** 호출자 명시 인핸싱 값(있으면 mode 기본값보다 우선). undefined 면 entry 기본값. */
  explicitEnhance?: boolean;
}

/**
 * ★ 진입 정책 해석 — 기억·관측은 항상 ON, 인핸싱만 mode 기본값(명시 override 우선).
 */
export function resolveIngestionPolicy(opts: ResolveIngestionOpts): IngestionPolicy {
  const enhanceDefault = opts.entry === 'elanous-apparatus';
  return {
    entry: opts.entry,
    enhance: opts.explicitEnhance ?? enhanceDefault,
    memory: true, // entry-independent — 어떤 길로 들어오든 기억은 동작
    observe: true, // entry-independent — 어떤 길로 들어오든 관측은 동작
  };
}
