import { describe, it, expect } from 'bun:test';
import {
  extractPrUrl,
  snapshotPhase,
  buildGenerationSnapshot,
  cleanPhaseNotesForRerun,
  type PhaseLike,
} from './mission-rerun-archive.js';

describe('extractPrUrl', () => {
  it('prefers a GitHub /pull/ URL', () => {
    const notes = ['[SE·PR] 격리 구현 완료 → PR 초안 https://github.com/o/r/pull/3871 · merge HITL'];
    expect(extractPrUrl(notes)).toBe('https://github.com/o/r/pull/3871');
  });
  it('falls back to first https link when no pull URL', () => {
    expect(extractPrUrl(['see https://example.com/x for detail'])).toBe('https://example.com/x');
  });
  it('returns undefined when no URL', () => {
    expect(extractPrUrl(['[ATTEMPT 1] no link here'])).toBeUndefined();
  });
});

describe('cleanPhaseNotesForRerun', () => {
  it('drops execution residue markers', () => {
    const notes = ['[ATTEMPT 1] tried X', '[LEARNING] Y', '[SE·PR] PR 초안', '[GATE] pass'];
    expect(cleanPhaseNotesForRerun(notes)).toEqual([]);
  });
  it('preserves [REBUILD] guidance (SE reads it)', () => {
    const notes = ['[ATTEMPT 1] stale', '[REBUILD] 범위 밖 파일 건드리지 마'];
    expect(cleanPhaseNotesForRerun(notes)).toEqual(['[REBUILD] 범위 밖 파일 건드리지 마']);
  });
  it('preserves non-execution context notes', () => {
    const notes = ['원본 요구: cold 이관 배선', '[ATTEMPT 2] x'];
    expect(cleanPhaseNotesForRerun(notes)).toEqual(['원본 요구: cold 이관 배선']);
  });
});

describe('snapshotPhase', () => {
  it('captures title/status/notes and extracts prUrl', () => {
    const p: PhaseLike = {
      title: '보존 점수 구현',
      status: 'done',
      notes: ['[SE·PR] PR 초안 https://github.com/o/r/pull/9'],
    };
    const s = snapshotPhase(p);
    expect(s.title).toBe('보존 점수 구현');
    expect(s.status).toBe('done');
    expect(s.prUrl).toBe('https://github.com/o/r/pull/9');
    expect(s.notes).toEqual(['[SE·PR] PR 초안 https://github.com/o/r/pull/9']);
  });
  it('omits prUrl field when none present', () => {
    const s = snapshotPhase({ title: 't', status: 'failed', notes: ['조사 미완료'] });
    expect(s.prUrl).toBeUndefined();
  });
});

describe('buildGenerationSnapshot', () => {
  it('records generation, reason, fromPhaseIndex and per-phase snapshots', () => {
    const phases: PhaseLike[] = [
      { title: 'p0', status: 'done', notes: [] },
      { title: 'p1', status: 'failed', notes: ['조사 미완료'] },
    ];
    const snap = buildGenerationSnapshot(phases, {
      generation: 0, reason: 'rerun', fromPhaseIndex: 0, now: 1234,
    });
    expect(snap.generation).toBe(0);
    expect(snap.reason).toBe('rerun');
    expect(snap.fromPhaseIndex).toBe(0);
    expect(snap.archivedAt).toBe(1234);
    expect(snap.phases.map((p) => p.title)).toEqual(['p0', 'p1']);
    expect(snap.phases[1]!.status).toBe('failed');
  });
});
