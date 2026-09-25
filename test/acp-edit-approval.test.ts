// ACP edit-approval default = auto-approve (autonomous delegation).
// Asking the human to approve every delegated edit is the interactive-editor
// paradigm ACP inherited; it defeats autonomous telegram delegation. So
// PERMISSION requests auto-approve by default; per-edit oversight is opt-in
// via `acp.editApproval`. Structured QUESTIONS still surface regardless.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig, saveUserConfig } from '../src/user-config';

let dir: string;
function writeCfg(obj: Record<string, unknown>): string {
  dir = mkdtempSync(join(tmpdir(), 'acp-appr-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify(obj), 'utf-8');
  return p;
}

describe('acp.editApproval config', () => {
  test('defaults OFF (autonomous auto-approve) when absent', () => {
    const cfg = buildUserConfig(writeCfg({ acp: {} }));
    expect(cfg.acp.editApproval).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test('parses true (opt-in oversight)', () => {
    const cfg = buildUserConfig(writeCfg({ acp: { editApproval: true } }));
    expect(cfg.acp.editApproval).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('round-trips through saveUserConfig', () => {
    const cfg = buildUserConfig(writeCfg({ acp: { editApproval: true } }));
    const out = join(dir, 'out.json');
    saveUserConfig(cfg, out);
    const stored = JSON.parse(readFileSync(out, 'utf-8'));
    expect(stored.acp.editApproval).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// Source-level wire guard — the approvers are module-private and hard to
// unit-drive, so assert the auto-approve-by-default posture at the source
// (per feedback_source_level_grep_test_value). A dropped gate would silently
// revert to babysitting.
describe('approver auto-approve default (source guard)', () => {
  test('turn-runner surfacePermissionApprover gates on editApproval + returns true by default', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'src/acp/turn-runner.ts'), 'utf-8');
    expect(src).toMatch(/editApproval\s*=\s*getUserConfig\(\)\.acp\?\.editApproval === true/);
    // no editApproval / no channels → auto-approve
    expect(src).toMatch(/if \(!editApproval \|\| !channels \|\| channels\.length === 0\) return true;/);
  });

  test('delegate-agent asks permission only when interactive AND editApproval', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'src/boot/daemon-tools/delegate-agent.ts'), 'utf-8');
    expect(src).toMatch(/const askPermission = interactive && editApproval/);
    // questions still surface when interactive (independent of editApproval)
    expect(src).toContain('questionApprover: createAcpQuestionApproverFromHitl');
  });
});
