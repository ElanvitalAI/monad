// #25 P1 — detectGateCommand 외부 target manifest 감지 (2026-07-21).
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGateCommand } from '../src/self-implement/detect-gate.js';

function tmp(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'detect-gate-'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
}
const clean = (d: string): void => { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } };

describe('detectGateCommand — 외부 target manifest 감지(#25 P1)', () => {
  it('package.json + scripts.test + bun.lock → bun test', () => {
    const d = tmp({ 'package.json': JSON.stringify({ scripts: { test: 'bun test' } }), 'bun.lock': '' });
    expect(detectGateCommand(d)).toEqual({ cmd: 'bun', args: ['test'], label: 'bun test' });
    clean(d);
  });
  it('package.json + scripts.test (no bun) → npm test', () => {
    const d = tmp({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) });
    expect(detectGateCommand(d)?.cmd).toBe('npm');
    clean(d);
  });
  it('package.json 빈 test script → 폴스루(null)', () => {
    const d = tmp({ 'package.json': JSON.stringify({ scripts: {} }) });
    expect(detectGateCommand(d)).toBeNull();
    clean(d);
  });
  it('Cargo.toml → cargo test', () => {
    const d = tmp({ 'Cargo.toml': '[package]\nname="x"' });
    expect(detectGateCommand(d)).toEqual({ cmd: 'cargo', args: ['test'], label: 'cargo test' });
    clean(d);
  });
  it('pyproject.toml → pytest', () => {
    const d = tmp({ 'pyproject.toml': '[tool]' });
    expect(detectGateCommand(d)?.label).toBe('pytest');
    clean(d);
  });
  it('go.mod → go test', () => {
    const d = tmp({ 'go.mod': 'module x' });
    expect(detectGateCommand(d)?.cmd).toBe('go');
    clean(d);
  });
  it('Makefile test 타깃 → make test', () => {
    const d = tmp({ Makefile: 'test:\n\techo hi\n' });
    expect(detectGateCommand(d)?.label).toBe('make test');
    clean(d);
  });
  it('Makefile test 타깃 없음 → null', () => {
    const d = tmp({ Makefile: 'build:\n\techo hi\n' });
    expect(detectGateCommand(d)).toBeNull();
    clean(d);
  });
  it('manifest 없음 → null(skip-with-warn)', () => {
    const d = tmp({ 'README.md': '# x' });
    expect(detectGateCommand(d)).toBeNull();
    clean(d);
  });
});
