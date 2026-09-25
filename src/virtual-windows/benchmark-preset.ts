// LLM benchmark preset — VW-P10.
//
// Spawns a new virtual window with up to 4 panes, each running an
// llm-chat PaneContent against a different provider. A single prompt
// fans out via broadcast so all panes process the same question
// concurrently; the user then compares answers side-by-side.
//
// The underlying primitives (window registry, pane-content factory,
// event bus) don't care about the "benchmark" concept — this module
// is sugar that bundles the right spec calls into one entry point.

import type { AddressBook } from './addressing.js';
import type { VWEventBus } from './event-bus.js';
import type { WindowRegistry } from './window-registry.js';
import type { PaneFactoryDeps } from './pane-content.js';
import { createPaneContent } from './pane-content.js';
import type { VirtualWindow } from './virtual-window.js';

export type BenchmarkLayout = 'grid' | 'columns' | 'rows';

export interface BenchmarkProvider {
  name: string;         // display label (e.g. 'grok', 'gpt-5', 'claude')
  provider: string;     // key the llmChatBackend reads
  model?: string;
  systemPrompt?: string;
}

export interface SpawnBenchmarkOpts {
  prompt: string;
  providers: BenchmarkProvider[];
  title?: string;
  layout?: BenchmarkLayout;
  paneDeps?: PaneFactoryDeps;
}

export interface BenchmarkHandle {
  window: VirtualWindow;
  paneIds: string[];
  broadcastPrompt(input: string): { sent: number; total: number; failed: number };
}

export const MAX_BENCHMARK_PANES = 4;

export function spawnLLMBenchmark(
  opts: SpawnBenchmarkOpts,
  deps: {
    registry: WindowRegistry;
    eventBus: VWEventBus;
    addressBook: AddressBook;
    paneDeps?: PaneFactoryDeps;
  },
): BenchmarkHandle {
  if (opts.providers.length === 0) {
    throw new Error('at least one provider required');
  }
  if (opts.providers.length > MAX_BENCHMARK_PANES) {
    throw new Error(`max ${MAX_BENCHMARK_PANES} providers — trim the list`);
  }
  const layout = opts.layout ?? (opts.providers.length <= 2 ? 'columns' : 'grid');
  const paneDeps = opts.paneDeps ?? deps.paneDeps ?? {};
  const title = opts.title ?? `LLM Benchmark — ${opts.providers.map(p => p.name).join(' vs ')}`;

  // Spawn the window with the first provider's pane.
  const [firstProvider, ...rest] = opts.providers;
  if (!firstProvider) throw new Error('providers empty');
  const window = deps.registry.spawn({
    title,
    initialContent: {
      kind: 'llm-chat',
      provider: firstProvider.provider,
      model: firstProvider.model,
      systemPrompt: firstProvider.systemPrompt,
      title: firstProvider.name,
    },
  });
  const paneIds = [window.focused];

  // Split the remaining providers into place.
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i]!;
    const axis = pickAxis(layout, i, rest.length);
    // Split from an existing pane — balance by always targeting
    // the first pane for 'columns', the last for 'rows',
    // alternating for 'grid'.
    const target = layout === 'rows' ? paneIds[paneIds.length - 1]! : paneIds[i % paneIds.length]!;
    const newContent = createPaneContent({
      kind: 'llm-chat',
      provider: p.provider,
      model: p.model,
      systemPrompt: p.systemPrompt,
      title: p.name,
    }, paneDeps);
    const newPaneId = window.splitPaneAt(target, axis, newContent, 0.5);
    paneIds.push(newPaneId);
  }

  // Fire the initial prompt via broadcast so every pane gets it
  // simultaneously (no drift from sequential pane.write calls).
  const broadcastPrompt = (input: string) => {
    const targets = paneIds.map(id => `pane:${id}`);
    const r = deps.eventBus.broadcast(targets, input);
    return { sent: r.sent, total: r.total, failed: r.failed.length };
  };
  broadcastPrompt(opts.prompt);

  return { window, paneIds, broadcastPrompt };
}

function pickAxis(layout: BenchmarkLayout, splitIndex: number, _totalRest: number): 'h' | 'v' {
  switch (layout) {
    case 'columns': return 'h';
    case 'rows':    return 'v';
    case 'grid': {
      // 2nd pane → horizontal (2 columns), 3rd → split the left
      // column vertically, 4th → split the right column vertically.
      return splitIndex === 0 ? 'h' : 'v';
    }
  }
}
