// Round 1 PR3 (2026-05-08) — voice-quick-task workflow
// (samples/workflows/voice-quick-task.yaml).
//
// Verifies YAML shape, trigger isolation, runtime behaviour with
// stubbed deps, audio-vs-text detection branching (when expression),
// LLM picker JSON parsing, and dispatch action routing.

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

const YAML_PATH = join(import.meta.dir, '..', 'samples', 'workflows', 'voice-quick-task.yaml');

function loadWorkflow(): WorkflowDefinition {
  return parseYaml(readFileSync(YAML_PATH, 'utf-8')) as WorkflowDefinition;
}

describe('voice-quick-task — YAML shape', () => {
  it('description follows the 4-line conv', () => {
    const wf = loadWorkflow();
    expect(wf.description).toContain('Use when:');
    expect(wf.description).toContain('Triggers:');
    expect(wf.description).toContain('Does:');
    expect(wf.description).toContain('NOT for:');
  });

  it('exposes all 5 trigger phrases', () => {
    const desc = loadWorkflow().description!;
    expect(desc).toContain('voice quick task');
    expect(desc).toContain('voice memo');
    expect(desc).toContain('elanous capture');
    expect(desc).toContain('음성 받아 적어');
    expect(desc).toContain('remember this voice');
  });

  it('node graph: detect-input → transcribe (when audio) → pick-action → dispatch', () => {
    const wf = loadWorkflow();
    const ids = wf.nodes.map((n) => n.id);
    expect(ids).toEqual(['detect-input', 'transcribe', 'pick-action', 'dispatch']);

    const transcribe = wf.nodes.find((n) => n.id === 'transcribe')! as { skill?: string; when?: string };
    expect(transcribe.skill).toBe('voice-stt');
    expect(transcribe.when).toBe("$detect-input.output == 'type=audio'");

    const pick = wf.nodes.find((n) => n.id === 'pick-action')!;
    expect(pick.depends_on).toEqual(expect.arrayContaining(['detect-input', 'transcribe']));
    expect((pick as { output_format?: { type: string; required?: string[] } }).output_format).toEqual({
      type: 'object',
      required: ['action', 'args'],
    });

    const dispatch = wf.nodes.find((n) => n.id === 'dispatch')!;
    expect(dispatch.depends_on).toEqual(['pick-action']);
  });

  it('uses haiku model hint (latency-sensitive)', () => {
    const wf = loadWorkflow() as WorkflowDefinition & { model?: string };
    expect(wf.model).toBe('haiku');
  });
});

describe('voice-quick-task — trigger isolation', () => {
  it('triggers do not substring-overlap with builtins / morning-briefing / share-intake', () => {
    const builtin = [
      'summarize', '요약', 'tl;dr', 'what is this',
      'review my branch', 'code review', 'check diff',
      'pdca', 'improvement cycle', 'iterate on', 'improve',
      'build workflow', 'new workflow', '워크플로우 만들어줘', 'workflow builder',
    ];
    const morning = ['morning briefing', "what's today", '오늘 뭐 해야 해', 'daily kickoff', "today's plan"];
    const share = ['share-intake', 'process this', 'intake', '이거 처리해줘', '공유 처리'];
    const mine = ['voice quick task', 'voice memo', 'elanous capture', '음성 받아 적어', 'remember this voice'];
    for (const a of mine) {
      for (const b of [...builtin, ...morning, ...share]) {
        expect(a.includes(b)).toBe(false);
        expect(b.includes(a)).toBe(false);
      }
    }
  });
});

describe('voice-quick-task — runtime: text input branch', () => {
  it('skips transcribe + dispatches capture for plain-text note', async () => {
    const wf = loadWorkflow();
    const skillCalls: string[] = [];
    const bashBodies: string[] = [];
    const deps: WorkflowDeps = {
      callLLM: async () => '{"action":"capture","args":"buy milk"}',
      runBash: async (body) => {
        bashBodies.push(body);
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=text', stderr: '', exitCode: 0 };
        }
        if (body.includes('OBSIDIAN_DIR')) {
          return { stdout: 'dispatch=capture file=/tmp/Obsidian/Capture.md', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug) => {
        skillCalls.push(slug);
        return 'should-not-be-called-for-text';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'buy milk', artifactsDir: mkdtempSync(join(tmpdir(), 'voice-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    // transcribe is skipped via when expression — runSkill never called
    expect(skillCalls).toEqual([]);

    const dispatchBody = bashBodies[bashBodies.length - 1];
    expect(dispatchBody).toContain('OBSIDIAN_DIR');
    expect(dispatchBody).toContain('"action"');
    expect(dispatchBody).toContain('capture');
  });
});

describe('voice-quick-task — runtime: audio input branch', () => {
  it('runs transcribe (voice-stt) for audio file then dispatches', async () => {
    const wf = loadWorkflow();
    const skillCalls: { slug: string; args: string }[] = [];
    const deps: WorkflowDeps = {
      callLLM: async ({ prompt }) => {
        // The picker prompt should carry the transcribed text in.
        expect(prompt).toContain('audio_text:');
        expect(prompt).toContain('hello world transcription');
        return '{"action":"task-create","args":"call dentist tomorrow"}';
      },
      runBash: async (body) => {
        if (body.includes('case "$INPUT"')) {
          return { stdout: 'type=audio', stderr: '', exitCode: 0 };
        }
        return { stdout: 'dispatch=task-create file=/tmp/Tasks.md', stderr: '', exitCode: 0 };
      },
      runSkill: async (slug, args) => {
        skillCalls.push({ slug, args });
        return 'hello world transcription';
      },
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: '/tmp/note.m4a', artifactsDir: mkdtempSync(join(tmpdir(), 'voice2-')) },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(skillCalls).toEqual([{ slug: 'voice-stt', args: '/tmp/note.m4a' }]);
  });
});

describe('voice-quick-task — runtime: invalid LLM JSON', () => {
  it('reports failure when picker emits non-JSON', async () => {
    const wf = loadWorkflow();
    const deps: WorkflowDeps = {
      callLLM: async () => 'I cannot decide.',
      runBash: async () => ({ stdout: 'type=text', stderr: '', exitCode: 0 }),
    };
    const r = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'unclear input', artifactsDir: mkdtempSync(join(tmpdir(), 'voice3-')) },
      deps,
    );
    expect(r.ok).toBe(false);
  });
});

describe('voice-quick-task — router cascade', () => {
  it('regex single-hit on "voice memo"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vqt-router-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      let llmCalls = 0;
      const fakeLLM: RouterLLMCaller = async () => {
        llmCalls += 1;
        return '/invoke-workflow voice-quick-task';
      };
      const r = await routeWorkflow(
        { userMessage: 'voice memo: tomorrow standup at 9' },
        fakeLLM,
      );
      expect(r.name).toBe('voice-quick-task');
      expect(r.source).toBe('regex');
      expect(llmCalls).toBe(0);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('regex single-hit on Korean "음성 받아 적어"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'vqt-router2-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
      const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nothing';
      const r = await routeWorkflow(
        { userMessage: '음성 받아 적어 줘' },
        fakeLLM,
      );
      expect(r.name).toBe('voice-quick-task');
      expect(r.source).toBe('regex');
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
