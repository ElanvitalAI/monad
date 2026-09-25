import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createReactHookHarness } from '@/lib/testing/react-hook-harness';
import { _resetPersonasCacheForTest } from '@/lib/showroom/use-personas';
import { BotsPanel } from './BotsPanel';

const require = createRequire(import.meta.url);
const harness = createReactHookHarness(require('react'));

const commands = [
  {
    name: 'research',
    description: 'Research a topic.',
    arguments: [{ name: 'topic', description: 'Subject to research.', required: true }],
  },
];

const personas = [
  { personaId: 'sage', displayName: 'Sage', description: 'Careful analyst.' },
];

function createClient({
  catalog = Promise.resolve(commands),
  personaList = Promise.resolve({ personas }),
}: {
  catalog?: Promise<typeof commands>;
  personaList?: Promise<{ personas: typeof personas }>;
} = {}) {
  const requestedPaths: string[] = [];
  const client = {
    fetchJson: (path: string) => {
      requestedPaths.push(path);
      return catalog;
    },
    listPersonas: () => personaList,
    personasEventsUrl: () => null,
  } as unknown as Parameters<typeof BotsPanel>[0]['client'];
  return { client, requestedPaths };
}

afterEach(() => {
  harness.unmount();
  _resetPersonasCacheForTest();
});

describe('BotsPanel', () => {
  it('requests and renders persona cards and the shared command catalog with arguments', async () => {
    const { client, requestedPaths } = createClient();
    harness.render(() => BotsPanel({ client }));
    await harness.settle();

    const page = harness.find((element) => element.props['data-testid'] === 'bots-panel');
    const text = harness.textOf(page);
    expect(requestedPaths).toEqual(['/v1/bots/commands']);
    expect(text).toContain('Sage');
    expect(text).toContain('Careful analyst.');
    expect(text).toContain('research');
    expect(text).toContain('Research a topic.');
    expect(text).toContain('topic (required) — Subject to research.');
    expect(text).toContain('Commands are global: every bot exposes the same catalog.');
  });

  it('shows a catalog failure instead of treating it as an empty result', async () => {
    const { client, requestedPaths } = createClient({
      catalog: Promise.reject(new Error('catalog offline')),
    });
    harness.render(() => BotsPanel({ client }));
    await harness.settle();

    const alert = harness.find((element) => element.props.role === 'alert');
    expect(requestedPaths).toEqual(['/v1/bots/commands']);
    expect(harness.textOf(alert)).toContain('Unable to load bot catalog: catalog offline');
  });

  it('clears the previous catalog while a replacement client request is pending', async () => {
    const first = createClient();
    let resolveReplacementCatalog: (value: typeof commands) => void = () => {};
    const replacementCatalog = new Promise<typeof commands>((resolve) => {
      resolveReplacementCatalog = resolve;
    });
    const second = createClient({ catalog: replacementCatalog });

    harness.render(() => BotsPanel({ client: first.client }));
    await harness.settle();
    expect(harness.textOf(harness.find((element) => element.props['data-testid'] === 'bots-panel'))).toContain('research');

    harness.render(() => BotsPanel({ client: second.client }));
    const loading = harness.find((element) => element.props.role === 'status');
    const duringReplacement = harness.textOf(harness.find((element) => element.props['data-testid'] === 'bots-panel'));
    expect(second.requestedPaths).toEqual(['/v1/bots/commands']);
    expect(harness.textOf(loading)).toContain('Loading bot identities and command catalog…');
    expect(duringReplacement).not.toContain('research');

    resolveReplacementCatalog([{ name: 'inspect', description: 'Inspect a bot.', arguments: [] }]);
    await harness.settle();
    const afterReplacement = harness.textOf(harness.find((element) => element.props['data-testid'] === 'bots-panel'));
    expect(afterReplacement).toContain('inspect');
    expect(afterReplacement).not.toContain('research');
  });

  it('renders the initial loading state', () => {
    const { client } = createClient();
    const html = renderToStaticMarkup(<BotsPanel client={client} />);

    expect(html).toContain('Loading bot identities and command catalog…');
  });

  it('shows a persona failure even while the catalog request remains pending', async () => {
    const { client } = createClient({
      catalog: new Promise(() => {}),
      personaList: Promise.reject(new Error('personas offline')),
    });
    harness.render(() => BotsPanel({ client }));
    await harness.settle();

    const alert = harness.find((element) => element.props.role === 'alert');
    expect(harness.textOf(alert)).toContain('Unable to load bot identities: personas offline');
  });

  it('does not render command execution controls after the successful responses settle', async () => {
    const { client } = createClient();
    harness.render(() => BotsPanel({ client }));
    await harness.settle();

    const page = harness.find((element) => element.props['data-testid'] === 'bots-panel');
    expect(harness.findAll((element) => element.type === 'button' || element.type === 'form')).toEqual([]);
    expect(harness.findAll((element) => element.type === 'a' && typeof element.props.href === 'string' && element.props.href.includes('/v1/bots/commands/'))).toEqual([]);
    expect(harness.textOf(page)).toContain('This surface cannot send commands yet; it only shows what you can ask bots to do.');
  });
});
