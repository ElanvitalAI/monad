export const AD_MODES = ['quick', 'medium', 'quality'] as const;
export type AdMode = typeof AD_MODES[number];

export interface DraftMarker {
  readonly step: string;
  readonly text: string;
}

export interface AdModeDefinition {
  readonly mode: AdMode;
  readonly locks: readonly string[];
  readonly cutCount: { readonly min: number; readonly max: number };
  readonly regenerationCeiling: 0 | 1 | 2;
  readonly requiredGates: readonly string[];
  readonly requiresDraftMarker: boolean;
}

export const DRAFT_MARKER: DraftMarker = Object.freeze({
  step: 'draft-marker',
  text: '시안 — 납품용 산출물이 아닙니다.',
});

function freezeModeDefinition(definition: AdModeDefinition): AdModeDefinition {
  return Object.freeze({
    ...definition,
    locks: Object.freeze([...definition.locks]),
    cutCount: Object.freeze({ ...definition.cutCount }),
    requiredGates: Object.freeze([...definition.requiredGates]),
  });
}

export const AD_MODE_DEFINITIONS: Readonly<Record<AdMode, AdModeDefinition>> = Object.freeze({
  quick: freezeModeDefinition({
    mode: 'quick',
    locks: [],
    cutCount: { min: 1, max: 1 },
    regenerationCeiling: 0,
    requiredGates: ['CONCEPT_OK'],
    requiresDraftMarker: true,
  }),
  medium: freezeModeDefinition({
    mode: 'medium',
    locks: ['hero-frame'],
    cutCount: { min: 3, max: 4 },
    regenerationCeiling: 1,
    // ⛔⭐ `VIDEO_OK` 를 빼지 마라 — 아래 불변식이 그 이유를 시험으로 들고 있다.
    //    「시안 표식이 «없다» = 납품될 수 있다」이고, 납품되는 것에는 «최종 승인»이 있어야 한다.
    requiredGates: ['BRIEF_OK', 'MASTER_PICK', 'VIDEO_OK'],
    requiresDraftMarker: false,
  }),
  quality: freezeModeDefinition({
    mode: 'quality',
    locks: ['soul-cast', 'color'],
    cutCount: { min: 1, max: 6 },
    regenerationCeiling: 2,
    requiredGates: ['CONCEPT_OK', 'BRIEF_OK', 'MASTER_PICK', 'PACK_OK', 'VIDEO_OK'],
    requiresDraftMarker: false,
  }),
});

/** 파이프라인의 «마지막» 승인 게이트. ⛔ 납품되는 모드는 이것을 반드시 가진다(아래 불변식). */
export const FINAL_APPROVAL_GATE = 'VIDEO_OK' as const;

/** ⛔⭐ 모드 정의가 지켜야 하는 «관계» — 목록이 아니라 관계다.
 *  🔑 ***시안 표식이 «없다」 = 그 산출은 납품될 수 있다*** ⇒ 최종 승인 게이트가 «있어야» 한다.
 *  🩸 초판의 `medium` 이 그 관계를 깼다 — 납품 가능한데 최종 승인이 «없었다».
 *     그것이 RFC 가 경고한 「모드가 «검사를 건너뛰는 길»이 된다」의 실물이다.
 *  ⇒ 새 모드를 더할 때 이 함수가 «자동으로» 그것을 묻는다. */
export function modesMissingFinalApproval(): readonly AdMode[] {
  return AD_MODES.filter((mode) => {
    const d = AD_MODE_DEFINITIONS[mode];
    return !d.requiresDraftMarker && !d.requiredGates.includes(FINAL_APPROVAL_GATE);
  });
}

export function resolveAdMode(mode?: AdMode): AdModeDefinition {
  return AD_MODE_DEFINITIONS[mode ?? 'medium'];
}

export function validateDraftMarkerPlan(plan: {
  readonly mode: AdMode;
  readonly draftMarker?: DraftMarker;
}): void {
  if (plan.mode === 'quick') {
    if (!plan.draftMarker || !plan.draftMarker.step.trim() || !plan.draftMarker.text.trim()) {
      throw new Error('Quick plans require a non-empty draft marker step and text.');
    }
  }
}
