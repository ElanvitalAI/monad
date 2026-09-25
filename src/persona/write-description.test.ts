// PR #3022 Phase 3 — persona description surgical edit tests.
//
// 목표: yaml 의 다른 field / comment / key ordering 가 보존되는지 검증.
// Real-IO tmpdir round-trip (parser fragility 노출 위해 mock 회피).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  MAX_PERSONA_DESCRIPTION_LENGTH,
  personaYamlPath,
  updatePersonaDescription,
} from './write-description';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monad-persona-write-test-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writePersonaFile(id: string, body: string): string {
  const p = personaYamlPath(tmpDir, id);
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function readBack(id: string): string {
  return fs.readFileSync(personaYamlPath(tmpDir, id), 'utf-8');
}

describe('updatePersonaDescription — surgical replace', () => {
  test('replaces existing description line', () => {
    writePersonaFile('pragmatist', [
      'personaId: pragmatist',
      'displayName: Pragmatist',
      'description: Old description here.',
      'brandColor: "#3b82f6"',
      '',
    ].join('\n'));

    const r = updatePersonaDescription(tmpDir, 'pragmatist', 'New crisp description.');
    expect(r.ok).toBe(true);

    const text = readBack('pragmatist');
    expect(text).toContain('description: "New crisp description."');
    expect(text).not.toContain('Old description here.');
    // other fields preserved
    expect(text).toContain('displayName: Pragmatist');
    expect(text).toContain('brandColor: "#3b82f6"');
  });

  test('preserves comments + custom (loader-unknown) keys', () => {
    writePersonaFile('contrarian', [
      '# Top-of-file comment',
      'personaId: contrarian',
      'displayName: Contrarian',
      '# inline comment about description',
      'description: prior',
      'customField: should-survive',  // not in PersonaProfile type
      '',
    ].join('\n'));

    const r = updatePersonaDescription(tmpDir, 'contrarian', 'Plays devil advocate.');
    expect(r.ok).toBe(true);

    const text = readBack('contrarian');
    expect(text).toContain('# Top-of-file comment');
    expect(text).toContain('# inline comment about description');
    expect(text).toContain('customField: should-survive');
    expect(text).toContain('description: "Plays devil advocate."');
  });

  test('inserts description after personaId when absent', () => {
    writePersonaFile('sage', [
      'personaId: sage',
      'displayName: Sage',
      'brandColor: "#f59e0b"',
      '',
    ].join('\n'));

    const r = updatePersonaDescription(tmpDir, 'sage', 'Thoughtful elder.');
    expect(r.ok).toBe(true);

    const text = readBack('sage');
    expect(text).toContain('personaId: sage\ndescription: "Thoughtful elder."');
  });

  test('escapes special characters (quote · backslash · newline)', () => {
    writePersonaFile('_default', 'personaId: _default\ndisplayName: Default\n');

    const r = updatePersonaDescription(
      tmpDir,
      '_default',
      'has "quote" and \\backslash and\nnewline.',
    );
    expect(r.ok).toBe(true);

    const text = readBack('_default');
    expect(text).toContain('"has \\"quote\\" and \\\\backslash and\\nnewline."');
    const parsed = parseYaml(text) as { description: string };
    expect(parsed.description).toBe('has "quote" and \\backslash and\nnewline.');
  });
});

describe('updatePersonaDescription — failure modes', () => {
  test('reports file-not-found', () => {
    const r = updatePersonaDescription(tmpDir, 'ghost', 'anything');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('file-not-found');
  });

  test('reports description-too-long', () => {
    writePersonaFile('long', 'personaId: long\ndisplayName: L\n');
    const tooLong = 'x'.repeat(MAX_PERSONA_DESCRIPTION_LENGTH + 1);
    const r = updatePersonaDescription(tmpDir, 'long', tooLong);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('description-too-long');
  });

  test('accepts exactly MAX_PERSONA_DESCRIPTION_LENGTH', () => {
    writePersonaFile('cap', 'personaId: cap\ndisplayName: C\n');
    const exact = 'y'.repeat(MAX_PERSONA_DESCRIPTION_LENGTH);
    const r = updatePersonaDescription(tmpDir, 'cap', exact);
    expect(r.ok).toBe(true);
  });

  test('trims whitespace before length check', () => {
    writePersonaFile('trim', 'personaId: trim\ndisplayName: T\n');
    const padded = `   ${'z'.repeat(MAX_PERSONA_DESCRIPTION_LENGTH)}    `;
    const r = updatePersonaDescription(tmpDir, 'trim', padded);
    expect(r.ok).toBe(true);
    const text = readBack('trim');
    const parsed = parseYaml(text) as { description: string };
    expect(parsed.description.startsWith('z')).toBe(true);
    expect(parsed.description.length).toBe(MAX_PERSONA_DESCRIPTION_LENGTH);
  });

  test('empty string clears description', () => {
    writePersonaFile('emp', 'personaId: emp\ndisplayName: E\ndescription: existing\n');
    const r = updatePersonaDescription(tmpDir, 'emp', '');
    expect(r.ok).toBe(true);
    const text = readBack('emp');
    expect(text).toContain('description: ""');
    expect(text).not.toContain('existing');
  });
});

describe('updatePersonaDescription — atomicity', () => {
  test('does not leave .tmp files behind on success', () => {
    writePersonaFile('atomic', 'personaId: atomic\ndisplayName: A\n');
    const r = updatePersonaDescription(tmpDir, 'atomic', 'New.');
    expect(r.ok).toBe(true);
    const entries = fs.readdirSync(tmpDir);
    const tmpFiles = entries.filter((e) => e.includes('.tmp-'));
    expect(tmpFiles.length).toBe(0);
  });
});
