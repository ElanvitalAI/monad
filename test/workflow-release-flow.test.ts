// Round 4 PR2 (2026-05-08) — release-flow workflow.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'release-flow.yaml');
const loadWorkflow = (): WorkflowDefinition =>
  parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;

describe('release-flow — YAML shape', () => {
  it('description follows the 4-line conv + 5 triggers', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('Use when:');
    expect(desc).toContain('Triggers:');
    expect(desc).toContain('Does:');
    expect(desc).toContain('NOT for:');
    expect(desc).toContain('release flow');
    expect(desc).toContain('cut release');
    expect(desc).toContain('릴리즈 진행');
    expect(desc).toContain('release tag');
    expect(desc).toContain('ship release');
  });

  it('node graph: gather-history → draft-notes → gate (approval) → cut-release', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['gather-history', 'draft-notes', 'gate', 'cut-release']);
    type RawNode = { id: string; depends_on?: string[]; approval?: { capture_response?: boolean } };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));
    expect(byId.get('gate')!.approval?.capture_response).toBe(true);
    expect(byId.get('cut-release')!.depends_on).toEqual(['gate']);
  });

  it('uses sonnet model (release notes quality-sensitive)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('sonnet');
  });
});

describe('release-flow — runtime: approve path', () => {
  it('cuts release when approval returns approved', async () => {
    const wf = loadWorkflow();
    let cutBody = '';
    const deps: WorkflowDeps = {
      callLLM: async () => '# Release notes\n\n## Highlights\n- ship new endpoints',
      runBash: async (body) => {
        if (body.includes('git describe')) {
          return { stdout: '## Last tag: v1.0\n\n## Commits since v1.0\n- abc123 feat: thing', stderr: '', exitCode: 0 };
        }
        if (body.includes('ELANOUS_RELEASE_VERSION')) {
          cutBody = body;
          return { stdout: 'release=tagging version=v2026.05.08-1430\nrelease=gh_release_will_be_created', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      requestApproval: async () => 'approved',
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'release-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(cutBody).toContain('ELANOUS_RELEASE_VERSION');
    expect(cutBody).toContain('approved');
  });
});

describe('release-flow — runtime: reject path', () => {
  it('aborts when approval response starts with "no"', async () => {
    const wf = loadWorkflow();
    let cutOutput = '';
    const deps: WorkflowDeps = {
      callLLM: async () => 'notes',
      runBash: async (body) => {
        if (body.includes('git describe')) {
          return { stdout: 'history', stderr: '', exitCode: 0 };
        }
        if (body.includes('ELANOUS_RELEASE_VERSION')) {
          cutOutput = body;
          return { stdout: 'release=aborted reason=user_rejected', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      requestApproval: async () => 'no, not yet',
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'release2-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(cutOutput).toContain('no, not yet');
  });
});

describe('release-flow — trigger isolation', () => {
  it('triggers do not substring-overlap with prior 6 workflows + 4 builtins', () => {
    const others = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
      'morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan",
      'share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리',
      'voice quick task', 'voice memo', 'elanous capture', '음성 받아 적어', 'remember this voice',
      'research deep', 'deep dive', 'deep research', '리서치 딥', '백그라운드 조사',
      'daily standup', 'standup recap', 'EoD recap', '오늘 마감', '야근전 정리',
      'commute digest', 'leaving home', '출퇴근 정리', '운전 준비', 'transit brief',
    ];
    const mine = ['release flow', 'cut release', '릴리즈 진행', 'release tag', 'ship release'];
    for (const a of mine) {
      for (const b of others) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('release-flow — router cascade', () => {
  it('regex single-hit on "cut release"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rf-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => { llmCalls += 1; return ''; };
      const r = await routeWorkflow(
        { userMessage: "let's cut release v2" },
        fakeLLM,
      );
      expect(r.name).toBe('release-flow');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
