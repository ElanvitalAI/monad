import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  buildKrFlowTool,
  dispatchKrFlow,
  krFlowAvailable,
} from '../src/skills/tools/kr-flow.js';

const ORIG = {
  KEY: process.env.KIS_APP_KEY,
  SEC: process.env.KIS_APP_SECRET,
  SCRIPT: process.env.KR_FLOW_SCRIPT,
  ENV: process.env.KR_FLOW_ENV,
};
let tmp: string;

beforeEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
  delete process.env.KR_FLOW_SCRIPT;
  tmp = joinPath(tmpdir(), `mh-krflow-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  // Isolate from the real ~/.claude/skills/kr-flow/.env: krFlowAvailable()
  // now falls back to that file when process.env has no keys, so point
  // KR_FLOW_ENV at a nonexistent path to make the "no creds" tests hermetic.
  process.env.KR_FLOW_ENV = joinPath(tmp, 'nonexistent.env');
});

afterEach(() => {
  if (ORIG.KEY !== undefined) process.env.KIS_APP_KEY = ORIG.KEY;
  if (ORIG.SEC !== undefined) process.env.KIS_APP_SECRET = ORIG.SEC;
  if (ORIG.SCRIPT !== undefined) process.env.KR_FLOW_SCRIPT = ORIG.SCRIPT;
  if (ORIG.ENV !== undefined) process.env.KR_FLOW_ENV = ORIG.ENV;
  else delete process.env.KR_FLOW_ENV;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('buildKrFlowTool', () => {
  test('schema: no required field (market commands need no symbol) + command enum covers per-stock + market', () => {
    const spec = buildKrFlowTool();
    expect(spec.name).toBe('KrFlowSnapshot');
    // symbol is validated per-command at dispatch, not schema-required, so
    // market-wide commands (frgn-institution, market-flow) need no symbol.
    expect(spec.parameters.required).toEqual([]);
    const props = spec.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.command.enum).toContain('foreign-net');
    expect(props.command.enum).toContain('investor');
    expect(props.command.enum).toContain('market-flow');
    expect(props.command.enum).toContain('frgn-institution');
    expect(props.target).toBeDefined();
  });

  test('schema: derivatives + intraday commands exposed for leverage digging + date/json params', () => {
    const spec = buildKrFlowTool();
    const props = spec.parameters.properties as Record<string, unknown>;
    const cmd = (props.command as { enum: string[] }).enum;
    // Derivatives (the point of this expansion).
    expect(cmd).toContain('krx-futures');
    expect(cmd).toContain('krx-options');
    expect(cmd).toContain('krx-index');
    expect(cmd).toContain('krx-deriv-index');
    // Intraday flow commands (already valid, now surfaced).
    expect(cmd).toContain('estimate');
    expect(cmd).toContain('member');
    expect(cmd).toContain('investor-time');
    // New passthrough params.
    expect(props.date).toBeDefined();
    expect(props.json).toBeDefined();
  });
});

describe('krFlowAvailable', () => {
  test('false without keys', () => {
    expect(krFlowAvailable()).toBe(false);
  });

  test('false with keys but no script', () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    process.env.KR_FLOW_SCRIPT = joinPath(tmp, 'nonexistent.py');
    expect(krFlowAvailable()).toBe(false);
  });

  test('true with keys + script present', () => {
    process.env.KIS_APP_KEY = 'k';
    process.env.KIS_APP_SECRET = 's';
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, '#!/usr/bin/env python3\nprint("ok")\n', 'utf-8');
    process.env.KR_FLOW_SCRIPT = scriptPath;
    expect(krFlowAvailable()).toBe(true);
  });
});

describe('dispatchKrFlow — unavailable', () => {
  test('returns isError when keys missing', async () => {
    const r = await dispatchKrFlow({ symbol: '005930' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('unavailable');
  });
});

describe('dispatchKrFlow — running a stub script', () => {
  test('captures stdout from a fake python script', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'cmd = sys.argv[1]',
      'sym = sys.argv[2]',
      'print(f"## {cmd} for {sym}")',
      'print("row1")',
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    const r = await dispatchKrFlow({ symbol: '005930', command: 'investor' });
    expect(r.isError).toBeUndefined();
    expect(r.output).toContain('## investor for 005930');
    expect(r.output).toContain('row1');
    expect(r.metadata.exitCode).toBe(0);
    expect(r.metadata.symbol).toBe('005930');
    expect(r.metadata.command).toBe('investor');
  });

  test('market command runs with NO symbol, passes only [command]', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'print("argv=" + "|".join(sys.argv[1:]))',
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    const r = await dispatchKrFlow({ command: 'frgn-institution' });
    expect(r.isError).toBeUndefined();
    expect(r.output).toContain('argv=frgn-institution');
    expect(r.metadata.command).toBe('frgn-institution');
  });

  test('market-flow forwards target as second arg', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'print("argv=" + "|".join(sys.argv[1:]))',
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    const r = await dispatchKrFlow({ command: 'market-flow', target: 'KSP' });
    expect(r.output).toContain('argv=market-flow|KSP');
  });

  test('derivative command runs with no symbol + --date + --json passthrough', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'print("argv=" + "|".join(sys.argv[1:]))',
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    const r = await dispatchKrFlow({ command: 'krx-options', date: '20260708', json: true });
    // date is a KRX date-scoped flag → `--date 20260708`; json → `--json`.
    expect(r.output).toContain('argv=krx-options|--date|20260708|--json');
    expect(r.metadata.command).toBe('krx-options');
  });

  test('json passthrough on a per-stock command; date is dropped for non-date commands', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'print("argv=" + "|".join(sys.argv[1:]))',
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    // `estimate` is not a date-scoped command, so `date` must NOT be forwarded.
    const r = await dispatchKrFlow({ command: 'estimate', symbol: '005930', date: '20260708', json: true });
    expect(r.output).toContain('argv=estimate|005930|--json');
    expect(r.output).not.toContain('--date');
  });

  test('non-zero exit surfaces as isError with stderr', async () => {
    const scriptPath = joinPath(tmp, 'main.py');
    writeFileSync(scriptPath, [
      '#!/usr/bin/env python3',
      'import sys',
      'sys.stderr.write("boom\\n")',
      'sys.exit(2)',
    ].join('\n'), 'utf-8');
    process.env.KIS_APP_KEY = 'fake';
    process.env.KIS_APP_SECRET = 'fake';
    process.env.KR_FLOW_SCRIPT = scriptPath;

    const r = await dispatchKrFlow({ symbol: '005930' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('boom');
    expect(r.metadata.exitCode).toBe(2);
  });
});

describe('dispatchKrFlow — validation', () => {
  test('non-6-digit symbol rejected', async () => {
    await expect(dispatchKrFlow({ symbol: 'AAPL' })).rejects.toThrow(/6-digit/);
    await expect(dispatchKrFlow({ symbol: '12345' })).rejects.toThrow(/6-digit/);
    await expect(dispatchKrFlow({ symbol: '005930a' })).rejects.toThrow(/6-digit/);
  });

  test('invalid command rejected', async () => {
    await expect(dispatchKrFlow({ symbol: '005930', command: 'unknown' })).rejects.toThrow(/command/);
  });
});

describe('catalog registration', () => {
  test('kr_flow_snapshot has probe + supportsParallel false', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const entry = nativeToolCatalog.find(t => t.id === 'kr_flow_snapshot');
    expect(entry).toBeDefined();
    expect(entry!.probe?.kind).toBe('custom');
    expect(entry!.supportsParallel).toBe(false);
  });
});
