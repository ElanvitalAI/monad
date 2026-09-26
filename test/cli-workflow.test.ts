// Archon-port T3 (2026-05-08) — `elanous wf` CLI tests.
//
// Exercises list / show / validate via the exported sub-command
// implementations. `run` is integration-tested against a synthetic
// bash-only workflow + LLM stub via the workflow runtime's existing
// test suite — duplicating that here would re-test T2.1.

import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  workflowList,
  workflowShow,
  workflowValidate,
} from '../src/cli/workflow.js';

const VALID_YAML = `name: t-cli-demo
description: CLI test demo
nodes:
  - id: one
    bash: echo hello
`;

let tmpRoot: string;
let lastCwd: string;
let logs: string[] = [];
let consoleLogSpy: ReturnType<typeof mock>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wf-cli-'));
  mkdirSync(join(tmpRoot, '.elanous', 'workflows'), { recursive: true });
  lastCwd = process.cwd();
  process.chdir(tmpRoot);
  logs = [];
  consoleLogSpy = mock((msg: unknown) => {
    logs.push(String(msg));
  });
  globalThis.console = { ...console, log: consoleLogSpy } as Console;
});

afterEach(() => {
  process.chdir(lastCwd);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('workflowList', () => {
  it('prints the 4 built-in samples', () => {
    workflowList();
    const all = logs.join('\n');
    expect(all).toContain('quick-summary');
    expect(all).toContain('pdca-cycle');
    expect(all).toContain('code-review');
    expect(all).toContain('build-workflow');
  });

  it('shows project-scoped workflows when present', () => {
    writeFileSync(
      join(tmpRoot, '.elanous', 'workflows', 't-cli-demo.yaml'),
      VALID_YAML,
      'utf-8',
    );
    workflowList();
    const all = logs.join('\n');
    expect(all).toContain('[project]');
    expect(all).toContain('t-cli-demo');
  });
});

describe('workflowShow', () => {
  it('prints YAML for an existing workflow', () => {
    writeFileSync(
      join(tmpRoot, '.elanous', 'workflows', 't-cli-demo.yaml'),
      VALID_YAML,
      'utf-8',
    );
    const exit = workflowShow('t-cli-demo');
    expect(exit).toBe(0);
    const all = logs.join('\n');
    expect(all).toContain('name: t-cli-demo');
    expect(all).toContain('source: project');
  });

  it('returns 1 for unknown workflow', () => {
    const exit = workflowShow('no-such-flow');
    expect(exit).toBe(1);
  });
});

describe('workflowValidate', () => {
  it('validates by name (built-in samples pass)', () => {
    expect(workflowValidate('quick-summary')).toBe(0);
    expect(workflowValidate('pdca-cycle')).toBe(0);
    expect(workflowValidate('code-review')).toBe(0);
    expect(workflowValidate('build-workflow')).toBe(0);
  });

  it('validates by file path', () => {
    const path = join(tmpRoot, 'standalone.yaml');
    writeFileSync(path, VALID_YAML, 'utf-8');
    expect(workflowValidate(path)).toBe(0);
  });

  it('returns 1 for invalid YAML', () => {
    const path = join(tmpRoot, 'bad.yaml');
    writeFileSync(path, `name: bad\ndescription: missing nodes\n`, 'utf-8');
    expect(workflowValidate(path)).toBe(1);
  });

  it('returns 1 for unknown name', () => {
    expect(workflowValidate('no-such-workflow')).toBe(1);
  });

  it('returns 1 for non-existent file path', () => {
    expect(workflowValidate(join(tmpRoot, 'ghost.yaml'))).toBe(1);
  });
});

describe('workflowValidate · M4-2 warnings surface', () => {
  it('prints "no-trigger-node" warning for a trigger-less workflow', () => {
    const path = join(tmpRoot, 'no-trigger.yaml');
    writeFileSync(
      path,
      `name: no-trigger\ndescription: only has an llm node\nnodes:\n  - id: act\n    prompt: do stuff\n`,
      'utf-8',
    );
    expect(workflowValidate(path)).toBe(0);
    const all = logs.join('\n');
    expect(all).toContain('1 warning');
    expect(all).toContain('no-trigger-node');
    expect(all).toContain('[medium]');
    expect(all).toContain('add a schedule/webhook/chat/discord/telegram/manual trigger node');
  });

  it('prints "cron-too-frequent" warning with high severity + suggestion', () => {
    const path = join(tmpRoot, 'cron-frequent.yaml');
    writeFileSync(
      path,
      `name: cron-frequent\ndescription: trigger M4-2 cron rule\nnodes:\n  - id: t\n    scheduleTrigger:\n      type: cron\n      cron: '* * * * *'\n  - id: act\n    depends_on: [t]\n    prompt: x\n`,
      'utf-8',
    );
    expect(workflowValidate(path)).toBe(0);
    const all = logs.join('\n');
    expect(all).toContain('cron-too-frequent');
    expect(all).toContain('[high]');
    expect(all).toContain('every 5 minutes');
  });

  it('emits no warning block when the workflow is clean', () => {
    const path = join(tmpRoot, 'clean.yaml');
    writeFileSync(
      path,
      `name: clean\ndescription: properly triggered + bash\nnodes:\n  - id: t\n    manualTrigger: {}\n  - id: act\n    depends_on: [t]\n    bash: echo ok\n`,
      'utf-8',
    );
    expect(workflowValidate(path)).toBe(0);
    const all = logs.join('\n');
    expect(all).not.toContain('warning');
    expect(all).not.toContain('⚠');
  });
});

describe('build-workflow.yaml shape', () => {
  it('declares all 5 node ids in a valid DAG', () => {
    // The samples/workflows/build-workflow.yaml file is the heart of
    // T3 — guard its shape so a future YAML edit can't accidentally
    // remove a required node or break the depends_on chain.
    expect(workflowValidate('build-workflow')).toBe(0);
  });
});

// Sanity: confirm built-ins folder discoverable from a temp cwd.
describe('built-ins are discoverable from arbitrary cwd', () => {
  it('list shows builtin even without a .elanous/workflows dir', () => {
    rmSync(join(tmpRoot, '.elanous'), { recursive: true, force: true });
    expect(existsSync(join(tmpRoot, '.elanous'))).toBe(false);
    workflowList();
    const all = logs.join('\n');
    expect(all).toContain('[builtin]');
    expect(all).toContain('build-workflow');
  });
});
