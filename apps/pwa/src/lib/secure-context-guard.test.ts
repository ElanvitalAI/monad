import { describe, expect, it } from 'bun:test';

import { classifySecureContext } from './secure-context-guard';

describe('classifySecureContext', () => {
  describe('localhost — exempt regardless of protocol', () => {
    it('localhost over http is secure', () => {
      const r = classifySecureContext('http:', 'localhost');
      expect(r.isSecure).toBe(true);
      expect(r.reason).toBe('localhost');
      expect(r.guidance).toBeUndefined();
    });

    it('127.0.0.1 over http is secure', () => {
      expect(classifySecureContext('http:', '127.0.0.1').reason).toBe('localhost');
    });

    it('IPv6 ::1 is secure', () => {
      expect(classifySecureContext('http:', '::1').reason).toBe('localhost');
      expect(classifySecureContext('http:', '[::1]').reason).toBe('localhost');
    });
  });

  describe('Tailscale ts.net HTTPS — recommended dogfood path', () => {
    it('https *.ts.net is secure with reason https-tsnet', () => {
      const r = classifySecureContext('https:', 'mbp.tailnet-abc.ts.net');
      expect(r.isSecure).toBe(true);
      expect(r.reason).toBe('https-tsnet');
    });

    it('case-insensitive ts.net match', () => {
      expect(classifySecureContext('https:', 'mbp.TAILNET.TS.NET').reason).toBe('https-tsnet');
    });

    it('http *.ts.net is treated as http-other (Tailscale serve always issues HTTPS — http means misconfig)', () => {
      const r = classifySecureContext('http:', 'mbp.tailnet.ts.net');
      expect(r.isSecure).toBe(false);
      expect(r.reason).toBe('http-other');
    });
  });

  describe('Tailscale 100.x CGNAT over HTTP — most common dogfood failure', () => {
    it('100.64.x.x over http is insecure with http-tailscale guidance', () => {
      const r = classifySecureContext('http:', '100.64.1.5');
      expect(r.isSecure).toBe(false);
      expect(r.reason).toBe('http-tailscale');
      expect(r.guidance).toContain('ts.net');
    });

    it('100.127.x.x (top of CGNAT range) is also detected', () => {
      expect(classifySecureContext('http:', '100.127.255.254').reason).toBe('http-tailscale');
    });

    it('100.63.x.x (one below CGNAT range) is NOT classified as tailscale', () => {
      expect(classifySecureContext('http:', '100.63.0.1').reason).toBe('http-other');
    });

    it('100.128.x.x (one above CGNAT range) is NOT classified as tailscale', () => {
      expect(classifySecureContext('http:', '100.128.0.1').reason).toBe('http-other');
    });

    it('100.x over https is secure (Tailscale + own cert — rare but valid)', () => {
      expect(classifySecureContext('https:', '100.64.1.5').isSecure).toBe(true);
    });
  });

  describe('generic HTTPS / HTTP', () => {
    it('https example.com is secure with https-other', () => {
      const r = classifySecureContext('https:', 'example.com');
      expect(r.isSecure).toBe(true);
      expect(r.reason).toBe('https-other');
    });

    it('http example.com is insecure with generic guidance', () => {
      const r = classifySecureContext('http:', 'example.com');
      expect(r.isSecure).toBe(false);
      expect(r.reason).toBe('http-other');
      expect(r.guidance).toBeDefined();
    });

    it('unknown protocol (file:, blob:) is insecure unknown', () => {
      const r = classifySecureContext('file:', '');
      expect(r.isSecure).toBe(false);
      expect(r.reason).toBe('unknown');
    });
  });

  describe('hostname / protocol round-trip', () => {
    it('preserves hostname in result', () => {
      expect(classifySecureContext('https:', 'foo.ts.net').hostname).toBe('foo.ts.net');
    });

    it('preserves protocol with trailing colon', () => {
      expect(classifySecureContext('https:', 'foo.ts.net').protocol).toBe('https:');
    });
  });
});
