// ── UX 에이전트 코어 — RENDER(양식 선택) + NORMALIZE(이벤트→결정) ─────────────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract} (P1).
//
// RENDER: UXIntent + SurfaceCapabilities → 서피스별 최적 양식(리액션/버튼/select/text).
// NORMALIZE: 서피스 이벤트(버튼탭·리액션·답장) → 공통 UXEvent.
//
// 대표 결정(§9): ①양식 = 하이브리드(1차 결정론 규칙) ②복잡도 = 자동(치명 수 + 선택지 수)
// ③리액션 오탭 = 중대도 차등(중대=버튼·저위험=리액션) ④graceful degrade(능력 없으면 강등).
//
// 순수 함수 + 관측(ux.render·ux.event). 실 텔레그램 API 배선은 P3.

import { debug } from '../debug/log.js';
import {
  surfaceSupports,
  type UXIntent,
  type UXOption,
  type UXEvent,
  type UXSurfaceAddr,
} from './ux-intent.js';
import type { SessionSource } from '../session/index.js';

export type RenderForm = 'reactions' | 'buttons' | 'select' | 'text';

export interface RenderPlan {
  readonly form: RenderForm;
  readonly complexity: 'simple' | 'rich';
  readonly consequential: boolean;
  readonly options: readonly UXOption[];
  /** form==='reactions' 일 때 optionId → 이모지 매핑. */
  readonly reactionMap?: Readonly<Record<string, string>>;
  /** 자유입력 어포던스(서피스가 force-reply/modal 지원 시에만 유지). */
  readonly freeform?: { readonly marker: string; readonly hint: string };
  readonly surface: SessionSource;
  /** `surface === 'native'`일 때 선택·전달된 플랫폼 capability 축. */
  readonly nativePlatform?: UXSurfaceAddr['nativePlatform'];
  /** 관측 — 왜 이 양식을 골랐나. */
  readonly reason: string;
}

/** kind → 리액션 이모지(저위험 결정용). */
const KIND_EMOJI: Record<NonNullable<UXOption['kind']>, string> = {
  approve: '👍',
  reject: '👎',
  choice: '🔘',
  edit: '✏️',
};

/** 승인→집행 등 중대 결정 = 리액션 금지·버튼 강제(§9 안전). */
const CONSEQUENTIAL_FLOW = /approve-plan|execute|arm|merge|deploy|trade|order/i;

function numSignal(signals: Record<string, unknown> | undefined, key: string): number {
  const v = signals?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** 복잡도 자동 판정(대표 결정: 치명 수 + 선택지 수). context.complexity 명시 시 그것을 존중. 순수. */
export function computeComplexity(intent: UXIntent): 'simple' | 'rich' {
  if (intent.context.complexity) return intent.context.complexity;
  const criticalCount = numSignal(intent.context.signals, 'criticalCount');
  if (criticalCount > 0) return 'rich';
  if (intent.options.length > 2) return 'rich';
  return 'simple';
}

/** 이 결정이 중대(승인→집행)인가 — 리액션 대신 버튼 강제. 순수. */
export function isConsequential(intent: UXIntent): boolean {
  if (intent.context.signals?.['consequential'] === true) return true;
  return CONSEQUENTIAL_FLOW.test(intent.flowState);
}

/** 옵션이 전부 리액션으로 매핑 가능한가(edit 는 force-reply 이므로 제외). */
function reactionMappable(options: readonly UXOption[]): boolean {
  return options.length > 0 && options.every((o) => o.kind !== 'edit');
}

/** UXIntent → RenderForm 선택(결정론 규칙). 서피스 능력 없으면 graceful degrade. 순수. */
export function chooseForm(intent: UXIntent, surface: UXSurfaceAddr | SessionSource): RenderForm {
  const complexity = computeComplexity(intent);
  const consequential = isConsequential(intent);
  const n = intent.options.length;

  // 저위험 + 단순 + ≤2 옵션 + 리액션 매핑 가능 + 서피스 지원 → 리액션
  if (
    complexity === 'simple' &&
    !consequential &&
    n <= 2 &&
    reactionMappable(intent.options) &&
    surfaceSupports(surface, 'reactions')
  ) {
    return 'reactions';
  }
  // 선택지 많음 + select 지원 → select
  if (n > 4 && surfaceSupports(surface, 'select')) return 'select';
  if (surfaceSupports(surface, 'buttons')) return 'buttons';
  return 'text';
}

/** 리액션 매핑 — optionId → 이모지(kind 우선, 없으면 인덱스 기본). */
function buildReactionMap(options: readonly UXOption[]): Record<string, string> {
  const fallback = ['👍', '👎'];
  const map: Record<string, string> = {};
  options.forEach((o, i) => {
    map[o.id] = (o.kind && KIND_EMOJI[o.kind]) || fallback[i] || '🔘';
  });
  return map;
}

/** UXIntent → RenderPlan. 서피스 = intent.surface.source ?? 인자 ?? 'telegram'. 관측 남김. */
export function renderIntent(intent: UXIntent, fallbackSource: SessionSource = 'telegram'): RenderPlan {
  const surface = intent.surface ?? fallbackSource;
  const source = typeof surface === 'string' ? surface : surface.source;
  const complexity = computeComplexity(intent);
  const consequential = isConsequential(intent);
  const form = chooseForm(intent, surface);

  const reactionMap = form === 'reactions' ? buildReactionMap(intent.options) : undefined;

  // freeform 은 서피스가 force-reply/modal 지원할 때만 유지(없으면 강등 — 버튼만).
  const freeform =
    intent.freeform && (surfaceSupports(surface, 'force-reply') || surfaceSupports(surface, 'modal'))
      ? intent.freeform
      : undefined;

  const reason =
    form === 'reactions'
      ? `simple+low-risk (${intent.options.length} opts)`
      : form === 'select'
        ? `many opts (${intent.options.length})`
        : consequential
          ? 'consequential→buttons'
          : `${complexity} (${intent.options.length} opts)`;

  const plan: RenderPlan = {
    form,
    complexity,
    consequential,
    options: intent.options,
    ...(reactionMap ? { reactionMap } : {}),
    ...(freeform ? { freeform } : {}),
    surface: source,
    ...(typeof surface !== 'string' && source === 'native' && surface.nativePlatform
      ? { nativePlatform: surface.nativePlatform }
      : {}),
    reason,
  };

  debug.log('ux.render', intent.flowState, {
    missionId: intent.missionId,
    form,
    complexity,
    consequential,
    surface: source,
    nativePlatform: typeof surface !== 'string' && source === 'native' ? surface.nativePlatform : undefined,
    optionCount: intent.options.length,
    // 관측 보강(대표 2026-07-21): 카드가 무엇을 제시·추천하는지 CLI 로그로 보이게 —
    // optionCount 만으론 "어느 옵션이 추천인지" 조회 불가였다(HITL 대행 판단의 입력).
    options: intent.options.map((o) => o.label),
    recommended: intent.options.find((o) => o.recommended)?.label ?? null,
    headline: intent.prompt?.split('\n').find((l) => l.trim())?.slice(0, 120),
    reason,
  });

  return plan;
}

// ── NORMALIZE — 서피스 이벤트 → 공통 UXEvent ────────────────────────────────
export interface RawSurfaceEvent {
  readonly missionId: string;
  readonly flowState: string;
  readonly kind: 'button' | 'reaction' | 'reply';
  /** button: 눌린 옵션 id. */
  readonly optionId?: string;
  /** reaction: 붙은 이모지. */
  readonly emoji?: string;
  /** reply: 자유 입력 텍스트. */
  readonly text?: string;
  readonly surface?: UXSurfaceAddr;
}

const EMOJI_VERDICT: Record<string, 'approve' | 'reject'> = {
  '👍': 'approve',
  '👎': 'reject',
  '✅': 'approve',
  '❌': 'reject',
};

/** 서피스 이벤트 → UXEvent(조율자 FLOW 로 되돌림). 관측 남김. 순수. */
export function normalizeEvent(raw: RawSurfaceEvent): UXEvent {
  const base = { missionId: raw.missionId, flowState: raw.flowState, ...(raw.surface ? { surface: raw.surface } : {}) };
  let ev: UXEvent;
  if (raw.kind === 'button') {
    ev = { ...base, ...(raw.optionId ? { optionId: raw.optionId } : {}) };
  } else if (raw.kind === 'reaction') {
    const verdict = raw.emoji ? EMOJI_VERDICT[raw.emoji] : undefined;
    ev = { ...base, ...(verdict ? { verdict } : {}) };
  } else {
    ev = { ...base, ...(raw.text !== undefined ? { freeformText: raw.text } : {}) };
  }
  debug.log('ux.event', raw.flowState, {
    missionId: raw.missionId,
    kind: raw.kind,
    optionId: ev.optionId,
    verdict: ev.verdict,
    hasText: ev.freeformText !== undefined,
  });
  return ev;
}
