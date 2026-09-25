// Public i18n surface for the expression layer.
//
// Hosts pick a bundle once at boot via `getMessages()` (default reads
// `process.env`), or they can pass an explicit `Locale`. Templates
// fill via `format(template, vars)` — `{name}`-style placeholders.
//
// The bundle table is closed on purpose: adding a locale means
// importing a new bundle here. Avoids accidental dynamic require()
// patterns that would block bundlers / SSR.

import { type Locale, detectLocale } from '../locale.js';
import type { Messages } from './types.js';
import { messagesEn } from './messages.en.js';
import { messagesKo } from './messages.ko.js';
import { messagesJa } from './messages.ja.js';
import { messagesZh } from './messages.zh.js';

const BUNDLES: Record<Locale, Messages> = {
  en: messagesEn,
  ko: messagesKo,
  ja: messagesJa,
  zh: messagesZh,
};

/** Resolve a message bundle. Pass an explicit `locale` to bypass env
 *  detection — useful when the host has its own locale plumbing. */
export function getMessages(locale?: Locale): Messages {
  return BUNDLES[locale ?? detectLocale()];
}

/** Replace `{name}` placeholders in `template` with values from
 *  `vars`. Missing keys render as empty strings (kept silent so a
 *  partial vars object doesn't crash a wizard mid-step). */
export function format(
  template: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

export type { Messages } from './types.js';
export { messagesEn } from './messages.en.js';
export { messagesKo } from './messages.ko.js';
export { messagesJa } from './messages.ja.js';
export { messagesZh } from './messages.zh.js';
