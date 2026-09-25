// ── IUL Bundle 8T — StartRecording / StopRecording unit tests ──
//
// Exercises the tool specs + dispatch functions + registration
// lifecycle. Uses a fake WidgetRecorderHost so no real WidgetHost is
// needed; events are fired synchronously via the captured subscriber
// callback.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildStartRecordingTool,
  buildStopRecordingTool,
  dispatchStartRecording,
  dispatchStopRecording,
  registerRecordingRuntimes,
  __resetRecordingRuntimesForTest,
  __activeRecorderCountForTest,
  type RecordingFs,
  type RecordingRuntimeDeps,
} from '../src/tool-runtime/recording-runtimes.js';
import {
  getToolRuntime,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/registry.js';
import type { WidgetStateChangeEvent } from '../src/widgets/host.js';

// ── Fakes ───────────────────────────────────────────────────────

type Subscriber = (e: WidgetStateChangeEvent) => void;

function makeFakeHost(): {
  onInstanceStateChange: (cb: Subscriber) => () => void;
  snapshotHashFor: (id: string) => string | null;
  get: (id: string) => { id: string; type: string; character: string; state: unknown } | null;
  fire: (event: WidgetStateChangeEvent) => void;
  subs: Set<Subscriber>;
} {
  const subs = new Set<Subscriber>();
  let hashSeq = 0;
  const hashPerId = new Map<string, string>();
  return {
    subs,
    onInstanceStateChange(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    snapshotHashFor(id) {
      // Unique hash per call so skipUnchanged doesn't filter our test
      // events unless a test explicitly wants the fast-path to trip.
      hashSeq += 1;
      const h = `h-${id}-${hashSeq}`;
      hashPerId.set(id, h);
      return h;
    },
    get(id) {
      return { id, type: 'fake', character: `c-${id}`, state: {} };
    },
    fire(event) {
      for (const cb of subs) cb(event);
    },
  };
}

function makeFakeFs(): RecordingFs & {
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    mkdirSync(p) { dirs.add(p); },
    writeFileSync(p, body) { files.set(p, body); },
  };
}

function makeClock(start = 1_700_000_000_000): () => number {
  let t = start;
  const tick = () => t;
  tick.advance = (ms: number) => { t += ms; return t; };
  // attach helpers on the function object for tests
  return Object.assign(tick, { advance: (ms: number) => { t += ms; return t; } });
}

function mkEvent(id: string, next: unknown, ts = 1): WidgetStateChangeEvent {
  return { instanceId: id, type: 'fake', prev: null, next, timestamp: ts };
}

function mkDeps(overrides: Partial<RecordingRuntimeDeps> = {}): RecordingRuntimeDeps & {
  host: ReturnType<typeof makeFakeHost>;
} {
  const host = overrides.widgetHost as ReturnType<typeof makeFakeHost> | undefined
    ?? makeFakeHost();
  return {
    widgetHost: host,
    baseDir: '/tmp/monad-test-timelines',
    fs: makeFakeFs(),
    now: () => 1_700_000_000_000,
    ...overrides,
    // Preserve host reference even when overrides had widgetHost undefined.
    host,
  } as RecordingRuntimeDeps & { host: ReturnType<typeof makeFakeHost> };
}

afterEach(() => {
  __resetRecordingRuntimesForTest();
  _resetToolRuntimeRegistryForTest();
});

// ── Tool spec shape ─────────────────────────────────────────────

describe('buildStartRecordingTool / buildStopRecordingTool', () => {
  test('StartRecording spec — name + object params', () => {
    const spec = buildStartRecordingTool();
    expect(spec.name).toBe('StartRecording');
    expect(spec.description.length).toBeGreaterThan(20);
    const p = spec.parameters as { type: string; properties: Record<string, unknown> };
    expect(p.type).toBe('object');
    expect(p.properties.widgetIds).toBeDefined();
    expect(p.properties.dims).toBeDefined();
    expect(p.properties.skipUnchanged).toBeDefined();
  });

  test('StopRecording spec — requires recorderId', () => {
    const spec = buildStopRecordingTool();
    expect(spec.name).toBe('StopRecording');
    const p = spec.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(p.required).toEqual(['recorderId']);
    expect(p.properties.persist).toBeDefined();
    expect(p.properties.format).toBeDefined();
  });
});

// ── Start: args + filter ─────────────────────────────────────────

describe('dispatchStartRecording', () => {
  test('returns recording shape with rec- prefix + epoch startedAt', () => {
    const deps = mkDeps();
    const out = dispatchStartRecording({}, deps);
    expect(out.status).toBe('recording');
    expect(out.recorderId).toMatch(/^rec-[0-9a-f]{8}$/);
    expect(out.startedAt).toBe(Math.floor(deps.now!() / 1000));
  });

  test('two starts produce distinct recorderIds', () => {
    const deps = mkDeps();
    const a = dispatchStartRecording({}, deps);
    const b = dispatchStartRecording({}, deps);
    expect(a.recorderId).not.toBe(b.recorderId);
  });

  test('widgetIds filter drops events for other ids', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording({ widgetIds: ['a'] }, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    deps.host.fire(mkEvent('b', { n: 2 }));
    deps.host.fire(mkEvent('a', { n: 3 }));
    const stop = dispatchStopRecording(
      { recorderId, persist: false, format: 'summary' },
      deps,
    );
    expect(stop.summary!.widgetIds).toEqual(['a']);
    expect(stop.summary!.tPerId).toEqual({ a: 2 });
  });

  test('no widgetIds → every event recorded', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    deps.host.fire(mkEvent('b', { n: 2 }));
    const stop = dispatchStopRecording(
      { recorderId, persist: false, format: 'summary' },
      deps,
    );
    expect(new Set(stop.summary!.widgetIds)).toEqual(new Set(['a', 'b']));
  });

  test('dims default 80×24 when omitted', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    const header = JSON.parse(stop.body!.split('\n')[0]!);
    expect(header.width).toBe(80);
    expect(header.height).toBe(24);
  });

  test('explicit dims land in the header', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording(
      { dims: { cols: 120, rows: 40 }, title: 'cpu watch' },
      deps,
    );
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    const header = JSON.parse(stop.body!.split('\n')[0]!);
    expect(header.width).toBe(120);
    expect(header.height).toBe(40);
    expect(header.title).toBe('cpu watch');
  });
});

// ── Stop: persist / summary / not-found ──────────────────────────

describe('dispatchStopRecording', () => {
  test('format=timeline + persist writes asciicast file + returns path', () => {
    const fs = makeFakeFs();
    const deps = mkDeps({ fs });
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId }, deps);
    expect(stop.status).toBe('stopped');
    expect(stop.path).toBeDefined();
    expect(stop.path).toContain(recorderId);
    expect(stop.path).toContain('.cast');
    expect(fs.files.size).toBe(1);
    const body = fs.files.get(stop.path!)!;
    expect(body.split('\n')[0]).toContain('"version":2.1');
    expect(fs.dirs.size).toBeGreaterThan(0);
  });

  test('format=timeline + persist=false returns body inline, no file write', () => {
    const fs = makeFakeFs();
    const deps = mkDeps({ fs });
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    expect(stop.path).toBeUndefined();
    expect(stop.body).toBeDefined();
    expect(stop.body!).toContain('"w"');
    expect(fs.files.size).toBe(0);
  });

  test('format=summary returns tPerId aggregate (no body, no path)', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    deps.host.fire(mkEvent('a', { n: 2 }));
    deps.host.fire(mkEvent('b', { n: 3 }));
    const stop = dispatchStopRecording({ recorderId, format: 'summary' }, deps);
    expect(stop.body).toBeUndefined();
    expect(stop.path).toBeUndefined();
    expect(stop.summary!.tPerId).toEqual({ a: 2, b: 1 });
    expect(new Set(stop.summary!.widgetIds)).toEqual(new Set(['a', 'b']));
  });

  test('unknown recorderId → structured note, no throw', () => {
    const deps = mkDeps();
    const stop = dispatchStopRecording({ recorderId: 'rec-ghost' }, deps);
    expect(stop.note).toMatch(/recorder not found: rec-ghost/);
    expect(stop.frameCount).toBe(0);
  });

  test('stop removes recorder from active map', () => {
    const deps = mkDeps();
    const { recorderId } = dispatchStartRecording({}, deps);
    expect(__activeRecorderCountForTest()).toBe(1);
    dispatchStopRecording({ recorderId, persist: false }, deps);
    expect(__activeRecorderCountForTest()).toBe(0);
  });
});

// ── Registration lifecycle ───────────────────────────────────────

describe('registerRecordingRuntimes', () => {
  test('registers both runtimes under catalog-free ids', () => {
    const deps = mkDeps();
    registerRecordingRuntimes(deps);
    expect(getToolRuntime('iul_start_recording')).toBeDefined();
    expect(getToolRuntime('iul_stop_recording')).toBeDefined();
  });

  test('double-register is idempotent (no throw)', () => {
    const deps = mkDeps();
    registerRecordingRuntimes(deps);
    expect(() => registerRecordingRuntimes(deps)).not.toThrow();
  });

  test('runtime.run wires through to live deps (updates on re-register)', async () => {
    const deps1 = mkDeps();
    registerRecordingRuntimes(deps1);
    const startRt = getToolRuntime('iul_start_recording')!;
    const result = await startRt.run({} as never, { surface: 'dashboard' } as never);
    const payload = JSON.parse((result as { output: string }).output);
    expect(payload.status).toBe('recording');
    expect(payload.recorderId).toMatch(/^rec-/);
  });

  test('reset clears active recorders + deps (fresh registration needed)', () => {
    const deps = mkDeps();
    registerRecordingRuntimes(deps);
    dispatchStartRecording({}, deps);
    expect(__activeRecorderCountForTest()).toBe(1);
    __resetRecordingRuntimesForTest();
    _resetToolRuntimeRegistryForTest();
    expect(__activeRecorderCountForTest()).toBe(0);
    // After reset the runtime entries are gone; a fresh registration
    // exercises the register path again without an id collision.
    registerRecordingRuntimes(deps);
    expect(getToolRuntime('iul_start_recording')).toBeDefined();
  });

  test('custom baseDir injected → path is under it', () => {
    const fs = makeFakeFs();
    const baseDir = '/tmp/test-recordings';
    const deps = mkDeps({ baseDir, fs });
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId }, deps);
    expect(stop.path!.startsWith(baseDir)).toBe(true);
  });
});

// ── Bundle B-3 (P6-2) · ArtifactStore migration ────────────────

describe('dispatchStopRecording · artifactStore path (Bundle B-3)', () => {
  function makeFakeStore(): {
    put: (...args: unknown[]) => { path: string; metaPath: string; meta: Record<string, unknown> };
    puts: Array<{ kind: string; body: unknown; meta: Record<string, unknown> }>;
  } {
    const puts: Array<{ kind: string; body: unknown; meta: Record<string, unknown> }> = [];
    return {
      puts,
      put(kind, body, meta) {
        const m = meta as Record<string, unknown>;
        puts.push({ kind: String(kind), body, meta: m });
        const path = `/fake/artifacts/${kind}/20260420-000000-${String(m.origin ?? 'x')}.cast`;
        return {
          path,
          metaPath: `${path}.meta.json`,
          meta: { ...m, kind, createdAt: 1_700_000_000_000 },
        };
      },
    };
  }

  test('artifactStore present → put("timeline") called · path from store', () => {
    const store = makeFakeStore();
    const host = makeFakeHost();
    const deps = {
      widgetHost: host,
      artifactStore: store as unknown as import('../src/artifact/index.js').ArtifactStore,
    };
    const { recorderId } = dispatchStartRecording({ widgetIds: ['a', 'b'] }, deps);
    host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId }, deps);
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]!.kind).toBe('timeline');
    expect(store.puts[0]!.meta.origin).toBe(recorderId);
    expect(store.puts[0]!.meta.producer).toBe('bundle-8t');
    expect(stop.path!.startsWith('/fake/artifacts/timeline/')).toBe(true);
  });

  test('artifactStore + persist=false → put NOT called (body inline)', () => {
    const store = makeFakeStore();
    const host = makeFakeHost();
    const deps = {
      widgetHost: host,
      artifactStore: store as unknown as import('../src/artifact/index.js').ArtifactStore,
    };
    const { recorderId } = dispatchStartRecording({}, deps);
    host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId, persist: false }, deps);
    expect(store.puts).toHaveLength(0);
    expect(stop.body).toBeDefined();
    expect(stop.path).toBeUndefined();
  });

  test('artifactStore absent → legacy baseDir/fs path (regression guard)', () => {
    const fs = makeFakeFs();
    const deps = mkDeps({ fs, baseDir: '/legacy' });
    const { recorderId } = dispatchStartRecording({}, deps);
    deps.host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId }, deps);
    expect(stop.path!.startsWith('/legacy')).toBe(true);
    expect(fs.files.size).toBe(1);
  });

  test('artifactStore + baseDir both → artifactStore wins (baseDir ignored)', () => {
    const store = makeFakeStore();
    const fs = makeFakeFs();
    const host = makeFakeHost();
    const deps = {
      widgetHost: host,
      baseDir: '/legacy',
      fs,
      artifactStore: store as unknown as import('../src/artifact/index.js').ArtifactStore,
    };
    const { recorderId } = dispatchStartRecording({}, deps);
    host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId }, deps);
    expect(store.puts).toHaveLength(1);
    expect(fs.files.size).toBe(0);
    expect(stop.path!.startsWith('/fake/artifacts/timeline/')).toBe(true);
  });

  test('artifactStore + format=summary → put NOT called', () => {
    const store = makeFakeStore();
    const host = makeFakeHost();
    const deps = {
      widgetHost: host,
      artifactStore: store as unknown as import('../src/artifact/index.js').ArtifactStore,
    };
    const { recorderId } = dispatchStartRecording({}, deps);
    host.fire(mkEvent('a', { n: 1 }));
    const stop = dispatchStopRecording({ recorderId, format: 'summary' }, deps);
    expect(store.puts).toHaveLength(0);
    expect(stop.summary).toBeDefined();
    expect(stop.path).toBeUndefined();
  });
});
