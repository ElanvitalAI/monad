import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';
import { buildUserConfig, resetUserConfig } from '../src/user-config.js';
import { buildDevCliSpec, type DevCliExecutor } from '../src/self-dev/dev-cli.js';
import { planDevPipeline, toSelfImplementOptions } from '../src/self-dev/dev-pipeline.js';
import { runSelfImplement } from '../src/self-implement/orchestrator.js';
import { parseRunControlValue } from '../src/self-implement/run-controls.js';
import { seams } from '../src/self-implement/test-seams.js';

const SELF: DevCliExecutor = { kind: 'self' };

type AuthorityObservation = {
  graphAuthoritative: boolean;
  graphAuthoritativeSource: 'flag' | 'config' | 'default';
};

async function runThroughExistingEntry(input: {
  configValue?: boolean;
  graphFlag?: 'on' | 'off';
  goalType?: 'research';
  changedFiles?: readonly string[];
  runId: string;
}): Promise<{ authority: AuthorityObservation; nodeNames: string[]; gateExecuted: boolean }> {
  const configDir = mkdtempSync(join(tmpdir(), 'graph-authority-default-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const ledger: Array<{ event: string; data: Record<string, unknown> }> = [];
  try {
    delete process.env.XDG_CONFIG_HOME;
    setMonadConfigDir(configDir);
    if (input.configValue !== undefined) {
      // This is the persisted raw shape produced by
      // `config set tools.selfImplement.graphAuthoritative <boolean>`.
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        tools: { selfImplement: { graphAuthoritative: input.configValue } },
      }));
    }
    resetUserConfig();

    const parsedFlag = input.graphFlag === undefined
      ? undefined
      : parseRunControlValue('graph', input.graphFlag) as boolean;
    const spec = buildDevCliSpec(
      { text: 'graph authority execution entry' },
      SELF,
      parsedFlag === undefined ? {} : { graph: parsedFlag },
    );
    const goalFile = input.goalType === undefined
      ? undefined
      : join(configDir, 'GOAL.md');
    if (goalFile !== undefined) writeFileSync(goalFile, `대상 경로: docs/x.md\n- GoalId: 1111111111111111\n- GoalType: ${input.goalType}\n\n# research goal\n`);
    const options = toSelfImplementOptions(
      'graph authority execution entry',
      planDevPipeline(spec),
      seams({
        writeRunLedger: (entry) => {
          ledger.push({ event: entry.event, data: entry.data });
        },
        ...(input.changedFiles === undefined ? {} : { changedFilesForGateRoute: () => input.changedFiles! }),
      }),
    );
    await runSelfImplement({ ...options, ...(goalFile === undefined ? {} : { goalFile }), runId: input.runId });

    const authority = ledger.find(({ event }) => event === 'graph-authority-resolved')?.data;
    expect(authority).toBeDefined();
    return {
      authority: authority as AuthorityObservation,
      nodeNames: ledger
        .filter(({ event }) => event === 'pipeline-node-entry')
        .map(({ data }) => String(data.node)),
      gateExecuted: ledger.some(({ event, data }) => event === 'gated' && data.gateExecuted === true),
    };
  } finally {
    resetUserConfig();
    resetMonadConfigDir();
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(configDir, { recursive: true, force: true });
  }
}

describe('graph authority default and source ladder', () => {
  test('missing setting reaches runSelfImplement as enabled/default and records node names', async () => {
    const observed = await runThroughExistingEntry({ runId: 'run-graph-default' });
    expect(observed.authority).toMatchObject({
      graphAuthoritative: true,
      graphAuthoritativeSource: 'default',
    });
    expect(observed.nodeNames).toEqual(['implement', 'gate', 'open-pr']);
  });

  test('default graph authority intentionally skips the gate for research document-only changes, while --graph off preserves it', async () => {
    const defaultOn = await runThroughExistingEntry({
      goalType: 'research',
      changedFiles: ['docs/RESEARCH-x.md'],
      runId: 'run-graph-default-research-docs',
    });
    const flagOff = await runThroughExistingEntry({
      goalType: 'research',
      graphFlag: 'off',
      changedFiles: ['docs/RESEARCH-x.md'],
      runId: 'run-graph-off-research-docs',
    });

    expect(defaultOn.authority).toMatchObject({ graphAuthoritative: true, graphAuthoritativeSource: 'default' });
    expect(defaultOn.gateExecuted).toBe(false);
    expect(flagOff.authority).toMatchObject({ graphAuthoritative: false, graphAuthoritativeSource: 'flag' });
    expect(flagOff.gateExecuted).toBe(true);
  });

  test('explicit config on and off survive as distinct config observations', async () => {
    const enabled = await runThroughExistingEntry({ configValue: true, runId: 'run-graph-config-on' });
    const disabled = await runThroughExistingEntry({ configValue: false, runId: 'run-graph-config-off' });
    expect(enabled.authority).toMatchObject({ graphAuthoritative: true, graphAuthoritativeSource: 'config' });
    expect(disabled.authority).toMatchObject({ graphAuthoritative: false, graphAuthoritativeSource: 'config' });
  });

  test('--graph off traverses CLI adapters and overrides explicit config with flag provenance', async () => {
    const observed = await runThroughExistingEntry({
      configValue: true,
      graphFlag: 'off',
      runId: 'run-graph-flag-off',
    });
    expect(observed.authority).toMatchObject({
      graphAuthoritative: false,
      graphAuthoritativeSource: 'flag',
    });
  });

  test('flag, config, and default remain three distinguishable provenance values', async () => {
    // The config-dir override is process-global, so these entry runs are deliberately serial.
    const byDefault = await runThroughExistingEntry({ runId: 'run-source-default' });
    const byConfig = await runThroughExistingEntry({ configValue: false, runId: 'run-source-config' });
    const byFlag = await runThroughExistingEntry({ configValue: true, graphFlag: 'off', runId: 'run-source-flag' });
    expect(new Set([
      byDefault.authority.graphAuthoritativeSource,
      byConfig.authority.graphAuthoritativeSource,
      byFlag.authority.graphAuthoritativeSource,
    ])).toEqual(new Set(['default', 'config', 'flag']));
  });

  test('adjacent selfImplement defaults remain unchanged', () => {
    const config = buildUserConfig('/definitely/missing/graph-authority-default.json');
    expect(config.tools.selfImplement).toMatchObject({
      graphAuthoritative: true,
      observeOnly: false,
      fabricDecompose: false,
      autoOpenPr: true,
    });
  });
});
