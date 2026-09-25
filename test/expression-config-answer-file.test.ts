import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAnswerFile,
  saveAnswerFile,
  defaultAnswerFilePath,
} from '../src/expression/config/answer-file.js';

let tmpDir: string;
let tmpPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'monad-answer-'));
  tmpPath = join(tmpDir, 'setup-answers.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('expression/config/answer-file', () => {
  test('loadAnswerFile() returns {} when the omitted default file is absent', () => {
    const previous = process.env.MONAD_SETUP_ANSWERS;
    const defaultPath = join(tmpDir, 'does-not-exist.json');
    try {
      process.env.MONAD_SETUP_ANSWERS = defaultPath;
      expect(loadAnswerFile()).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.MONAD_SETUP_ANSWERS;
      else process.env.MONAD_SETUP_ANSWERS = previous;
    }
  });

  test('loadAnswerFile() throws with an explicit missing file path', () => {
    const path = join(tmpDir, 'does-not-exist.json');
    expect(() => loadAnswerFile(path)).toThrow(path);
  });

  test('loadAnswerFile() throws with an explicit unreadable file path', () => {
    const path = join(tmpDir, 'directory-answer-file');
    mkdirSync(path);
    expect(() => loadAnswerFile(path)).toThrow(path);
  });

  test('loadAnswerFile() throws with an explicit malformed file path', () => {
    writeFileSync(tmpPath, '{not json}');
    expect(() => loadAnswerFile(tmpPath)).toThrow(tmpPath);
  });

  test('loadAnswerFile() throws with an explicit non-object JSON file path', () => {
    writeFileSync(tmpPath, '[]');
    expect(() => loadAnswerFile(tmpPath)).toThrow(tmpPath);
  });

  test('loadAnswerFile() parses a well-formed JSON', () => {
    writeFileSync(tmpPath, JSON.stringify({ llm: { provider: 'openai' }, schema_version: 1 }));
    const out = loadAnswerFile(tmpPath);
    expect(out.schema_version).toBe(1);
    expect(out.llm).toEqual({ provider: 'openai' });
  });

  test('saveAnswerFile() round-trips through loadAnswerFile', () => {
    const original = { llm: { provider: 'grok', apiKey: 'xai-...' }, obsidian: { vault: '/x' } };
    saveAnswerFile(original, tmpPath);
    const loaded = loadAnswerFile(tmpPath);
    expect(loaded.llm).toEqual({ provider: 'grok', apiKey: 'xai-...' });
    expect(loaded.obsidian).toEqual({ vault: '/x' });
  });

  test('defaultAnswerFilePath() honours MONAD_SETUP_ANSWERS env', () => {
    const prev = process.env.MONAD_SETUP_ANSWERS;
    try {
      process.env.MONAD_SETUP_ANSWERS = '/tmp/alt.json';
      expect(defaultAnswerFilePath()).toBe('/tmp/alt.json');
    } finally {
      if (prev === undefined) delete process.env.MONAD_SETUP_ANSWERS;
      else process.env.MONAD_SETUP_ANSWERS = prev;
    }
  });

  test('defaultAnswerFilePath() honours XDG_CONFIG_HOME', () => {
    const prevXdg = process.env.XDG_CONFIG_HOME;
    const prevEnv = process.env.MONAD_SETUP_ANSWERS;
    try {
      delete process.env.MONAD_SETUP_ANSWERS;
      process.env.XDG_CONFIG_HOME = '/custom/cfg';
      expect(defaultAnswerFilePath()).toBe('/custom/cfg/monad/setup-answers.json');
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      if (prevEnv === undefined) delete process.env.MONAD_SETUP_ANSWERS;
      else process.env.MONAD_SETUP_ANSWERS = prevEnv;
    }
  });
});
