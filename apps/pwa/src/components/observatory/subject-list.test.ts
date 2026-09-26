import { describe, expect, mock, test } from 'bun:test';
import { createRequire } from 'node:module';

import { createReactHookHarness } from '@/lib/testing/react-hook-harness';

import {
  canonicalPtyItems,
  classifySubject,
  openObservatoryTerminal,
  requestTerminalTakeover,
  subjectProgressBySubject,
  subjectSurfaces,
  terminalControlUrl,
  terminalFrameUrl,
  terminalListRequest,
  terminalsQueryUrl,
  TERMINAL_TAKEOVER_MESSAGES,
  terminalsViewUrl,
  visibleSubjects,
  type ObservatorySubject,
  type TerminalTakeoverFailureKind,
} from './subject-list';

type FetchMock = ReturnType<typeof mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchMock {
  return mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return impl(url, init);
  });
}

function asFetch(fetchMock: FetchMock): typeof fetch {
  return fetchMock as unknown as typeof fetch;
}

function subject(overrides: Partial<ObservatorySubject> = {}): ObservatorySubject {
  return {
    id: 'subject:run-1',
    runId: 'run-1',
    origin: 'system',
    screen: { ptyIds: [], liveCount: 0 },
    agent: { names: [], controllers: [] },
    talk: [],
    ...overrides,
  };
}

type ElementNode = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

/** 모듈을 «새로 평가»시키려고 질의 문자열을 붙여 들여온다(Bun 의 모듈 캐시 우회).
 *  ⛔ 리터럴 `import('./SubjectList?tag')` 는 TS 가 «실재하지 않는 모듈»로 읽어 TS2307 을 낸다
 *     (실측 2026-09-17: 이 파일에서 16건). 그리고 그 오류가 저장소 전체 검사에 섞여,
 *     ***이 축과 무관한 PR 의 착지까지 막았다***(내보낸 함수의 인자를 늘리면 전체 검사로 승격된다).
 *  ✅ 치환이 «하나라도» 있으면 TS 는 그 지정자를 정적으로 풀지 않는다 — 그래서 오류가 사라진다.
 *     타입은 캐스트로 «되돌려» 준다: 들여온 모양은 `./SubjectList` 와 «같다». */
async function importSubjectListFresh(tag: string): Promise<typeof import('./SubjectList')> {
  return (await import(`./SubjectList?${tag}`)) as typeof import('./SubjectList');
}

/** 같은 이유로 `observatory/page` 도 «새로 평가»시켜 들여온다. 위 `importSubjectListFresh` 와 같은 처방. */
async function importObservatoryPageFresh(tag: string): Promise<typeof import('../../app/observatory/page')> {
  return (await import(`../../app/observatory/page?${tag}`)) as typeof import('../../app/observatory/page');
}

function descendants(node: unknown): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  const element = node as ElementNode;
  return [element, ...descendants(element.props?.children)];
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!node || typeof node !== 'object') return '';
  return textContent((node as ElementNode).props?.children);
}

const require = createRequire(import.meta.url);
const react = require('react') as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: unknown };
};
function createReactHarness() {
  const harness = createReactHookHarness(react);
  let tree: unknown;
  const evaluateComponents = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(evaluateComponents);
    if (!node || typeof node !== 'object') return node;
    const element = node as ElementNode;
    if (typeof element.type === 'function') return evaluateComponents(element.type(element.props ?? {}));
    if (!element.props) return element;
    return react.createElement(element.type, {
      ...element.props,
      children: evaluateComponents(element.props.children),
    });
  };
  return {
    render<T>(component: () => T): T {
      harness.render((() => evaluateComponents(component())) as (props: never) => unknown);
      tree = harness.findAll(() => true)[0] ?? null;
      return tree as T;
    },
    flushEffects() {},
  };
}

describe('observatory subject visibility', () => {
  test('keeps a subject with a live screen in the default window', () => {
    const live = subject({ screen: { ptyIds: ['pty-1'], liveCount: 1 } });
    expect(classifySubject(live)).toBe('live');
    expect(visibleSubjects([live])).toEqual([live]);
  });

  test('keeps an agent-only subject as unknown in the default window', () => {
    const unknown = subject({ agent: { names: ['codex'], controllers: [] } });
    expect(classifySubject(unknown)).toBe('unknown');
    expect(visibleSubjects([unknown])).toEqual([unknown]);
  });

  test('hides inactive screens by default and restores them in the all toggle', () => {
    const inactive = subject({ screen: { ptyIds: ['pty-2'], liveCount: 0 } });
    expect(classifySubject(inactive)).toBe('inactive');
    expect(visibleSubjects([inactive])).toEqual([]);
    expect(visibleSubjects([inactive], true)).toEqual([inactive]);
  });

  test('reflects each talk, screen, and agent surface independently', () => {
    expect(subjectSurfaces(subject())).toEqual({ talk: false, screen: false, agent: false });
    expect(subjectSurfaces(subject({
      talk: [{ id: 'talk-1' }],
      screen: { ptyIds: ['pty-3'], liveCount: 0 },
      agent: { names: [], controllers: ['controller-1'] },
    }))).toEqual({ talk: true, screen: true, agent: true });
  });
});

describe('observatory subject progress', () => {
  test('joins only progress-bearing PTYs and distinguishes no screen from no progress', () => {
    const withProgress = subject({ id: 'two-screens', screen: { ptyIds: ['pty-b', 'pty-a'], liveCount: 2 } });
    const noProgress = subject({ id: 'one-screen', screen: { ptyIds: ['pty-c'], liveCount: 1 } });
    const noScreen = subject({ id: 'no-screen', screen: { ptyIds: [], liveCount: 0 } });
    const summaries = new Map([
      ['pty-a', { line: '◐ implement', status: 'running' as const, hasMissingFrames: false }],
    ]);

    const progress = subjectProgressBySubject([withProgress, noProgress, noScreen], summaries);
    expect(progress.get('two-screens')).toEqual({ kind: 'progress', ptyId: 'pty-a', line: '◐ implement', status: 'running', hasMissingFrames: false });
    expect(progress.get('one-screen')).toEqual({ kind: 'no-progress' });
    expect(progress.get('no-screen')).toEqual({ kind: 'no-screen' });
  });

  test('chooses the alphabetically first unique PTY with progress deterministically', () => {
    const twoScreens = subject({ id: 'two-screens', screen: { ptyIds: ['pty-b', 'pty-a', 'pty-a'], liveCount: 2 } });
    const summaries = new Map([
      ['pty-a', { line: '● first', status: 'complete' as const, hasMissingFrames: true }],
      ['pty-b', { line: '◐ second', status: 'running' as const, hasMissingFrames: false }],
    ]);

    expect(subjectProgressBySubject([twoScreens], summaries).get('two-screens')).toEqual({ kind: 'progress', ptyId: 'pty-a', line: '● first', status: 'complete', hasMissingFrames: true });
    expect(subjectProgressBySubject([twoScreens], summaries).get('two-screens')).toEqual({ kind: 'progress', ptyId: 'pty-a', line: '● first', status: 'complete', hasMissingFrames: true });
  });

  test('returns no-progress for every screen-bearing subject when summaries are empty', () => {
    const withScreen = subject({ id: 'with-screen', screen: { ptyIds: ['pty-a'], liveCount: 1 } });
    const noScreen = subject({ id: 'no-screen', screen: { ptyIds: [], liveCount: 0 } });

    expect(subjectProgressBySubject([withScreen, noScreen], new Map())).toEqual(new Map([
      ['with-screen', { kind: 'no-progress' }],
      ['no-screen', { kind: 'no-screen' }],
    ]));
  });
});

describe('canonical PTY-list projection', () => {
  test('preserves first-seen order and legacy rows while removing explicit non-PTY and duplicate ids', () => {
    const input = [
      { id: 'pty-b', hasPty: true, source: 'terminal' },
      { id: 'agent-only', hasPty: false, source: 'agent' },
      { id: 'pty-a', source: 'legacy' },
      { id: 'pty-b', hasPty: true, source: 'duplicate' },
    ];

    expect(canonicalPtyItems(input)).toEqual([
      { id: 'pty-b', value: input[0] },
      { id: 'pty-a', value: input[2] },
    ]);
    expect(canonicalPtyItems([])).toEqual([]);
  });
});

describe('observatory terminal creation', () => {
  test('adds the next canonical web-terminal ID while preserving existing tabs', () => {
    const originalWindow = globalThis.window;
    const storage = new Map<string, string>([['elanous.webterm.tabs', JSON.stringify(['preview-1'])]]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    });

    expect(openObservatoryTerminal()).toBe('preview-2');
    expect(JSON.parse(storage.get('elanous.webterm.tabs') ?? '[]')).toEqual(['preview-1', 'preview-2']);
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  });

  test('does not throw when browser storage is unavailable', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => null, setItem: () => { throw new Error('unavailable'); } } },
    });

    expect(openObservatoryTerminal()).toBeNull();
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  });
});

describe('observatory terminal URLs', () => {
  test('encodes PTY IDs for the rendered frame endpoint and retains the dedicated inspector URL', () => {
    expect(terminalFrameUrl('pty/a b?')).toBe('/v1/terminals/pty%2Fa%20b%3F/frame');
    expect(terminalControlUrl('pty/a b?')).toBe('/v1/terminals/pty%2Fa%20b%3F/control');
    expect(terminalsViewUrl()).toBe('/v1/terminals/view');
  });

  test('serializes the full shared all/includeTest request contract', () => {
    for (const includeAll of [false, true]) {
      const request = terminalListRequest(includeAll);
      const query = new URL(`http://localhost${terminalsQueryUrl(includeAll)}`).searchParams;
      expect(Object.fromEntries(query.entries())).toEqual(
        Object.fromEntries(Object.entries(request).map(([key, value]) => [key, String(value)])),
      );
    }
    expect(terminalsQueryUrl()).toBe('/v1/terminals');
    expect(terminalsQueryUrl(false)).toBe('/v1/terminals');
    expect(terminalsQueryUrl(true)).toBe('/v1/terminals?all=true&includeTest=true');
  });
});

describe('observatory terminal takeover helper', () => {
  test('posts takeover JSON to the encoded control endpoint and returns success on 200', async () => {
    const fetchImpl = mockFetch(async (url, init) => {
      expect(url).toBe('/v1/terminals/pty%2Fa%20b%3F/control');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify({ action: 'takeover' }));
      return jsonResponse({ id: 'pty/a b?', action: 'takeover', status: 'success' }, 200);
    });
    await expect(requestTerminalTakeover('pty/a b?', fetchImpl)).resolves.toEqual({ ok: true, ptyId: 'pty/a b?' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('forwards an abort signal to fetch when provided', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      return jsonResponse({ id: 'pty-x', action: 'takeover', status: 'success' }, 200);
    });
    await expect(requestTerminalTakeover('pty-x', fetchImpl, { signal: controller.signal })).resolves.toEqual({
      ok: true,
      ptyId: 'pty-x',
    });
  });

  test('returns caller-visible errors for 404, 409, 502, 504, and other HTTP statuses', async () => {
    const cases: ReadonlyArray<{ status: number; kind: TerminalTakeoverFailureKind; message: string }> = [
      { status: 404, kind: 'unknown', message: TERMINAL_TAKEOVER_MESSAGES.unknown },
      { status: 409, kind: 'denied', message: TERMINAL_TAKEOVER_MESSAGES.denied },
      { status: 504, kind: 'owner-unreachable', message: TERMINAL_TAKEOVER_MESSAGES['owner-unreachable'] },
      { status: 502, kind: 'failed', message: TERMINAL_TAKEOVER_MESSAGES.failed },
      { status: 503, kind: 'http', message: 'Takeover failed (503). Check status and try again.' },
    ];
    for (const { status, kind, message } of cases) {
      const result = await requestTerminalTakeover('pty-x', mockFetch(async () => new Response('no', { status })));
      expect(result).toEqual({ ok: false, ptyId: 'pty-x', kind, status, message });
    }
  });

  test('returns a network failure when fetch throws', async () => {
    const result = await requestTerminalTakeover('pty-x', mockFetch(async () => { throw new Error('offline'); }));
    expect(result).toEqual({
      ok: false,
      ptyId: 'pty-x',
      kind: 'network',
      message: TERMINAL_TAKEOVER_MESSAGES.network,
    });
  });
});

describe('observatory PWA behavior', () => {
  test('SubjectList defaults to live and unknown, then shows inactive subjects after its toggle changes', async () => {
    const react = createReactHarness();
    const { SubjectList } = await import('./SubjectList');
    const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-live'], liveCount: 1 } });
    const unknown = subject({ runId: 'unknown-run', agent: { names: ['codex'], controllers: [] } });
    const inactive = subject({ runId: 'inactive-run', screen: { ptyIds: ['pty-old'], liveCount: 0 } });

    const render = () => react.render(() => SubjectList({ subjects: [live, unknown, inactive] }));
    const defaultTree = render();
    expect(textContent(defaultTree)).toContain('live-run');
    expect(textContent(defaultTree)).toContain('unknown-run');
    expect(textContent(defaultTree)).not.toContain('inactive-run');
    expect(textContent(defaultTree)).toContain('🗣️ talk: absent');
    expect(textContent(defaultTree)).toContain('🖥️ screen: present');
    expect(textContent(defaultTree)).toContain('🤖 agent: present');
    expect(textContent(defaultTree)).toContain('screen: 1 PTY · 1 live');

    const checkbox = descendants(defaultTree).find((node) => node.props?.type === 'checkbox' && node.props?.['aria-label'] !== 'Include isolated instances');
    expect(checkbox?.props?.checked).toBe(false);
    (checkbox?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const allTree = render();
    expect(textContent(allTree)).toContain('inactive-run');
  });

  test('SubjectList displays the selected isolated-instance mode and optional server scope without changing server counts', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('observatory-scope');
    const onIncludeIsolatedInstancesChange = mock(() => {});
    const tree = react.render(() => SubjectList({
      subjects: [subject({ runId: 'isolated-running', run: { status: 'running', reason: 'federated-ledger', presence: 'ledger-live' } })],
      runningRuns: { running: 11, 'probable-running': 2, countedStatuses: ['running', 'probable-running'] },
      includeIsolatedInstances: true,
      onIncludeIsolatedInstancesChange,
      scope: { domain: 'terminal-registry', roots: 3, federated: true, hiddenDead: 4, hiddenSubAgentRuns: 5 },
    }));
    expect(textContent(tree)).toContain('Include isolated instances: included');
    expect(textContent(tree)).toContain('Observation scope: terminal-registry; 3 roots; federated; 4 dead hidden; 5 sub-agent runs hidden');
    expect(textContent(tree)).toContain('Server run count: 11 running, 2 probable-running');
    const scopeToggle = descendants(tree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    (scopeToggle?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    expect(onIncludeIsolatedInstancesChange).toHaveBeenCalledWith(false);

    const missingScopeTree = react.render(() => SubjectList({ subjects: [], includeIsolatedInstances: false }));
    expect(textContent(missingScopeTree)).toContain('Include isolated instances: local only');
    expect(descendants(missingScopeTree).some((node) => node.props?.['data-testid'] === 'observatory-scope')).toBe(false);
  });

  test('SubjectList lazily fetches a selected frame, supports PTY selection, and links to the terminal inspector', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame');
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetch(async (url) => jsonResponse({ frame: `frame for ${url}` }));
    globalThis.fetch = asFetch(fetchMock);
    const withScreens = subject({ screen: { ptyIds: ['pty/one', 'pty-two'], liveCount: 2 } });
    const render = () => react.render(() => SubjectList({ subjects: [withScreens] }));

    const foldedTree = render();
    expect(fetchMock).not.toHaveBeenCalled();
    const inspector = descendants(foldedTree).find((node) => node.props?.href === '/v1/terminals/view');
    expect(inspector).toBeDefined();
    const expand = descendants(foldedTree).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    const loadingTree = render();
    expect(textContent(loadingTree)).toContain('Loading terminal frame…');
    react.flushEffects();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals/pty%2Fone/frame', expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textContent(render())).toContain('frame for /v1/terminals/pty%2Fone/frame');

    const select = descendants(render()).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    (select?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'pty-two' } });
    const switchedTree = render();
    expect(textContent(switchedTree)).toContain('Loading terminal frame…');
    expect(textContent(switchedTree)).not.toContain('frame for /v1/terminals/pty%2Fone/frame');
    react.flushEffects();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals/pty-two/frame', expect.anything());

    const collapse = descendants(render()).find((node) => node.props?.['aria-expanded'] === true);
    (collapse?.props?.onClick as () => void)();
    const collapsedTree = render();
    expect(descendants(collapsedTree).some((node) => node.props?.['data-testid'] === 'terminal-frame-panel')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    globalThis.fetch = originalFetch;
  });

  test('SubjectList ignores a stale frame response after selecting another PTY', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame-race');
    const originalFetch = globalThis.fetch;
    let resolveFirst: ((response: Response) => void) | undefined;
    globalThis.fetch = asFetch(mockFetch((url) => url.endsWith('pty-first/frame')
      ? new Promise<Response>((resolve) => { resolveFirst = resolve; })
      : jsonResponse({ frame: 'second frame' })));
    const screens = subject({ screen: { ptyIds: ['pty-first', 'pty-second'], liveCount: 2 } });
    const render = () => react.render(() => SubjectList({ subjects: [screens] }));
    const foldedTree = render();
    const expand = descendants(foldedTree).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    const expandedTree = render();
    react.flushEffects();
    const select = descendants(expandedTree).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    (select?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'pty-second' } });
    const switchedTree = render();
    expect(textContent(switchedTree)).toContain('Loading terminal frame…');
    expect(textContent(switchedTree)).not.toContain('stale first frame');
    react.flushEffects();
    resolveFirst?.(new Response(JSON.stringify({ frame: 'stale first frame' }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const finalTree = render();
    expect(textContent(finalTree)).toContain('second frame');
    expect(textContent(finalTree)).not.toContain('stale first frame');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList does not render a selector for one PTY and names HTTP frame failures', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame-http-failure');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = asFetch(mockFetch(async () => new Response('unavailable', { status: 503 })));
    const onlyPty = subject({ runId: 'single-pty-subject', screen: { ptyIds: ['pty-only'], liveCount: 1 } });
    const render = () => react.render(() => SubjectList({ subjects: [onlyPty] }));
    const foldedTree = render();
    const expand = descendants(foldedTree).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    const expandedTree = render();
    expect(descendants(expandedTree).some((node) => node.props?.['aria-label'] === 'Select terminal PTY')).toBe(false);
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failedTree = render();
    expect(textContent(failedTree)).toContain('GET /v1/terminals/pty-only/frame failed (503)');
    expect(textContent(failedTree)).toContain('single-pty-subject');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList replaces a removed selected PTY with the first current PTY', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame-prop-update');
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetch(async (url) => jsonResponse({ frame: `frame for ${url}` }));
    globalThis.fetch = asFetch(fetchMock);
    const initial = subject({ screen: { ptyIds: ['pty-first', 'pty-removed'], liveCount: 2 } });
    const updated = subject({ screen: { ptyIds: ['pty-replacement'], liveCount: 1 } });
    let current = initial;
    const render = () => react.render(() => SubjectList({ subjects: [current] }));

    const foldedTree = render();
    const expand = descendants(foldedTree).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    let expandedTree = render();
    const select = descendants(expandedTree).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    (select?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'pty-removed' } });
    expandedTree = render();
    react.flushEffects();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals/pty-removed/frame', expect.anything());

    current = updated;
    expandedTree = render();
    expect(descendants(expandedTree).some((node) => node.props?.['aria-label'] === 'Select terminal PTY')).toBe(false);
    react.flushEffects();
    expandedTree = render();
    react.flushEffects();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals/pty-replacement/frame', expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textContent(render())).toContain('frame for /v1/terminals/pty-replacement/frame');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList distinguishes frame failures from an empty frame without removing its subject row', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame-errors');
    const originalFetch = globalThis.fetch;
    const rendered = subject({ runId: 'frame-subject', screen: { ptyIds: ['pty-empty'], liveCount: 1 } });
    globalThis.fetch = asFetch(mockFetch(async () => jsonResponse({ frame: '' })));
    const renderEmpty = () => react.render(() => SubjectList({ subjects: [rendered] }));
    const emptyFolded = renderEmpty();
    const emptyExpand = descendants(emptyFolded).find((node) => node.props?.['aria-expanded'] === false);
    (emptyExpand?.props?.onClick as () => void)();
    renderEmpty();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textContent(renderEmpty())).toContain('(Terminal frame is empty.)');

    const failureReact = createReactHarness();
    const { SubjectList: FailureList } = await importSubjectListFresh('terminal-frame-failure');
    globalThis.fetch = asFetch(mockFetch(async () => { throw new Error('offline'); }));
    const renderFailure = () => failureReact.render(() => FailureList({ subjects: [rendered] }));
    const failureFolded = renderFailure();
    const failureExpand = descendants(failureFolded).find((node) => node.props?.['aria-expanded'] === false);
    (failureExpand?.props?.onClick as () => void)();
    renderFailure();
    failureReact.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failureTree = renderFailure();
    expect(textContent(failureTree)).toContain('Unable to load terminal frame: offline');
    expect(textContent(failureTree)).toContain('frame-subject');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList renders server run assessments without inferring from PTY presence and preserves older responses', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('run-assessments');
    const running = subject({
      id: 'running', runId: 'running', screen: { ptyIds: ['pty-running'], liveCount: 1 },
      run: { status: 'running', reason: 'ledger-live-and-pty-alive', presence: 'ledger-live-and-pty-observed' },
    });
    const probable = subject({
      id: 'probable', runId: 'probable', agent: { names: ['agent-probable'], controllers: [] },
      run: { status: 'probable-running', reason: 'unfinished-ledger-without-pty', presence: 'ledger-live-without-pty-observed' },
    });
    const ended = subject({
      id: 'ended', runId: 'ended', agent: { names: ['agent-ended'], controllers: [] },
      run: { status: 'ended-unclosed', reason: 'ledger-ended-without-close', presence: 'ledger-ended' },
    });
    const ptyOnlyUnknown = subject({
      id: 'pty-only-unknown', runId: 'pty-only-unknown', screen: { ptyIds: ['pty-stale'], liveCount: 1 },
      run: { status: 'unknown', reason: 'run-assessment-not-found', presence: 'pty-without-ledger-observed' },
    });
    const legacy = subject({
      id: 'legacy',
      runId: 'legacy',
      screen: { ptyIds: ['pty-legacy'], liveCount: 1 },
    });
    const tree = react.render(() => SubjectList({
      subjects: [running, probable, ended, ptyOnlyUnknown, legacy],
      runningRuns: { running: 7, 'probable-running': 3, countedStatuses: ['running', 'probable-running'] },
    }));
    const text = textContent(tree);

    expect(text).toContain('Server run count: 7 running, 3 probable-running (counted statuses: running, probable-running)');
    expect(text).toContain('run: running — reason: ledger-live-and-pty-alive (presence: ledger-live-and-pty-observed)');
    expect(text).toContain('run: probably running — reason: unfinished-ledger-without-pty (presence: ledger-live-without-pty-observed)');
    expect(text).toContain('run: ended, not closed — reason: ledger-ended-without-close (presence: ledger-ended)');
    expect(text).toContain('run: run state unknown — reason: run-assessment-not-found (presence: pty-without-ledger-observed)');
    expect(text).not.toContain('run: running — reason: run-assessment-not-found');
    expect(descendants(tree).filter((node) => node.props?.['data-testid'] === 'subject-run-assessment')).toHaveLength(4);
    expect(descendants(tree).find((node) => node.props?.['data-run-status'] === 'running')).toBeDefined();
    expect(descendants(tree).find((node) => node.props?.['data-run-status'] === 'unknown')).toBeDefined();

    const legacyTree = react.render(() => SubjectList({ subjects: [legacy] }));
    expect(textContent(legacyTree)).toContain('legacy');
    expect(textContent(legacyTree)).not.toContain('Server run count:');
    expect(descendants(legacyTree).some((node) => node.props?.['data-testid'] === 'subject-run-assessment')).toBe(false);
  });

  test('ObservatoryPage renders loading, subjects-only success, empty, and failure fetch states', async () => {
    const react = createReactHarness();
    const { default: ObservatoryPage } = await import('../../app/observatory/page');
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const storage = new Map<string, string>([['elanous.webterm.tabs', JSON.stringify(['preview-1'])]]);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    });

    globalThis.fetch = asFetch(mockFetch(async (url) => url === '/v1/terminals'
      ? jsonResponse({
        subjects: [subject({
          runId: 'fetched-run', screen: { ptyIds: ['pty-fetched'], liveCount: 1 },
          run: { status: 'running', reason: 'ledger-live-and-pty-alive', presence: 'ledger-live-and-pty-observed' },
        })],
        runningRuns: { running: 7, 'probable-running': 3, countedStatuses: ['running', 'probable-running'] },
      })
      : new Response(JSON.stringify({ ok: true, logs: [{ id: 1, ts: '2026-08-14T00:00:00.000Z', event: 'headless.progress-frame', data: { ptyId: 'pty-fetched', runId: 'run-1', planId: 'plan-1', seq: 1, humanLine: '◐ fetch progress' } }], count: 1, ts: '2026-08-14T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const loadingTree = react.render(ObservatoryPage);
    expect(textContent(loadingTree)).toContain('Loading observation subjects…');
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const successTree = react.render(ObservatoryPage);
    expect(globalThis.fetch).toHaveBeenCalledWith('/v1/terminals');
    expect(textContent(successTree)).toContain('fetched-run');
    expect(textContent(successTree)).toContain('progress (pty-fetched): running — ◐ fetch progress');
    expect(textContent(successTree)).toContain('Server run count: 7 running, 3 probable-running (counted statuses: running, probable-running)');
    expect(textContent(successTree)).toContain('run: running — reason: ledger-live-and-pty-alive (presence: ledger-live-and-pty-observed)');
    const openTerminal = descendants(successTree).find((node) => textContent(node) === 'Open new terminal');
    // ⛔ `ElementNode.props` 는 `Record<string, unknown>` 이라 «부를 수 있는지»를 TS 가 모른다.
    //   그 자리에서만 좁힌다 — 위 `toBeFunction()` 이 그 가정을 «실행 시점»에 지킨다.
    const onClick = openTerminal?.props?.onClick;
    expect(onClick).toBeFunction();
    (onClick as () => void)();
    expect(JSON.parse(storage.get('elanous.webterm.tabs') ?? '[]')).toEqual(['preview-1', 'preview-2']);

    globalThis.fetch = asFetch(mockFetch(async (url) => url === '/v1/terminals'
      ? jsonResponse({ subjects: [] })
      : new Response('progress unavailable', { status: 503 })));
    const emptyReact = createReactHarness();
    const { default: EmptyPage } = await importObservatoryPageFresh('empty');
    emptyReact.render(EmptyPage);
    emptyReact.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textContent(emptyReact.render(EmptyPage))).toContain('No observation subjects reported.');

    globalThis.fetch = asFetch(mockFetch(async () => new Response('unavailable', { status: 503 })));
    const failureReact = createReactHarness();
    const { default: FailurePage } = await importObservatoryPageFresh('failure');
    failureReact.render(FailurePage);
    failureReact.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failureTree = failureReact.render(FailurePage);
    expect(textContent(failureTree)).toContain('GET /v1/terminals failed (503)');
    expect(descendants(failureTree).some((node) => node.props?.role === 'alert')).toBe(true);
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  });

  test('ObservatoryPage keeps its isolated-instance toggle available after an isolated query fails and uses it to recover the local query', async () => {
    const react = createReactHarness();
    const { default: ObservatoryPage } = await importObservatoryPageFresh('isolated-query-failure');
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetch(async (url) => {
      if (url === '/v1/terminals') return jsonResponse({ subjects: [subject({ runId: 'local-run', agent: { names: ['local-agent'], controllers: [] } })] });
      if (url === '/v1/terminals?all=true&includeTest=true') return new Response('unavailable', { status: 503 });
      return jsonResponse({ logs: [] });
    });
    globalThis.fetch = asFetch(fetchMock);
    const render = () => react.render(ObservatoryPage);

    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const localTree = render();
    const enableScope = descendants(localTree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    (enableScope?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failureTree = render();
    const alert = descendants(failureTree).find((node) => node.props?.role === 'alert');
    const disableScope = descendants(failureTree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    expect(textContent(alert)).toContain('GET /v1/terminals?all=true&includeTest=true failed (503)');
    expect(disableScope?.props?.checked).toBe(true);

    (disableScope?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recoveredTree = render();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals');
    expect(textContent(recoveredTree)).toContain('local-run');
    globalThis.fetch = originalFetch;
  });

  test('ObservatoryPage refetches with the federated isolated-instance query after its scope toggle changes', async () => {
    const react = createReactHarness();
    const { default: ObservatoryPage } = await importObservatoryPageFresh('isolated-scope');
    const originalFetch = globalThis.fetch;
    const fetchMock = mockFetch(async (url) => {
      if (url === '/v1/terminals') return jsonResponse({
        subjects: [subject({ runId: 'local-run', agent: { names: ['local-agent'], controllers: [] } })],
        runningRuns: { running: 0, 'probable-running': 0, countedStatuses: ['running', 'probable-running'] },
        scope: { domain: 'terminal-registry', roots: 1, federated: false, hiddenDead: 0 },
      });
      if (url === '/v1/terminals?all=true&includeTest=true') return jsonResponse({
        subjects: [subject({
          runId: 'isolated-run',
          agent: { names: ['isolated-agent'], controllers: [] },
          run: { status: 'running', reason: 'federated-ledger', presence: 'ledger-live' },
        })],
        runningRuns: { running: 1, 'probable-running': 0, countedStatuses: ['running', 'probable-running'] },
        scope: { domain: 'terminal-registry', roots: 2, federated: true, hiddenDead: 1 },
      });
      return jsonResponse({ logs: [] });
    });
    globalThis.fetch = asFetch(fetchMock);
    const render = () => react.render(ObservatoryPage);
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const localTree = render();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals');
    expect(textContent(localTree)).toContain('Include isolated instances: local only');
    const scopeToggle = descendants(localTree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    (scopeToggle?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const isolatedTree = render();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals?all=true&includeTest=true');
    expect(textContent(isolatedTree)).toContain('isolated-run');
    expect(textContent(isolatedTree)).toContain('run: running — reason: federated-ledger (presence: ledger-live)');
    expect(textContent(isolatedTree)).toContain('Server run count: 1 running, 0 probable-running');
    expect(textContent(isolatedTree)).toContain('Observation scope: terminal-registry; 2 roots; federated; 1 dead hidden');
    globalThis.fetch = originalFetch;
  });

  test('ObservatoryPage keeps the latest selected scope when a slower isolated response finishes late', async () => {
    const react = createReactHarness();
    const { default: ObservatoryPage } = await importObservatoryPageFresh('isolated-scope-race');
    const originalFetch = globalThis.fetch;
    let resolveIsolated: ((response: Response) => void) | undefined;
    const fetchMock = mockFetch((url) => {
      if (url === '/v1/terminals') return jsonResponse({
        subjects: [subject({ runId: 'local-run', agent: { names: ['local-agent'], controllers: [] } })],
        runningRuns: { running: 0, 'probable-running': 0, countedStatuses: ['running', 'probable-running'] },
        scope: { domain: 'terminal-registry', roots: 1, federated: false, hiddenDead: 0 },
      });
      if (url === '/v1/terminals?all=true&includeTest=true') {
        return new Promise<Response>((resolve) => { resolveIsolated = resolve; });
      }
      return jsonResponse({ logs: [] });
    });
    globalThis.fetch = asFetch(fetchMock);
    const render = () => react.render(ObservatoryPage);
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const localTree = render();
    const enableScope = descendants(localTree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    (enableScope?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    render();
    react.flushEffects();
    const isolatedTree = render();
    const disableScope = descendants(isolatedTree).find((node) => node.props?.['aria-label'] === 'Include isolated instances');
    (disableScope?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveIsolated?.(jsonResponse({
      subjects: [subject({ runId: 'stale-isolated-run', agent: { names: ['isolated-agent'], controllers: [] } })],
      runningRuns: { running: 1, 'probable-running': 0, countedStatuses: ['running', 'probable-running'] },
      scope: { domain: 'terminal-registry', roots: 2, federated: true, hiddenDead: 0 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const finalTree = render();
    expect(fetchMock).toHaveBeenCalledWith('/v1/terminals?all=true&includeTest=true');
    expect(textContent(finalTree)).toContain('local-run');
    expect(textContent(finalTree)).not.toContain('stale-isolated-run');
    expect(textContent(finalTree)).toContain('Include isolated instances: local only');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList shows takeover only for a selected PTY screen, not for agent-only subjects', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = asFetch(mockFetch(async () => jsonResponse({ frame: 'live frame' })));
    const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-live'], liveCount: 1 } });
    const unknown = subject({ runId: 'unknown-run', agent: { names: ['codex'], controllers: [] } });
    const render = () => react.render(() => SubjectList({ subjects: [live, unknown] }));
    const folded = render();
    expect(textContent(folded)).toContain('unknown-run');
    expect(descendants(folded).some((node) => node.props?.['data-testid'] === 'terminal-takeover-button')).toBe(false);
    const expand = descendants(folded).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    const expanded = render();
    expect(descendants(expanded).some((node) => node.props?.['data-testid'] === 'terminal-takeover-button')).toBe(true);
    expect(textContent(expanded)).toContain('Take over ownership');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList takeover click posts through the helper, blocks a second click, then refreshes on success', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-frame-race');
    const originalFetch = globalThis.fetch;
    let resolveTakeover: ((response: Response) => void) | undefined;
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/control')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ action: 'takeover' }));
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Promise<Response>((resolve) => { resolveTakeover = resolve; });
      }
      return jsonResponse({ frame: `frame for ${url}` });
    });
    globalThis.fetch = asFetch(fetchMock);
    const onRefresh = mock(() => {});
    const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-live'], liveCount: 1 } });
    const render = () => react.render(() => SubjectList({ subjects: [live], onRefresh }));
    const folded = render();
    const expand = descendants(folded).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ready = render();
    const frameCallsBeforeTakeover = fetchMock.mock.calls.filter((call) => String(call[0]) === '/v1/terminals/pty-live/frame').length;
    expect(frameCallsBeforeTakeover).toBeGreaterThan(0);
    const button = descendants(ready).find((node) => node.props?.['data-testid'] === 'terminal-takeover-button');
    expect(button?.props?.disabled).toBe(false);
    (button?.props?.onClick as () => void)();
    const pending = render();
    const pendingButton = descendants(pending).find((node) => node.props?.['data-testid'] === 'terminal-takeover-button');
    expect(pendingButton?.props?.disabled).toBe(true);
    expect(textContent(pending)).toContain('Taking over ownership…');
    (pendingButton?.props?.onClick as () => void)();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/control'))).toHaveLength(1);
    resolveTakeover?.(new Response(JSON.stringify({ id: 'pty-live', action: 'takeover', status: 'success' }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const success = render();
    expect(textContent(success)).toContain('Ownership transferred. Observation refreshed.');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    react.flushEffects();
    const frameCallsAfterTakeover = fetchMock.mock.calls.filter((call) => String(call[0]) === '/v1/terminals/pty-live/frame').length;
    expect(frameCallsAfterTakeover).toBeGreaterThan(frameCallsBeforeTakeover);
    globalThis.fetch = originalFetch;
  });

  test('SubjectList locks the PTY selector while takeover is pending for that PTY', async () => {
    const react = createReactHarness();
    const { SubjectList } = await importSubjectListFresh('terminal-takeover-lock');
    const originalFetch = globalThis.fetch;
    let resolveTakeover: ((response: Response) => void) | undefined;
    globalThis.fetch = asFetch(mockFetch((url) => url.endsWith('/control')
      ? new Promise<Response>((resolve) => { resolveTakeover = resolve; })
      : jsonResponse({ frame: `frame for ${url}` })));
    const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-a', 'pty-b'], liveCount: 2 } });
    const render = () => react.render(() => SubjectList({ subjects: [live] }));
    const folded = render();
    const expand = descendants(folded).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    render();
    react.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ready = render();
    const select = descendants(ready).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    expect(select?.props?.disabled).toBe(false);
    const button = descendants(ready).find((node) => node.props?.['data-testid'] === 'terminal-takeover-button');
    (button?.props?.onClick as () => void)();
    const pending = render();
    const pendingSelect = descendants(pending).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    expect(pendingSelect?.props?.disabled).toBe(true);
    expect(pendingSelect?.props?.value).toBe('pty-a');
    expect(textContent(pending)).toContain('Taking over ownership…');
    resolveTakeover?.(new Response(JSON.stringify({ id: 'pty-a', action: 'takeover', status: 'success' }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const success = render();
    const successSelect = descendants(success).find((node) => node.props?.['aria-label'] === 'Select terminal PTY');
    expect(successSelect?.props?.disabled).toBe(false);
    expect(successSelect?.props?.value).toBe('pty-a');
    globalThis.fetch = originalFetch;
  });

  test('SubjectList shows distinct takeover faces for unknown, denied, and owner-unreachable failures', async () => {
    const originalFetch = globalThis.fetch;
    const cases: ReadonlyArray<{ status: number; kind: TerminalTakeoverFailureKind; phrase: string }> = [
      { status: 404, kind: 'unknown', phrase: 'Unknown target' },
      { status: 409, kind: 'denied', phrase: 'Denied' },
      { status: 504, kind: 'owner-unreachable', phrase: 'Owner unreachable' },
      { status: 502, kind: 'failed', phrase: 'Server failed' },
    ];
    for (const { status, kind, phrase } of cases) {
      const react = createReactHarness();
        const { SubjectList } = await import('./SubjectList');
      globalThis.fetch = asFetch(mockFetch((url) => url.endsWith('/control')
        ? new Response('no', { status })
        : jsonResponse({ frame: 'live frame' })));
      const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-live'], liveCount: 1 } });
      const render = () => react.render(() => SubjectList({ subjects: [live] }));
      const folded = render();
      const expand = descendants(folded).find((node) => node.props?.['aria-expanded'] === false);
      (expand?.props?.onClick as () => void)();
      render();
      react.flushEffects();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ready = render();
      const button = descendants(ready).find((node) => node.props?.['data-testid'] === 'terminal-takeover-button');
      (button?.props?.onClick as () => void)();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const failed = render();
      const alert = descendants(failed).find((node) => node.props?.['data-testid'] === 'terminal-takeover-error');
      expect(alert?.props?.['data-takeover-kind']).toBe(kind);
      expect(textContent(failed)).toContain(phrase);
      expect(textContent(failed)).toContain('try again');
    }
    globalThis.fetch = asFetch(mockFetch(async () => { throw new Error('offline'); }));
    const networkReact = createReactHarness();
    const { SubjectList: NetworkList } = await import('./SubjectList');
    const live = subject({ runId: 'live-run', screen: { ptyIds: ['pty-live'], liveCount: 1 } });
    const renderNetwork = () => networkReact.render(() => NetworkList({ subjects: [live] }));
    const folded = renderNetwork();
    const expand = descendants(folded).find((node) => node.props?.['aria-expanded'] === false);
    (expand?.props?.onClick as () => void)();
    renderNetwork();
    networkReact.flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ready = renderNetwork();
    const button = descendants(ready).find((node) => node.props?.['data-testid'] === 'terminal-takeover-button');
    (button?.props?.onClick as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failed = renderNetwork();
    expect(textContent(failed)).toContain('Network failed');
    expect(descendants(failed).find((node) => node.props?.['data-testid'] === 'terminal-takeover-error')?.props?.['data-takeover-kind']).toBe('network');
    globalThis.fetch = originalFetch;
  });
});
