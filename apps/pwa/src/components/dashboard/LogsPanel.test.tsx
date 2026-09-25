// LogsPanel render contract + source-level wiring guards.
// Browser-only effects are intentionally pinned by source guards: these tests
// assert endpoint names and state-update paths, not browser runtime behavior.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { LogsPanel } from './LogsPanel';
import { DaemonContext } from '@/components/providers/DaemonProvider';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'LogsPanel.tsx'), 'utf8');

const STUB_DAEMON = {
  config: { baseUrl: '', token: '', provider: '' },
  setConfig: () => {},
  client: {} as never,
  sessionId: 'sess-test',
  setSessionId: () => {},
};

const STUB_ROUTER = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

describe('LogsPanel · render contract', () => {
  test('renders the initial empty log dashboard controls', () => {
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider value={STUB_ROUTER}>
        <DaemonContext.Provider value={STUB_DAEMON}>
          <LogsPanel />
        </DaemonContext.Provider>
      </AppRouterContext.Provider>,
    );

    expect(html).toContain('Logs');
    expect(html).toContain('전 서피스 실시간 (logs.db)');
    expect(html).toContain('쿼리 저장');
    expect(html).toContain('⏸ 일시정지');
    expect(html).toContain('최근 1시간 데이터 없음.');
    expect(html).toContain('level ≥');
    expect(html).toContain('debug');
    expect(html).toContain('info');
    expect(html).toContain('warn');
    expect(html).toContain('error');
    expect(html).toContain('event/data/category 부분 일치…');
    expect(html).toContain('일치하는 로그 없음.');
  });
});

describe('LogsPanel · source-level wiring guards', () => {
  test('pins the instance-list endpoint, 60-second refresh, and hidden initial selector', () => {
    expect(SRC).toContain("'/v1/logs/instances'");
    expect(SRC).toMatch(/setInterval\(\(\) => \{ void load\(\); \}, 60_000\)/);
    expect(SRC).toContain('if (alive) setInstances(r.instances ?? []);');
    expect(SRC).toContain('catch { /* 구버전 데몬 — 셀렉터만 숨김 */ }');
    expect(SRC).toContain('instances.length > 1 && (');
  });

  test('pins empty, single, and multi-store parameters into logs, facets, and histogram requests', () => {
    expect(SRC).toContain("const [storeNames, setStoreNames] = useState<string[]>([]);");
    expect(SRC).toContain("const storeParams = useMemo<Array<[string, string]>>(() => storeNames.map((store) => ['store', store]), [storeNames]);");
    expect(SRC).toContain("new URLSearchParams([...Object.entries(queryToParams(query)), ...storeParams, ['limit', '200'], ['since', '2h']])");
    expect(SRC).toContain('`/v1/logs?${qs}`');
    expect(SRC).toContain('const storeSuffix = useMemo(() => storeParams.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join(\'\'), [storeParams]);');
    expect(SRC).toContain('`/v1/logs/facets?since=6h${storeSuffix}`');
    expect(SRC).toContain('`/v1/logs/histogram?since=1h${sp}${storeSuffix}`');
  });

  test('pins saved-query restore, application, and persistence wiring', () => {
    expect(SRC).toContain("const SAVED_KEY = 'monad.pwa.logs.savedQueries';");
    expect(SRC).toContain('useEffect(() => { setSaved(loadSaved()); }, []);');
    expect(SRC).toContain('window.localStorage.getItem(SAVED_KEY)');
    expect(SRC).toContain('const s = saved.find((x) => x.name === e.target.value);');
    expect(SRC).toContain('if (s) setQuery(s.q);');
    expect(SRC).toContain('setSaved(next);');
    expect(SRC).toContain('window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));');
  });

  test('pins multi-store saved-query compatibility separately from preserved query wiring', () => {
    expect(SRC).toContain("const rawStores: unknown[] = Array.isArray(item.stores)");
    expect(SRC).toContain('typeof item.store === \'string\' && item.store ? [item.store] : []');
    expect(SRC).toContain('if (s) setStoreNames(s.stores);');
    expect(SRC).toContain('{ name, q: query, stores: storeNames }');
  });

  test('pins multi-instance selector, source labels, stable keys, and single-store SSE policy', () => {
    expect(SRC).toContain('multiple');
    expect(SRC).toContain('Array.from(e.target.selectedOptions, (option) => option.value).filter(Boolean)');
    expect(SRC).toContain('{log.instance && <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary">{log.instance}</span>}');
    expect(SRC).toContain("key={`${l.instance ?? 'unknown'}:${l.id}`}");
    expect(SRC).toContain('if (storeNames.length === 1) p.store = storeNames[0];');
    expect(SRC).toContain("if (typeof window === 'undefined' || storeNames.length > 1) return;");
    expect(SRC).toContain('client.logsStreamUrl({ ...queryToParams(query), ...streamStoreParam })');
  });

  test('pins histogram and dynamic facet-chip creation into the rendered filter tree', () => {
    expect(SRC).toContain('aria-label="분당 로그 히스토그램"');
    expect(SRC).toContain('(facets?.surfaces ?? []).map((s) => (');
    expect(SRC).toContain("<Chip key={s.surface} active={query.surfaces.includes(s.surface)} label={s.surface} count={s.count} onClick={() => toggle('surfaces', s.surface)} />");
    expect(SRC).toContain('(facets?.components ?? []).slice(0, 16).map((c) => (');
    expect(SRC).toContain("<Chip key={c.component} active={query.components.includes(c.component)} label={c.component} count={c.count} onClick={() => toggle('components', c.component)} />");
  });

  test('pins functional paused buffering and functional resume merge at BUFFER_CAP', () => {
    expect(SRC).toContain('const BUFFER_CAP = 500;');
    expect(SRC).toContain('if (pausedRef.current) {');
    expect(SRC).toContain('setQueued((prev) => [...prev, rec].slice(-BUFFER_CAP));');
    expect(SRC).toMatch(/setQueued\(\(q\) => \{\s*if \(q\.length\) setLogs\(\(prev\) => \[\.\.\.prev, \.\.\.q\]\.slice\(-BUFFER_CAP\)\);\s*return \[\];\s*\}\)/);
  });
});
