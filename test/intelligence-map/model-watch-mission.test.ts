// PLAN-model-intelligence-router-2026-07-10 · Phase A5 tests.

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runModelIntelligenceWatch,
  getModelWatchProposalPath,
} from '../../src/intelligence-map/model-watch-mission.js';
import type { LlmRunner } from '../../src/model-tier/preset-suggest-llm.js';

const dirs: string[] = [];
function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'watch-mission-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const runner: LlmRunner = async () => JSON.stringify({
  models: [{ id: 'newmodel-9', provider: 'openai', family: 'nine', tier: 'best' }],
});

describe('runModelIntelligenceWatch', () => {
  it('surfaces a proposal + writes the proposals log + calls onProposal', async () => {
    const home = tempHome();
    let sinkCalled = false;
    const r = await runModelIntelligenceWatch(
      {
        fetchPages: async () => [{ source: 'openai-models', text: 'GPT nine announced' }],
        runLlm: runner,
        provider: 'anthropic',
        onProposal: () => { sinkCalled = true; },
      },
      { home, now: 100 },
    );
    expect(r.proposal.added).toContain('newmodel-9');
    expect(sinkCalled).toBe(true);
    const path = getModelWatchProposalPath(home);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain('newmodel-9');
  });

  it('writes nothing and does not throw when no pages change', async () => {
    const home = tempHome();
    const r = await runModelIntelligenceWatch(
      { fetchPages: async () => [], runLlm: runner, provider: 'anthropic' },
      { home, now: 100 },
    );
    expect(r.candidates).toEqual([]);
    expect(existsSync(getModelWatchProposalPath(home))).toBe(false);
  });

  it('survives a fetchPages failure', async () => {
    const home = tempHome();
    const r = await runModelIntelligenceWatch(
      { fetchPages: async () => { throw new Error('monitor down'); }, runLlm: runner, provider: 'anthropic' },
      { home, now: 100 },
    );
    expect(r.candidates).toEqual([]);
  });
});
