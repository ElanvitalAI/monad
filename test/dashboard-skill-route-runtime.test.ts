import { describe, expect, test } from 'bun:test';

import {
  formatDashboardSkillHint,
  resolveDashboardSkillRouteDecision,
} from '../src/dashboard/skill-route-runtime.js';

describe('formatDashboardSkillHint', () => {
  test('formats explicit-match hints and ambiguous fallbacks', () => {
    const unambiguous = formatDashboardSkillHint({
      top: {
        name: 'skill-a',
        score: 2,
        matchedTriggers: ['deploy'],
        matchedExtractedTriggers: [],
        autoTrigger: true,
        description: 'desc',
      },
      candidates: [{
        name: 'skill-a',
        score: 2,
        matchedTriggers: ['deploy'],
        matchedExtractedTriggers: [],
        autoTrigger: true,
        description: 'desc',
      }],
      unambiguous: true,
    });
    const ambiguous = formatDashboardSkillHint({
      top: {
        name: 'skill-a',
        score: 2,
        matchedTriggers: [],
        matchedExtractedTriggers: ['website'],
        autoTrigger: false,
        description: 'desc',
      },
      candidates: [
        {
          name: 'skill-a',
          score: 2,
          matchedTriggers: [],
          matchedExtractedTriggers: ['website'],
          autoTrigger: false,
          description: 'desc',
        },
        {
          name: 'skill-b',
          score: 2,
          matchedTriggers: ['deploy'],
          matchedExtractedTriggers: [],
          autoTrigger: true,
          description: 'desc',
        },
      ],
      unambiguous: false,
    });

    expect(unambiguous).toContain('/run-skill skill-a');
    expect(unambiguous).toContain('matched: deploy');
    expect(ambiguous).toContain('ambiguous');
    expect(ambiguous).toContain('also: skill-b');
  });
});

describe('resolveDashboardSkillRouteDecision', () => {
  const detection = {
    top: {
      name: 'skill-a',
      score: 2.4,
      matchedTriggers: ['deploy'],
      matchedExtractedTriggers: [],
      autoTrigger: true,
      description: 'desc',
      minTier: 'T2' as const,
    },
    candidates: [{
      name: 'skill-a',
      score: 2.4,
      matchedTriggers: ['deploy'],
      matchedExtractedTriggers: [],
      autoTrigger: true,
      description: 'desc',
      minTier: 'T2' as const,
    }],
    unambiguous: true,
  };

  test('chooses auto-route when the gate passes', () => {
    expect(resolveDashboardSkillRouteDecision(detection, {
      autoRouteEnabled: true,
      autoRouteMinScore: 2,
      requireAutoTrigger: true,
      activeTier: 'T1',
      declinedTop: false,
    })).toEqual({ kind: 'auto', target: 'skill-a' });
  });

  test('falls back to tab-confirm when auto-route is disabled but hint is valid', () => {
    expect(resolveDashboardSkillRouteDecision(detection, {
      autoRouteEnabled: false,
      autoRouteMinScore: 2,
      requireAutoTrigger: true,
      activeTier: 'T1',
      declinedTop: false,
    })).toEqual({ kind: 'none' });

    expect(resolveDashboardSkillRouteDecision({
      ...detection,
      top: {
        ...detection.top,
        autoTrigger: false,
      },
      candidates: [{
        ...detection.candidates[0],
        autoTrigger: false,
      }],
    }, {
      autoRouteEnabled: true,
      autoRouteMinScore: 3,
      requireAutoTrigger: true,
      activeTier: 'T1',
      declinedTop: false,
    })).toEqual({ kind: 'confirm', target: 'skill-a' });
  });

  test('suppresses routing when the top skill was declined', () => {
    expect(resolveDashboardSkillRouteDecision(detection, {
      autoRouteEnabled: true,
      autoRouteMinScore: 2,
      requireAutoTrigger: true,
      activeTier: 'T1',
      declinedTop: true,
    })).toEqual({ kind: 'none' });
  });
});
