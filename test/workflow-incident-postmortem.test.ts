// Round 4 PR4 (2026-05-08) — incident-postmortem workflow.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'incident-postmortem.yaml');
const loadWorkflow = (): WorkflowDefinition =>
  parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;

describe('incident-postmortem — YAML shape', () => {
  it('description follows the 4-line conv + 5 triggers', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('Use when:');
    expect(desc).toContain('Triggers:');
    expect(desc).toContain('Does:');
    expect(desc).toContain('NOT for:');
    expect(desc).toContain('incident postmortem');
    expect(desc).toContain('postmortem');
    expect(desc).toContain('사후 분석');
    expect(desc).toContain('장애 정리');
    expect(desc).toContain('rca writeup');
  });

  it('node graph: detect-input → transcribe (when audio) → structure → save-pm', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['detect-input', 'transcribe', 'structure', 'save-pm']);
    type RawNode = { id: string; trigger_rule?: string; skill?: string; when?: string };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));
    expect(byId.get('transcribe')!.skill).toBe('voice-stt');
    expect(byId.get('structure')!.trigger_rule).toBe('one_success');
  });

  it('uses sonnet model (quality-sensitive)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('sonnet');
  });
});

describe('incident-postmortem — runtime: text path', () => {
  it('skips transcribe when input is plain text + saves structured pm', async () => {
    const wf = loadWorkflow();
    const skillCalls: string[] = [];
    let saveBody = '';
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        expect(prompt).toContain('## Timeline');
        return '# Incident — DB outage 09:00\n\n## Timeline\n- 09:00 alarms';
      },
      runBash: async (body) => {
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=text', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          saveBody = body;
          return { stdout: 'saved=/tmp/Postmortems/2026-05-08-1500.md', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug) => {
        skillCalls.push(slug);
        return '';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'DB outage at 9am, recovered 9:30', artifactsDir: mkdtempSync(join(tmpdir(), 'pm-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls).toEqual([]);
    expect(saveBody).toContain('DB outage');
  });
});

describe('incident-postmortem — router cascade', () => {
  it('regex single-hit on "postmortem"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pm-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => { llmCalls += 1; return ''; };
      const r = await routeWorkflow(
        { userMessage: 'do a postmortem on this' },
        fakeLLM,
      );
      expect(r.name).toBe('incident-postmortem');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
