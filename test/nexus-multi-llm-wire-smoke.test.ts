// NEXUS / monad serve — multi-LLM runTurn wire smoke.
//
// Regression guard for the bug class fixed by PR #2079: NEXUS daemon
// (`src/nexus/index.ts`) was wiring its ACP runTurn from the legacy
// single-LLM `createDaemonRunTurn` directly, bypassing the
// multi-LLM-aware composer (`createDaemonMultiLlmRunTurn`). Result:
// DM-1 / DM-2 / DM-3 / DM3 FU 4-track stack (~6,000 LOC across
// #1928 #1932 #1940 #2072) was dead-code in production — Showroom
// `_meta.monad.multiLlm` hint dispatched the prompt but the legacy
// bridge ignored it, the response was broadcast without
// `_meta.monad.modelId`, and the client filtered every chunk.
//
// The composer is a strict superset — it falls through to the legacy
// single-LLM bridge when no hint is present, so vanilla ACP clients
// (chat tab · webterm peer) keep their behaviour. The cost of using
// the composer at the entry point is zero; the cost of NOT using it
// is silent multi-LLM dispatch failure.
//
// This test pins the entry-point wire so any new daemon process
// (NEXUS, `monad serve`-style legacy runtime, future fork) needs to
// keep using the composer. Source-level grep is intentionally simple
// and brittle — that brittleness is the point: anyone touching the
// wire will trip this test before the production bug ships.
//
// See also:
//   - 내부 문서 §2.1 (root cause)
//   - feedback_nexus_wire_smoke_required.md (memory)

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

function readSource(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('NEXUS daemon · multi-LLM-aware runTurn composer wire (regression for #2079)', () => {
  test('src/nexus/index.ts imports createDaemonMultiLlmRunTurn from boot/daemon-multi-llm-runtime', () => {
    const src = readSource('src/nexus/index.ts');
    // ESM import — anywhere in the file.
    expect(src).toMatch(
      /import\s*\{\s*createDaemonMultiLlmRunTurn\s*\}\s*from\s*['"]\.\.\/boot\/daemon-multi-llm-runtime\.js['"]/,
    );
  });

  test('src/nexus/index.ts wires its ACP runTurn via createDaemonMultiLlmRunTurn', () => {
    const src = readSource('src/nexus/index.ts');
    // The composer call must exist in the runtime block. The legacy
    // single-LLM `createDaemonRunTurn` would silently drop
    // `_meta.monad.multiLlm` hints and break Showroom dispatch.
    //
    // R1 IntentContext extension (2026-05-09) wraps the composer's
    // output in an outer `runTurn` that captures errors / tool_use
    // for the ranker — so the binding name is now `innerRunTurn`,
    // but the composer call itself is still the gate this guard
    // protects.
    expect(src).toMatch(
      /const\s+(?:runTurn|innerRunTurn)\s*=\s*createDaemonMultiLlmRunTurn\s*\(/,
    );
  });

  test('src/nexus/index.ts does NOT import createDaemonRunTurn from boot/daemon-runtime directly', () => {
    const src = readSource('src/nexus/index.ts');
    // `createDaemonRunTurn` is only the composer's internal fallback
    // (daemon-multi-llm-runtime.ts:60). Direct import in NEXUS is the
    // exact regression PR #2079 fixed.
    const importBlock = src.match(
      /import\s*\{[^}]*\}\s*from\s*['"]\.\.\/boot\/daemon-runtime\.js['"]/g,
    ) ?? [];
    for (const imp of importBlock) {
      expect(imp).not.toMatch(/\bcreateDaemonRunTurn\b/);
    }
  });
});

describe('legacy `monad serve` runtime · multi-LLM composer wire', () => {
  test('src/boot/daemon-runtime.ts createDaemonRuntime uses createDaemonMultiLlmRunTurn', () => {
    const src = readSource('src/boot/daemon-runtime.ts');
    // The wrapper at line ~556 (require'd lazy to break the import
    // cycle) is the single point where `monad serve` boots its
    // runTurn handler. It must compose, not call the legacy directly.
    expect(src).toMatch(/createDaemonMultiLlmRunTurn/);
    // And the resulting `runTurn` should be the composer's return.
    expect(src).toMatch(
      /const\s+runTurn\s*=\s*createDaemonMultiLlmRunTurn\s*\(/,
    );
  });
});

describe('multi-LLM composer · contract preserved', () => {
  test('src/boot/daemon-multi-llm-runtime.ts re-exports createDaemonMultiLlmRunTurn', () => {
    const src = readSource('src/boot/daemon-multi-llm-runtime.ts');
    expect(src).toMatch(
      /export\s+function\s+createDaemonMultiLlmRunTurn\s*\(/,
    );
  });

  test('composer wraps the legacy createDaemonRunTurn as its no-hint fallback', () => {
    // Regression guard for the *opposite* bug — if a future refactor
    // dropped the legacy fallback, vanilla ACP clients (chat tab, webterm
    // peer) would suddenly require the multi-LLM hint or get nothing.
    const src = readSource('src/boot/daemon-multi-llm-runtime.ts');
    expect(src).toMatch(/createDaemonRunTurn\s*\(/);
    // Composer must call the legacy when readMultiLlmHint returns null.
    expect(src).toMatch(/readMultiLlmHint/);
  });
});
