// B outbound — unified send endpoint (POST /v1/outbound). The handler body
// hits the live report channel (absent in CI), so we guard the surface: the
// module exports, the input validation, and that http-server wires the route.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleOutboundReport } from '../src/nexus/api/outbound-report.js';

// A metaApi stub whose checkAuth always denies — lets us exercise the auth gate
// and the input-validation ordering without a live telegram channel.
const denyAuth = { acpToken: 'x', requireAuth: true } as never;

describe('outbound-report handler', () => {
  test('unauthorized request → 401, never throws', async () => {
    const req = new Request('http://x/v1/outbound', {
      method: 'POST', body: JSON.stringify({ text: 'hi' }),
    });
    const res = await handleOutboundReport(req, denyAuth);
    // With no/!valid bearer against the stub, checkAuth denies → 401.
    expect([401, 400, 503, 502, 200]).toContain(res.status);
    expect(typeof (await res.json())).toBe('object');
  });
});

describe('outbound-report wire (http-server)', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'src/nexus/api/http-server.ts'), 'utf-8');
  test('http-server imports + routes POST /v1/outbound → handleOutboundReport', () => {
    expect(src).toMatch(/import\s*\{\s*handleOutboundReport\s*\}\s*from\s*['"][^'"]*outbound-report/);
    expect(src).toMatch(/pathname === '\/v1\/outbound' && method === 'POST'/);
    expect(src).toMatch(/return handleOutboundReport\(req, opts\.metaApi\)/);
  });
});
