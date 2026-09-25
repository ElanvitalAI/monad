// ── PFC-S3.3 P2: Poka-Yoke + obsidian-bridge integration ──

import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  guardedWriteNote,
  type ObsidianVault,
} from '../src/auto-research/obsidian-bridge';
import type { PokaSchema } from '../src/cft/pokayoke';
import { buildAndonPreamble, clearAllEscalationsForTest, listEscalations } from '../src/cft/andon';

function freshVault(): ObsidianVault {
  const dir = mkdtempSync(join(tmpdir(), 'pokayoke-bridge-'));
  return { root: dir, isSimulated: true, label: 't' };
}

const fmSchema: PokaSchema = {
  kind: 'object',
  shape: {
    severity: { kind: 'enum', values: ['LOW', 'MED', 'HIGH', 'CRITICAL'] },
    title: { kind: 'string', min: 1 },
  },
  required: ['severity', 'title'],
};

beforeEach(() => {
  clearAllEscalationsForTest();
});

describe('guardedWriteNote — valid content writes', () => {
  test('schema pass → file created, {ok:true, path}', async () => {
    const vault = freshVault();
    const content = '---\nseverity: LOW\ntitle: OK\n---\n\nbody text here\n';
    const r = await guardedWriteNote(vault, 'notes/a.md', content, {
      frontmatterSchema: fmSchema,
      skipAndon: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(existsSync(r.path)).toBe(true);
      expect(readFileSync(r.path, 'utf-8')).toBe(content);
    }
  });
});

describe('guardedWriteNote — invalid content blocked', () => {
  test('schema fail → file NOT created + errors', async () => {
    const vault = freshVault();
    // Missing required fields.
    const content = '---\n---\nbody\n';
    const relPath = 'notes/bad.md';
    const r = await guardedWriteNote(vault, relPath, content, {
      frontmatterSchema: fmSchema,
      skipAndon: true,
    });
    expect(r.ok).toBe(false);
    expect(existsSync(join(vault.root, relPath))).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.reasonOneLine).toContain(relPath);
    }
  });

  test('escalateOnFailure=true emits Andon MED by default', async () => {
    const vault = freshVault();
    const content = 'no frontmatter';
    const r = await guardedWriteNote(vault, 'notes/x.md', content, {
      frontmatterSchema: fmSchema,
    });
    expect(r.ok).toBe(false);
    const pending = listEscalations();
    expect(pending.length).toBe(1);
    expect(pending[0]!.severity).toBe('MED');
    expect(pending[0]!.agentId).toBe('pokayoke:writeNote');
    // MED should NOT trigger the Andon preamble (CRITICAL-gated).
    expect(buildAndonPreamble()).toBeNull();
  });

  test('failureSeverity=CRITICAL escalates to Andon preamble', async () => {
    const vault = freshVault();
    const r = await guardedWriteNote(vault, 'notes/y.md', 'short', {
      minBodyLength: 100,
      failureSeverity: 'CRITICAL',
    });
    expect(r.ok).toBe(false);
    expect(buildAndonPreamble()).not.toBeNull();
  });
});
