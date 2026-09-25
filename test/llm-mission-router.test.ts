// ── Mission router · Tier 1 heuristic guard (P1-1 · 2026-05-14) ──
//
// Pure unit tests · no I/O · no user-config touch. The router is
// deliberately stateless at Tier 1, so the suite covers:
//   • Korean + English pattern coverage for all 6 missions (12 cases).
//   • Attachment priority (image / video → vision).
//   • Short-input rule (≤20 chars → quick).
//   • Fallback (no match → quick, low confidence).
//   • User-config override resolves provider/model.
//   • Lazy singleton lifecycle.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  classifyMissionTier1,
  createMissionRouter,
  globalMissionRouter,
  resetGlobalMissionRouter,
  type MissionRoutingConfig,
} from '../src/llm/mission-router';

describe('classifyMissionTier1 · 6 missions × 2 languages', () => {
  const cases: Array<{ text: string; mission: string; lang: 'ko' | 'en' }> = [
    // plan
    { text: 'Help me plan the new auth module', mission: 'plan', lang: 'en' },
    { text: '새 인증 모듈 설계해줘', mission: 'plan', lang: 'ko' },
    // build
    { text: 'Implement the rate limiter using a token bucket', mission: 'build', lang: 'en' },
    { text: '토큰 버킷으로 rate limiter 구현해줘', mission: 'build', lang: 'ko' },
    // review
    { text: 'Please review this pull request for security issues', mission: 'review', lang: 'en' },
    { text: '이 PR 의 보안 이슈 검토 부탁드립니다', mission: 'review', lang: 'ko' },
    // research
    { text: 'Research how Tigris compares to S3 for edge workloads', mission: 'research', lang: 'en' },
    { text: 'Tigris 와 S3 의 차이점을 조사해줘', mission: 'research', lang: 'ko' },
  ];

  for (const c of cases) {
    test(`${c.mission} (${c.lang}): "${c.text.slice(0, 30)}"`, () => {
      const r = classifyMissionTier1({ text: c.text });
      expect(r.mission).toBe(c.mission as never);
      expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    });
  }
});

describe('attachment priority', () => {
  test('image attachment → vision (wins over text pattern)', () => {
    const r = classifyMissionTier1({
      text: 'plan the auth module',
      attachments: [{ kind: 'image' }],
    });
    expect(r.mission).toBe('vision');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('video attachment → vision', () => {
    const r = classifyMissionTier1({
      text: 'analyze this clip',
      attachments: [{ kind: 'video' }],
    });
    expect(r.mission).toBe('vision');
  });

  test('audio attachment alone does NOT force vision', () => {
    const r = classifyMissionTier1({
      text: 'review the audio transcript for tone',
      attachments: [{ kind: 'audio' }],
    });
    expect(r.mission).toBe('review');
  });

  test('document attachment alone does NOT force vision', () => {
    const r = classifyMissionTier1({
      text: 'implement the parser per this spec',
      attachments: [{ kind: 'document' }],
    });
    expect(r.mission).toBe('build');
  });
});

describe('short input rule', () => {
  test('Korean short "ㅇㅇ" → quick', () => {
    expect(classifyMissionTier1({ text: 'ㅇㅇ' }).mission).toBe('quick');
  });

  test('English "ok" → quick', () => {
    expect(classifyMissionTier1({ text: 'ok' }).mission).toBe('quick');
  });

  test('exact-20-char short input → quick', () => {
    expect(classifyMissionTier1({ text: 'a'.repeat(20) }).mission).toBe('quick');
  });

  test('21-char text falls through to pattern matching', () => {
    // 21 chars, contains "plan" — should NOT collapse to quick.
    const text = 'lets plan the migrate';
    expect(text.length).toBe(21);
    expect(classifyMissionTier1({ text }).mission).toBe('plan');
  });

  test('empty text → quick fallback (low confidence)', () => {
    const r = classifyMissionTier1({ text: '' });
    expect(r.mission).toBe('quick');
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe('fallback', () => {
  test('long text with no matching pattern → quick (low confidence)', () => {
    const text =
      'The weather is nice and the cat is sleeping on the windowsill while the kettle whistles.';
    const r = classifyMissionTier1({ text });
    expect(r.mission).toBe('quick');
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe('createMissionRouter · provider resolution', () => {
  test('defaults: plan → claude, build → codex-app-server, review → gemini', async () => {
    const router = createMissionRouter();
    const plan = await router.predict({ text: 'plan the migration' });
    expect(plan.mission).toBe('plan');
    expect(plan.provider).toBe('claude');
    expect(plan.tier).toBe(1);

    const build = await router.predict({ text: 'implement the cache layer' });
    expect(build.provider).toBe('codex-app-server');

    const review = await router.predict({ text: 'review this for race conditions' });
    expect(review.provider).toBe('gemini');
  });

  test('user-config override wins over defaults', async () => {
    const config: MissionRoutingConfig = {
      mode: 'auto',
      missions: {
        plan: { provider: 'gemini', model: 'gemini-3-pro' },
      },
    };
    const router = createMissionRouter({ config });
    const r = await router.predict({ text: 'plan the new pipeline' });
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-3-pro');
  });

  test('vision routes to gemini with image attachment', async () => {
    const router = createMissionRouter();
    const r = await router.predict({
      text: 'what is in this screenshot',
      attachments: [{ kind: 'image' }],
    });
    expect(r.mission).toBe('vision');
    expect(r.provider).toBe('gemini');
  });
});

describe('globalMissionRouter · lazy singleton', () => {
  beforeEach(() => {
    resetGlobalMissionRouter();
  });

  test('first call constructs · second call returns same instance', () => {
    const a = globalMissionRouter();
    const b = globalMissionRouter();
    expect(a).toBe(b);
  });

  test('reset clears the cache so the next call rebuilds', () => {
    const a = globalMissionRouter();
    resetGlobalMissionRouter();
    const b = globalMissionRouter();
    expect(a).not.toBe(b);
  });
});
