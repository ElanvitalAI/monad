// R3 (BACKLOG-pwa-mobile-readiness #5 · 2026-05-09) — source-level
// guard that the SW's notificationclick handler branches on
// `event.action`. Pattern mirror of `nexus-multi-llm-wire-smoke`
// and `chat/ChatInput.test.tsx` — full SW execution can't be
// driven from bun test (needs a ServiceWorkerGlobalScope), so we
// pin the branch existence by reading the source file.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/pwa/src/lib/ → ../public/sw.js
const SW_SRC = readFileSync(join(HERE, '..', '..', 'public', 'sw.js'), 'utf8');

describe('sw.js · R3 notificationclick action branch', () => {
  test('reads event.action from the click event', () => {
    expect(SW_SRC).toMatch(/event\.action/);
  });

  test('detects action click vs body click via length check', () => {
    // The handler short-circuits when event.action is a non-empty
    // string (body taps fire with event.action === '').
    expect(SW_SRC).toMatch(/event\.action\.length\s*>\s*0/);
  });

  test('POSTs the action payload to /v1/notification-action', () => {
    expect(SW_SRC).toMatch(/v1\/notification-action/);
    // Body shape — JSON with sessionId + action.
    expect(SW_SRC).toMatch(/JSON\.stringify\(\s*\{[^}]*sessionId/);
    expect(SW_SRC).toMatch(/JSON\.stringify\(\s*\{[^}]*action/);
  });

  test('action click skips the focus/navigate flow (early return)', () => {
    // After the action POST waitUntil, the handler returns; the
    // body-click flow follows. Pin the early `return;` so a future
    // refactor can't accidentally run both paths.
    const actionBranchPattern = /if\s*\(\s*actionId\s*!==\s*null\s*\)\s*\{[\s\S]*?return;\s*\}/;
    expect(SW_SRC).toMatch(actionBranchPattern);
  });
});
