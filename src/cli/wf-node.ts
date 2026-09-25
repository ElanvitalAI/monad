// M4-5 (2026-05-12 · Phase 4 N5-5) — `monad wf node {list,spec,search}` CLI.
//
// Thin printer over `src/workflow-runtime/node-catalog.ts`. The
// catalog itself is the single source of truth (F6 default · ROADMAP
// §2 · 2026-05-12); this module is presentation only.

import {
  getNodeSpec,
  renderCatalogList,
  renderNodeSpec,
  searchNodes,
  type NodeCategory,
} from '../workflow-runtime/index.js';
import * as ui from '../ui.js';

const VALID_CATEGORIES: readonly NodeCategory[] = [
  'core', 'hitl', 'branch', 'iteration', 'transform', 'integration', 'trigger',
];

function parseCategory(value: string | undefined): NodeCategory | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase() as NodeCategory;
  if (VALID_CATEGORIES.includes(v)) return v;
  return undefined;
}

export function wfNodeList(opts: { category?: string } = {}): number {
  const category = parseCategory(opts.category);
  if (opts.category && !category) {
    ui.error(`unknown category '${opts.category}' — valid: ${VALID_CATEGORIES.join(', ')}`);
    return 1;
  }
  const out = renderCatalogList(category ? { category } : {});
  if (out.trim().length === 0) {
    ui.info(category ? `No nodes in category '${category}'.` : 'No nodes registered.');
    return 0;
  }
  console.log(out);
  return 0;
}

export function wfNodeSpec(kind: string): number {
  if (!kind || kind.trim().length === 0) {
    ui.error('spec: <kind> is required');
    return 1;
  }
  const spec = getNodeSpec(kind);
  if (!spec) {
    ui.error(`unknown node kind '${kind}'`);
    const suggestion = searchNodes(kind).slice(0, 3);
    if (suggestion.length > 0) {
      ui.info('Did you mean:');
      for (const r of suggestion) console.log(`  ${r.spec.kind}`);
    } else {
      ui.info('Run `monad wf node list` to see all kinds.');
    }
    return 1;
  }
  console.log(renderNodeSpec(spec));
  return 0;
}

export function wfNodeSearch(
  query: string,
  opts: { category?: string; limit?: number } = {},
): number {
  if (!query || query.trim().length === 0) {
    ui.error('search: <query> is required');
    return 1;
  }
  const category = parseCategory(opts.category);
  if (opts.category && !category) {
    ui.error(`unknown category '${opts.category}' — valid: ${VALID_CATEGORIES.join(', ')}`);
    return 1;
  }
  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const results = searchNodes(query, category ? { category } : {});
  if (results.length === 0) {
    ui.info(`No nodes match '${query}'${category ? ` in category '${category}'` : ''}.`);
    return 0;
  }
  ui.header(`Workflow nodes matching '${query}' (${Math.min(results.length, limit)} of ${results.length})`);
  console.log('');
  for (const r of results.slice(0, limit)) {
    const tag = `[${r.spec.category}]`.padEnd(14);
    console.log(`  ${tag} ${r.spec.kind.padEnd(20)} ${r.spec.summary}`);
  }
  return 0;
}
