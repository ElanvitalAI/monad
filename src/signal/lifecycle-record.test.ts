import { describe, expect, test } from 'bun:test';
import { ChannelBus, type ChannelMessage } from '../terminal-matrix/channel-bus.js';
import {
  applyTruncation, channelForChild, channelMessageToRecord, createSeqCounter,
  aggregateChannelForRun, LIFECYCLE_TRUNCATION_LIMITS, publishLifecycleRecord,
  recordToChannelMessage, snapshotChildLifecycle, snapshotRunLifecycle, subscribeRunLifecycle, subscribeChildLifecycle,
  validateLifecycleRecord, type LifecycleRecord,
} from './lifecycle-record.js';

const base = { runId: 'run-1', ptyId: 'pty-1', subjectPtyId: 'pty-1', depth: 1, role: 'child' as const, seq: 1, at: 1_700_000_000_000, truncated: false as const };
const records: readonly LifecycleRecord[] = [
  { ...base, class: 'progress', name: 'started' },
  { ...base, seq: 2, class: 'progress', name: 'progress', payload: { step: 'inspect' } },
  { ...base, seq: 3, class: 'progress', name: 'complete', payload: { summary: 'done', changedFiles: ['a.ts'], verification: 'pass' } },
  { ...base, seq: 4, class: 'progress', name: 'failed', payload: { reason: 'blocked' } },
  { ...base, seq: 5, class: 'condition', name: 'awaiting-input', transition: 'enter', resumable: true, payload: { prompt: 'continue?' } },
  { ...base, seq: 6, class: 'condition', name: 'awaiting-input', transition: 'exit', payload: { prompt: 'received' } },
  { ...base, seq: 7, class: 'condition', name: 'ownership-lent', transition: 'enter', resumable: true, payload: { actor: 'human', mode: 'write' } },
  { ...base, seq: 8, class: 'event', name: 'action-refused', payload: { tools: ['Write'], by: 'guard', retryable: false } },
  { ...base, seq: 9, class: 'progress', name: 'failed', payload: { reason: 'cut' }, truncated: true, truncatedFields: ['reason'] },
];

describe('LifecycleRecord validation and serialization', () => {
  test('validates every axis and its class-specific payload', () => {
    for (const record of records) expect(validateLifecycleRecord(record)).toBeNull();
    expect(validateLifecycleRecord({ ...records[4], transition: undefined })).toBe('transition');
    expect(validateLifecycleRecord({ ...records[0], transition: 'enter' })).toBe('transition');
    expect(validateLifecycleRecord({ ...records[4], resumable: undefined })).toBe('resumable');
    expect(validateLifecycleRecord({ ...records[5], resumable: false })).toBe('resumable');
    expect(validateLifecycleRecord({ ...records[0], name: 'ownership-lent' })).toBe('name');
    expect(validateLifecycleRecord({ ...records[0], depth: -1 })).toBe('depth');
    expect(validateLifecycleRecord({ ...records[0], depth: 1.5 })).toBe('depth');
    expect(validateLifecycleRecord({ ...records[0], truncatedFields: [] })).toBe('truncatedFields');
    expect(validateLifecycleRecord({ ...records[0], truncatedFields: undefined })).toBe('truncatedFields');

    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const payload of [cyclic, { value: 1n }, { value: () => undefined }, { value: Symbol('x') }, { value: Number.NaN }]) {
      expect(validateLifecycleRecord({ ...records[1], payload })).toBe('payload');
    }
  });

  test('enforces payload length bounds and truncatedFields allowlist', () => {
    // Exact bounds pass; one over the limit fails on 'payload'.
    expect(validateLifecycleRecord({ ...records[5], payload: { prompt: 'p'.repeat(240) } })).toBeNull();
    expect(validateLifecycleRecord({ ...records[5], payload: { prompt: 'p'.repeat(241) } })).toBe('payload');
    expect(validateLifecycleRecord({ ...records[3], payload: { reason: 'r'.repeat(240) } })).toBeNull();
    expect(validateLifecycleRecord({ ...records[3], payload: { reason: 'r'.repeat(241) } })).toBe('payload');
    expect(validateLifecycleRecord({ ...records[2], payload: { summary: 's'.repeat(4_000), changedFiles: Array.from({ length: 50 }, (_, i) => `f${i}.ts`) } })).toBeNull();
    expect(validateLifecycleRecord({ ...records[2], payload: { summary: 's'.repeat(4_001), changedFiles: ['a.ts'] } })).toBe('payload');
    expect(validateLifecycleRecord({ ...records[2], payload: { summary: 'ok', changedFiles: Array.from({ length: 51 }, (_, i) => `f${i}.ts`) } })).toBe('payload');
    // truncated:true with a field outside the allowlist is rejected.
    expect(validateLifecycleRecord({ ...records[0], truncated: true, truncatedFields: ['actor'] })).toBe('truncatedFields');
    expect(validateLifecycleRecord({ ...records[8], truncatedFields: ['reason'] })).toBeNull();
  });

  test('rejects the contract-forbidden parentPtyId even when undefined', () => {
    expect(validateLifecycleRecord({ ...records[0], parentPtyId: 'pty-parent' })).toBe('parentPtyId');
    expect(validateLifecycleRecord({ ...records[0], parentPtyId: undefined })).toBe('parentPtyId');
  });

  test('requires a subject and makes every non-ownership record describe its producer', () => {
    for (const record of records.filter((record) => record.name !== 'ownership-lent')) {
      expect(validateLifecycleRecord({ ...record, subjectPtyId: 'pty-other' })).toBe('subjectPtyId');
    }
    expect(validateLifecycleRecord({ ...records[0], subjectPtyId: undefined })).toBe('subjectPtyId');
    const ownershipLent = records.find((record) => record.name === 'ownership-lent');
    if (!ownershipLent) throw new Error('missing ownership-lent fixture');
    expect(validateLifecycleRecord({ ...ownershipLent, subjectPtyId: 'pty-lent-to-human' })).toBeNull();
  });

  test('round-trips every record without restoring absent optional keys', () => {
    for (const record of records) expect(channelMessageToRecord({ channel: 'test', ...recordToChannelMessage(record) } as ChannelMessage)).toEqual(record);
    const started = channelMessageToRecord({ channel: 'test', ...recordToChannelMessage(records[0]) } as ChannelMessage);
    expect(started).not.toHaveProperty('payload');
    expect(started).not.toHaveProperty('transition');
    expect(started).not.toHaveProperty('resumable');
    expect(started).not.toHaveProperty('truncatedFields');
  });

  test('drops malformed channel messages without throwing', () => {
    expect(channelMessageToRecord({ channel: 'test', from: 'pty-1', at: 1, payload: '', meta: { lifecycleRecord: true, ...base, class: 'event', name: 'action-refused', payload: { tools: [] } } })).toBeNull();
  });

  test('rejects an envelope whose from impersonates a foreign ptyId', () => {
    const honest = { channel: 'test', ...recordToChannelMessage(records[0]) } as ChannelMessage;
    expect(channelMessageToRecord(honest)).toEqual(records[0]);
    const spoofed = { ...honest, from: 'pty-attacker' } as ChannelMessage;
    expect(channelMessageToRecord(spoofed)).toBeNull();
  });
});

describe('LifecycleRecord bus helpers', () => {
  test('fans in multiple children through the aggregate channel and snapshots one child', () => {
    const bus = new ChannelBus(); const received: LifecycleRecord[] = [];
    subscribeRunLifecycle(bus, base.runId, (record) => received.push(record));
    publishLifecycleRecord(bus, records[0]);
    publishLifecycleRecord(bus, { ...records[1], ptyId: 'pty-2', subjectPtyId: 'pty-2' });
    expect(received.map((record) => record.ptyId)).toEqual(['pty-1', 'pty-2']);
    expect(snapshotChildLifecycle(bus, 'pty-1')).toEqual([records[0]]);
    expect(bus.channels()).toContain(channelForChild('pty-1'));
    expect(bus.channels()).toContain(aggregateChannelForRun(base.runId));
  });

  test('subscribes to one child, drops malformed messages, and unsubscribes', () => {
    const bus = new ChannelBus(); const received: LifecycleRecord[] = [];
    const subscription = subscribeChildLifecycle(bus, 'pty-1', (record) => received.push(record));
    publishLifecycleRecord(bus, records[0]);
    publishLifecycleRecord(bus, { ...records[1], ptyId: 'pty-2', subjectPtyId: 'pty-2' });
    bus.publish(channelForChild('pty-1'), { from: 'pty-1', payload: '', meta: { lifecycleRecord: true } });
    expect(received).toEqual([records[0]]);
    subscription.unsubscribe();
    publishLifecycleRecord(bus, records[1]);
    expect(received).toEqual([records[0]]);
  });

  test('swallows bus publishing errors while attempting both channels', () => {
    const channels: string[] = [];
    const bus = {
      publish: (channel: string) => {
        channels.push(channel);
        if (channel === channelForChild('pty-1')) throw new Error('child unavailable');
        return 0;
      },
    } as unknown as ChannelBus;
    expect(() => publishLifecycleRecord(bus, records[0])).not.toThrow();
    expect(channels).toEqual([channelForChild('pty-1'), aggregateChannelForRun(base.runId)]);
  });

  test('creates independent producer-local sequence counters starting at one', () => {
    const first = createSeqCounter(); const second = createSeqCounter();
    expect([first(), first(), second(), first(), second()]).toEqual([1, 2, 1, 3, 2]);
  });
});

describe('LifecycleRecord truncation', () => {
  test('marks truncated text and file fields without exceeding final bounds', () => {
    const result = applyTruncation({ prompt: 'x'.repeat(241), reason: 'y'.repeat(241), summary: 'z'.repeat(4_001), changedFiles: Array.from({ length: 51 }, (_, index) => `file-${index}`) }, LIFECYCLE_TRUNCATION_LIMITS);
    // The discriminant is load-bearing: `truncatedFields` is only reachable
    // on the truncated branch, which is what keeps the producer seam and the
    // validator in agreement.
    if (!result.truncated) throw new Error('expected truncation');
    expect(result.truncatedFields).toEqual(['prompt', 'reason', 'summary', 'changedFiles']);
    expect(result.payload.prompt).toBe('x'.repeat(220) + '… [21 chars omitted]');
    expect((result.payload.prompt as string).length).toBe(240);
    expect((result.payload.reason as string).length).toBe(240);
    expect((result.payload.summary as string).length).toBe(4_000);
    expect(result.payload.summary).toEndWith('chars omitted]');
    const changedFiles = result.payload.changedFiles;
    expect(Array.isArray(changedFiles)).toBe(true);
    if (!Array.isArray(changedFiles)) throw new Error('changedFiles was not a string array');
    expect(changedFiles).toHaveLength(50);
    expect(changedFiles.at(-1)).toBe('… [2 files omitted]');
  });

  test('honors exact, exceeded, and short text boundaries by final length', () => {
    const exact = applyTruncation({ prompt: 'x'.repeat(240) }, LIFECYCLE_TRUNCATION_LIMITS);
    const exceeded = applyTruncation({ prompt: 'x'.repeat(241) }, LIFECYCLE_TRUNCATION_LIMITS);
    const short = applyTruncation({ prompt: 'short' }, LIFECYCLE_TRUNCATION_LIMITS);
    expect(exact).toEqual({ payload: { prompt: 'x'.repeat(240) }, truncated: false });
    expect((exceeded.payload.prompt as string).length).toBeLessThanOrEqual(240);
    expect(exceeded.payload.prompt).toEndWith('chars omitted]');
    expect(short).toEqual({ payload: { prompt: 'short' }, truncated: false });
  });

  test('keeps fields under bounds and reports no truncation', () => {
    const verification = 'verification is not subject to lifecycle truncation';
    expect(applyTruncation({ prompt: 'short', changedFiles: ['a.ts'], verification }, LIFECYCLE_TRUNCATION_LIMITS)).toEqual({ payload: { prompt: 'short', changedFiles: ['a.ts'], verification }, truncated: false });
  });
});

describe('lifecycle-record — review hardening (PR #5624)', () => {
  test('rejects pathologically deep payloads instead of overflowing the stack', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 5_000; i += 1) deep = { nested: deep };
    const record = { ...base, seq: 1, class: 'progress' as const, name: 'progress' as const, payload: deep };
    expect(validateLifecycleRecord(record)).toBe('payload');
    // …and the bus boundary turns that into a drop, never a throw.
    const msg: ChannelMessage = { channel: channelForChild('pty-1'), from: 'pty-1', at: 1, payload: '', meta: { lifecycleRecord: true, ...record } };
    expect(channelMessageToRecord(msg)).toBeNull();
  });

  test('applyTruncation output spreads into a VALID record on both branches', () => {
    const untouched = applyTruncation({ reason: 'short' }, LIFECYCLE_TRUNCATION_LIMITS);
    expect(untouched).not.toHaveProperty('truncatedFields');
    expect(validateLifecycleRecord({ ...base, class: 'progress', name: 'failed', ...untouched })).toBeNull();

    const cut = applyTruncation({ reason: 'r'.repeat(241) }, LIFECYCLE_TRUNCATION_LIMITS);
    expect(cut.truncated).toBe(true);
    expect(validateLifecycleRecord({ ...base, class: 'progress', name: 'failed', ...cut })).toBeNull();
  });

  test('truncatedFields must belong to the record NAME, not a global allowlist', () => {
    // `started` carries no truncatable field at all.
    expect(validateLifecycleRecord({ ...base, class: 'progress', name: 'started', truncated: true, truncatedFields: ['reason'] })).toBe('truncatedFields');
    // `complete` has summary/changedFiles — but not prompt.
    const complete = { ...base, class: 'progress' as const, name: 'complete' as const, payload: { summary: 's', changedFiles: [] } };
    expect(validateLifecycleRecord({ ...complete, truncated: true, truncatedFields: ['prompt'] })).toBe('truncatedFields');
    expect(validateLifecycleRecord({ ...complete, truncated: true, truncatedFields: ['summary'] })).toBeNull();
  });

  test('run-scoped aggregate isolates concurrent runs without consumer filtering', () => {
    const bus = new ChannelBus();
    const mine: LifecycleRecord[] = [];
    subscribeRunLifecycle(bus, 'run-1', (r) => mine.push(r));

    publishLifecycleRecord(bus, { ...base, runId: 'run-1', ptyId: 'pty-a', subjectPtyId: 'pty-a', class: 'progress', name: 'started' });
    publishLifecycleRecord(bus, { ...base, runId: 'run-2', ptyId: 'pty-b', subjectPtyId: 'pty-b', class: 'progress', name: 'started' });

    expect(mine.map((r) => r.ptyId)).toEqual(['pty-a']);
    expect(bus.channels()).toContain(aggregateChannelForRun('run-2'));
  });
});

describe('lifecycle-record — channel/record identity must agree (PR #5624 R2)', () => {
  /** Publish straight onto a channel, bypassing publishLifecycleRecord's
   *  key derivation — this is what a mis-routing (or hostile) producer does. */
  const publishRaw = (bus: ChannelBus, channel: string, record: LifecycleRecord): void => {
    bus.publish(channel, recordToChannelMessage(record));
  };

  test('a foreign child cannot pollute a sibling stream', () => {
    const bus = new ChannelBus();
    const seen: LifecycleRecord[] = [];
    subscribeChildLifecycle(bus, 'pty-a', (r) => seen.push(r));

    // Honest envelope (from === its own ptyId) but delivered on pty-a's channel.
    publishRaw(bus, channelForChild('pty-a'), { ...base, ptyId: 'pty-b', subjectPtyId: 'pty-b', class: 'progress', name: 'started' });
    publishRaw(bus, channelForChild('pty-a'), { ...base, ptyId: 'pty-a', subjectPtyId: 'pty-a', class: 'progress', name: 'started' });

    expect(seen.map((r) => r.ptyId)).toEqual(['pty-a']);
    expect(snapshotChildLifecycle(bus, 'pty-a').map((r) => r.ptyId)).toEqual(['pty-a']);
  });

  test('a mis-routed record cannot leak into a sibling run aggregate', () => {
    const bus = new ChannelBus();
    const seen: LifecycleRecord[] = [];
    subscribeRunLifecycle(bus, 'run-1', (r) => seen.push(r));

    publishRaw(bus, aggregateChannelForRun('run-1'), { ...base, runId: 'run-2', ptyId: 'pty-x', subjectPtyId: 'pty-x', class: 'progress', name: 'started' });
    publishRaw(bus, aggregateChannelForRun('run-1'), { ...base, runId: 'run-1', ptyId: 'pty-y', subjectPtyId: 'pty-y', class: 'progress', name: 'started' });

    expect(seen.map((r) => r.ptyId)).toEqual(['pty-y']);
    // snapshotRunLifecycle enforces the same boundary on the replay path.
    expect(snapshotRunLifecycle(bus, 'run-1').map((r) => r.ptyId)).toEqual(['pty-y']);
  });

  test('snapshotRunLifecycle replays the run children in publish order', () => {
    const bus = new ChannelBus();
    publishLifecycleRecord(bus, { ...base, runId: 'run-9', ptyId: 'pty-1', seq: 1, class: 'progress', name: 'started' });
    publishLifecycleRecord(bus, { ...base, runId: 'run-9', ptyId: 'pty-2', subjectPtyId: 'pty-2', seq: 1, class: 'progress', name: 'started' });
    expect(snapshotRunLifecycle(bus, 'run-9').map((r) => r.ptyId)).toEqual(['pty-1', 'pty-2']);
    expect(snapshotRunLifecycle(bus, 'run-9', 1).map((r) => r.ptyId)).toEqual(['pty-2']);
  });
});
