// ── builds-api 라우팅(대표 2026-07-13·PLAN B4) ──
import { describe, it, expect } from 'bun:test';
import { parseBuildsPath } from './builds-api.js';

describe('parseBuildsPath', () => {
  it('/v1/builds → list', () => {
    expect(parseBuildsPath('/v1/builds')).toEqual({ kind: 'list' });
  });
  it('/v1/builds/<id> → snapshot', () => {
    expect(parseBuildsPath('/v1/builds/bld_0808d01f_1')).toEqual({ kind: 'snapshot', buildId: 'bld_0808d01f_1' });
  });
  it('/v1/builds/<id>/stream → stream(SSE)', () => {
    expect(parseBuildsPath('/v1/builds/bld_0808d01f_2/stream')).toEqual({ kind: 'stream', buildId: 'bld_0808d01f_2' });
  });
  it('무관 경로 → null(다른 핸들러 소관)', () => {
    expect(parseBuildsPath('/v1/nexus')).toBeNull();
    expect(parseBuildsPath('/v1/builds/x/y/z')).toBeNull();
  });
});
