import { describe, it, expect } from 'bun:test';
import {
  reconcilePhaseStatus,
  parsePrFromNotes,
  gatherPhaseGroundTruth,
  reconcileMission,
  type PhaseGroundTruth,
} from './mission-reconcile.js';

const gt = (o: Partial<PhaseGroundTruth>): PhaseGroundTruth => ({
  phaseId: 'task:a', phaseTitle: 'p', recordedStatus: 'done', recordedPr: 4039,
  prState: null, deliverables: [], deliverableOnMain: false, landedCommitSubject: '', landedViaPr: null, ...o,
});

describe('reconcilePhaseStatus (순수 self-derivation)', () => {
  it('PR merged → landed, drift 없음(done과 일치)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'done', recordedPr: 4036, prState: 'MERGED' }));
    expect(r.perceived).toBe('landed');
    expect(r.drift).toBe(false);
  });

  it('★핵심: PR closed + deliverable on main → landed-elsewhere, drift (sub8 #4039→#4041 케이스)', () => {
    const r = reconcilePhaseStatus(gt({
      recordedStatus: 'done', recordedPr: 4039, prState: 'CLOSED',
      deliverables: ['tests/price-guard-replay.test.ts'], deliverableOnMain: true,
      landedCommitSubject: 'test(price-guard): sub8 router 검증 랜딩', landedViaPr: 4041,
    }));
    expect(r.perceived).toBe('landed-elsewhere');
    expect(r.drift).toBe(true);
    expect(r.note).toContain('PR #4041'); // 실제 머지한 PR 인지
  });

  it('PR closed + deliverable NOT on main + 기록 done → incomplete, drift(거짓 done)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'done', recordedPr: 4099, prState: 'CLOSED', deliverableOnMain: false }));
    expect(r.perceived).toBe('incomplete');
    expect(r.drift).toBe(true);
  });

  it('PR open + 기록 done → pending, drift(미머지인데 done)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'done', recordedPr: 4100, prState: 'OPEN' }));
    expect(r.perceived).toBe('pending');
    expect(r.drift).toBe(true);
  });

  it('PR 없음 + deliverable on main → landed (operational이 파일 냈을 때)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'done', recordedPr: null, deliverableOnMain: true, landedCommitSubject: 'x' }));
    expect(r.perceived).toBe('landed');
  });

  it('PR 없음 + done → landed(운영/조사/HITL·done 신뢰·반증 없음)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'done', recordedPr: null, deliverableOnMain: false }));
    expect(r.perceived).toBe('landed');
    expect(r.drift).toBe(false);
  });

  it('PR 없음 + 실패 기록 → incomplete, drift 없음(현실 일치)', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'failed', recordedPr: null, deliverableOnMain: false }));
    expect(r.perceived).toBe('incomplete');
    expect(r.drift).toBe(false);
  });

  it('backlog + 근거 부족 → unknown', () => {
    const r = reconcilePhaseStatus(gt({ recordedStatus: 'backlog', recordedPr: null, deliverableOnMain: false }));
    expect(r.perceived).toBe('unknown');
    expect(r.drift).toBe(false);
  });
});

describe('parsePrFromNotes', () => {
  it('pull/<n> URL 추출', () => {
    expect(parsePrFromNotes(['[SE-PR] https://github.com/x/y/pull/4036 · merge HITL'])).toBe(4036);
  });
  it('PR #<n> 추출', () => {
    expect(parsePrFromNotes(['reviewed', 'PR #4041 merged'])).toBe(4041);
  });
  it('없으면 null', () => {
    expect(parsePrFromNotes(['no pr here'])).toBe(null);
  });
  it('★ 여러 PR 중 마지막(최신·inject 우선)', () => {
    expect(parsePrFromNotes(['[SE-PR] .../pull/4039', '[EXTERNAL] .../pull/4041 (외부 주입)'])).toBe(4041);
  });
});

describe('gatherPhaseGroundTruth (IO·주입 mock)', () => {
  it('gh/git mock 으로 closed-but-on-main 관측', () => {
    const g = gatherPhaseGroundTruth(
      { phaseId: 'task:b', title: 'router', status: 'done', notes: ['https://github.com/x/y/pull/4039'] },
      {
        gh: (a) => a.includes('--json state') ? 'CLOSED' : a.includes('--json files') ? 'tests/price-guard-replay.test.ts' : '',
        git: (a) => a[0] === 'ls-tree' ? 'tests/price-guard-replay.test.ts' : a[0] === 'log' && a[1] === '-1' ? 'sub8 랜딩' : '',
      },
    );
    expect(g.recordedPr).toBe(4039);
    expect(g.prState).toBe('CLOSED');
    expect(g.deliverableOnMain).toBe(true);
    expect(g.landedCommitSubject).toBe('sub8 랜딩');
  });
});

describe('reconcileMission (self-write·mock)', () => {
  it('drift 감지 + working memory 에 provenance=reconcile self-write', () => {
    const written: any[] = [];
    const res = reconcileMission('apm_test', {
      listPhases: () => [
        { phaseId: 't1', title: 'sub7', status: 'done', notes: ['pull/4036'] },
        { phaseId: 't2', title: 'sub8', status: 'done', notes: ['pull/4039'] },
      ],
      gh: (a) => {
        if (a.includes('4036') && a.includes('state')) return 'MERGED';
        if (a.includes('4039') && a.includes('state')) return 'CLOSED';
        if (a.includes('files')) return 'tests/price-guard-replay.test.ts';
        return '';
      },
      git: (a) => a.includes('ls-tree') ? 'tests/price-guard-replay.test.ts' : a.includes('log -1') ? 'landed' : '',
      now: () => '2026-07-13T00:00:00Z',
      writeMemory: (_mid, e) => { written.push(e); },
    });
    expect(res.reconciliations.length).toBe(2);
    expect(res.drifts).toBe(1); // sub8 = landed-elsewhere = drift
    // self-write 검증: 모두 provenance=reconcile
    expect(written.length).toBe(2);
    expect(written.every((e) => e.provenance === 'reconcile')).toBe(true);
    expect(written.find((e) => e.phaseTitle === 'sub8')?.summary).toContain('DRIFT');
  });
});
