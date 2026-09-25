export const CHAT_PICKER_KINDS = ['slash', 'arg', 'at', 'skill'] as const;

export type ChatPickerKind = (typeof CHAT_PICKER_KINDS)[number];
