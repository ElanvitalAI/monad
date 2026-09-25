import { describe, test, expect } from 'bun:test';
import { debug } from '../debug/log.js';
import {
  countDocsMarkdownDeletions,
  countNonDocsMarkdownDeletions,
  runSelfImplement,
} from './orchestrator.js';
import { seams } from './test-seams.js';

const fileDiff = (deletions: number, path: string) => [
  `diff --git a/${path} b/${path}`,
  'index 1111111..2222222 100644',
  `--- a/${path}`,
  `+++ b/${path}`,
  ...Array.from({ length: deletions }, (_, index) => `-deleted line ${index}`),
].join('\n');

const passingReview = {
  verdict: 'pass' as const,
  mustFix: [] as string[],
  shouldFix: [] as string[],
  summary: 'review',
  reviewed: true,
  diffTruncated: false,
  diffShownChars: 100,
  diffTotalChars: 100,
  diffOmittedFiles: 0,
};

describe('countNonDocsMarkdownDeletions', () => {
  test('docs 가 아닌 파일만 삭제된 diff 는 그 삭제 행 수를 반환한다', () => {
    expect(countNonDocsMarkdownDeletions(fileDiff(128, 'apps/ios/App.swift'))).toBe(128);
    expect(countDocsMarkdownDeletions(fileDiff(128, 'apps/ios/App.swift'))).toBe(0);
  });

  test('docs Markdown 삭제 행은 세지 않고 countDocsMarkdownDeletions 반환값은 그대로다', () => {
    const diff = fileDiff(7, 'docs/ROADMAP.md');
    expect(countNonDocsMarkdownDeletions(diff)).toBe(0);
    expect(countDocsMarkdownDeletions(diff)).toBe(7);
  });

  test('docs 와 비-docs 가 섞이면 각자 자기 쪽만 센다', () => {
    const mixed = [fileDiff(3, 'docs/NOTE.md'), fileDiff(5, 'src/large-module.ts')].join('\n');
    expect(countNonDocsMarkdownDeletions(mixed)).toBe(5);
    expect(countDocsMarkdownDeletions(mixed)).toBe(3);
  });

  test('인용된 비-docs 경로도 diffHeaderPaths 와 같은 방식으로 센다', () => {
    expect(countNonDocsMarkdownDeletions([
      'diff --git "a/apps/ios/\\\\355\\\\225\\\\234\\\\352\\\\270\\\\200.swift" "b/apps/ios/\\\\355\\\\225\\\\234\\\\352\\\\270\\\\200.swift"',
      '--- "a/apps/ios/한글.swift"',
      '+++ "b/apps/ios/한글.swift"',
      '-deleted',
      '-also gone',
    ].join('\n'))).toBe(2);
  });

  test('해석할 수 없는 diff --git header 는 기존 함수와 같은 예외를 낸다', () => {
    const malformed = 'diff --git "a/src/unterminated.ts b/src/unterminated.ts';
    expect(() => countNonDocsMarkdownDeletions(malformed)).toThrow('unparseable diff --git header');
    expect(() => countDocsMarkdownDeletions(malformed)).toThrow('unparseable diff --git header');
  });
});

describe('auto-merge-docs-deletion-guard observes non-docs deletions without blocking', () => {
  test('소스 삭제 수는 관측에 실리고 blocked 는 거짓이다', async () => {
    const original = debug.log;
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let mergeCalls = 0;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: data as Record<string, unknown> });
      }) as typeof debug.log;
      const result = await runSelfImplement({
        feature: 'source deletion observed',
        autoMerge: true,
        seams: seams({
          reviewDiff: async () => passingReview,
          readPrDiff: async () => fileDiff(128, 'apps/ios/App.swift'),
          mergePr: async () => { mergeCalls++; return { merged: true }; },
        }),
      });
      expect(result.stage).toBe('merged');
      expect(mergeCalls).toBe(1);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const guard = events.find((entry) => entry.event === 'auto-merge-docs-deletion-guard');
    expect(guard).toBeDefined();
    expect(guard?.data).toEqual(expect.objectContaining({
      blocked: false,
      docsMarkdownDeletions: 0,
      nonDocsMarkdownDeletions: 128,
      threshold: 500,
    }));
    expect(Object.keys(guard?.data ?? {})).toEqual(expect.arrayContaining(['nonDocsMarkdownDeletions']));
  });

  test('docs 삭제 문턱은 그대로 막고 비-docs 수는 같이 관측된다', async () => {
    const original = debug.log;
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let mergeCalls = 0;
    try {
      (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
        events.push({ event, data: data as Record<string, unknown> });
      }) as typeof debug.log;
      const result = await runSelfImplement({
        feature: 'docs deletion still blocks',
        autoMerge: true,
        seams: seams({
          reviewDiff: async () => passingReview,
          readPrDiff: async () => [fileDiff(500, 'docs/ROADMAP.md'), fileDiff(12, 'src/mod.ts')].join('\n'),
          mergePr: async () => { mergeCalls++; return { merged: true }; },
        }),
      });
      expect(result.stage).toBe('pr-opened');
      expect(result.detail).toContain('docs Markdown deletion count 500 meets threshold 500');
      expect(mergeCalls).toBe(0);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'auto-merge-docs-deletion-guard',
        data: expect.objectContaining({
          blocked: true,
          docsMarkdownDeletions: 500,
          nonDocsMarkdownDeletions: 12,
          threshold: 500,
        }),
      }),
    ]));
  });
});
