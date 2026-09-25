// #3571 channel-terminal-relay integration into the NL delegate path.
//
// The `/cc` slash path relays tool commands/stdout/diffs into the chat
// (turn-runner). Before this, delegate_code_agent accumulated PROSE ONLY,
// so a natural-language "Claude로 구현해줘" hid the actual diffs/output.
// These tests confirm the relay now feeds tool content into the result.

import { describe, test, expect, afterEach } from 'bun:test';
import { dispatchDelegateAgent } from '../src/boot/daemon-tools/delegate-agent';
import { __setDualRoleManagerForTest, type DualRoleManager } from '../src/acp/dual-role-manager';

/** Fake DRM whose clientSessionSend replays a scripted stream of ACP
 *  updates through the caller's onUpdate. */
function installDrmWithUpdates(updates: unknown[]): void {
  const fake = {
    async clientSessionCreate() { return { id: 'sub-1' }; },
    async clientSessionSetGoal() { return null; },
    async clientSessionGetGoal() { return null; },
    async clientSessionSend(opts: { onUpdate?: (u: unknown) => void }) {
      for (const u of updates) opts.onUpdate?.(u);
      return { stopReason: 'end_turn' };
    },
  };
  __setDualRoleManagerForTest(fake as unknown as DualRoleManager);
}

const baseCtx = { cwd: process.cwd(), signal: new AbortController().signal };

afterEach(() => { __setDualRoleManagerForTest(null); });

describe('dispatchDelegateAgent · tool content relay (NL path)', () => {
  test('relays tool command + output + prose into the result output', async () => {
    installDrmWithUpdates([
      { sessionUpdate: 'tool_call', title: 'Bash', kind: 'execute', rawInput: { command: 'npm test' } },
      { sessionUpdate: 'tool_call_update', title: 'Bash', kind: 'execute', status: 'completed', rawOutput: '3 passing' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'all tests green' } },
    ]);
    const res = await dispatchDelegateAgent({ backend: 'claude', task: 'run the tests' }, { ...baseCtx }) as { output: string };
    // command (from tool_call), output (from tool_call_update), and prose
    expect(res.output).toContain('npm test');
    expect(res.output).toContain('3 passing');
    expect(res.output).toContain('all tests green');
  });

  test('read-only tool at the fixed normal policy → compact 1-line header (no command body)', async () => {
    installDrmWithUpdates([
      { sessionUpdate: 'tool_call', title: 'Read', kind: 'read', rawInput: { path: '/x' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
    ]);
    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'read a file' },
      { ...baseCtx },
    ) as { output: string };
    // normal: read-only shows a 1-line header (title) but NOT the rawInput path.
    expect(res.output).toContain('ok');
    expect(res.output).toContain('Read');
    expect(res.output).not.toContain('/x');
  });
});
