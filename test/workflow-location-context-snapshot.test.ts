// Round 4 PR5 (2026-05-08) — location-context-snapshot workflow.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'location-context-snapshot.yaml');
const loadWorkflow = (): WorkflowDefinition =>
  parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;

describe('location-context-snapshot — YAML shape', () => {
  it('description follows 4-line conv + 5 triggers', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('Use when:');
    expect(desc).toContain('Triggers:');
    expect(desc).toContain('Does:');
    expect(desc).toContain('NOT for:');
    expect(desc).toContain('location snapshot');
    expect(desc).toContain('where am I');
    expect(desc).toContain('context here');
    expect(desc).toContain('여기서 정리');
    expect(desc).toContain('장소 컨텍스트');
  });

  it('node graph: resolve-place → gather-priors + glance → save-snapshot', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['resolve-place', 'gather-priors', 'glance', 'save-snapshot']);
  });
});

describe('location-context-snapshot — runtime', () => {
  it('runs full chain when MONAD_LOCATION_PLACE provides the place', async () => {
    const wf = loadWorkflow();
    let saveBody = '';
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        expect(prompt).toContain('1-line glance');
        return 'Office · 3 PRs to review · sync at 2pm.';
      },
      runBash: async (body) => {
        if (body.includes('MONAD_LOCATION_PLACE')) {
          return { stdout: 'place=Office', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR') && body.includes('grep')) {
          return { stdout: '## Prior notes for: Office\n- 2026-05-01.md', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          saveBody = body;
          return { stdout: 'saved=/tmp/Locations/2026-05-08-1500.md', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', artifactsDir: mkdtempSync(join(tmpdir(), 'loc-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(saveBody).toContain('Office');
    expect(saveBody).toContain('PRs to review');
  });
});

describe('location-context-snapshot — router cascade', () => {
  it('regex single-hit on "where am I"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'loc-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.monad', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => { llmCalls += 1; return ''; };
      const r = await routeWorkflow(
        { userMessage: 'where am I and what was here last time' },
        fakeLLM,
      );
      expect(r.name).toBe('location-context-snapshot');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
