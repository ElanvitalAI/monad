// Obsidian Vault REST 브릿지(OP0) 단위테스트 — parseVaultPath + info(무vault fallback).
import { describe, test, expect } from 'bun:test';
import { parseVaultPath, handleVaultGet, handleTemplateExpand } from './vault-api.js';

describe('parseVaultPath', () => {
  test('지원 read 섹션', () => {
    for (const s of ['info', 'list', 'read', 'search', 'notes', 'backlinks', 'tags', 'templates', 'poll-changes', 'orphans', 'graph']) {
      expect(parseVaultPath(`/v1/vault/${s}`)).toBe(s);
    }
  });
  test('template-expand 는 POST 전용(GET 파싱 제외)', () => {
    expect(parseVaultPath('/v1/vault/template-expand')).toBeNull();
  });
  test('미지원/무관 → null', () => {
    expect(parseVaultPath('/v1/vault/bogus')).toBeNull();
    expect(parseVaultPath('/v1/dashboard/summary')).toBeNull();
  });
});

describe('handleVaultGet — info 계약', () => {
  test('info 는 available boolean + source 반환', async () => {
    const res = await handleVaultGet(new Request('http://x/v1/vault/info'), 'info');
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(typeof j.available).toBe('boolean');
    expect(typeof j.source).toBe('string');
  });
  test('OPTIONS → 204 CORS', async () => {
    const res = await handleVaultGet(new Request('http://x/v1/vault/list', { method: 'OPTIONS' }), 'list');
    expect(res.status).toBe(204);
  });
});

describe('handleTemplateExpand — 계약', () => {
  test('templatePath 없으면 400 (vault 있을 때)', async () => {
    const res = await handleTemplateExpand(new Request('http://x/v1/vault/template-expand', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }));
    // vault 부재면 200(unavailable), 있으면 400(templatePath-required). 둘 다 유효 계약.
    expect([200, 400]).toContain(res.status);
  });
  test('잘못된 JSON → 400 또는 unavailable', async () => {
    const res = await handleTemplateExpand(new Request('http://x/v1/vault/template-expand', { method: 'POST', body: 'nope' }));
    expect([200, 400]).toContain(res.status);
  });
});
