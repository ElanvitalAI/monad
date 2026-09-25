// PWA `/setup` Phase 1 — SetupPage mount surface test.
//
// React Testing harness 가 PWA 에 없어 (per
// `QuickSetupCard.test.tsx`, `NexusClientProvider.test.tsx` convention),
// 본 파일은 export contract 만 검증. wire 동작은
// `client.test.ts` (LlmProviders endpoint) + backend
// `setup-llm-provider.test.ts` (E2E) 가 transitively 커버.

import { describe, expect, test } from 'bun:test';

import SetupPage from './page';

describe('SetupPage — Phase 1 mount surface', () => {
  test('exports a default component function', () => {
    expect(typeof SetupPage).toBe('function');
  });
});
