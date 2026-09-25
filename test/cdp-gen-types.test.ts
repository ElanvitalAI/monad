import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERATED = resolve(import.meta.dir, '../src/browser-cdp/generated.d.ts');

function readGenerated(): string {
  return readFileSync(GENERATED, 'utf8');
}

describe('generated CDP type bindings', () => {
  test('file exists with auto-gen banner', () => {
    const text = readGenerated();
    expect(text).toMatch(/AUTO-GENERATED/);
    expect(text).toMatch(/devtools-protocol v\d+\.\d+/);
  });

  test('exports major domain namespaces', () => {
    const text = readGenerated();
    for (const ns of ['Page', 'Runtime', 'DOM', 'Network', 'Target', 'Browser']) {
      expect(text).toContain(`export namespace ${ns} {`);
    }
  });

  test('exports NavigateRequest for Page.navigate', () => {
    const text = readGenerated();
    expect(text).toContain('export interface NavigateRequest');
    expect(text).toContain('url: string;');
  });

  test('exports EvaluateRequest for Runtime.evaluate', () => {
    const text = readGenerated();
    expect(text).toContain('export interface EvaluateRequest');
    expect(text).toContain('expression: string;');
  });

  test('CdpCommands map includes Page.navigate and Runtime.evaluate', () => {
    const text = readGenerated();
    expect(text).toContain('"Page.navigate":');
    expect(text).toContain('"Runtime.evaluate":');
  });

  test('CdpEvents map includes Page.loadEventFired', () => {
    const text = readGenerated();
    expect(text).toContain('"Page.loadEventFired":');
  });

  test('exports method/event helper types', () => {
    const text = readGenerated();
    expect(text).toContain('export type CdpMethodName = keyof CdpCommands;');
    expect(text).toContain('export type CdpEventName = keyof CdpEvents;');
    expect(text).toContain("export type CdpMethodParams<M extends CdpMethodName>");
    expect(text).toContain("export type CdpMethodResult<M extends CdpMethodName>");
    expect(text).toContain("export type CdpEventPayload<E extends CdpEventName>");
  });

  test('is deterministically sorted (domains alphabetical)', () => {
    const text = readGenerated();
    const nsMatches = Array.from(text.matchAll(/^export namespace (\w+) \{$/gm), (m) => m[1]!);
    expect(nsMatches.length).toBeGreaterThan(40);
    const sorted = [...nsMatches].sort((a, b) => a.localeCompare(b));
    expect(nsMatches).toEqual(sorted);
  });

  test('CdpCommands entries are deterministically sorted', () => {
    const text = readGenerated();
    const m = text.match(/export interface CdpCommands \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const lines = m![1]!.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const keys = lines.map((l) => {
      const mm = l.match(/^"([^"]+)":/);
      return mm ? mm[1]! : l;
    });
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });
});
