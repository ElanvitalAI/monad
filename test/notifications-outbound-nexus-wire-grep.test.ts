// W7-후속 (2026-05-12) · NEXUS outbound boot wire source-grep guard.
//
// `feedback_source_level_grep_test_value` — entry-point wires need
// source-level guards because unit/integration tests don't catch a
// missing call site. The pin here protects:
//
//   1. `buildOutboundSubstrate` is imported in `src/nexus/index.ts`.
//   2. The substrate's `tokenStore` is forwarded to the http-server
//      via `outboundTokens: { tokenStore: ... }` (the option the
//      `/v1/devices/tokens` endpoint reads).
//   3. The boot site reads `cfg.notifications?.apns` from user-config.
//   4. A misconfigured APNs surface logs `apnsBootSkippedReason`
//      via console.warn so a missing .p8 isn't silently absorbed.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const NEXUS_INDEX = readFileSync(join(REPO, 'src', 'nexus', 'index.ts'), 'utf8');

describe('nexus/index.ts · outbound substrate wire', () => {
  test('imports buildOutboundSubstrate', () => {
    expect(NEXUS_INDEX).toMatch(
      /import\s*\{[^}]*buildOutboundSubstrate[^}]*\}\s*from\s*['"]\.\.\/notifications\/outbound-boot/,
    );
  });

  test('reads cfg.notifications?.apns from user-config', () => {
    expect(NEXUS_INDEX).toContain('cfg.notifications?.apns');
  });

  test('passes outboundTokens with the substrate tokenStore to http-server', () => {
    // The forward must thread the SAME tokenStore the substrate created
    // (not a fresh InMemoryDeviceTokenStore) so PWA tokens land on the
    // same store the channel reads from on send.
    expect(NEXUS_INDEX).toMatch(
      /outboundTokens:\s*\{\s*tokenStore:\s*outboundSubstrate\.tokenStore\s*\}/,
    );
  });

  test('surfaces apnsBootSkippedReason via console.warn (not silent)', () => {
    expect(NEXUS_INDEX).toContain('apnsBootSkippedReason');
    expect(NEXUS_INDEX).toMatch(/console\.warn\([^)]*apns/);
  });
});
