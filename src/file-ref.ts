// Shared file-reference detection — used by the telegram formatter to
// wrap bare file refs in <code> (stops auto-linkification on mobile)
// and by the terminal markdown renderer to style them like inline
// code spans. Keeping the extension set + regex in one place so the
// two renderers stay in sync: when an LLM writes "edit src/foo.ts",
// both surfaces treat it the same.

/** File extensions recognized as bare file references in prose.
 *
 *  Curated with openclaw's rule of thumb: commonly used in code and
 *  docs, rarely written as an intentional domain. `.ai`, `.io`, `.tv`,
 *  `.fm`, `.co` are intentionally excluded so "vercel.io" / "x.ai"
 *  don't get wrapped as if they were Go/AI-language files. */
export const FILE_REF_EXTENSIONS = new Set<string>([
  'md', 'mdx', 'txt', 'rst',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'dart', 'lua',
  'c', 'cc', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  'yml', 'yaml', 'toml', 'json', 'xml',
  'html', 'htm', 'css', 'scss', 'sass',
  'sql', 'csv', 'tsv', 'log', 'env',
  'lock', 'gitignore', 'dockerfile', 'makefile',
]);

/** Match `<prefix-char>filename.ext` where prefix is a safe boundary
 *  (start-of-string or whitespace / punctuation). Captures:
 *    group 1 — the boundary char (restored by the caller)
 *    group 2 — the filename body including extension
 *  Filename body allows letters/digits/`_`/`.`/`-`/`/` — enough for
 *  `src/server.ts` or `foo.bar.config.json`. */
export const FILE_REF_RE: RegExp = (() => {
  const exts = Array.from(FILE_REF_EXTENSIONS).join('|');
  return new RegExp(
    `(^|[\\s(\\[,;:!?])([a-zA-Z0-9_.\\-/]+\\.(?:${exts}))(?=$|[\\s)\\],;:!?])`,
    'g',
  );
})();
