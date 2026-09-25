import { describe, expect, test } from 'bun:test';

import { stripAnsi } from '../src/tui.js';
import {
  createChatPickerTestFamily,
  createChatPickerTestSources,
} from './helpers/chat-picker-family-fixture.js';
import type {
  ArgSuggestion,
  AtCandidate,
  SkillCandidate,
  SlashCommand,
} from '../src/chat/index.js';

describe('chat picker family compact chrome', () => {
  test('small slash picker hides the verbose footer hint', () => {
    const commands: SlashCommand[] = [
      { name: 'help', aliases: ['?'], description: 'Show help' },
      { name: 'quit', aliases: ['q'], description: 'Exit' },
      { name: 'clear', aliases: ['cls'], description: 'Clear log' },
    ];
    const out = stripAnsi(createChatPickerTestFamily({
      sources: {
        ...createChatPickerTestSources({ slashItems: () => commands }),
        slash: { id: 'test:slash-compact', getItems: () => commands },
      },
    }).createSurface('slash').paint());
    expect(out).not.toContain('type filter');
    expect(out).not.toContain('Click/↵');
    expect(out).not.toContain('Esc');
  });

  test('large slash picker keeps the compact footer hint', () => {
    const commands: SlashCommand[] = Array.from({ length: 8 }, (_, idx) => ({
      name: `cmd${idx}`,
      aliases: [],
      description: `Command ${idx}`,
    }));
    const out = stripAnsi(createChatPickerTestFamily({
      sources: {
        ...createChatPickerTestSources({ slashItems: () => commands }),
        slash: { id: 'test:slash-large', getItems: () => commands },
      },
    }).createSurface('slash').paint());
    expect(out).toContain('type');
    expect(out).toContain('Click/Enter');
    expect(out).toContain('Esc');
  });

  test('small arg picker hides the verbose footer hint', () => {
    const items: ArgSuggestion[] = [
      { value: 'grok', description: 'xAI Grok' },
      { value: 'openai', description: 'OpenAI GPT' },
      { value: 'anthropic', description: 'Anthropic Claude' },
    ];
    const out = stripAnsi(createChatPickerTestFamily({
      sources: createChatPickerTestSources({
        slashItems: () => [],
        argItems: () => items,
      }),
    }).createSurface('arg').paint());
    expect(out).not.toContain('type filter');
    expect(out).not.toContain('Click/↵');
    expect(out).not.toContain('Esc');
  });

  test('small at picker hides the verbose footer hint', () => {
    const items: AtCandidate[] = [
      { label: 'README.md', absPath: '/repo/README.md', isDir: false, hint: '12 KB' },
      { label: 'src/', absPath: '/repo/src', isDir: true, hint: 'directory' },
      { label: 'package.json', absPath: '/repo/package.json', isDir: false, hint: '4 KB' },
    ];
    const out = stripAnsi(createChatPickerTestFamily({
      sources: createChatPickerTestSources({
        slashItems: () => [],
        atItems: () => items,
      }),
    }).createSurface('at').paint());
    expect(out).not.toContain('type filter');
    expect(out).not.toContain('Click/↵');
    expect(out).not.toContain('Esc');
  });

  test('small skill picker hides the verbose footer hint', () => {
    const items: SkillCandidate[] = [
      { name: 'browse', description: 'Search the workspace' },
      { name: 'diagram', description: 'Make a diagram' },
      { name: 'digest', description: 'Summarize content' },
    ];
    const out = stripAnsi(createChatPickerTestFamily({
      sources: createChatPickerTestSources({
        slashItems: () => [],
        skillItems: () => items,
      }),
    }).createSurface('skill').paint());
    expect(out).not.toContain('type filter');
    expect(out).not.toContain('Click/↵');
    expect(out).not.toContain('Esc');
  });
});
