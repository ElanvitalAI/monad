// Round 4 PR3 (2026-05-08) — photo-intake workflow.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'photo-intake.yaml');
const loadWorkflow = (): WorkflowDefinition =>
  parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;

describe('photo-intake — YAML shape', () => {
  it('description follows the 4-line conv + 5 triggers', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('Use when:');
    expect(desc).toContain('Triggers:');
    expect(desc).toContain('Does:');
    expect(desc).toContain('NOT for:');
    expect(desc).toContain('photo intake');
    expect(desc).toContain('scan receipt');
    expect(desc).toContain('process this photo');
    expect(desc).toContain('사진 처리');
    expect(desc).toContain('영수증 스캔');
  });

  it('node graph: detect-image → digest (when image) → archive', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['detect-image', 'digest', 'archive']);
    type RawNode = { id: string; skill?: string; when?: string; trigger_rule?: string };
    const byId = new Map(wf.nodes.map((n) => [n.id, n as unknown as RawNode]));
    expect(byId.get('digest')!.skill).toBe('omni-digest');
    expect(byId.get('digest')!.when).toBe("$detect-image.output == 'type=image'");
    expect(byId.get('archive')!.trigger_rule).toBe('one_success');
  });
});

describe('photo-intake — runtime', () => {
  it('routes image to omni-digest + archives', async () => {
    const wf = loadWorkflow();
    const skillCalls: string[] = [];
    let archiveBody = '';
    const deps: WorkflowDeps = {
      callLLM: async () => '',
      runBash: async (body) => {
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=image', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          archiveBody = body;
          return { stdout: 'saved=/tmp/Photos/2026-05-08/090000.md source=/tmp/r.jpg', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug, args) => {
        skillCalls.push(slug);
        return `OCR result for ${args}`;
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '/tmp/receipt.jpg', artifactsDir: mkdtempSync(join(tmpdir(), 'photo-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls).toEqual(['omni-digest']);
    expect(archiveBody).toContain('OCR result');
  });

  it('skips digest when input is not an image', async () => {
    const wf = loadWorkflow();
    const skillCalls: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async () => '',
      runBash: async (body) => {
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=not-image', stderr: '', exitCode: 0 };
        }
        return { stdout: 'archive=skipped reason=type=not-image', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug) => {
        skillCalls.push(slug);
        return '';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'plain text', artifactsDir: mkdtempSync(join(tmpdir(), 'photo2-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls).toEqual([]);  // digest skipped via when
  });
});

describe('photo-intake — router cascade', () => {
  it('regex single-hit on "scan receipt"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.monad', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => { llmCalls += 1; return ''; };
      const r = await routeWorkflow(
        { userMessage: 'scan receipt please' },
        fakeLLM,
      );
      expect(r.name).toBe('photo-intake');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
