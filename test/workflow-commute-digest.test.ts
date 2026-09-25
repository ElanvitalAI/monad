// Round 4 PR1 (2026-05-08) — commute-digest workflow.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'commute-digest.yaml');
const loadWorkflow = (): WorkflowDefinition =>
  parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;

describe('commute-digest — YAML shape', () => {
  it('description follows the 4-line conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('commute digest');
    expect(desc).toContain('leaving home');
    expect(desc).toContain('출퇴근 정리');
    expect(desc).toContain('운전 준비');
    expect(desc).toContain('transit brief');
  });

  it('node graph: gather-prs + gather-calendar → synthesize → save-commute', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['gather-prs', 'gather-calendar', 'synthesize', 'save-commute']);
    type RawNode = { id: string; depends_on?: string[]; trigger_rule?: string };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));
    expect(byId.get('synthesize')!.depends_on).toEqual(expect.arrayContaining(['gather-prs', 'gather-calendar']));
    expect(byId.get('synthesize')!.trigger_rule).toBe('all_done');
    expect(byId.get('save-commute')!.trigger_rule).toBe('all_done');
  });

  it('uses haiku model (latency-sensitive)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('haiku');
  });
});

describe('commute-digest — runtime', () => {
  it('runs full chain with stubbed deps', async () => {
    const wf = loadWorkflow();
    let saveBody = '';
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        expect(prompt).toContain('Open PRs');
        expect(prompt).toContain('calendar');
        return 'Driving brief: 3 PRs in flight, 9am sync pending. Light day. Drive safe.';
      },
      runBash: async (body) => {
        if (body.includes('command -v gh')) {
          return { stdout: '## Open PRs\n- #2050 R2/R3 closure', stderr: '', exitCode: 0 };
        }
        if (body.includes('MONAD_CALENDAR_CMD')) {
          return { stdout: '- 09:00 sync\n- 14:00 review', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          saveBody = body;
          return { stdout: 'saved=/tmp/Obsidian/Commute/2026-05-08-0830.md date=2026-05-08 time=0830', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'commute-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(saveBody).toContain('Drive safe');
  });
});

describe('commute-digest — trigger isolation', () => {
  it('triggers do not substring-overlap with builtins or any prior workflow', () => {
    const others = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
      'morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan",
      'share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리',
      'voice quick task', 'voice memo', 'monad capture', '음성 받아 적어', 'remember this voice',
      'research deep', 'deep dive', 'deep research', '리서치 딥', '백그라운드 조사',
      'daily standup', 'standup recap', 'EoD recap', '오늘 마감', '야근전 정리',
    ];
    const mine = ['commute digest', 'leaving home', '출퇴근 정리', '운전 준비', 'transit brief'];
    for (const a of mine) {
      for (const b of others) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('commute-digest — router cascade', () => {
  it('regex single-hit on "commute digest"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cd-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.monad', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => { llmCalls += 1; return ''; };
      const r = await routeWorkflow(
        { userMessage: 'fire my commute digest please' },
        fakeLLM,
      );
      expect(r.name).toBe('commute-digest');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
