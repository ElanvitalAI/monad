import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { listAcpBackends } from '../acp/backend-registry.js';

const calls: string[] = [];
let sinkShouldFail = false;
const agentOpts: Array<Record<string, unknown>> = [];
const promptCalls: unknown[][] = [];
const debugEvents: Array<{ category: string; event: string; data: unknown }> = [];
let imageCapability = true;

const fakeAgent = {
  newSession: async () => 'test-session',
  getCapabilities: () => ({ prompt: { image: imageCapability, resourceLink: true } }),
  prompt: async (...args: unknown[]) => {
    promptCalls.push(args);
    debug.log('acp.client', 'prompt-start', { sessionId: args[0] });
    return { stopReason: 'end_turn' };
  },
  stop: async () => {},
};

function tempFile(name: string, contents: string | Uint8Array): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'acp-cli-attachment-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return { dir, path };
}

function expectSinglePromptStart(): void {
  expect(debugEvents.filter(({ category, event }) => category === 'acp.client' && event === 'prompt-start')).toHaveLength(1);
}

mock.module('../domains/standalone-log-sink.js', () => ({
  registerStandaloneLogSink: async (surface: string) => {
    calls.push(`sink:${surface}`);
    if (sinkShouldFail) throw new Error('logs.db unavailable');
  },
}));
mock.module('../acp/agent-manager.js', () => ({
  AcpAgentManager: class {},
  globalAcpAgentManager: () => ({
    getAgent: async (_backend: string, opts: Record<string, unknown>) => {
      agentOpts.push(opts);
      return fakeAgent;
    },
  }),
}));

let program: Command;
let debugSpy: ReturnType<typeof spyOn>;

beforeAll(async () => {
  ({ program } = await import('../index.js'));
  program.exitOverride();
});

beforeEach(() => {
  calls.length = 0;
  agentOpts.length = 0;
  promptCalls.length = 0;
  debugEvents.length = 0;
  debugSpy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data: unknown) => {
    debugEvents.push({ category, event, data });
  }) as never);
  sinkShouldFail = false;
  imageCapability = true;
});

afterEach(() => debugSpy.mockRestore());

describe('production ACP CLI sink wiring', () => {
  test('the actual index ACP list action renders unsupported reasons without changing supported rows or registry order', async () => {
    const output: string[] = [];
    const log = spyOn(console, 'log').mockImplementation((line: string) => output.push(line));
    try {
      await program.parseAsync(['node', 'elanous', 'acp', 'list']);
    } finally {
      log.mockRestore();
    }

    expect(calls).toEqual(['sink:acp']);
    const expectedRows = listAcpBackends().flatMap((backend) => [
      `  ${backend.id.padEnd(10)} ${backend.label}${backend.unsupportedReason ? ` (unsupported: ${backend.unsupportedReason})` : ''}`,
      `             ${backend.npmPackage}@${backend.npmVersion}`,
    ]);
    expect(output.slice(3)).toEqual(expectedRows);
  });

  test('the actual index ACP list action continues when sink registration fails', async () => {
    sinkShouldFail = true;

    await program.parseAsync(['node', 'elanous', 'acp', 'list']);

    expect(calls).toEqual(['sink:acp']);
  });

  test('the actual index ACP test action leaves permission approval unset by default', async () => {
    await program.parseAsync(['node', 'elanous', 'acp', 'test']);

    expect(agentOpts).toHaveLength(1);
    expect(agentOpts[0]?.permissionApprover).toBeUndefined();
  });

  test('the actual index ACP test action opts into an approving permission handler', async () => {
    await program.parseAsync(['node', 'elanous', 'acp', 'test', '--auto-approve-permissions']);

    expect(agentOpts).toHaveLength(1);
    const approver = agentOpts[0]?.permissionApprover;
    expect(approver).toEqual(expect.any(Function));
    if (typeof approver !== 'function') throw new Error('permission approver was not configured');
    await expect(approver({})).resolves.toBe(true);
  });

  test('the actual index ACP test action sends an image block for an image file', async () => {
    const file = tempFile('image.png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
    try {
      await program.parseAsync(['node', 'elanous', 'acp', 'test', '--file', file.path]);
      expect(promptCalls[0]?.[1]).toEqual([
        { type: 'text', text: 'Say hi in one short sentence.' },
        { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
      ]);
      expectSinglePromptStart();
      expect(debugEvents.filter(({ category, event }) => category === 'acp.client' && event === 'attachment-summary')).toHaveLength(1);
    } finally {
      rmSync(file.dir, { recursive: true, force: true });
    }
  });

  test('the actual index ACP test action sends a resource link for a non-image file', async () => {
    const file = tempFile('notes.txt', 'notes');
    try {
      await program.parseAsync(['node', 'elanous', 'acp', 'test', '--file', file.path]);
      expect(promptCalls[0]?.[1]).toEqual([
        { type: 'text', text: 'Say hi in one short sentence.' },
        { type: 'resource_link', uri: `file://${file.path}`, name: 'notes.txt' },
      ]);
    } finally {
      rmSync(file.dir, { recursive: true, force: true });
    }
  });

  test('the actual index ACP test action omits unsupported image attachments visibly', async () => {
    imageCapability = false;
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    const file = tempFile('image.png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
    try {
      await program.parseAsync(['node', 'elanous', 'acp', 'test', '--file', file.path]);
      expect(promptCalls[0]?.[1]).toEqual([{ type: 'text', text: 'Say hi in one short sentence.' }]);
      expect(warning).toHaveBeenCalledWith(`attachment skipped: ${file.path} (image unsupported by peer)`);
    } finally {
      warning.mockRestore();
      rmSync(file.dir, { recursive: true, force: true });
    }
  });

  test('the actual index ACP test action preserves a single text block without file options', async () => {
    await program.parseAsync(['node', 'elanous', 'acp', 'test']);

    expect(promptCalls[0]?.[1]).toEqual([{ type: 'text', text: 'Say hi in one short sentence.' }]);
    expectSinglePromptStart();
    expect(debugEvents.filter(({ category, event }) => category === 'acp.client' && event === 'attachment-summary')).toHaveLength(1);
  });
});
