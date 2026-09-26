#!/usr/bin/env bun
// M8 (2026-04-28) — ACP capability matrix auto-generator.
//
// Reads the static `*_CAPS` snapshots exported by each elanous-owned ACP
// backend and emits a markdown table into `내부 문서 `ACP-INTEGRATION``
// between marker comments. The generated section gets replaced on
// every run; everything outside the markers is preserved verbatim.
//
// Sprint 5B (2026-04-28) removed the codex-native column alongside
// the source files + dep packages. codex-app-server is the lone
// elanous-owned backend.
//
// CI mode (`--check`): exits 1 if the on-disk doc differs from the
// freshly generated content. Without `--check`, the script writes the
// updated doc back.
//
// Manual run:
//   bun run scripts/gen-acp-capability-matrix.ts
//   bun run scripts/gen-acp-capability-matrix.ts --check
//
// Marker syntax in the doc:
//   <!-- generated:cap-matrix-start -->
//   ... auto-generated table ...
//   <!-- generated:cap-matrix-end -->

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElanousCapabilities } from '../src/acp/capabilities.js';
import { CODEX_APP_SERVER_CAPS } from '../src/acp/codex-app-server-agent.js';

// ─── Pure helpers (testable) ─────────────────────────────────────────

export const CAP_MATRIX_MARKER_START = '<!-- generated:cap-matrix-start -->';
export const CAP_MATRIX_MARKER_END = '<!-- generated:cap-matrix-end -->';

/** Format a per-backend ElanousCapabilities snapshot map into a markdown
 *  table. The leading column lists capability flags; one column per
 *  backend. Boolean values render as ✅ / ❌; numeric (e.g. protocol
 *  version) as the number. Stable column order so re-runs produce
 *  identical output. */
export function formatCapabilityMatrix(
  snapshots: ReadonlyArray<readonly [backendId: string, caps: ElanousCapabilities]>,
): string {
  const backends = snapshots.map(([id]) => id);
  const yn = (v: boolean): string => (v ? '✅' : '❌');
  const rows: Array<{ label: string; values: string[] }> = [
    {
      label: '`protocolVersion`',
      values: snapshots.map(([, c]) => String(c.protocolVersion)),
    },
    { label: '`prompt.text`', values: snapshots.map(([, c]) => yn(c.prompt.text)) },
    {
      label: '`prompt.resourceLink`',
      values: snapshots.map(([, c]) => yn(c.prompt.resourceLink)),
    },
    { label: '`prompt.image`', values: snapshots.map(([, c]) => yn(c.prompt.image)) },
    { label: '`prompt.audio`', values: snapshots.map(([, c]) => yn(c.prompt.audio)) },
    {
      label: '`prompt.embeddedContext`',
      values: snapshots.map(([, c]) => yn(c.prompt.embeddedContext)),
    },
    { label: '`loadSession`', values: snapshots.map(([, c]) => yn(c.loadSession)) },
    {
      label: '`fileOps.readTextFile`',
      values: snapshots.map(([, c]) => yn(c.fileOps.readTextFile)),
    },
    {
      label: '`fileOps.writeTextFile`',
      values: snapshots.map(([, c]) => yn(c.fileOps.writeTextFile)),
    },
    { label: '`planMode`', values: snapshots.map(([, c]) => yn(c.planMode)) },
    { label: '`ui.showModal`', values: snapshots.map(([, c]) => yn(c.ui.showModal)) },
    { label: '`ui.showToast`', values: snapshots.map(([, c]) => yn(c.ui.showToast)) },
    {
      label: '`ui.updateStatusPill`',
      values: snapshots.map(([, c]) => yn(c.ui.updateStatusPill)),
    },
    { label: '`ui.usage`', values: snapshots.map(([, c]) => yn(c.ui.usage)) },
  ];

  const headerRow = `| capability | ${backends.join(' | ')} |`;
  const sepRow = `|---|${backends.map(() => '---').join('|')}|`;
  const dataRows = rows.map(
    (r) => `| ${r.label} | ${r.values.join(' | ')} |`,
  );
  return [headerRow, sepRow, ...dataRows].join('\n');
}

interface ExtractedSection {
  before: string;
  generated: string;
  after: string;
}

/** Find the marker-delimited section. Returns:
 *   - { before, generated, after } when both markers found (generated
 *     excludes the marker lines themselves)
 *   - null when either marker missing
 */
export function extractCapMatrixSection(doc: string): ExtractedSection | null {
  const startIdx = doc.indexOf(CAP_MATRIX_MARKER_START);
  if (startIdx === -1) return null;
  const endIdx = doc.indexOf(CAP_MATRIX_MARKER_END, startIdx + CAP_MATRIX_MARKER_START.length);
  if (endIdx === -1) return null;
  const before = doc.slice(0, startIdx + CAP_MATRIX_MARKER_START.length);
  const after = doc.slice(endIdx);
  const generated = doc.slice(startIdx + CAP_MATRIX_MARKER_START.length, endIdx);
  return { before, generated, after };
}

/** Replace the auto-generated section with `nextGenerated`. Surrounding
 *  marker comments are preserved + a single `\n` is added either side
 *  so the table renders cleanly across markdown engines. Returns null
 *  when the source doc is missing markers (caller should fail with a
 *  clear error rather than silently insert). */
export function replaceCapMatrixSection(
  doc: string,
  nextGenerated: string,
): string | null {
  const section = extractCapMatrixSection(doc);
  if (!section) return null;
  // Trim trailing newlines on input then sandwich with single \n.
  const body = nextGenerated.replace(/\n+$/, '');
  return `${section.before}\n${body}\n${section.after}`;
}

// ─── Production driver ──────────────────────────────────────────────

interface RunOpts {
  readonly check: boolean;
  readonly docPath: string;
}

export function runMain(opts: RunOpts): number {
  const snapshots: Array<readonly [string, ElanousCapabilities]> = [
    ['codex-app-server', CODEX_APP_SERVER_CAPS],
  ];
  const generated = formatCapabilityMatrix(snapshots);
  const doc = readFileSync(opts.docPath, 'utf8');
  const next = replaceCapMatrixSection(doc, generated);
  if (next === null) {
    console.error(
      `❌ Markers missing in ${opts.docPath}. Add:\n  ${CAP_MATRIX_MARKER_START}\n  ${CAP_MATRIX_MARKER_END}`,
    );
    return 2;
  }
  if (next === doc) {
    console.log('✅ capability matrix already in sync');
    return 0;
  }
  if (opts.check) {
    console.error('❌ capability matrix out of date — run without --check to update');
    // Print a first-glance hint of what would change.
    const oldSection = extractCapMatrixSection(doc);
    if (oldSection) {
      console.error('--- existing (excerpt) ---');
      console.error(oldSection.generated.split('\n').slice(0, 6).join('\n'));
      console.error('--- generated (excerpt) ---');
      console.error(generated.split('\n').slice(0, 6).join('\n'));
    }
    return 1;
  }
  writeFileSync(opts.docPath, next, 'utf8');
  console.log(`✅ wrote updated capability matrix to ${opts.docPath}`);
  return 0;
}

const isDirectInvoke =
  (import.meta as { main?: boolean }).main === true ||
  process.argv[1]?.endsWith('gen-acp-capability-matrix.ts');

if (isDirectInvoke) {
  const check = process.argv.slice(2).includes('--check');
  const docPath = join(process.cwd(), 'docs', 'ACP-INTEGRATION.md');
  process.exit(runMain({ check, docPath }));
}
