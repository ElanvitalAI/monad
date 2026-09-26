// Round 1 PR5 (2026-05-08) — daily-standup workflow
// (samples/workflows/daily-standup.yaml).
//
// Verifies YAML shape, trigger isolation vs builtins + 4 sibling
// Round-1 workflows, runtime carry-over, env-gated broadcast intent
// emission (ELANOUS_STANDUP_CHANNEL), and router regex single-hit on
// canonical EN + KR phrases.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'daily-standup.yaml');

function loadWorkflow(): WorkflowDefinition {
  return parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;
}

describe('daily-standup — YAML shape', () => {
  it('description follows the 4-line conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes all 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('daily standup');
    expect(desc).toContain('standup recap');
    expect(desc).toContain('EoD recap');
    expect(desc).toContain('오늘 마감');
    expect(desc).toContain('야근전 정리');
  });

  it('node graph: gather-today → synthesize → save-standup → broadcast', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['gather-today', 'synthesize', 'save-standup', 'broadcast']);

    type RawNode = { id: string; depends_on?: string[]; trigger_rule?: string; bash?: string };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));

    expect(byId.get('synthesize')!.depends_on).toEqual(['gather-today']);
    expect(byId.get('save-standup')!.depends_on).toEqual(['synthesize']);
    expect(byId.get('broadcast')!.depends_on).toEqual(['save-standup']);
    expect(byId.get('broadcast')!.trigger_rule).toBe('all_done');

    expect(byId.get('save-standup')!.bash).toContain('${ELANOUS_OBSIDIAN_DIR:-$HOME/Documents/Obsidian}');
    expect(byId.get('save-standup')!.bash).toContain('Standup');
    expect(byId.get('broadcast')!.bash).toContain('${ELANOUS_STANDUP_CHANNEL:-}');
  });

  it('uses haiku model hint (cost-conscious daily run)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('haiku');
  });
});

describe('daily-standup — trigger isolation', () => {
  it('triggers do not substring-overlap with builtins or any sibling Round-1 workflow', () => {
    const builtin = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
    ];
    const morning = ['morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan"];
    const share = ['share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리'];
    const voice = ['voice quick task', 'voice memo', 'elanous capture', '음성 받아 적어', 'remember this voice'];
    const research = ['research deep', 'deep dive', 'deep research', '리서치 딥', '백그라운드 조사'];
    const mine = ['daily standup', 'standup recap', 'EoD recap', '오늘 마감', '야근전 정리'];
    for (const a of mine) {
      for (const b of [...builtin, ...morning, ...share, ...voice, ...research]) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('daily-standup — runtime', () => {
  it('runs full chain with all deps stubbed and carries gather → synthesize prompt', async () => {
    const wf = loadWorkflow();
    const promptCalls: string[] = [];
    const bashBodies: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        promptCalls.push(prompt);
        return '## Yesterday\n- shipped #2042\n\n## Today\n- shipped #2043\n\n## Blockers\n- none\n\n## Tomorrow first action\n- start Round 2 audit log';
      },
      runBash: async (body) => {
        bashBodies.push(body);
        if (body.includes("git log --since='today.midnight'")) {
          return { stdout: "## Today's commits\n- abc1234 ship #2043\n\n## Open PRs (mine)\n- #2043 research-deep (open)", stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR') && body.includes('Standup')) {
          return { stdout: 'saved=/tmp/Obsidian/Standup/2026-05-08.md date=2026-05-08 time=18:00', stderr: '', exitCode: 0 };
        }
        if (body.includes('ELANOUS_STANDUP_CHANNEL')) {
          return { stdout: 'broadcast=skipped reason=ELANOUS_STANDUP_CHANNEL_not_set', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'standup-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]).toContain("Today's git + GitHub");
    expect(promptCalls[0]).toContain('ship #2043');

    // save-standup should embed the synthesized markdown
    const saveBody = bashBodies.find((b) => b.includes('Standup') && b.includes('OBSIDIAN_DIR'))!;
    expect(saveBody).toContain('Tomorrow first action');
    expect(saveBody).toContain('start Round 2 audit log');
  });

  it('broadcast emits skip line when ELANOUS_STANDUP_CHANNEL is unset (default)', () => {
    const wf = loadWorkflow();
    type RawNode = { id: string; bash?: string };
    const broadcast = (wf.nodes.find((n) => n.id === 'broadcast') as unknown as RawNode);
    expect(broadcast.bash).toContain('broadcast=skipped reason=ELANOUS_STANDUP_CHANNEL_not_set');
    expect(broadcast.bash).toContain('discord|telegram|both');
    expect(broadcast.bash).toContain('cv-3_beta-1_infra');
  });
});

describe('daily-standup — router cascade', () => {
  it('regex single-hit on "daily standup"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ds-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => {
        llmCalls += 1;
        return '/invoke-workflow daily-standup';
      };
      const r = await routeWorkflow(
        { userMessage: "let's do a daily standup" },
        fakeLLM,
      );
      expect(r.name).toBe('daily-standup');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('regex single-hit on Korean "오늘 마감"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ds-router2-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nothing';
      const r = await routeWorkflow(
        { userMessage: '오늘 마감 정리해줘' },
        fakeLLM,
      );
      expect(r.name).toBe('daily-standup');
      expect(r.source).toBe('regex');
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
