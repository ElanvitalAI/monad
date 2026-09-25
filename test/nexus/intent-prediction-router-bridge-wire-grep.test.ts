// G2 (2026-05-12) · NEXUS intent-prediction → router bridge wire guard.
//
// `feedback_source_level_grep_test_value` — wire-up regressions slip
// past unit + integration tests because the boot site itself isn't
// covered. This grep pin protects:
//
//   1. `wireIntentPredictionToRouter` is imported in nexus/index.ts.
//   2. Function-level `intentPredictionRouterBridge` declaration so
//      the shutdown closure can stop it.
//   3. Wire site checks BOTH `runtimeIntentPrediction` and
//      `outboundSubstrate?.router` before calling the bridge.
//   4. Shutdown calls `intentPredictionRouterBridge.stop()` before
//      `runtimeIntentPrediction.dispose()` (ordering defensive — the
//      service dispose already clears listeners, but explicit stop
//      keeps the contract symmetric).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const NEXUS_INDEX = readFileSync(join(REPO, 'src', 'nexus', 'index.ts'), 'utf8');

describe('nexus/index.ts · intent-prediction router bridge wire', () => {
  test('imports wireIntentPredictionToRouter + handle type', () => {
    expect(NEXUS_INDEX).toMatch(
      /import\s*\{[\s\S]*?wireIntentPredictionToRouter[\s\S]*?\}\s*from\s*['"]\.\.\/intent-prediction\/router-bridge/,
    );
    expect(NEXUS_INDEX).toContain('IntentPredictionRouterBridgeHandle');
  });

  test('function-level handle declaration', () => {
    expect(NEXUS_INDEX).toMatch(
      /let\s+intentPredictionRouterBridge\s*:\s*IntentPredictionRouterBridgeHandle\s*\|\s*undefined/,
    );
  });

  test('wire site guarded by both prerequisites', () => {
    // The wire site must check BOTH `runtimeIntentPrediction` (line
    // ~681 declaration) AND `outboundSubstrate?.router`. Either
    // missing → wire is skipped (substrate-not-ready, not a crash).
    expect(NEXUS_INDEX).toMatch(
      /if\s*\(\s*runtimeIntentPrediction\s*&&\s*outboundSubstrate\?\.router\s*\)/,
    );
  });

  test('bridge invocation forwards service + router', () => {
    expect(NEXUS_INDEX).toMatch(
      /intentPredictionRouterBridge\s*=\s*wireIntentPredictionToRouter\(\s*\{[\s\S]*?service:\s*runtimeIntentPrediction[\s\S]*?router:\s*outboundSubstrate\.router/,
    );
  });

  test('shutdown stops bridge before disposing service', () => {
    // The two cleanup blocks must appear in this order: bridge.stop()
    // first (defensive — service.dispose() clears listeners anyway,
    // but explicit stop keeps the contract symmetric).
    const stopIdx = NEXUS_INDEX.indexOf('intentPredictionRouterBridge.stop()');
    const disposeIdx = NEXUS_INDEX.indexOf('runtimeIntentPrediction.dispose()');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeLessThan(disposeIdx);
  });

  test('boot console.info surface on success', () => {
    expect(NEXUS_INDEX).toContain('intent-prediction → outbound router bridge wired');
  });
});
