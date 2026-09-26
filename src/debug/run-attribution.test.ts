import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { debug } from './log.js';

const RUN_ID_ENV = 'ELANOUS_RUN_ID';
const originalRunId = process.env[RUN_ID_ENV];
let originalDebugStatus: ReturnType<typeof debug.status>;

beforeEach(() => {
  originalDebugStatus = debug.status();
  debug.setFileEnabled(false);
  debug.enable();
  debug.setVerboseEnabled(true);
  debug.clear();
});

afterEach(() => {
  debug.clear();
  debug.setFileEnabled(originalDebugStatus.file);
  debug.setMirror(originalDebugStatus.mirror);
  debug.setVerboseEnabled(originalDebugStatus.verbose);
  debug.setDiagEnabled(originalDebugStatus.diag);
  debug.setRenderSuppressed(originalDebugStatus.renderSuppressed);
  if (originalRunId === undefined) delete process.env[RUN_ID_ENV];
  else process.env[RUN_ID_ENV] = originalRunId;
});

function emitAndRead(data?: unknown) {
  debug.log('run.attribution', 'record', data);
  return debug.events(1)[0];
}

describe('DebugLog run attribution', () => {
  test('ambient ELANOUS_RUN_ID is recorded at the data.runId query key while preserving data', () => {
    process.env[RUN_ID_ENV] = 'ambient-run';

    expect(emitAndRead({ existing: true })?.data).toEqual({ existing: true, runId: 'ambient-run' });
  });

  test('caller-provided runId remains authoritative over ambient attribution', () => {
    process.env[RUN_ID_ENV] = 'ambient-run';

    expect(emitAndRead({ runId: 'caller-run', existing: true })?.data).toEqual({
      runId: 'caller-run',
      existing: true,
    });
  });

  test('missing ambient run identity does not invent a data.runId field', () => {
    delete process.env[RUN_ID_ENV];

    const data = emitAndRead({ existing: true })?.data as Record<string, unknown>;
    expect(data).toEqual({ existing: true });
    expect(Object.hasOwn(data, 'runId')).toBe(false);
  });

  test('non-plain and primitive payloads retain their identity while the record receives ambient attribution', () => {
    process.env[RUN_ID_ENV] = 'ambient-run';
    const values = [undefined, null, 'text', 7, [1, 2], new Date('2026-08-18T00:00:00Z'), new Map([['key', 'value']])];

    for (const value of values) {
      const record = emitAndRead(value);
      expect(record?.data).toBe(value);
      expect(record?.runId).toBe('ambient-run');
    }

    class Payload { constructor(readonly value: string) {} }
    const instance = new Payload('preserved');
    const record = emitAndRead(instance);
    expect(record?.data).toBe(instance);
    expect(record?.runId).toBe('ambient-run');
  });
});

describe('DebugLog host attribution', () => {
  const originalHostId = process.env.ELANOUS_HOST_ID;
  afterEach(() => {
    if (originalHostId === undefined) delete process.env.ELANOUS_HOST_ID;
    else process.env.ELANOUS_HOST_ID = originalHostId;
  });
  test('inherited host is attached to plain object; caller wins', () => {
    process.env.ELANOUS_HOST_ID = '01HOSTTEST';
    expect(emitAndRead({ value: 1 })?.data).toEqual({ value: 1, hostId: '01HOSTTEST' });
    expect(emitAndRead({ hostId: 'caller' })?.data).toEqual({ hostId: 'caller' });
    expect(emitAndRead([1])?.data).toEqual([1]);
  });
  test('without host env the plain payload is byte-identical', () => {
    delete process.env.ELANOUS_HOST_ID;
    delete process.env.ELANOUS_RUN_ID;
    delete process.env.ELANOUS_SUBSTRATE;
    delete process.env.ELANOUS_ARM_ID;
    expect(JSON.stringify(emitAndRead({ value: 1 })?.data)).toBe('{"value":1}');
  });
});

// RFC fleet 슈퍼바이저 §A1 — 실행 칸(ELANOUS_SUBSTRATE)·벤치 팔(ELANOUS_ARM_ID)도 runId 처럼 data 에 귀속된다.
describe('DebugLog substrate · arm attribution', () => {
  afterEach(() => { delete process.env.ELANOUS_SUBSTRATE; delete process.env.ELANOUS_ARM_ID; });
  test('env present → data.substrate and data.armId (llm.usage rows become per-arm)', () => {
    process.env.ELANOUS_SUBSTRATE = 'pod';
    process.env.ELANOUS_ARM_ID = 'pod/openrouter/kimi-k3';
    const data = emitAndRead({ inputTokens: 10 })?.data as Record<string, unknown>;
    expect(data.substrate).toBe('pod');
    expect(data.armId).toBe('pod/openrouter/kimi-k3');
    expect(data.inputTokens).toBe(10);
  });
  test('env absent → payload unchanged (byte-identical ordinary logs)', () => {
    delete process.env.ELANOUS_SUBSTRATE; delete process.env.ELANOUS_ARM_ID; delete process.env[RUN_ID_ENV];
    expect(emitAndRead({ a: 1 })?.data).toEqual({ a: 1 });
  });
  test('caller-provided substrate wins', () => {
    process.env.ELANOUS_SUBSTRATE = 'pod';
    expect((emitAndRead({ substrate: 'local' })?.data as Record<string, unknown>).substrate).toBe('local');
  });
});
