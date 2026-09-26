// Round 1 PR1 (2026-05-08) — morning-briefing workflow
// (samples/workflows/morning-briefing.yaml).
//
// Verifies the YAML shape (4-line description conv, trigger phrases,
// node DAG), runtime behaviour with stubbed deps, graceful gh-missing
// skip, ELANOUS_OBSIDIAN_DIR env literal, and router regex cascade
// (single-hit, no LLM call) for the canonical trigger.

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  runWorkflowToCompletion,
  type WorkflowDeps,
  type WorkflowDefinition,
} from '../src/workflow-runtime/index.js';
import { routeWorkflow, type RouterLLMCaller } from '../src/nexus/api/workflow-router.js';

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'morning-briefing.yaml');

function loadWorkflow(): WorkflowDefinition {
  return parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;
}

describe('morning-briefing — YAML shape', () => {
  it('description follows the 4-line "Use when / Triggers / Does / NOT for" conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes all 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('morning briefing');
    expect(desc).toContain("what's today");
    expect(desc).toContain('오늘 뭐 해야 해');
    expect(desc).toContain('daily kickoff');
    expect(desc).toContain("today's plan");
  });

  it('node graph: gather-git + gather-prs → synthesize → save-daily-note', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['gather-git', 'gather-prs', 'synthesize', 'save-daily-note']);

    const synth = wf.nodes.find((n) => n.id === 'synthesize')!;
    expect(synth.depends_on).toEqual(expect.arrayContaining(['gather-git', 'gather-prs']));

    const save = wf.nodes.find((n) => n.id === 'save-daily-note')!;
    expect(save.depends_on).toEqual(['synthesize']);
  });

  it('uses haiku model hint (cost-conscious daily run)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('haiku');
  });

  it('save-daily-note honors ELANOUS_OBSIDIAN_DIR env override', () => {
    const wf = loadWorkflow();
    const save = wf.nodes.find((n) => n.id === 'save-daily-note')! as { bash?: string };
    expect(save.bash).toContain('${ELANOUS_OBSIDIAN_DIR:-$HOME/Documents/Obsidian}');
    expect(save.bash).toContain('Daily Notes');
  });
});

describe('morning-briefing — trigger isolation', () => {
  it('triggers do not substring-overlap with the 4 builtin workflow triggers', () => {
    const builtin = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
    ];
    const mine = ['morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan"];
    for (const a of mine) {
      for (const b of builtin) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('morning-briefing — runtime', () => {
  it('runs to completion with stubbed deps + carries prior outputs into synthesize prompt', async () => {
    const wf = loadWorkflow();
    const promptCalls: string[] = [];
    const bashBodies: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        promptCalls.push(prompt);
        return '## Today\nbusy day.\n\n## Top 3 today\n- ship PR #2040\n- review PR #2041\n- write Round 1 closure\n\n## Watch / Blocked\n- none';
      },
      runBash: async (body) => {
        bashBodies.push(body);
        if (body.includes("git log --since='yesterday.midnight'")) {
          return { stdout: "## Yesterday's commits\n- abc1234 fix flaky test", stderr: '', exitCode: 0 };
        }
        if (body.includes('command -v gh')) {
          return { stdout: '## Open PRs (mine)\n- #2040 morning-briefing workflow (open)', stderr: '', exitCode: 0 };
        }
        if (body.includes('ELANOUS_OBSIDIAN_DIR')) {
          return { stdout: 'saved=/tmp/Obsidian/Daily Notes/2026-05-08.md date=2026-05-08 time=08:00', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'morning-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]).toContain('Yesterday');
    expect(promptCalls[0]).toContain('Open PRs (mine)');
    expect(promptCalls[0]).toContain('Top 3 today');

    const lastBash = bashBodies[bashBodies.length - 1];
    expect(lastBash).toContain('ELANOUS_OBSIDIAN_DIR');
    expect(lastBash).toContain('Top 3 today');
  });

  it('graceful skip when gh CLI is missing — install hint surfaced + workflow continues', async () => {
    const wf = loadWorkflow();
    let prsBody = '';
    const deps: WorkflowDeps = {
      callLLM: async () => 'ok',
      runBash: async (body) => {
        if (body.includes('command -v gh')) {
          prsBody = body;
          return {
            stdout: '(gh CLI not installed — skipping PR section)\nInstall hint: brew install gh && gh auth login',
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'mb-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(prsBody).toContain('command -v gh');
    expect(prsBody).toContain('Install hint');
    expect(prsBody).toContain('brew install gh');
  });
});

describe('morning-briefing — router cascade', () => {
  it('regex single-hit on "morning briefing" — no LLM call', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mb-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCallCount = 0;
      const fakeLLM: RouterLLMCaller = async () => {
        llmCallCount += 1;
        return '/invoke-workflow morning-briefing';
      };
      const r = await routeWorkflow(
        { userMessage: 'please run my morning briefing' },
        fakeLLM,
      );
      expect(r.name).toBe('morning-briefing');
      expect(r.source).toBe('regex');
      expect(r.error).toBeUndefined();
      expect(llmCallCount).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('regex single-hit on "today\'s plan" — picks morning-briefing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mb-router2-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nothing';
      const r = await routeWorkflow(
        { userMessage: "let's see today's plan" },
        fakeLLM,
      );
      expect(r.name).toBe('morning-briefing');
      expect(r.source).toBe('regex');
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
