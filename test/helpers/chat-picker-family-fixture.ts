import type {
  ArgSuggestion,
  AtCandidate,
  SkillCandidate,
  SlashCommand,
} from '../../src/chat/index.js';
import {
  createChatPickerModalFamily,
  type ChatPickerFamilySources,
  type ChatPickerModalBindings,
  type ChatPickerModalFamily,
} from '../../src/chat/pickers/modals.js';
import type { ChatPickerKind } from '../../src/chat/pickers/kinds.js';

export const chatPickerTestBounds = { row: 30, col: 1, width: 80, height: 1 } as const;

export const chatPickerFamilyBaseBindings = {
  slash: { selectedIdx: () => 0, maxVisible: 5, getInputZoneHeight: () => 1, width: 80 },
  arg: { selectedIdx: () => 0, maxVisible: 5, getInputZoneHeight: () => 1, width: 80 },
  at: { selectedIdx: () => 0, maxVisible: 5, getInputZoneHeight: () => 1, width: 80 },
  skill: { selectedIdx: () => 0, maxVisible: 5, getInputZoneHeight: () => 1, width: 80 },
};

export function createChatPickerTestSources(spec?: Partial<{
  slashItems: () => SlashCommand[];
  argItems: () => ArgSuggestion[];
  atItems: () => AtCandidate[];
  skillItems: () => SkillCandidate[];
}>): ChatPickerFamilySources {
  return {
    slash: { id: 'test:slash', getItems: spec?.slashItems ?? (() => [] as SlashCommand[]) },
    arg: { id: 'test:arg', getItems: spec?.argItems ?? (() => [] as ArgSuggestion[]) },
    at: { id: 'test:at', getItems: spec?.atItems ?? (() => [] as AtCandidate[]) },
    skill: { id: 'test:skill', getItems: spec?.skillItems ?? (() => [] as SkillCandidate[]) },
  };
}

export function createChatPickerTestBindings(spec?: {
  width?: number;
  overrides?: Partial<{
    [K in ChatPickerKind]: Partial<ChatPickerModalBindings>;
  }>;
}): Record<ChatPickerKind, ChatPickerModalBindings> {
  const width = spec?.width ?? 80;
  const overrides = spec?.overrides ?? {};
  return {
    slash: { ...chatPickerFamilyBaseBindings.slash, width, ...overrides.slash },
    arg: { ...chatPickerFamilyBaseBindings.arg, width, ...overrides.arg },
    at: { ...chatPickerFamilyBaseBindings.at, width, ...overrides.at },
    skill: { ...chatPickerFamilyBaseBindings.skill, width, ...overrides.skill },
  };
}

export function createChatPickerTestFamily(spec?: {
  bounds?: { row: number; col: number; width: number; height: number };
  sources?: ChatPickerFamilySources;
  width?: number;
  bindingOverrides?: Partial<{
    [K in ChatPickerKind]: Partial<ChatPickerModalBindings>;
  }>;
}): ChatPickerModalFamily {
  return createChatPickerModalFamily({
    bounds: spec?.bounds ?? { ...chatPickerTestBounds },
    sources: spec?.sources ?? createChatPickerTestSources(),
    bindings: createChatPickerTestBindings({
      width: spec?.width ?? spec?.bounds?.width ?? chatPickerTestBounds.width,
      overrides: spec?.bindingOverrides,
    }),
  });
}
