import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { registerModelWatchCommand, runModelWatchCli } from './model-watch-cli.js';
import { loadCatalog } from '../intelligence-map/model-catalog.js';
import type { ModelCandidate } from '../intelligence-map/model-classifier.js';
import type { WatchIntakeResult } from '../intelligence-map/model-watch-intake.js';

const candidate: ModelCandidate = {
  id: 'new-model', provider: 'openai', family: 'gpt',
  contextWindow: 0, inputPerMtok: 0, outputPerMtok: 0,
  local: false, classification: { source: 'auto' },
};
const secondCandidate: ModelCandidate = { ...candidate, id: 'updated-model' };

function proposalLedger(candidates: ModelCandidate[] = [candidate, secondCandidate]): string {
  return JSON.stringify({ candidates }) + '\n';
}

function multiLineProposalLedger(): string {
  return [
    proposalLedger([{ ...candidate, id: 'previous-only' }]).trim(),
    proposalLedger([candidate, secondCandidate]).trim(),
  ].join('\n') + '\n';
}

function intake(added: string[] = ['new-model']): WatchIntakeResult {
  return {
    candidates: added.length ? [candidate] : [],
    proposal: { catalog: { version: 1, updated: 0, models: [] }, added, updated: [] },
    perSource: {
      source: {
        candidates: added.length ? [candidate] : [],
        candidateCount: added.length,
        status: 'completed',
        elapsedMs: 0,
        contentLength: 0,
      },
    },
  };
}

describe('model-watch CLI', () => {
  test('returns successful source proposal without applying a catalog', async () => {
    let watchCalls = 0;
    const result = await runModelWatchCli({
      fetchPages: async () => ({ pages: [{ source: 'source', text: 'new model' }], failures: [] }),
      runWatch: async (deps) => {
        watchCalls++;
        expect(await deps.fetchPages()).toEqual([{ source: 'source', text: 'new model' }]);
        return intake();
      },
    });

    expect(watchCalls).toBe(1);
    expect(result).toMatchObject({ status: 'ok', fetched: 1, proposal: { added: ['new-model'], updated: [] } });
    expect(result.candidates.map((item) => item.id)).toEqual(['new-model']);
  });

  test('returns partial failure separately while passing successful pages to the mission', async () => {
    const result = await runModelWatchCli({
      fetchPages: async () => ({
        pages: [{ source: 'available', text: 'new model' }],
        failures: [{ id: 'offline', url: 'https://offline.test', error: 'offline' }],
      }),
      runWatch: async () => intake(),
    });

    expect(result.status).toBe('partial-failure');
    expect(result.fetched).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.proposal.added).toEqual(['new-model']);
  });

  test('distinguishes no fetched pages from a no-change proposal and sets failure status', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const program = new Command();
    registerModelWatchCommand(program, {
      fetchPages: async () => ({ pages: [], failures: [{ id: 'all', url: 'https://all.test', error: 'offline' }] }),
      runWatch: async () => intake([]),
      out: { log: (line) => output.push(line) },
      err: { error: (line) => errors.push(line) },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', '--json']);
    expect(JSON.parse(output[0]!)).toMatchObject({ status: 'no-pages', fetched: 0, proposal: { added: [], updated: [] } });
    expect(errors).toEqual(['Fetch failed [all]: offline']);
    expect(exitCodes).toEqual([1]);
  });

  test('renders only abnormal zero-candidate source names through the normal model-watch command', async () => {
    const abnormalOutput: string[] = [];
    const completedOutput: string[] = [];
    const abnormalProgram = new Command();
    const completedProgram = new Command();
    const abnormalIntake = {
      ...intake([]),
      perSource: {
        'completed-empty': { candidates: [], candidateCount: 0, status: 'completed', elapsedMs: 1, contentLength: 5 },
        'deadline-source': { candidates: [], candidateCount: 0, status: 'deadline', elapsedMs: 10, contentLength: 8 },
        'error-source': { candidates: [], candidateCount: 0, status: 'error', elapsedMs: 2, contentLength: 5, error: 'offline' },
      },
    } satisfies WatchIntakeResult;
    const completedIntake = {
      ...intake([]),
      perSource: {
        'completed-empty': { candidates: [], candidateCount: 0, status: 'completed', elapsedMs: 1, contentLength: 5 },
      },
    } satisfies WatchIntakeResult;
    registerModelWatchCommand(abnormalProgram, {
      fetchPages: async () => ({ pages: [{ source: 'source', text: 'page' }], failures: [] }),
      runWatch: async () => abnormalIntake,
      out: { log: (line) => abnormalOutput.push(line) }, err: { error: () => {} }, setExitCode: () => {},
    });
    registerModelWatchCommand(completedProgram, {
      fetchPages: async () => ({ pages: [{ source: 'source', text: 'page' }], failures: [] }),
      runWatch: async () => completedIntake,
      out: { log: (line) => completedOutput.push(line) }, err: { error: () => {} }, setExitCode: () => {},
    });

    await abnormalProgram.parseAsync(['node', 'elanous', 'model-watch']);
    await completedProgram.parseAsync(['node', 'elanous', 'model-watch']);

    expect(abnormalOutput[0]).toContain('Classification incomplete for zero-candidate sources: deadline-source, error-source');
    expect(abnormalOutput[0]).not.toContain('completed-empty');
    expect(completedOutput[0]).not.toContain('Classification incomplete for zero-candidate sources:');
  });

  test('emits structured failures and unapproved proposed model names', async () => {
    const output: string[] = [];
    const program = new Command();
    registerModelWatchCommand(program, {
      fetchPages: async () => ({ pages: [{ source: 'source', text: 'new' }], failures: [{ id: 'other', url: 'https://other.test', error: 'bad gateway' }] }),
      runWatch: async () => intake(),
      out: { log: (line) => output.push(line) },
      err: { error: () => {} },
      setExitCode: () => {},
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', '--json']);
    const result = JSON.parse(output[0]!);
    expect(result).toMatchObject({ status: 'partial-failure', failures: [{ id: 'other' }], proposal: { added: ['new-model'] } });
    expect(result.candidates.map((item: { id: string }) => item.id)).toEqual(['new-model']);
  });

  test('applies exactly two requested candidates from the latest proposal through Commander with success exit status', async () => {
    const output: string[] = [];
    const applied: string[][] = [];
    const exitCodes: number[] = [];
    const unselectedCandidate: ModelCandidate = { ...candidate, id: 'unselected-model' };
    const program = new Command();
    registerModelWatchCommand(program, {
      readProposalLedger: () => proposalLedger([candidate, secondCandidate, unselectedCandidate]),
      applyApprovedCandidates: async (candidates) => {
        applied.push(candidates.map((item) => item.id));
        return { catalog: { version: 1, updated: 0, models: [] }, added: ['new-model'], updated: ['updated-model'], path: '/tmp/models.json' };
      },
      out: { log: (line) => output.push(line) }, err: { error: () => {} }, setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', 'new-model', 'updated-model']);
    expect(applied).toEqual([['new-model', 'updated-model']]);
    expect(output).toEqual(['Applied: added new-model; updated updated-model; saved /tmp/models.json']);
    expect(exitCodes).toEqual([0]);
  });

  test('rejects an ID that appears only in an earlier proposal ledger line', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    let applyCalls = 0;
    const program = new Command();
    registerModelWatchCommand(program, {
      readProposalLedger: multiLineProposalLedger,
      applyApprovedCandidates: async () => { applyCalls++; throw new Error('must not apply'); },
      out: { log: () => {} }, err: { error: (line) => errors.push(line) }, setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', 'previous-only']);
    expect(applyCalls).toBe(0);
    expect(errors).toEqual(['Candidate(s) not found in the latest proposal: previous-only']);
    expect(exitCodes).toEqual([1]);
  });

  test('rejects any requested ID missing from the latest proposal without applying', async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    let applyCalls = 0;
    const program = new Command();
    registerModelWatchCommand(program, {
      readProposalLedger: () => proposalLedger(),
      applyApprovedCandidates: async () => { applyCalls++; throw new Error('must not apply'); },
      out: { log: () => {} }, err: { error: (line) => errors.push(line) }, setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', 'new-model', 'missing-model']);
    expect(applyCalls).toBe(0);
    expect(errors).toEqual(['Candidate(s) not found in the latest proposal: missing-model']);
    expect(exitCodes).toEqual([1]);
  });

  test('prints apply usage without reading or writing when no candidate ID is supplied', async () => {
    const output: string[] = [];
    let reads = 0;
    const program = new Command();
    registerModelWatchCommand(program, {
      readProposalLedger: () => { reads++; return proposalLedger(); },
      out: { log: (line) => output.push(line) }, err: { error: () => {} }, setExitCode: () => {},
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', 'apply']);
    expect(reads).toBe(0);
    expect(output).toEqual(['Usage: model-watch apply [--dry-run] <candidate-id...>']);
  });

  test('uses the latest real proposal ledger record for dry-run then persists only after apply', async () => {
    const home = mkdtempSync(join(tmpdir(), 'model-watch-cli-'));
    const candidateId = 'proposal-only-model';
    const proposalPath = join(home, '.elanous', 'model-watch-proposals.jsonl');
    const catalogPath = join(home, '.elanous', 'models.json');
    const proposalCandidate: ModelCandidate = { ...candidate, id: candidateId };
    const output: string[] = [];
    try {
      mkdirSync(join(home, '.elanous'), { recursive: true });
      writeFileSync(proposalPath, `${proposalLedger([{ ...candidate, id: 'earlier-model' }]).trim()}\n${proposalLedger([proposalCandidate])}`);
      const program = new Command();
      registerModelWatchCommand(program, {
        readProposalLedger: () => readFileSync(proposalPath, 'utf8'),
        catalogIo: { home },
        out: { log: (line) => output.push(line) }, err: { error: () => {} }, setExitCode: () => {},
      });

      expect(loadCatalog({ home }).catalog.models.some((item) => item.id === candidateId)).toBe(false);
      await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', '--dry-run', candidateId]);
      expect(existsSync(catalogPath)).toBe(false);
      expect(loadCatalog({ home }).catalog.models.some((item) => item.id === candidateId)).toBe(false);
      expect(output).toEqual([`Dry run: would add ${candidateId}; would update none; no file written.`]);

      await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', candidateId]);
      expect(readFileSync(catalogPath, 'utf8')).toContain(candidateId);
      expect(loadCatalog({ home }).catalog.models.some((item) => item.id === candidateId)).toBe(true);
      expect(output.at(-1)).toBe(`Applied: added ${candidateId}; updated none; saved ${catalogPath}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('previews selected candidates without applying or writing', async () => {
    const output: string[] = [];
    let applyCalls = 0;
    const program = new Command();
    registerModelWatchCommand(program, {
      readProposalLedger: () => proposalLedger(),
      loadCatalog: () => ({ catalog: { version: 1, updated: 0, models: [] }, source: 'builtin', notices: [], path: '/tmp/models.json' }),
      mergeCandidates: (_catalog, candidates) => ({ catalog: { version: 1, updated: 0, models: [] }, added: candidates.map((item) => item.id), updated: [] }),
      applyApprovedCandidates: async () => { applyCalls++; throw new Error('must not apply'); },
      out: { log: (line) => output.push(line) }, err: { error: () => {} }, setExitCode: () => {},
    });

    await program.parseAsync(['node', 'elanous', 'model-watch', 'apply', '--dry-run', 'new-model']);
    expect(applyCalls).toBe(0);
    expect(output).toEqual(['Dry run: would add new-model; would update none; no file written.']);
  });
});
