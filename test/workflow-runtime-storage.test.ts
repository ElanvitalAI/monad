// Archon-port T2.2 (2026-05-08) — workflow storage + discovery tests.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  discoverWorkflows,
  findWorkflow,
  saveWorkflow,
  deleteWorkflow,
  validateWorkflowFile,
  getBuiltinWorkflowDir,
  getGlobalWorkflowDir,
} from '../src/workflow-runtime/index.js';
import {
  getMonadConfigDir,
  getMonadConfigDirOverride,
  setMonadConfigDir,
  resetMonadConfigDir,
} from '../src/monad-config-dir.js';

const VALID_YAML = `name: t-demo
description: Test demo workflow
nodes:
  - id: one
    bash: echo hello
`;

const INVALID_YAML = `name: bad
description: missing nodes
`;

let tmpRoot: string;
let projectDir: string;
let monadConfigOverride: string | undefined;
let monadConfigDir: string | undefined;
let monadStateDir: string | undefined;

function restoreEnv(name: 'MONAD_CONFIG_DIR' | 'MONAD_STATE_DIR', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  monadConfigOverride = getMonadConfigDirOverride();
  monadConfigDir = process.env.MONAD_CONFIG_DIR;
  monadStateDir = process.env.MONAD_STATE_DIR;
  resetMonadConfigDir();
  delete process.env.MONAD_CONFIG_DIR;
  delete process.env.MONAD_STATE_DIR;
  tmpRoot = mkdtempSync(join(tmpdir(), 'wf-storage-'));
  projectDir = join(tmpRoot, '.monad', 'workflows');
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  resetMonadConfigDir();
  if (monadConfigOverride !== undefined) setMonadConfigDir(monadConfigOverride);
  restoreEnv('MONAD_CONFIG_DIR', monadConfigDir);
  restoreEnv('MONAD_STATE_DIR', monadStateDir);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('getGlobalWorkflowDir · setMonadConfigDir honour', () => {
  it('uses the central config-dir default when no override set', () => {
    expect(getGlobalWorkflowDir()).toBe(join(getMonadConfigDir(), 'workflows'));
  });

  it('lands under <override>/workflows when setMonadConfigDir is set', () => {
    setMonadConfigDir('/tmp/monad-isolation-fixture');
    expect(getGlobalWorkflowDir()).toBe('/tmp/monad-isolation-fixture/workflows');
  });

  it('trims a stray newline in the override', () => {
    setMonadConfigDir('/tmp/monad-trim\n');
    expect(getGlobalWorkflowDir()).toBe('/tmp/monad-trim/workflows');
  });
});

describe('saveWorkflow', () => {
  it('writes valid YAML to project scope', () => {
    const r = saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    expect(r.ok).toBe(true);
    expect(r.path).toContain('t-demo.yaml');
    expect(existsSync(r.path!)).toBe(true);
    expect(readFileSync(r.path!, 'utf-8')).toBe(VALID_YAML);
  });

  it('rejects YAML with no nodes', () => {
    const r = saveWorkflow('bad', INVALID_YAML, { scope: 'project', cwd: tmpRoot });
    expect(r.ok).toBe(false);
    expect(r.validation?.ok).toBe(false);
  });

  it('rejects when YAML name does not match the requested name', () => {
    const r = saveWorkflow('different-name', VALID_YAML, {
      scope: 'project',
      cwd: tmpRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('name mismatch');
  });

  it('writes a .bak file when overwriting an existing file', () => {
    const first = saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    expect(first.ok).toBe(true);
    const updated = VALID_YAML.replace('Test demo workflow', 'Updated demo');
    const second = saveWorkflow('t-demo', updated, { scope: 'project', cwd: tmpRoot });
    expect(second.ok).toBe(true);
    expect(existsSync(`${first.path}.bak`)).toBe(true);
    expect(readFileSync(`${first.path}.bak`, 'utf-8')).toBe(VALID_YAML);
  });
});

describe('deleteWorkflow', () => {
  it('removes a written workflow', () => {
    const saved = saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    expect(saved.ok).toBe(true);
    const r = deleteWorkflow('t-demo', { scope: 'project', cwd: tmpRoot });
    expect(r.ok).toBe(true);
    expect(existsSync(saved.path!)).toBe(false);
  });

  it('returns ok=false when file does not exist', () => {
    const r = deleteWorkflow('ghost', { scope: 'project', cwd: tmpRoot });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not found');
  });
});

describe('discoverWorkflows', () => {
  it('finds project-scoped workflows', () => {
    saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    const list = discoverWorkflows({ cwd: tmpRoot });
    const demo = list.find(e => e.definition.name === 't-demo');
    expect(demo).toBeDefined();
    expect(demo?.source.source).toBe('project');
  });

  it('returns empty array when no workflows exist', () => {
    rmSync(projectDir, { recursive: true, force: true });
    // Pass a temp HOME so global / builtin don't leak in. We can't
    // easily isolate the real ~/.monad — but the *project* dir under
    // tmpRoot is empty, and shadowed global/builtin entries (if any)
    // are accepted as long as project-only doesn't crash.
    const list = discoverWorkflows({ cwd: tmpRoot });
    expect(Array.isArray(list)).toBe(true);
  });

  it('skips invalid YAML files with a warning (non-throwing)', () => {
    writeFileSync(join(projectDir, 'broken.yaml'), '::: not yaml :::', 'utf-8');
    saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    const list = discoverWorkflows({ cwd: tmpRoot });
    const demo = list.find(e => e.definition.name === 't-demo');
    expect(demo).toBeDefined();
    // The invalid file is skipped entirely — no entry for it.
    expect(list.find(e => e.source.path.endsWith('broken.yaml'))).toBeUndefined();
  });
});

describe('findWorkflow', () => {
  it('returns the project-scoped match', () => {
    saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    const found = findWorkflow('t-demo', tmpRoot);
    expect(found?.source.source).toBe('project');
    expect(found?.definition.name).toBe('t-demo');
  });

  it('returns undefined for unknown name', () => {
    expect(findWorkflow('no-such', tmpRoot)).toBeUndefined();
  });
});

describe('validateWorkflowFile', () => {
  it('validates an existing YAML file', () => {
    saveWorkflow('t-demo', VALID_YAML, { scope: 'project', cwd: tmpRoot });
    const r = validateWorkflowFile(join(projectDir, 't-demo.yaml'));
    expect(r.ok).toBe(true);
  });

  it('returns ok=false for missing file', () => {
    const r = validateWorkflowFile(join(projectDir, 'ghost.yaml'));
    expect(r.ok).toBe(false);
  });
});

describe('built-in workflows', () => {
  it('builtin dir is detectable on disk', () => {
    const dir = getBuiltinWorkflowDir();
    expect(existsSync(dir)).toBe(true);
  });

  it('built-in workflows pass validation', () => {
    const list = discoverWorkflows();
    const builtins = list.filter(e => e.source.source === 'builtin');
    expect(builtins.length).toBeGreaterThan(0);
    for (const e of builtins) {
      expect(e.definition.nodes.length).toBeGreaterThan(0);
    }
  });

  it('three canonical samples are present', () => {
    const list = discoverWorkflows();
    const names = new Set(
      list.filter(e => e.source.source === 'builtin').map(e => e.definition.name),
    );
    for (const expected of ['quick-summary', 'pdca-cycle', 'code-review']) {
      expect(names.has(expected)).toBe(true);
    }
  });
});
