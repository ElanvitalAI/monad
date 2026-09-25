#!/usr/bin/env bun
// ── Tool-economics baseline measurement (ROADMAP Wave 2 · W2.8 · M1-M5) ──
//
// Reports the per-turn token-cost shape of the native tool catalog so
// Wave 2 dogfood can be measured against a real baseline. Output is
// deliberately compact — one line per metric — so you can diff
// before/after by piping into a file:
//
//   bun run scripts/measure-tool-economics.ts > /tmp/baseline-A.txt
//   # ...flip catalog flags or run with --no-deferred...
//   bun run scripts/measure-tool-economics.ts > /tmp/baseline-B.txt
//   diff /tmp/baseline-A.txt /tmp/baseline-B.txt
//
// What is measured (all char-based · 1 token ≈ 4 chars heuristic):
//   M1  schemaCharsTotal      sum of JSON.stringify(spec) over every runtime
//   M2  schemaCharsActive     same, restricted to entries that would ship
//                             this turn (alwaysLoad !== false OR
//                             shouldDefer !== true)
//   M3  schemaCharsDeferred   the difference — chars saved per turn
//   M4  toolCountTotal        registered runtimes overall
//   M5  toolCountActive       runtimes shipped with full schema this turn
//   M6  toolCountDeferred     runtimes hidden behind ToolSearch
//   M7  announceBlockChars    chars of the `<available-deferred-tools>`
//                             system-prompt block that gets prepended
//                             (deferred-mode only)
//
// The script does NOT call any LLM — it estimates client-side, before
// the request leaves the process. For real cache-hit-rate /
// `cached_read_input_tokens` metrics, hook a dogfood session and read
// `llm.request/tools-tier` debug events.

import {
  nativeToolCatalog,
  type NativeToolCatalogEntry,
} from '../src/native-tool-catalog.js';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index.js';
import { listToolRuntimes } from '../src/tool-runtime/registry.js';
import {
  buildDeferredToolsPromptBlock,
  splitDeferredToolSpecs,
} from '../src/session-runtime/tier-flip.js';

const CHARS_PER_TOKEN = 4;

function specChars(spec: { name: string; description: string; parameters: unknown }): number {
  return JSON.stringify({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
  }).length;
}

function chars(n: number): string {
  return `${n.toLocaleString()} chars (~${Math.round(n / CHARS_PER_TOKEN).toLocaleString()} tok)`;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

interface RuntimeSpecMetric {
  name: string;
  chars: number;
  entry: NativeToolCatalogEntry | undefined;
  deferred: boolean;
}

function main(): void {
  registerAllDefaultToolRuntimes();
  const runtimes = listToolRuntimes();
  const verbose = process.argv.includes('--verbose');
  const topN = (() => {
    const idx = process.argv.indexOf('--top');
    if (idx >= 0 && process.argv[idx + 1]) {
      const n = Number(process.argv[idx + 1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 15;
  })();

  const catalogIndex = new Map<string, NativeToolCatalogEntry>();
  for (const entry of nativeToolCatalog) {
    catalogIndex.set(entry.id.toLowerCase(), entry);
    catalogIndex.set(entry.displayName.toLowerCase(), entry);
    for (const alias of entry.aliases) catalogIndex.set(alias.toLowerCase(), entry);
  }

  // Authoritative deferral decision = splitDeferredToolSpecs (covers
  // both catalog-flag and byname fallback paths). We feed each spec
  // through the splitter individually so per-spec metrics line up
  // with the live runtime path.
  let totalChars = 0;
  let activeChars = 0;
  let deferredChars = 0;
  let totalCount = 0;
  let activeCount = 0;
  let deferredCount = 0;
  const specs = runtimes
    .map((rt) => rt.spec)
    .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec));
  const split = splitDeferredToolSpecs(specs);
  const deferredNames = new Set(split.deferred.map((d) => d.name));
  const metrics: RuntimeSpecMetric[] = [];

  for (const spec of specs) {
    const entry = catalogIndex.get(spec.name.toLowerCase());
    const c = specChars(spec);
    const deferred = deferredNames.has(spec.name);
    totalChars += c;
    totalCount += 1;
    if (deferred) {
      deferredChars += c;
      deferredCount += 1;
    } else {
      activeChars += c;
      activeCount += 1;
    }
    metrics.push({ name: spec.name, chars: c, entry, deferred });
  }

  const announceBlock = buildDeferredToolsPromptBlock(split.deferred);
  const announceChars = announceBlock.length;

  console.log('# Tool-economics baseline (M1-M5 + announce)\n');
  console.log(`M1  schemaCharsTotal     : ${chars(totalChars)}`);
  console.log(`M2  schemaCharsActive    : ${chars(activeChars)}  (${pct(activeChars, totalChars)} of total)`);
  console.log(`M3  schemaCharsDeferred  : ${chars(deferredChars)}  (${pct(deferredChars, totalChars)} of total · "savings per turn")`);
  console.log(`M4  toolCountTotal       : ${totalCount}`);
  console.log(`M5  toolCountActive      : ${activeCount}`);
  console.log(`M6  toolCountDeferred    : ${deferredCount}`);
  console.log(`M7  announceBlockChars   : ${chars(announceChars)}`);
  console.log('');
  console.log(`Net per-turn delta (deferred ON vs OFF): ${chars(deferredChars - announceChars)} saved`);
  console.log('  (= schemaCharsDeferred minus the announce block we prepend in its place)');
  if (deferredChars < announceChars) {
    console.log('  WARN: deferring the current selection is a NET LOSS — consider trimming the announce block or unmarking small specs.');
  }

  if (verbose) {
    const activeSorted = metrics.filter((m) => !m.deferred).sort((a, b) => b.chars - a.chars);
    const deferredSorted = metrics.filter((m) => m.deferred).sort((a, b) => a.chars - b.chars);
    console.log('');
    console.log(`# Top ${topN} ACTIVE specs by chars (candidates to defer)`);
    for (const m of activeSorted.slice(0, topN)) {
      const safety = m.entry?.safety?.join(',') ?? '?';
      const scope = m.entry?.intentScope ?? '?';
      const flagsHint = !m.entry ? ' (no catalog entry)' : '';
      console.log(`  ${m.chars.toString().padStart(5)} chars · ${m.name}  [${safety} · ${scope}]${flagsHint}`);
    }
    console.log('');
    console.log(`# Bottom ${topN} DEFERRED specs by chars (oversize-announce suspects)`);
    for (const m of deferredSorted.slice(0, topN)) {
      const scope = m.entry?.intentScope ?? '?';
      console.log(`  ${m.chars.toString().padStart(5)} chars · ${m.name}  [${scope}]`);
    }
  }
}

main();
