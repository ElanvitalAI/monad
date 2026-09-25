import { describe, expect, test } from 'bun:test';
import { decideLineageSupersede, lineageSupersedeCloseComment } from './lineage-supersede.js';

const MERGED_OPENED_AT = '2026-09-24T03:00:00.000Z';
const EARLIER = '2026-09-24T01:00:00.000Z';
const LATER = '2026-09-24T05:00:00.000Z';

describe('decideLineageSupersede', () => {
  test('closes only the earlier draft with the same known askFile', () => {
    const decision = decideLineageSupersede(
      { askFile: 'docs/goals/ASK-a.md', runId: 'run-merged', prNumber: 300, openedAt: MERGED_OPENED_AT },
      [
        { number: 100, runId: 'run-100', askFile: 'docs/goals/ASK-a.md', openedAt: EARLIER },
        { number: 101, runId: 'run-101', askFile: 'docs/goals/ASK-b.md', openedAt: EARLIER },
        { number: 102, runId: 'run-102', openedAt: EARLIER },
      ],
    );
    expect(decision.close.map((draft) => draft.number)).toEqual([100]);
    expect(decision.notClosed['계보 다름']).toBe(1);
    expect(decision.notClosed['계보 모름']).toBe(1);
    expect(decision.notClosed['병합 PR 보다 늦게 열림']).toBe(0);
    expect(decision.notClosed['병합 PR 자신']).toBe(0);
  });

  test('closes nothing when the merged run has no askFile', () => {
    const decision = decideLineageSupersede(
      { runId: 'run-merged', prNumber: 300, openedAt: MERGED_OPENED_AT },
      [
        { number: 100, runId: 'run-100', askFile: 'docs/goals/ASK-a.md', openedAt: EARLIER },
        { number: 102, runId: 'run-102', openedAt: EARLIER },
      ],
    );
    expect(decision.close).toEqual([]);
    expect(decision.notClosed).toEqual({
      '계보 다름': 0,
      '계보 모름': 0,
      '병합 PR 보다 늦게 열림': 0,
      '병합 PR 자신': 0,
    });
  });

  test('does not close the merged PR itself, a later same-lineage draft, or an equal opened-at', () => {
    const decision = decideLineageSupersede(
      { askFile: 'docs/goals/ASK-a.md', runId: 'run-merged', prNumber: 300, openedAt: MERGED_OPENED_AT },
      [
        { number: 300, runId: 'run-merged', askFile: 'docs/goals/ASK-a.md', openedAt: EARLIER },
        { number: 400, runId: 'run-400', askFile: 'docs/goals/ASK-a.md', openedAt: LATER },
        { number: 401, runId: 'run-401', askFile: 'docs/goals/ASK-a.md', openedAt: MERGED_OPENED_AT },
      ],
    );
    expect(decision.close).toEqual([]);
    expect(decision.notClosed['병합 PR 자신']).toBe(1);
    expect(decision.notClosed['병합 PR 보다 늦게 열림']).toBe(2);
  });

  test('does not treat a missing draft askFile as the same lineage', () => {
    const decision = decideLineageSupersede(
      { askFile: 'docs/goals/ASK-a.md', runId: 'run-merged', prNumber: 300, openedAt: MERGED_OPENED_AT },
      [{ number: 102, runId: 'run-102', openedAt: EARLIER }],
    );
    expect(decision.close).toEqual([]);
    expect(decision.notClosed['계보 모름']).toBe(1);
  });

  test('close comment names the askFile and the merged PR number', () => {
    expect(lineageSupersedeCloseComment('docs/goals/ASK-a.md', 300))
      .toBe('대체됨: 같은 계보(docs/goals/ASK-a.md)의 #300 이 병합됐다');
  });
});
