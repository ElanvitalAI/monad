// Round 1 PR4 (2026-05-08) — research-deep workflow
// (samples/workflows/research-deep.yaml).
//
// Multi-skill chain: crawl → digest (rich) → diagram → save.
// Verifies YAML shape, trigger isolation, runtime carry-over of
// crawl→digest→diagram outputs, all_done resilience when diagram
// fails, and router regex single-hit on canonical phrases.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'research-deep.yaml');

function loadWorkflow(): WorkflowDefinition {
  return parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;
}

describe('research-deep — YAML shape', () => {
  it('description follows the 4-line conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes all 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('research deep');
    expect(desc).toContain('deep dive');
    expect(desc).toContain('deep research');
    expect(desc).toContain('리서치 딥');
    expect(desc).toContain('백그라운드 조사');
  });

  it('node graph: crawl → digest → diagram → save (4-stage chain)', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['crawl', 'digest', 'diagram', 'save']);

    type RawNode = { id: string; skill?: string; trigger_rule?: string; depends_on?: string[] };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));

    expect(byId.get('crawl')!.skill).toBe('omni-crawl');
    expect(byId.get('digest')!.skill).toBe('omni-digest');
    expect(byId.get('digest')!.depends_on).toEqual(['crawl']);

    const diagram = byId.get('diagram')!;
    expect(diagram.skill).toBe('diagram-master');
    expect(diagram.depends_on).toEqual(['digest']);
    expect(diagram.trigger_rule).toBe('all_done');

    const save = byId.get('save')!;
    expect(save.depends_on).toEqual(['digest', 'diagram']);
    expect(save.trigger_rule).toBe('all_done');
  });

  it('uses sonnet model hint (quality-sensitive)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('sonnet');
  });
});

describe('research-deep — trigger isolation', () => {
  it('triggers do not substring-overlap with builtins / morning / share / voice', () => {
    const builtin = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
    ];
    const morning = ['morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan"];
    const share = ['share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리'];
    const voice = ['voice quick task', 'voice memo', 'monad capture', '음성 받아 적어', 'remember this voice'];
    const mine = ['research deep', 'deep dive', 'deep research', '리서치 딥', '백그라운드 조사'];
    for (const a of mine) {
      for (const b of [...builtin, ...morning, ...share, ...voice]) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('research-deep — runtime: full chain happy path', () => {
  it('carries crawl → digest → diagram outputs into save bash', async () => {
    const wf = loadWorkflow();
    const skillCalls: { slug: string; args: string }[] = [];
    const bashBodies: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async () => 'unused',
      runBash: async (body) => {
        bashBodies.push(body);
        if (body.includes('OBSIDIAN_DIR')) {
          return { stdout: 'saved=/tmp/Obsidian/Research/2026-05-08-090000.md topic=monad-mesh', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug, args) => {
        skillCalls.push({ slug, args });
        if (slug === 'omni-crawl') return 'CRAWL[X+Grok+Firecrawl results for monad-mesh]';
        if (slug === 'omni-digest') return 'DIGEST[rich · 5 sources synthesized]';
        if (slug === 'diagram-master') return 'DIAGRAM[mermaid flow chart]';
        return 'unknown';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'monad-mesh', artifactsDir: mkdtempSync(join(tmpdir(), 'research-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls.map((c) => c.slug)).toEqual(['omni-crawl', 'omni-digest', 'diagram-master']);

    // digest should receive crawl output via interpolation
    const digestArgs = skillCalls.find((c) => c.slug === 'omni-digest')!.args;
    expect(digestArgs).toContain('Mode: rich');
    expect(digestArgs).toContain('Topic: monad-mesh');
    expect(digestArgs).toContain('CRAWL[X+Grok+Firecrawl');

    // diagram should receive digest output
    const diagramArgs = skillCalls.find((c) => c.slug === 'diagram-master')!.args;
    expect(diagramArgs).toContain('DIGEST[rich');

    // save bash should embed all 3 prior outputs
    const saveBody = bashBodies[bashBodies.length - 1];
    expect(saveBody).toContain('OBSIDIAN_DIR');
    expect(saveBody).toContain('Research');
    expect(saveBody).toContain('CRAWL[X+Grok');
    expect(saveBody).toContain('DIGEST[rich');
    expect(saveBody).toContain('DIAGRAM[mermaid');
  });
});

describe('research-deep — runtime: diagram failure does NOT kill save', () => {
  it('save still runs (trigger_rule=all_done) when diagram-master fails', async () => {
    const wf = loadWorkflow();
    let saveBody = '';
    const deps: WorkflowDeps = {
      callLLM: async () => '',
      runBash: async (body) => {
        if (body.includes('OBSIDIAN_DIR')) {
          saveBody = body;
          return { stdout: 'saved=/tmp/Research/x.md topic=t', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug, _args) => {
        if (slug === 'omni-crawl') return 'crawl-out';
        if (slug === 'omni-digest') return 'digest-out';
        if (slug === 'diagram-master') throw new Error('diagram-master skill not installed');
        return '';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'topic', artifactsDir: mkdtempSync(join(tmpdir(), 'research2-')) },
      deps,
    );
    // save runs because save.trigger_rule=all_done lets the chain
    // continue past the diagram failure. The downstream-all_done
    // resilience also suppresses workflow_failed (executor.ts §120-126),
    // so r.ok stays true even though diagram errored.
    expect(saveBody).toContain('crawl-out');
    expect(saveBody).toContain('digest-out');
    expect(r.ok).toBe(true);
    // diagram node still surfaces the error in its NodeOutput
    const diagramOut = r.outputs?.['diagram'] as { ok?: boolean; error?: string } | undefined;
    if (diagramOut) {
      expect(diagramOut.ok).toBe(false);
    }
  });
});

describe('research-deep — router cascade', () => {
  it('regex single-hit on "deep dive"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rd-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.monad', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => {
        llmCalls += 1;
        return '/invoke-workflow research-deep';
      };
      const r = await routeWorkflow(
        { userMessage: 'I want a deep dive on workflow routing' },
        fakeLLM,
      );
      expect(r.name).toBe('research-deep');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('regex single-hit on Korean "백그라운드 조사"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rd-router2-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.monad', 'workflows'), { recursive: true });
      const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nothing';
      const r = await routeWorkflow(
        { userMessage: '백그라운드 조사 좀 부탁해' },
        fakeLLM,
      );
      expect(r.name).toBe('research-deep');
      expect(r.source).toBe('regex');
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
