import { describe, expect, test } from 'bun:test';
import {
  deriveSubjectSummaries,
  enrichSubjectRunAssessments,
  resolveTerminalDetailTarget,
  handleTerminalsList,
  type PtyLessSubAgentSummary,
  type TerminalSummary,
} from '../src/nexus/api/terminals.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';
import type { PtyManifestRow } from '../src/pty-shell/pty-manifest.js';

const opts: MetaApiOpts = { noAuth: true };

function terminal(id: string, runId: string, startedAt: number, overrides: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    id, cmd: 'shell', treeName: '', worktreeName: '', parentPtyId: '', parentPid: 0,
    parentKind: '', runId, origin: 'unknown', producer: 'process', alive: true, exitCode: null, startedAt, outputBytes: 0, accessMode: null,
    ...overrides,
  };
}

function agent(correlationId: string, startedAt = 1): PtyLessSubAgentSummary {
  return {
    id: `agent:${correlationId}`, name: 'sub-agent', startedAt, instance: 'local',
    sourceRoot: { name: 'local', dbPath: 'local' }, hasPty: false, alive: null,
    status: 'unknown', correlationId, sessionId: null,
  };
}

describe('terminal subjects', () => {
  test('groups three PTYs by run while preserving their screen and empty talk', () => {
    const terminals = [terminal('pty-1', 'run-a', 1), terminal('pty-2', 'run-a', 2), terminal('pty-3', 'run-a', 3)];
    const subjects = enrichSubjectRunAssessments(deriveSubjectSummaries(terminals, []), null);

    expect(terminals).toHaveLength(3);
    expect(subjects).toEqual([{
      id: 'subject:run-a', runId: 'run-a', origin: 'human',
      screen: { ptyIds: ['pty-1', 'pty-2', 'pty-3'], liveCount: 3 },
      agent: { names: [], controllers: [] }, run: { status: 'unknown', reason: 'run-assessment-not-found', presence: null }, talk: [],
    }]);
  });

  test('keeps runless PTYs as distinct subjects and merges a matching PTY-less agent', () => {
    const subjects = enrichSubjectRunAssessments(deriveSubjectSummaries([
      terminal('pty-with-agent', 'cid-a', 2, { originAgent: 'worker', controller: 'parent', parentKind: 'pty' }),
      terminal('pty-without-run', '', 1),
    ], [agent('cid-a', 3), agent('cid-only', 4)]), null);

    expect(subjects).toEqual([
      { id: 'subject:cid-only', runId: 'cid-only', origin: 'system', screen: { ptyIds: [], liveCount: 0 }, agent: { names: ['sub-agent'], controllers: [] }, run: { status: 'unknown', reason: 'run-assessment-not-found', presence: null }, talk: [] },
      { id: 'subject:cid-a', runId: 'cid-a', origin: 'system', screen: { ptyIds: ['pty-with-agent'], liveCount: 1 }, agent: { names: ['worker', 'sub-agent'], controllers: ['parent'] }, run: { status: 'unknown', reason: 'run-assessment-not-found', presence: null }, talk: [] },
      { id: 'pty:pty-without-run', runId: '', origin: 'human', screen: { ptyIds: ['pty-without-run'], liveCount: 1 }, agent: { names: [], controllers: [] }, run: { status: 'unknown', reason: 'run-id-missing', presence: null }, talk: [] },
    ]);
  });

  test('resolves default, selected foreign, invalid, and missing selected-root PTYs distinctly', () => {
    const remote: PtyManifestRow = {
      id: 'remote-pty', cmd: 'shell', workdir: '', kind: 'tui', instance: 'remote', ptyPid: 1, ownerPid: 1, startedAt: 1, alive: true,
      exitCode: null, snapshot: 'remote output', snapshotAt: 1, updatedAt: 1, frame: 'remote frame', frameAt: 1, outputBytesTotal: 13,
      runId: '', runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentPid: 0, parentKind: '', closedAt: 0, codeSha: '',
    };
    const root = '/roots/remote/pty/manifest.db';
    const targets = [{ name: 'remote', dbPath: root }];
    const rowsAt = (dbPath: string) => dbPath === root ? [remote] : [];
    expect(resolveTerminalDetailTarget('remote-pty', new URL('http://localhost/v1/terminals/remote-pty/scrollback'), targets, rowsAt)).toEqual({ status: 'current-root' });
    expect(resolveTerminalDetailTarget('remote-pty', new URL(`http://localhost/v1/terminals/remote-pty/scrollback?sourceRoot=${encodeURIComponent(root)}`), targets, rowsAt)).toEqual({ status: 'selected', sourceRoot: root, dbPath: root, row: remote });
    expect(resolveTerminalDetailTarget('remote-pty', new URL('http://localhost/v1/terminals/remote-pty/scrollback?sourceRoot=missing'), targets, rowsAt)).toEqual({ status: 'source-root-not-found', sourceRoot: 'missing' });
    expect(resolveTerminalDetailTarget('missing', new URL(`http://localhost/v1/terminals/missing/scrollback?sourceRoot=${encodeURIComponent(root)}`), targets, rowsAt)).toEqual({ status: 'pty-not-found-in-source-root', sourceRoot: root, dbPath: root });
  });

  test('adds subjects without changing the existing terminals or scope payload', async () => {
    const rows: PtyManifestRow[] = [
      { id: 'pty-1', cmd: 'shell', workdir: '', kind: 'agent', instance: '', ptyPid: 1, ownerPid: 1, startedAt: 1, alive: true, exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 1, frame: '', frameAt: 0, outputBytesTotal: 0, runId: 'run-a', runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentPid: 0, parentKind: 'pty', closedAt: 0, codeSha: '', originRoot: 'system', originAgent: 'worker', controller: 'parent' },
    ];
    const body = await handleTerminalsList(new Request('http://localhost/v1/terminals'), opts, {
      ptyManifestTargets: () => [], listPtyManifestRows: () => rows, listPtyManifestRowsAt: () => [],
      listPty: () => [], isProcessAlive: () => true,
      reapDeadPtyManifest: () => 0, purgeClosedPtyManifest: () => 0, reapStalePtyManifest: () => 0, reapOrphanedOwnedPtyManifest: () => 0,
      getDefaultLogStore: () => ({ query: ({ exactCategories, events }: { exactCategories?: string[]; events?: string[] }) => exactCategories?.includes('agent.spawn') && events?.includes('dispatch') ? [{ id: 1, ts: new Date().toISOString(), ts_ms: 2, level: 'debug', instance: 'local', surface: 'test', category: 'agent.spawn', event: 'dispatch', session_id: null, trace_id: null, data: JSON.stringify({ cid: 'run-a', resolvedAgent: 'sub-agent' }) }] : [] }),
    }).json() as { terminals: unknown[]; subjects: unknown[]; scope: unknown };

    expect(body.terminals).toHaveLength(1);
    expect(body.terminals[0]).toEqual(expect.objectContaining({
      // ⭐ `accessMode` 는 `#8714` 가 더한 «스무째» 키다 — 로컬 in-process 핸들에서만 값이 나고
      //   매니페스트/원격 행은 `null` 이다(소유 프로세스만 그 값을 안다). 지어내지 않는 것이 계약이다.
      id: 'pty-1', cmd: 'shell', treeName: '', worktreeName: '', parentPtyId: '', parentPid: 0, parentKind: 'pty', runId: 'run-a', instance: '', originRoot: 'system', originAgent: 'worker', controller: 'parent', origin: 'unknown', producer: 'process', alive: true, exitCode: null, startedAt: 1, outputBytes: 0, remote: true, kind: 'agent', frameAt: 0, accessMode: null,
    }));
    expect(body.scope).toEqual(expect.objectContaining({ roots: 1, federated: false, hiddenDead: 0, domain: expect.any(String), hiddenSubAgentRuns: 1 }));
    expect(body.subjects).toEqual([{ id: 'subject:run-a', runId: 'run-a', origin: 'system', screen: { ptyIds: ['pty-1'], liveCount: 1 }, agent: { names: ['worker', 'sub-agent'], controllers: ['parent'] }, run: { status: 'unknown', reason: 'run-assessment-not-found', presence: null }, talk: [] }]);
  });
});
