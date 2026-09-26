// Round 1 PR2 (2026-05-08) — share-intake workflow
// (samples/workflows/share-intake.yaml).
//
// Verifies YAML shape, trigger isolation, runtime behaviour with
// stubbed deps (omni-digest skill stub), Obsidian Inbox env override,
// and router regex single-hit on the canonical "intake" / "process
// this" phrases.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'share-intake.yaml');

function loadWorkflow(): WorkflowDefinition {
  return parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;
}

describe('share-intake — YAML shape', () => {
  it('description follows the 4-line "Use when / Triggers / Does / NOT for" conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes all 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('share-intake');
    expect(desc).toContain('process this');
    expect(desc).toContain('intake');
    expect(desc).toContain('이거 처리해줘');
    expect(desc).toContain('공유 처리');
  });

  it('node graph: classify-input → digest → save-to-inbox', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['classify-input', 'digest', 'save-to-inbox']);

    const digest = wf.nodes.find((n) => n.id === 'digest')!;
    expect(digest.depends_on).toEqual(['classify-input']);
    expect((digest as { skill?: string }).skill).toBe('omni-digest');

    const save = wf.nodes.find((n) => n.id === 'save-to-inbox')!;
    expect(save.depends_on).toEqual(['digest']);
  });

  it('uses haiku model hint (high-frequency)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('haiku');
  });

  it('save-to-inbox honors ELANOUS_OBSIDIAN_DIR + writes under Inbox/', () => {
    const wf = loadWorkflow();
    const save = wf.nodes.find((n) => n.id === 'save-to-inbox')! as { bash?: string };
    expect(save.bash).toContain('${ELANOUS_OBSIDIAN_DIR:-$HOME/Documents/Obsidian}');
    expect(save.bash).toContain('Inbox');
    expect(save.bash).toContain('share-$DATE-$TIME.md');
  });
});

describe('share-intake — trigger isolation', () => {
  it('triggers do not substring-overlap with builtin or sibling Round-1 triggers', () => {
    const builtin = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
    ];
    const morningBriefing = ['morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan"];
    const mine = ['share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리'];
    for (const a of mine) {
      for (const b of [...builtin, ...morningBriefing]) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('share-intake — runtime', () => {
  it('classifies URL → digest → save with all deps stubbed', async () => {
    const wf = loadWorkflow();
    const skillCalls: { slug: string; args: string }[] = [];
    const bashBodies: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async () => 'unused-in-this-workflow',
      runBash: async (body) => {
        bashBodies.push(body);
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=url', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          return { stdout: 'saved=/tmp/Obsidian/Inbox/share-2026-05-08-090000.md source=https://example.com', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug, args) => {
        skillCalls.push({ slug, args });
        return `# Example.com\n\nDigested summary of ${args}`;
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'https://example.com', artifactsDir: mkdtempSync(join(tmpdir(), 'share-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls).toEqual([{ slug: 'omni-digest', args: 'https://example.com' }]);

    const saveBash = bashBodies[bashBodies.length - 1];
    expect(saveBash).toContain('Inbox');
    expect(saveBash).toContain('Digested summary');
    expect(saveBash).toContain('https://example.com');
  });

  it('classifies plain text input (no URL)', async () => {
    const wf = loadWorkflow();
    const deps: WorkflowDeps = {
      callLLM: async () => '',
      runBash: async (body) => {
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=text', stderr: '', exitCode: 0 };
        }
        return { stdout: 'saved=/tmp/x', stderr: '', exitCode: 0 };
      },
      runSkill: async (_slug, args) => `(text-digest) ${args}`,
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'random thoughts here', artifactsDir: mkdtempSync(join(tmpdir(), 'share2-')) },
      deps,
    );
    expect(r.ok).toBe(true);
  });

  it('fails fast when omni-digest skill is missing (Q6 default — clear error)', async () => {
    const wf = loadWorkflow();
    const deps: WorkflowDeps = {
      callLLM: async () => '',
      runBash: async () => ({ stdout: 'type=url', stderr: '', exitCode: 0 }),
      // intentionally NO runSkill — runtime fails the skill node
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'https://example.com', artifactsDir: mkdtempSync(join(tmpdir(), 'share3-')) },
      deps,
    );
    expect(r.ok).toBe(false);
  });
});

describe('share-intake — router cascade', () => {
  it('regex single-hit on "process this" phrase — no LLM call', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'si-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => {
        llmCalls += 1;
        return '/invoke-workflow share-intake';
      };
      const r = await routeWorkflow(
        { userMessage: 'please process this URL for me' },
        fakeLLM,
      );
      expect(r.name).toBe('share-intake');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('regex single-hit on Korean "이거 처리해줘"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'si-router2-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nothing';
      const r = await routeWorkflow(
        { userMessage: '이거 처리해줘 https://example.com' },
        fakeLLM,
      );
      expect(r.name).toBe('share-intake');
      expect(r.source).toBe('regex');
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
