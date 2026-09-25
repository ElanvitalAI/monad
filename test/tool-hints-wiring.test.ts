import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  buildNativeToolPromptSummary,
  nativeToolCatalog,
} from '../src/native-tool-catalog.js';
import { buildSkillToolDisciplinePrompt } from '../src/skills/tool-discipline-prompt.js';
import { buildSkillMessages } from '../src/skills/runner.js';
import { addHint, resetScope, setConfigPathForTesting, _reloadForTesting } from '../src/tool-hints/registry.js';
import { resetGateCache } from '../src/tool-hints/gate.js';

let tmpDir: string;

function skillDisciplineMessage(messages: ReturnType<typeof buildSkillMessages>): string {
  const message = messages.find(entry =>
    entry.role === 'system' && typeof entry.content === 'string' && entry.content.includes('You have these tools:'),
  );
  return typeof message?.content === 'string' ? message.content : '';
}

beforeEach(() => {
  tmpDir = joinPath(tmpdir(), `mh-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  setConfigPathForTesting(joinPath(tmpDir, 'hints.json'));
  process.env.HINTS_PROJECT_CWD = joinPath(tmpDir, 'fake-project');
  _reloadForTesting();
  resetGateCache();
});

afterEach(() => {
  resetScope('all');
  resetScope('global');
  setConfigPathForTesting(null);
  delete process.env.HINTS_PROJECT_CWD;
  resetGateCache();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('buildSkillToolDisciplinePrompt — P5 options', () => {
  test('defaults to full surface catalog when no options passed', () => {
    const prompt = buildSkillToolDisciplinePrompt();
    expect(prompt).toContain('`Bash`');
    expect(prompt).toContain('`Read`');
    expect(prompt).toContain('`AgentList`');
  });

  test('filtered catalog omits unlisted tools from the prompt', () => {
    const only = nativeToolCatalog.filter(t => t.id === 'bash' || t.id === 'read');
    const prompt = buildSkillToolDisciplinePrompt({ catalog: only });
    expect(prompt).toContain('`Bash`');
    expect(prompt).toContain('`Read`');
    expect(prompt).not.toContain('`Edit`');
    expect(prompt).not.toContain('`Agent`');
  });

  test('empty filtered catalog drops the cleaner-tools sentence', () => {
    const prompt = buildSkillToolDisciplinePrompt({ catalog: [] });
    expect(prompt).toContain('You have these tools:');
    expect(prompt).not.toMatch(/\bUse [A-Z]/);  // cleaner-tools sentence absent
  });

  test('renders each selected tool and its prompt hint without copying the full prompt', () => {
    const only = nativeToolCatalog.filter(tool => tool.id === 'bash' || tool.id === 'read');
    const prompt = buildSkillToolDisciplinePrompt({ catalog: only });

    for (const tool of only) {
      expect(prompt).toContain(`\`${tool.displayName}\``);
      expect(prompt).toContain(tool.promptSummary);
    }
    expect(prompt).not.toContain('`Edit`');
  });

  test('hintReasons append an "Active hints:" clause', () => {
    const prompt = buildSkillToolDisciplinePrompt({ hintReasons: ['user asked for diagram', 'session policy'] });
    expect(prompt).toContain('Active hints: user asked for diagram; session policy');
  });

  test('no hintReasons → no "Active hints:" clause', () => {
    const prompt = buildSkillToolDisciplinePrompt({});
    expect(prompt).not.toContain('Active hints:');
  });
});

describe('buildNativeToolPromptSummary — catalog override', () => {
  test('legacy call (surface-only) still works', () => {
    const summary = buildNativeToolPromptSummary('skill');
    expect(summary).toContain('`Bash`');
    expect(summary).toContain('`Read`');
  });

  test('catalog override scopes the summary', () => {
    const only = nativeToolCatalog.filter(t => t.id === 'grep');
    const summary = buildNativeToolPromptSummary('skill', only);
    expect(summary).toBe(only[0].promptSummary);
  });
});

describe('skill-runner — gate-integrated discipline prompt', () => {
  // ㉠ The Project Anchor can precede the discipline message; select it by its
  // stable tool-catalog line rather than assuming the first system message.
  test('disable hint removes the tool from the system prompt', () => {
    addHint({ kind: 'disable', tool: 'edit', scope: 'turn' });
    const messages = buildSkillMessages(
      { name: 'test-skill', description: '', content: '', skillDir: tmpDir },
      'refactor something',
    );
    const discipline = skillDisciplineMessage(messages);
    expect(discipline).not.toContain('`Edit`');
    expect(discipline).toContain('`Bash`');
    expect(discipline).toContain('`Read`');
  });

  test('hint reason surfaces in the Active hints: clause', () => {
    addHint({ kind: 'prefer', tool: 'web_search', scope: 'turn', reason: 'user wants fresh info' });
    const messages = buildSkillMessages(
      { name: 'test-skill', description: '', content: '', skillDir: tmpDir },
      'research this',
    );
    const discipline = skillDisciplineMessage(messages);
    expect(discipline).toContain('Active hints: user wants fresh info');
  });

  test('no active hints → prompt identical to pre-P5 behavior shape', () => {
    const messages = buildSkillMessages(
      { name: 'test-skill', description: '', content: '', skillDir: tmpDir },
      '',
    );
    const discipline = skillDisciplineMessage(messages);
    expect(discipline).not.toContain('Active hints:');
    expect(discipline).toContain('`Bash`');
  });
});
