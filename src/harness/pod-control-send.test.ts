import { describe, expect, test } from 'bun:test';
import { encodeControlMemoFrame } from './control-inbox.js';
import { sendPodControl } from './pod-control-send.js';
import type { Kubectl } from '../task-orchestrator/surfaces/self-implement-pod.js';

const record = { spaceId: 'fragment', context: 'cluster-a', namespace: 'elanous-test', job: 'si-fragment', inboxDir: '/tmp/elanous-control.inbox' };

describe('Pod control send', () => {
  test('memo uses the existing frame via exec stdin in the recorded context and namespace', () => {
    const calls: Array<{ args: readonly string[]; input?: string }> = [];
    const kubectl: Kubectl = (args, input) => { calls.push({ args, input }); return { status: 0, stdout: '', stderr: '' }; };
    const memo = { version: 1 as const, kind: 'supervisor', urgency: 'normal' as const, body: 'hello' };
    sendPodControl(record, { memo }, kubectl);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.slice(0, 9)).toEqual(['--context', 'cluster-a', '-n', 'elanous-test', 'exec', '-i', 'job/si-fragment', '-c', 'child']);
    expect(calls[0]!.args).toContain('/tmp/elanous-control.inbox');
    expect(calls[0]!.args).toContain('memo');
    expect(calls[0]!.input).toBe(`${encodeControlMemoFrame(memo)}\n`);
    expect(calls[0]!.args.join(' ')).toContain('memo:%s');
  });
  test('stop publishes the existing latch and durable marker inside the Pod', () => {
    let args: readonly string[] = [];
    let input: string | undefined;
    sendPodControl(record, { stop: true }, (a, i) => { args = a; input = i; return { status: 0, stdout: '', stderr: '' }; });
    expect(input).toBe('stop\n');
    expect(args).toContain('stop');
    expect(args.join(' ')).toContain('stop-requested.json');
    expect(args.join(' ')).toContain('.ready/stop');
  });
  test('kubectl failure is not reported as delivery', () => {
    expect(() => sendPodControl(record, { stop: true }, () => ({ status: 1, stdout: '', stderr: 'pod gone' }))).toThrow('Pod si-fragment control send 실패: pod gone');
  });
});
