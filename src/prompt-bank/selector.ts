import { estimateTokens } from '../tokens.js';
import type {
  PromptFragment,
  PromptRejection,
  PromptRuntimeState,
  PromptSelection,
  PromptSelectionOptions,
} from './types.js';

export function selectPromptFragments(
  fragments: readonly PromptFragment[],
  state: PromptRuntimeState = {},
  options: PromptSelectionOptions = {},
): PromptSelection {
  const rejected: PromptRejection[] = [];
  const ordered = [...fragments]
    .sort((a, b) => a.priority - b.priority || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  const selected: PromptFragment[] = [];
  let tokenEstimate = 0;
  const budget = options.budgetTokens ?? Number.POSITIVE_INFINITY;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  for (const fragment of ordered) {
    if (!fragment.enabled) {
      rejected.push({ id: fragment.id, reason: 'disabled' });
      continue;
    }
    const triggerReason = matchTriggers(fragment, state);
    if (triggerReason) {
      rejected.push({ id: fragment.id, reason: triggerReason });
      continue;
    }
    const constraintReason = matchConstraints(fragment, state);
    if (constraintReason) {
      rejected.push({ id: fragment.id, reason: constraintReason });
      continue;
    }
    const cost = estimateTokens(fragment.content);
    if (selected.length >= limit) {
      rejected.push({ id: fragment.id, reason: 'limit' });
      continue;
    }
    if (tokenEstimate + cost > budget) {
      rejected.push({ id: fragment.id, reason: 'budget' });
      continue;
    }
    selected.push(fragment);
    tokenEstimate += cost;
  }

  return { selected, rejected, tokenEstimate };
}

function matchTriggers(fragment: PromptFragment, state: PromptRuntimeState): string | null {
  const triggers = fragment.triggers ?? {};
  for (const [key, expected] of Object.entries(triggers)) {
    switch (key) {
      case 'view':
        if (!matchesOne(state.activeView, expected)) return 'trigger:view';
        break;
      case 'focusPane':
        if (!matchesOne(state.focusedPane, expected)) return 'trigger:focusPane';
        break;
      case 'paneVisible':
        if (!matchesAny(state.visiblePanes, expected)) return 'trigger:paneVisible';
        break;
      case 'pluginActive':
        if (!matchesAny(state.activePlugins, expected)) return 'trigger:pluginActive';
        break;
      case 'skillLoaded':
        if (!matchesAny(state.loadedSkills, expected)) return 'trigger:skillLoaded';
        break;
      case 'workflowLoaded':
        if (!matchesAny(state.loadedWorkflows, expected)) return 'trigger:workflowLoaded';
        break;
      case 'resourceOnline':
        if (!matchesAny(state.onlineResources, expected)) return 'trigger:resourceOnline';
        break;
      case 'intent':
        if (!matchesAny(state.intents, expected)) return 'trigger:intent';
        break;
      case 'debugLevel':
        if (!matchesOne(state.debugLevel, expected)) return 'trigger:debugLevel';
        break;
      case 'tag':
      case 'tags':
        if (!matchesAny(state.tags, expected)) return 'trigger:tags';
        break;
      default:
        return `trigger:unsupported:${key}`;
    }
  }
  return null;
}

function matchConstraints(fragment: PromptFragment, state: PromptRuntimeState): string | null {
  const constraints = fragment.constraints ?? {};
  if (constraints.modelFamily !== undefined && !matchesOne(state.modelFamily, constraints.modelFamily)) {
    return 'constraint:modelFamily';
  }
  if (constraints.targetSlot !== undefined && !matchesOne(fragment.targetSlot, constraints.targetSlot)) {
    return 'constraint:targetSlot';
  }
  const maxTokens = typeof constraints.maxTokens === 'number' ? constraints.maxTokens : null;
  if (maxTokens !== null && estimateTokens(fragment.content) > maxTokens) {
    return 'constraint:maxTokens';
  }
  return null;
}

function matchesOne(actual: string | undefined, expected: unknown): boolean {
  if (actual === undefined) return false;
  if (typeof expected === 'string') return actual === expected;
  if (Array.isArray(expected)) return expected.some(item => typeof item === 'string' && item === actual);
  return false;
}

function matchesAny(actual: readonly string[] | undefined, expected: unknown): boolean {
  if (!actual || actual.length === 0) return false;
  if (typeof expected === 'string') return actual.includes(expected);
  if (Array.isArray(expected)) {
    const expectedStrings = expected.filter((item): item is string => typeof item === 'string');
    return expectedStrings.some(item => actual.includes(item));
  }
  return false;
}
