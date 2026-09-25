import { debug } from '../debug/log.js';
import { estimateTokens } from '../tokens.js';
import { selectPromptFragments } from './selector.js';
import type {
  PromptBankStore,
  PromptFragment,
  PromptInjection,
  PromptInjectionBuildOptions,
  PromptRuntimeState,
  PromptTargetSlot,
} from './types.js';

export interface BuildPromptInjectionInput {
  store?: PromptBankStore;
  fragments?: readonly PromptFragment[];
  state?: PromptRuntimeState;
  options?: PromptInjectionBuildOptions;
}

const SLOT_ORDER: PromptTargetSlot[] = ['system', 'context', 'tool-hint', 'user-prefix'];

export function buildPromptInjection(input: BuildPromptInjectionInput): PromptInjection {
  const state = input.state ?? {};
  const options = input.options ?? {};
  const fragments = input.fragments
    ? [...input.fragments]
    : input.store?.search({ enabled: true, limit: 500 }) ?? [];
  const selection = selectPromptFragments(fragments, state, options);
  const slots = composeSlots(selection.selected, options.includeHeaders ?? true);
  const tokenEstimate = estimateInjectionTokens(slots);
  const selectedFragmentIds = selection.selected.map(fragment => fragment.id);
  let log: PromptInjection['log'];

  if (input.store && options.record !== false) {
    if (selectedFragmentIds.length > 0) input.store.recordUse(selectedFragmentIds);
    log = input.store.recordInjection({
      sessionId: options.sessionId,
      turnId: options.turnId,
      model: options.model,
      activeView: state.activeView,
      activePlugin: options.activePlugin ?? state.activePlugins?.[0],
      selectedFragmentIds,
      rejected: selection.rejected,
      tokenEstimate,
      slots,
      metadata: {
        ...(options.metadata ?? {}),
        focusedPane: state.focusedPane,
        visiblePanes: state.visiblePanes ?? [],
        intents: state.intents ?? [],
        debugLevel: state.debugLevel,
      },
    });
  }

  if (debug.enabled) {
    // Build the payload inside the gate — Object.fromEntries +
    // estimateTokens over every slot is ~20µs per turn, skipped
    // entirely when no sink is active.
    debug.log('prompt.inject', 'built prompt injection', {
      selected: selectedFragmentIds,
      rejected: selection.rejected,
      tokenEstimate,
      slots: Object.fromEntries(Object.entries(slots).map(([slot, content]) => [slot, estimateTokens(content ?? '')])),
      sessionId: options.sessionId,
      turnId: options.turnId,
      model: options.model,
      activeView: state.activeView,
      focusedPane: state.focusedPane,
    });
  }

  return {
    selection,
    slots,
    tokenEstimate,
    ...(log ? { log } : {}),
  };
}

export function composeSlots(
  fragments: readonly PromptFragment[],
  includeHeaders = true,
): Partial<Record<PromptTargetSlot, string>> {
  const grouped = new Map<PromptTargetSlot, PromptFragment[]>();
  for (const slot of SLOT_ORDER) grouped.set(slot, []);
  for (const fragment of fragments) {
    grouped.get(fragment.targetSlot)?.push(fragment);
  }

  const slots: Partial<Record<PromptTargetSlot, string>> = {};
  for (const slot of SLOT_ORDER) {
    const items = grouped.get(slot) ?? [];
    if (items.length === 0) continue;
    slots[slot] = items.map(fragment => renderFragment(fragment, includeHeaders)).join('\n\n').trim();
  }
  return slots;
}

export function estimateInjectionTokens(slots: Partial<Record<PromptTargetSlot, string>>): number {
  return Object.values(slots).reduce((total, content) => total + estimateTokens(content ?? ''), 0);
}

function renderFragment(fragment: PromptFragment, includeHeaders: boolean): string {
  const content = fragment.content.trim();
  if (!includeHeaders) return content;
  return [
    `### Prompt Fragment: ${fragment.name}`,
    `id: ${fragment.id}`,
    `owner: ${fragment.owner}`,
    '',
    content,
  ].join('\n').trim();
}
