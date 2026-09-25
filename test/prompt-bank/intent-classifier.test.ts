// ── AU7 — intent classifier ──

import { describe, test, expect } from 'bun:test';
import {
  classifyUserIntents,
  classifyUserIntentsDetailed,
} from '../../src/prompt-bank/intent-classifier.js';

describe('classifyUserIntents — ambiguous', () => {
  test('refactor / clean up / improve solo → ambiguous', () => {
    for (const text of ['refactor this', 'clean up the code', 'improve the module', 'optimize performance']) {
      expect(classifyUserIntents(text)).toContain('ambiguous');
    }
  });

  test('"fix it" / "update everything" → ambiguous', () => {
    expect(classifyUserIntents('fix it for me')).toContain('ambiguous');
    expect(classifyUserIntents('update everything')).toContain('ambiguous');
  });

  test('Korean vague verb', () => {
    expect(classifyUserIntents('이거 좀 리팩터해줘')).toContain('ambiguous');
    expect(classifyUserIntents('코드 좀 정리해줘')).toContain('ambiguous');
  });

  test('concrete request does not flag ambiguous', () => {
    expect(classifyUserIntents('rename `fooBar` in auth.ts to `processAuth`')).not.toContain('ambiguous');
  });
});

describe('classifyUserIntents — destructive', () => {
  test('English destructive verbs', () => {
    for (const text of ['delete all logs', 'drop the users table', 'wipe the cache', 'remove unused files', 'nuke dist']) {
      expect(classifyUserIntents(text)).toContain('destructive');
    }
  });

  test('shell-style destructive', () => {
    expect(classifyUserIntents('run rm -rf node_modules')).toContain('destructive');
    expect(classifyUserIntents('git force push')).toContain('destructive');
    expect(classifyUserIntents('reset --hard to previous commit')).toContain('destructive');
  });

  test('SQL drop/truncate', () => {
    expect(classifyUserIntents('drop table sessions')).toContain('destructive');
    expect(classifyUserIntents('TRUNCATE TABLE logs')).toContain('destructive');
  });

  test('Korean destructive verbs', () => {
    expect(classifyUserIntents('전부 삭제해줘')).toContain('destructive');
    expect(classifyUserIntents('초기화해줘')).toContain('destructive');
  });

  test('read-only request does not flag destructive', () => {
    expect(classifyUserIntents('show me the list of users')).not.toContain('destructive');
  });
});

describe('classifyUserIntents — multi-file', () => {
  test('"across the codebase" / "everywhere"', () => {
    expect(classifyUserIntents('rename X everywhere')).toContain('multi-file');
    expect(classifyUserIntents('across the codebase')).toContain('multi-file');
    expect(classifyUserIntents('change across the project')).toContain('multi-file');
  });

  test('"every file" / "all the files"', () => {
    expect(classifyUserIntents('update every test file')).toContain('multi-file');
    expect(classifyUserIntents('fix all the files in src')).toContain('multi-file');
  });

  test('Korean wide scope', () => {
    expect(classifyUserIntents('모든 파일에 적용')).toContain('multi-file');
    expect(classifyUserIntents('전체 모듈을 정리')).toContain('multi-file');
  });

  test('single-file mention does not flag multi-file', () => {
    expect(classifyUserIntents('update auth.ts')).not.toContain('multi-file');
  });
});

describe('classifyUserIntents — composition', () => {
  test('destructive + multi-file together', () => {
    const tags = classifyUserIntents('delete unused imports across the codebase');
    expect(tags).toContain('destructive');
    expect(tags).toContain('multi-file');
  });

  test('ambiguous + multi-file together', () => {
    const tags = classifyUserIntents('clean up every module');
    expect(tags).toContain('ambiguous');
    expect(tags).toContain('multi-file');
  });

  test('no dedupe — tags unique', () => {
    const tags = classifyUserIntents('delete rm -rf everything across the codebase');
    const uniq = new Set(tags);
    expect(tags.length).toBe(uniq.size);
  });
});

describe('classifyUserIntents — edge cases', () => {
  test('empty string → []', () => {
    expect(classifyUserIntents('')).toEqual([]);
    expect(classifyUserIntents(null as any)).toEqual([]);
  });

  test('totally unrelated text → []', () => {
    expect(classifyUserIntents('Hello, how are you today?')).toEqual([]);
  });

  test('detailed variant exposes label for debugging', () => {
    const hits = classifyUserIntentsDetailed('rm -rf node_modules');
    expect(hits.some(h => h.tag === 'destructive')).toBe(true);
    expect(hits.find(h => h.tag === 'destructive')!.label).toBeTruthy();
  });
});
