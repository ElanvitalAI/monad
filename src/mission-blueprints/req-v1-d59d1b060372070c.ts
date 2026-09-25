import {
  parseOpenPullRequestSnapshot,
  readOpenPullRequestSnapshot,
  type ReadOpenPullRequestSnapshot,
} from '../mission-capabilities/report/openprcount.js';
import type { MissionBlueprint } from './types.js';

const requestId = 'req:v1:d59d1b060372070c';
const capabilityId = 'report.openprcount';

function oneLine(text: string): string {
  return text.replace(/\s*(?:\r\n|\r|\n|\u2028|\u2029)\s*/g, ' ').trim();
}

function degraded(reason: string, root: string) {
  return {
    ok: false as const,
    body: oneLine(`정오 열린 판 수 리포트 — 판정 불가: ${reason} (잰 트리: ${root})`),
    measured: { open: 'unmeasurable', root },
  };
}

export function createOpenPullRequestCountReportBlueprint(
  readSnapshot: ReadOpenPullRequestSnapshot = readOpenPullRequestSnapshot,
): MissionBlueprint {
  return {
    id: requestId,
    requires: [{ id: capabilityId }],
    produces: { kind: 'open-pull-request-count-report', deliver: [] },
    async run(ctx) {
      try {
        const pullRequests = parseOpenPullRequestSnapshot(readSnapshot(ctx.authorityRoot));
        if (pullRequests === null) return degraded('열린 판 스냅샷이 없거나 손상되었거나 잘렸습니다.', ctx.authorityRoot);
        return {
          ok: true,
          body: oneLine(`정오 열린 판 수 리포트 — 열린 판 ${pullRequests.length}건 (잰 트리: ${ctx.authorityRoot})`),
          measured: { open: pullRequests.length, root: ctx.authorityRoot },
        };
      } catch (error) {
        return degraded(`열린 판 스냅샷을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, ctx.authorityRoot);
      }
    },
  };
}

export default createOpenPullRequestCountReportBlueprint();
