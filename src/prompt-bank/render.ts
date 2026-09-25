import type { PromptInjection, PromptTargetSlot } from './types.js';

const SLOT_ORDER: PromptTargetSlot[] = ['system', 'context', 'tool-hint', 'user-prefix'];

const SLOT_LABELS: Record<PromptTargetSlot, string> = {
  system: 'Prompt Bank System Addendum',
  context: 'Prompt Bank Context',
  'tool-hint': 'Prompt Bank Tool Hints',
  'user-prefix': 'Prompt Bank User Prefix',
};

export interface RenderPromptInjectionOptions {
  includeAuditLine?: boolean;
  slots?: readonly PromptTargetSlot[];
}

export function renderPromptInjectionForUser(
  injection: PromptInjection,
  options: RenderPromptInjectionOptions = {},
): string {
  const blocks = renderSlotBlocks(injection, options.slots);
  if (blocks.length === 0) return '';
  const audit = options.includeAuditLine
    ? [
        '## Prompt Bank Audit',
        '',
        `selected: ${injection.selection.selected.map(fragment => fragment.id).join(', ') || '-'}`,
        `tokens: ${injection.tokenEstimate}`,
        injection.log?.id ? `log: ${injection.log.id}` : '',
      ].filter(Boolean).join('\n')
    : '';
  return [audit, ...blocks].filter(Boolean).join('\n\n').trim();
}

export function renderPromptInjectionForSystemAddendum(injection: PromptInjection): string {
  const blocks = renderSlotBlocks(injection);
  if (blocks.length === 0) return '';
  return [
    '## Prompt Bank Dynamic Context',
    '',
    'The following reusable prompt fragments were selected for the current runtime state.',
    '',
    blocks.join('\n\n'),
  ].join('\n').trim();
}

function renderSlotBlocks(
  injection: PromptInjection,
  slots: readonly PromptTargetSlot[] = SLOT_ORDER,
): string[] {
  const blocks: string[] = [];
  for (const slot of slots) {
    const content = injection.slots[slot]?.trim();
    if (!content) continue;
    blocks.push([`## ${SLOT_LABELS[slot]}`, '', content].join('\n'));
  }
  return blocks;
}
