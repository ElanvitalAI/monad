// Syntax highlighting via shiki — Phase CE6.
//
// Lazy-loaded. First call loads the shiki core + the requested
// language grammar + the Catppuccin Mocha theme; subsequent calls
// reuse the singleton. Unsupported languages silently fall back to
// plain text so the diff renderer never explodes on an unknown
// extension.
//
// Cost profile: shiki's default bundle is ~2 MB after tree-shake; we
// load grammars on demand to keep the steady-state memory bounded.
// The highlighter survives the session — callers pay the first-hit
// latency once.

import { extname, basename } from 'path';

// Shape exported back to diff-render.ts. Per line, an array of
// (content, fg-hex) pairs. `color` may be undefined for whitespace
// that shiki emits without a style.
export interface SyntaxToken {
  content: string;
  color?: string;
}

/** Result of highlightCode — one row per source line, each a list of
 *  styled tokens. Falls back to a single plain token per line when
 *  the language isn't available. */
export type HighlightedLines = SyntaxToken[][];

// Shiki's actual type surface changes across versions; keep our ref
// loose-typed so a shiki minor bump doesn't break compile.
type Highlighter = {
  codeToTokens(code: string, opts: { lang: string; theme: string }): { tokens: SyntaxToken[][] };
  getLoadedLanguages(): string[];
  loadLanguage(lang: string): Promise<void>;
};

let _hl: Highlighter | null = null;
let _loadInFlight: Promise<Highlighter> | null = null;
const _loadedLangs = new Set<string>();

const THEME = 'catppuccin-mocha';

async function getHighlighter(): Promise<Highlighter> {
  if (_hl) return _hl;
  if (_loadInFlight) return _loadInFlight;
  _loadInFlight = (async () => {
    // Dynamic import so tests / headless usage never pay the bundle
    // cost unless highlightCode is actually invoked.
    const shiki = await import('shiki');
    const hl = await shiki.createHighlighter({
      themes: [THEME],
      langs: ['typescript', 'javascript'],   // seed set; grow via loadLanguage
    }) as unknown as Highlighter;
    _hl = hl;
    for (const l of hl.getLoadedLanguages()) _loadedLangs.add(l);
    return hl;
  })();
  return _loadInFlight;
}

/** Highlight `code` to per-line tokens using the given language hint.
 *  Returns plain one-token lines when anything goes wrong (missing
 *  lang, shiki fault, etc.) so the renderer always has something to
 *  paint. */
export async function highlightCode(code: string, lang: string): Promise<HighlightedLines> {
  if (!lang) return plainFallback(code);
  try {
    const hl = await getHighlighter();
    if (!_loadedLangs.has(lang)) {
      try {
        await hl.loadLanguage(lang);
        _loadedLangs.add(lang);
      } catch {
        return plainFallback(code);
      }
    }
    const res = hl.codeToTokens(code, { lang, theme: THEME });
    return res.tokens;
  } catch {
    return plainFallback(code);
  }
}

function plainFallback(code: string): HighlightedLines {
  return code.split('\n').map((line) => [{ content: line }]);
}

/** Map a file path / extension to a shiki language id. Returns ''
 *  when we don't have a confident mapping — diff-render treats this
 *  as "skip highlighting, render plain". */
export function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '');
  const base = basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    md: 'markdown', markdown: 'markdown',
    json: 'json', jsonc: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss',
    sql: 'sql',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    rb: 'ruby', php: 'php',
    lua: 'lua',
    tf: 'terraform',
  };
  return map[ext] ?? '';
}

/** For tests — drop the singleton so a subsequent call reloads. */
export function _resetSyntaxHighlighterForTesting(): void {
  _hl = null;
  _loadInFlight = null;
  _loadedLangs.clear();
}
