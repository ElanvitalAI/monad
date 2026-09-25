// Locale resolution — picks `en` / `ko` / `ja` / `zh` from env hints.
//
// Resolution order:
//  1. `MONAD_LANG`            — explicit project override (highest)
//  2. `LC_ALL` / `LC_MESSAGES` / `LANG` — POSIX locale chain
//  3. `en` fallback           — default when nothing matches
//
// Adding a locale = adding a message bundle + extending the matcher
// + adding the new locale to the BUNDLES table in `i18n/index.ts`;
// nothing else changes.

export type Locale = 'en' | 'ko' | 'ja' | 'zh';

const SUPPORTED: ReadonlyArray<Locale> = ['en', 'ko', 'ja', 'zh'];

/** Detect the active locale from environment variables. Falls back to
 *  `'en'` when no hint matches a supported locale. */
export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  const explicit = env.MONAD_LANG?.trim().toLowerCase();
  if (explicit) {
    // Exact match (en/ko/ja/zh).
    if ((SUPPORTED as ReadonlyArray<string>).includes(explicit)) {
      return explicit as Locale;
    }
    // Common variants (zh-cn → zh, zh-tw → zh, zh_cn → zh, ja-jp → ja).
    const head = explicit.split(/[-_]/, 1)[0] ?? '';
    if ((SUPPORTED as ReadonlyArray<string>).includes(head)) {
      return head as Locale;
    }
  }
  const chain = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  const head = chain.toLowerCase().split(/[._@-]/, 1)[0] ?? '';
  if (head.startsWith('ko')) return 'ko';
  if (head.startsWith('ja')) return 'ja';
  if (head.startsWith('zh')) return 'zh';
  return 'en';
}

/** Predicate — true when `value` is one of the supported locales. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED as ReadonlyArray<string>).includes(value);
}

/** Snapshot of the supported locale set — useful for help / picker UIs. */
export const LOCALES: ReadonlyArray<Locale> = SUPPORTED;
