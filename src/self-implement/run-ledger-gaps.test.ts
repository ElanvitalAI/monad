import { describe, expect, it } from 'bun:test';
import { measureRunLedgerGaps } from './run-ledger.js';

describe('measureRunLedgerGaps', () => {
  it('separates missing producer IDs and missing JSONL files while preserving a complete measurement', () => {
    const result = measureRunLedgerGaps([{
      root: '/state-a',
      manifestStatus: 'read',
      ledgerStatus: 'read',
      ledgerRunIds: new Set(['run-present']),
      livePtys: [
        { kind: 'self-implement', runId: null },
        { kind: 'self-implement', runId: 'run-missing' },
        { kind: 'self-implement', runId: 'run-present' },
      ],
    }]);

    expect(result).toMatchObject({
      scope: 'self-implement-run-ledger-gaps',
      complete: true,
      rootsMeasured: 1,
      livePtyCount: 3,
      counts: {
        'live-pty-run-id-missing': 1,
        'live-pty-ledger-missing': 1,
        'ledger-root-unreadable': 0,
        'pty-manifest-root-unreadable': 0,
      },
      gaps: [
        { kind: 'live-pty-run-id-missing', root: '/state-a', ptyKind: 'self-implement' },
        { kind: 'live-pty-ledger-missing', root: '/state-a', ptyKind: 'self-implement', runId: 'run-missing' },
      ],
    });
  });

  it('makes unreadable roots incomplete rather than treating them as zero coverage', () => {
    const result = measureRunLedgerGaps([
      { root: '/state-ledger-unreadable', manifestStatus: 'read', ledgerStatus: 'unreadable' },
      { root: '/state-manifest-unreadable', manifestStatus: 'unreadable', ledgerStatus: 'missing' },
      { root: '/state-missing-ledger-dir', manifestStatus: 'read', ledgerStatus: 'missing', livePtys: [{ kind: 'agent', runId: 'run-missing' }] },
    ]);

    expect(result.complete).toBe(false);
    expect(result.counts).toEqual({
      'live-pty-run-id-missing': 0,
      'live-pty-ledger-missing': 1,
      'ledger-root-unreadable': 1,
      'pty-manifest-root-unreadable': 1,
    });
    expect(result.gaps).toEqual(expect.arrayContaining([
      { kind: 'ledger-root-unreadable', root: '/state-ledger-unreadable' },
      { kind: 'pty-manifest-root-unreadable', root: '/state-manifest-unreadable' },
      { kind: 'live-pty-ledger-missing', root: '/state-missing-ledger-dir', ptyKind: 'agent', runId: 'run-missing' },
    ]));
  });

  // ⛔⭐ 리뷰 지적 2 — 원장을 못 읽어도 «manifest 로 이미 본» live PTY 판정은 계속 나와야 한다.
  //   종전 판은 그 뿌리를 통째로 건너뛰어, runId 자체가 없는 PTY 까지 조용히 0 이 됐다.
  it('still reports missing producer run IDs when the ledger root is unreadable', () => {
    const result = measureRunLedgerGaps([{
      root: '/state-ledger-unreadable',
      manifestStatus: 'read',
      ledgerStatus: 'unreadable',
      livePtys: [
        { kind: 'self-implement', runId: null },
        { kind: 'agent', runId: 'run-unknown-coverage' },
      ],
    }]);

    expect(result.complete).toBe(false);
    expect(result.livePtyCount).toBe(2);
    expect(result.counts).toEqual({
      'live-pty-run-id-missing': 1,
      // ⛔ 원장을 «못 본» 뿌리의 runId 는 「원장 없음」이 아니다 — 미관측이지 결손이 아니다.
      'live-pty-ledger-missing': 0,
      'ledger-root-unreadable': 1,
      'pty-manifest-root-unreadable': 0,
    });
    expect(result.gaps).toEqual([
      { kind: 'ledger-root-unreadable', root: '/state-ledger-unreadable' },
      { kind: 'live-pty-run-id-missing', root: '/state-ledger-unreadable', ptyKind: 'self-implement' },
    ]);
  });

  // ⛔ manifest 를 못 읽은 뿌리는 반대다 — live PTY 를 «본 적이 없으므로» 세지 않는다.
  it('counts no live PTY rows for a root whose manifest was never read', () => {
    const result = measureRunLedgerGaps([
      { root: '/state-manifest-unreadable', manifestStatus: 'unreadable', ledgerStatus: 'missing', livePtys: [{ kind: 'agent', runId: null }] },
    ]);

    expect(result.livePtyCount).toBe(0);
    expect(result.counts['live-pty-run-id-missing']).toBe(0);
    expect(result.gaps).toEqual([{ kind: 'pty-manifest-root-unreadable', root: '/state-manifest-unreadable' }]);
  });
});
