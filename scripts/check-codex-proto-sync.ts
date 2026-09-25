#!/usr/bin/env bun
// M9 (2026-04-28) — codex-app-server proto sync lint.
//
// Runs `codex app-server generate-ts --out <tmpdir>` and compares the
// JSON-RPC method surface against the methods monad references in
// `src/acp/codex-app-server-*.ts`. Surfaces:
//
//   ✅  proto in sync                 (no drift)
//   ⚠️  N codex methods not used      (informational — codex added new RPCs)
//   ❌  M monad methods missing       (CRITICAL — we reference a method
//                                       that doesn't exist in the current
//                                       codex spec; rename / removal)
//
// Exit codes:
//   0   sync OR informational drift only
//   1   monad-side method missing from codex spec (action required)
//   2   codex generate-ts failed (binary missing / permission / etc.)
//
// Manual run:
//
//   bun run scripts/check-codex-proto-sync.ts
//
// CI integration is intentionally out of scope (PR §3.3 / repo CI policy
// pending). The script writes its tmp output to a per-run subdir of
// `os.tmpdir()` and cleans up afterward.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_APPROVAL_DECISION_CONTRACT } from '../src/acp/codex-app-server-agent.js';

// ─── Pure helpers (testable) ─────────────────────────────────────────

/** Extract method literals from a `ClientRequest.ts` / `ClientNotification.ts`
 *  body. The discriminated union shapes look like:
 *
 *      { "method": "thread/start", id: RequestId, params: ... } |
 *      { "method": "fs/readFile", id: RequestId, params: ... }
 *
 *  We pull every `"method":"<value>"` literal regardless of surrounding
 *  whitespace. Non-string method values (e.g. an enum import) are
 *  skipped — pure regex match. */
export function extractMethodsFromGenerated(source: string): Set<string> {
  const out = new Set<string>();
  // The generator emits `"method": "<x>"` (with the surrounding double
  // quotes around `method`). We tolerate variable whitespace because
  // ts-rs tweaks formatting between releases.
  const re = /"method"\s*:\s*"([^"\\]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.add(match[1]!);
  }
  return out;
}

/** Extract method literals from monad's hand-written acp source. We
 *  scan for the 3 wire-touching call shapes:
 *
 *      client.request<...>('method/name', ...)
 *      client.notify<...>('method/name', ...)        // outbound
 *      client.onNotification('method/name', ...)     // inbound
 *      client.setServerRequestHandler('method/name', ...)
 *
 *  String literals containing `/` (the codex method-name shape) are
 *  the strict filter — anything else is project-internal noise (e.g.
 *  log category names like `acp.cas.thread-index.put`).
 *
 *  This is intentionally a conservative regex pass; it prefers under-
 *  reporting (false negative on a method we missed) over false
 *  positives that would noise up the lint output. */
export function extractMethodsFromHandWritten(source: string): Set<string> {
  const out = new Set<string>();
  const callPatterns: RegExp[] = [
    /\bclient\.request\b\s*<[^>]*>\s*\(\s*['"]([^'"]+)['"]/g,
    /\bclient\.request\b\s*\(\s*['"]([^'"]+)['"]/g,
    /\bclient\.notify\b\s*<[^>]*>\s*\(\s*['"]([^'"]+)['"]/g,
    /\bclient\.notify\b\s*\(\s*['"]([^'"]+)['"]/g,
    /\bclient\.onNotification\s*\(\s*['"]([^'"]+)['"]/g,
    /\bclient\.setServerRequestHandler\s*\(\s*['"]([^'"]+)['"]/g,
    // method-list constants like APPROVAL_METHODS · MCP_BRIDGE_METHODS
    // declare the same strings.
    /['"]((?:fs|turn|thread|mcpServer|item|account|model|review|config|skills|plugin|app|device|command|experimentalFeature|windowsSandbox|feedback|externalAgentConfig|configRequirements|getConversationSummary|gitDiffToRemote|getAuthStatus|fuzzyFileSearch|marketplace|monad)\/[A-Za-z0-9_/]+)['"]/g,
  ];
  for (const re of callPatterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const m = match[1]!;
      if (m.includes('/')) out.add(m);
    }
  }
  return out;
}

export interface MethodDiff {
  /** Methods monad uses that aren't in the codex spec — RENAME / REMOVAL alarm. */
  readonly monadOnly: string[];
  /** Methods in codex spec that monad doesn't use — informational. */
  readonly codexOnly: string[];
  /** Shared count for telemetry. */
  readonly shared: number;
}

export function computeMethodDiff(
  monad: ReadonlySet<string>,
  codex: ReadonlySet<string>,
): MethodDiff {
  const monadOnly: string[] = [];
  const codexOnly: string[] = [];
  let shared = 0;
  for (const m of monad) {
    if (codex.has(m)) shared++;
    else monadOnly.push(m);
  }
  for (const c of codex) {
    if (!monad.has(c)) codexOnly.push(c);
  }
  return {
    monadOnly: monadOnly.sort(),
    codexOnly: codexOnly.sort(),
    shared,
  };
}

// ─── Production driver (skipped in unit tests) ───────────────────────

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Extract the string-literal members of a generated TS union type.
 *
 *  codex `generate-ts` emits decision enums as a discriminated union, e.g.
 *    export type CommandExecutionApprovalDecision =
 *      | "accept"
 *      | "acceptForSession"
 *      | { "acceptWithExecpolicyAmendment": {...} }
 *      | "decline" | "cancel";
 *  We collect only the plain string-literal members (the ones monad emits
 *  as a bare `{decision:"..."}`); object variants carry data and aren't
 *  what the boolean approval path produces. Returns an empty set when the
 *  type isn't found (caller decides how to treat that). */
export function extractEnumMembersFromGenerated(source: string, typeName: string): Set<string> {
  const members = new Set<string>();
  // Grab everything from `type <name> =` up to the terminating `;`.
  const declRe = new RegExp(`type\\s+${typeName}\\s*=([\\s\\S]*?);`, 'm');
  const decl = declRe.exec(source);
  if (!decl) return members;
  const body = decl[1] ?? '';
  // Split on top-level `|` and keep only parts that are a BARE string
  // literal — an object variant like `{ "acceptWithExecpolicyAmendment":
  // {...} }` carries data (and its key trails a `:`), so it never matches
  // the pure-literal shape. Regex quote-pairing is unsafe here because a
  // skipped literal dangles its closing quote.
  for (const part of body.split('|')) {
    const m = /^\s*"([^"]+)"\s*$|^\s*'([^']+)'\s*$/.exec(part);
    if (m) members.add((m[1] ?? m[2])!);
  }
  return members;
}

/** Diff monad's emitted approval-decision values against codex's generated
 *  enum members. Returns, per contract entry, any emitted value that is NOT
 *  a valid member (⇒ drift) plus whether the enum type was found at all. */
export function computeDecisionDrift(
  contract: ReadonlyArray<{ method: string; enumType: string; emits: readonly string[] }>,
  readEnumSource: (enumType: string) => string | null,
): Array<{ method: string; enumType: string; missing: string[]; enumFound: boolean }> {
  const out: Array<{ method: string; enumType: string; missing: string[]; enumFound: boolean }> = [];
  for (const entry of contract) {
    const src = readEnumSource(entry.enumType);
    if (src === null) {
      out.push({ method: entry.method, enumType: entry.enumType, missing: [], enumFound: false });
      continue;
    }
    const members = extractEnumMembersFromGenerated(src, entry.enumType);
    const missing = entry.emits.filter((v) => !members.has(v));
    out.push({ method: entry.method, enumType: entry.enumType, missing, enumFound: true });
  }
  return out;
}

function runGenerateTs(outDir: string): RunResult {
  const result = spawnSync('codex', ['app-server', 'generate-ts', '--out', outDir], {
    encoding: 'utf8',
  });
  if (result.error) {
    return { exitCode: 2, stdout: `codex CLI not on PATH: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      exitCode: 2,
      stdout: `codex generate-ts exited ${result.status}: ${result.stderr}`,
    };
  }
  return { exitCode: 0, stdout: '' };
}

function readGeneratedMethodFile(outDir: string, fileName: string): string {
  // generate-ts emits ClientRequest.ts + ClientNotification.ts at the
  // OUTPUT ROOT (not under `v2/` — that's where the per-type Param/
  // Response files live). Be defensive: fall back to v2 if the layout
  // changes in a future codex release.
  for (const candidate of [join(outDir, fileName), join(outDir, 'v2', fileName)]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* fall through */
    }
  }
  throw new Error(`generated ${fileName} not found in ${outDir}`);
}

function readHandWrittenSources(): string {
  const acpDir = join(process.cwd(), 'src', 'acp');
  const out: string[] = [];
  for (const entry of readdirSync(acpDir)) {
    if (!entry.startsWith('codex-app-server-')) continue;
    if (!entry.endsWith('.ts')) continue;
    out.push(readFileSync(join(acpDir, entry), 'utf8'));
  }
  return out.join('\n\n');
}

export function main(): number {
  const tmp = mkdtempSync(join(tmpdir(), 'monad-codex-proto-sync-'));
  try {
    const run = runGenerateTs(tmp);
    if (run.exitCode !== 0) {
      console.error(`❌ ${run.stdout}`);
      return run.exitCode;
    }
    // Codex emits four discriminated unions covering both directions:
    //   ClientRequest      → method names CLIENT calls
    //   ClientNotification → notifications CLIENT sends
    //   ServerRequest      → server-initiated requests CLIENT must handle
    //   ServerNotification → notifications CLIENT subscribes to
    // Monad uses methods from all four (request/notify outbound +
    // setServerRequestHandler/onNotification inbound), so we union the
    // method names from every union before computing the diff.
    const codexMethods = new Set<string>();
    for (const fileName of [
      'ClientRequest.ts',
      'ClientNotification.ts',
      'ServerRequest.ts',
      'ServerNotification.ts',
    ]) {
      let src: string;
      try {
        src = readGeneratedMethodFile(tmp, fileName);
      } catch {
        // Tolerate one-of-four missing — older codex versions may not
        // emit ServerNotification yet. Surface it once for diagnostics.
        console.error(`note: skipping ${fileName} (not generated)`);
        continue;
      }
      for (const m of extractMethodsFromGenerated(src)) codexMethods.add(m);
    }

    const handWritten = readHandWrittenSources();
    const monadMethods = extractMethodsFromHandWritten(handWritten);

    const diff = computeMethodDiff(monadMethods, codexMethods);

    console.log(
      `monad references ${monadMethods.size} method(s) · codex spec exposes ${codexMethods.size}`,
    );
    console.log(`shared: ${diff.shared}`);

    // Approval-decision value drift — the check that would have caught the
    // approve/deny → accept/decline breakage (method names alone missed it).
    // For each contract entry, assert every value monad emits is a member of
    // codex's generated enum. Enum lives in a per-type file (v2/<Type>.ts).
    const drift = computeDecisionDrift(CODEX_APPROVAL_DECISION_CONTRACT, (enumType) => {
      try {
        return readGeneratedMethodFile(tmp, `${enumType}.ts`);
      } catch {
        return null;
      }
    });
    const broken = drift.filter((d) => d.enumFound && d.missing.length > 0);
    for (const d of drift.filter((x) => !x.enumFound)) {
      console.log(`note: decision enum ${d.enumType}.ts not generated — skipping value check`);
    }
    if (broken.length > 0) {
      console.error('❌ approval-decision value drift — monad emits values codex no longer accepts:');
      for (const d of broken) {
        console.error(`    - ${d.method} → ${d.enumType}: [${d.missing.join(', ')}] not in codex enum`);
      }
      console.error('   Fix `buildCodexApprovalResponse` + `CODEX_APPROVAL_DECISION_CONTRACT` in codex-app-server-agent.ts.');
      return 1;
    }
    console.log(`✅ approval-decision values in sync (${drift.filter((d) => d.enumFound).length} enum(s) checked)`);

    if (diff.monadOnly.length > 0) {
      console.error(
        `❌ ${diff.monadOnly.length} monad method(s) missing from codex spec — likely rename or removal:`,
      );
      for (const m of diff.monadOnly) console.error(`    - ${m}`);
      return 1;
    }
    if (diff.codexOnly.length > 0) {
      console.log(
        `⚠️  ${diff.codexOnly.length} codex method(s) not referenced by monad (informational):`,
      );
      for (const m of diff.codexOnly.slice(0, 20)) console.log(`    + ${m}`);
      if (diff.codexOnly.length > 20) {
        console.log(`    + ... ${diff.codexOnly.length - 20} more`);
      }
    } else {
      console.log('✅ proto in sync — every codex method referenced by monad');
    }
    return 0;
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
}

// Run main() when invoked directly (Bun + Node both honour
// `import.meta.main` / `require.main === module`). Avoid running on
// import so unit tests can drive the pure helpers without spawning a
// real codex process.
const isDirectInvoke =
  // Bun exposes `import.meta.main` for entrypoint detection.
  (import.meta as { main?: boolean }).main === true ||
  // Node-compatible fallback.
  process.argv[1]?.endsWith('check-codex-proto-sync.ts');

if (isDirectInvoke) {
  process.exit(main());
}
