// ── Category auto-inference — file path → 8-track namespace ──
//
// PLAN §11.5.2 — map source-file path to category prefix so contributors
// don't have to reason about namespace taxonomy when adding a debug.log.
// Falls back to 'unknown.<basename>' so the event is still searchable even
// when no track owns the file.

/** Ordered list — first matching prefix wins. Paths may include the
 *  `src/` prefix or be absolute — we normalise below. */
const TRACK_RULES: ReadonlyArray<{ match: RegExp; prefix: string }> = [
  { match: /(^|\/)src\/mss\//, prefix: 'mss' },
  { match: /(^|\/)src\/conductor\//, prefix: 'pfc' },
  { match: /(^|\/)src\/cft\//, prefix: 'pfc' },
  { match: /(^|\/)src\/agent(\/|-|s\/|-team\/|-status\/)/, prefix: 'pfc' },
  { match: /(^|\/)src\/auto-research\//, prefix: 'pfc' },
  { match: /(^|\/)src\/intelligence-map\//, prefix: 'pfc' },
  { match: /(^|\/)src\/input-core\//, prefix: 'idx' },
  { match: /(^|\/)src\/log-pane\//, prefix: 'idx' },
  { match: /(^|\/)src\/dashboard/, prefix: 'idx' },
  { match: /(^|\/)src\/task-orchestrator\//, prefix: 'tox' },
  { match: /(^|\/)src\/tool-runtime\/tox-/, prefix: 'tox' },
  { match: /(^|\/)src\/acp\//, prefix: 'axon' },
  { match: /(^|\/)src\/hitl\//, prefix: 'axon' },
  { match: /(^|\/)src\/axon\//, prefix: 'axon' },
  { match: /(^|\/)src\/pushcut\//, prefix: 'axon' },
  { match: /(^|\/)src\/(telegram|discord)/, prefix: 'axon' },
  { match: /(^|\/)src\/knowledge\//, prefix: 'kgs' },
  { match: /(^|\/)src\/kgp\//, prefix: 'kgs' },
  { match: /(^|\/)src\/obsidian-/, prefix: 'kgs' },
  { match: /(^|\/)src\/surface\//, prefix: 'iul' },
  { match: /(^|\/)src\/panes\//, prefix: 'iul' },
  { match: /(^|\/)src\/virtual-windows\//, prefix: 'iul' },
  { match: /(^|\/)src\/shell-runner\//, prefix: 'iul' },
  { match: /(^|\/)src\/terminal-matrix\//, prefix: 'iul' },
  { match: /(^|\/)src\/pty-shell\//, prefix: 'iul' },
  { match: /(^|\/)src\/preview-terminal/, prefix: 'iul' },
  { match: /(^|\/)src\/browser-cdp\//, prefix: 'iul' },
  { match: /(^|\/)src\/capture\//, prefix: 'cap' },
  { match: /(^|\/)src\/scheduler\//, prefix: 'sched' },
  { match: /(^|\/)src\/widget-/, prefix: 'widget' },
  { match: /(^|\/)widgets\//, prefix: 'widget' },
  { match: /(^|\/)plugins\//, prefix: 'plugin' },
];

/** Turn camel/Pascal case into kebab-case ('startTurnTrace' → 'start-turn-trace'). */
function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  const tail = idx >= 0 ? filePath.slice(idx + 1) : filePath;
  return tail.replace(/\.[jt]sx?$/, '');
}

/** Infer a category string for a debug.log call site.
 *
 *  - `filePath` — absolute path from `new Error().stack` or `import.meta.url`.
 *  - `fnName`   — optional function/class name; appended after `.`.
 *
 *  Returns e.g. `pfc.classify` for `src/conductor/classify.ts + fn='classify'`,
 *  or `unknown.<basename>` when no track rule matched. */
export function inferCategoryFromPath(filePath: string, fnName?: string): string {
  const normalised = filePath.replace(/\\/g, '/');
  let prefix: string | null = null;
  for (const rule of TRACK_RULES) {
    if (rule.match.test(normalised)) {
      prefix = rule.prefix;
      break;
    }
  }
  const base = basename(normalised);
  const tail = fnName && fnName.trim() ? kebab(fnName) : kebab(base);
  if (prefix) return `${prefix}.${tail}`;
  return `unknown.${kebab(base)}`;
}
