// PFC-S3 / W9 Y5 · method selector — RetrospectiveCard 의 root cause + outcome
// 패턴 → 다음 CFT 방법 추천. Cf. ROADMAP-prefrontal-cortex.md.

import type { RetrospectiveCard, RootCauseCategory } from './retrospective-card.js';

export type CftMethod =
  | 'fmea'      // pre-launch risk · "next time"
  | '5why'      // single root cause chain
  | 'fishbone'  // multi-factor diagram
  | 'a3'        // 1-page report
  | 'dmaic'     // measure + improve cycle
  | 'pdca'      // plan-do-check-act loop
  | 'kaizen'    // small continuous improvement
  | 'hansei';   // blame-free reflection (default)

export interface MethodRecommendation {
  primary: CftMethod;
  fallback?: CftMethod;
  reason: string;
}

const CATEGORY_PRIMARY: Record<RootCauseCategory, CftMethod> = {
  process: 'dmaic',
  people: 'hansei',
  technology: 'fmea',
  environment: 'fishbone',
  unknown: '5why',
};

export function recommendMethod(card: RetrospectiveCard): MethodRecommendation {
  if (card.outcome === 'success') {
    return { primary: 'kaizen', reason: 'success-path · small continuous improvement' };
  }
  if (card.outcome === 'fail' && card.actions.length === 0) {
    return { primary: 'a3', fallback: '5why', reason: 'failure with no action set · need 1-page report first' };
  }
  if (card.rootCause) {
    const primary = CATEGORY_PRIMARY[card.rootCause.category];
    return {
      primary,
      ...(primary !== '5why' ? { fallback: '5why' as CftMethod } : {}),
      reason: `root-cause category=${card.rootCause.category}`,
    };
  }
  if (card.lessons.length > 2 && card.actions.length > 2) {
    return { primary: 'pdca', reason: 'rich lessons + multi-action · loop suits PDCA' };
  }
  return { primary: 'hansei', reason: 'default · blame-free reflection' };
}
