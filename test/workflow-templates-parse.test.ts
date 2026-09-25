// Surface-unification ROADMAP §F1 (2026-05-11) — every starter
// template under samples/workflows/templates/ must parse cleanly so
// PWA's "+ New" picker (F2) can copy them into the user's project
// without surprise validation failures.

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseWorkflowYaml } from '../src/workflow-runtime/parser';

const TEMPLATES_DIR = join(import.meta.dir, '..', 'samples', 'workflows', 'templates');

describe('starter templates parse', () => {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.yaml'));

  it('contains 7 starter templates (F1 spec)', () => {
    expect(files.length).toBe(7);
  });

  for (const f of files) {
    it(`parses ${f} without issues`, () => {
      const yaml = readFileSync(join(TEMPLATES_DIR, f), 'utf-8');
      const result = parseWorkflowYaml(yaml);
      if (!result.ok) {
        // Surface the issues so test output is debuggable.
        // eslint-disable-next-line no-console
        console.error(`Validation issues for ${f}:`, result.issues);
      }
      expect(result.ok).toBe(true);
    });
  }

  it('every template carries _meta.template metadata for the picker', () => {
    for (const f of files) {
      const yaml = readFileSync(join(TEMPLATES_DIR, f), 'utf-8');
      // _meta is stripped by the schema validator (workflows define the
      // executable fields only). Source-level grep is the simplest gate.
      expect(yaml).toContain('_meta:');
      expect(yaml).toContain('template:');
    }
  });
});
