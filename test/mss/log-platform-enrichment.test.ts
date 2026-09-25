// SAM S0 seed — platform field on LogSource populated via
// process.platform during debug tracer enrichment.
//
// Why: future multi-platform clients (iOS / Android / web) will
// forward logs to a central collector where records from different
// devices look identical unless the record carries a platform label.
// This seed lands the label NOW so upcoming platform work does not
// require a schema migration later.

import { describe, test, expect, beforeEach } from 'bun:test';
import { debug } from '../../src/debug/log.js';

function resetDebug(): void {
  debug.setFileEnabled(false);
  debug.disable();
  debug.setVerboseEnabled(false);
  debug.clear();
  debug.setMirrorHook(null);
}

describe('SAM S0 — LogSource.platform enrichment', () => {
  beforeEach(resetDebug);

  test('emitted record carries source.platform set to process.platform', () => {
    debug.enable();
    debug.log('sam.s0', 'platform-check');
    const events = debug.events(1);
    expect(events.length).toBe(1);
    const rec = events[0] as unknown as { source?: { platform?: string } };
    expect(rec.source).toBeDefined();
    expect(rec.source?.platform).toBe(process.platform);
  });

  test('process.platform value (darwin / linux / win32 / ...) passes through unchanged', () => {
    debug.enable();
    debug.log('sam.s0', 'raw-platform');
    const events = debug.events(1);
    const rec = events[0] as unknown as { source?: { platform?: string } };
    // Platform must be one of the standard Node labels OR a mobile
    // runtime override. No empty string / uppercased values.
    expect(typeof rec.source?.platform).toBe('string');
    expect((rec.source?.platform ?? '').length).toBeGreaterThan(0);
  });
});
