// ── Context / Attachment registry ──
//
// Paste-to-token attachment system (Claude Code pattern). The registry owns
// a map of id → Attachment. Tokens like `[Image #1]` appear inline in the
// user's input text; pruning sweeps registry entries whose token no longer
// appears in the active input.
//
// Attachments are stored lazily: metadata registered at paste time, actual
// bytes (base64 for images / extracted text for docs) loaded right before
// submit.

import { statSync, realpathSync } from 'fs';
import { basename, resolve } from 'path';
import { homedir } from 'os';

export type AttachmentKind = 'image' | 'text' | 'md' | 'pdf' | 'docx' | 'xlsx';

export interface Attachment {
  id: number;                    // 1-based, monotonic within session
  kind: AttachmentKind;
  token: string;                 // e.g. '[Image #1]', '[PDF #3]'
  sourcePath: string;            // absolute file path (or /tmp for pasted clipboard)
  filename: string;              // basename for display
  sizeBytes: number;             // original file size on disk
  mtime: number;                 // epoch ms; used with sourcePath for dedup

  // For images
  mediaType?: string;            // 'image/png', 'image/jpeg', ...
  base64?: string;               // resized base64 (filled lazily at submit)
  dimensions?: { w: number; h: number };

  // For text-like (txt/md/pdf/docx/xlsx extracted)
  text?: string;                 // lazy — empty until extracted
  extractedBytes?: number;       // post-extraction size (may differ from sizeBytes)

  // Lifecycle
  pastedAt: number;              // Date.now() at registration
  loaded: boolean;               // extract/resize done?
}

export interface ContextRegistry {
  attachments: Map<number, Attachment>;
  nextId: number;
}

/** Token label per kind. Matches PLAN §2.4 scheme: `[Image #3]`, `[PDF #7]`, …  */
const TOKEN_LABEL: Record<AttachmentKind, string> = {
  image: 'Image',
  text:  'Text',
  md:    'Md',
  pdf:   'PDF',
  docx:  'Docx',
  xlsx:  'Xlsx',
};

/** Default threshold for `/context clear big` — 100KB. */
export const DEFAULT_LARGE_THRESHOLD_BYTES = 100 * 1024;

export function formatToken(kind: AttachmentKind, id: number): string {
  return `[${TOKEN_LABEL[kind]} #${id}]`;
}

export function createContextRegistry(): ContextRegistry {
  return { attachments: new Map(), nextId: 1 };
}

/**
 * Register (or dedup) an attachment. Returns the Attachment — possibly an
 * existing one if `sourcePath` + `mtime` already match. Use
 * `addAttachmentEx` when the caller needs to know whether the attachment
 * was newly created or reused (e.g. to render a different log line).
 *
 * Caller provides everything except `id`, `token`, `pastedAt`, `loaded`.
 */
export function addAttachment(
  reg: ContextRegistry,
  seed: Omit<Attachment, 'id' | 'token' | 'pastedAt' | 'loaded'>,
): Attachment {
  return addAttachmentEx(reg, seed).attachment;
}

/** Like addAttachment but exposes whether the entry was freshly created
 *  (`isNew: true`) or reused from a prior registration (`isNew: false`).
 *  The tokenizer wires this through to TokenizeResult so the dashboard
 *  can show `(already attached)` for repeat picks. */
export function addAttachmentEx(
  reg: ContextRegistry,
  seed: Omit<Attachment, 'id' | 'token' | 'pastedAt' | 'loaded'>,
): { attachment: Attachment; isNew: boolean } {
  // Dedup: same path + same mtime → reuse existing entry.
  for (const existing of reg.attachments.values()) {
    if (existing.sourcePath === seed.sourcePath && existing.mtime === seed.mtime) {
      return { attachment: existing, isNew: false };
    }
  }

  const id = reg.nextId++;
  const attachment: Attachment = {
    ...seed,
    id,
    token: formatToken(seed.kind, id),
    pastedAt: Date.now(),
    loaded: false,
  };
  reg.attachments.set(id, attachment);
  return { attachment, isNew: true };
}

/**
 * Remove attachments whose token no longer appears in `inputText`.
 * Returns the count removed.
 *
 * Called right after input submit so that stale tokens (user deleted the
 * `[Image #1]` marker from the line) don't linger in the registry.
 */
export function pruneUnreferenced(reg: ContextRegistry, inputText: string): number {
  let removed = 0;
  for (const [id, att] of reg.attachments) {
    if (!inputText.includes(att.token)) {
      reg.attachments.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Drop everything. Returns removed count. */
export function clearAll(reg: ContextRegistry): number {
  const n = reg.attachments.size;
  reg.attachments.clear();
  return n;
}

/** Drop attachments whose `sizeBytes` exceeds `thresholdBytes`. */
export function clearLarge(
  reg: ContextRegistry,
  thresholdBytes: number = DEFAULT_LARGE_THRESHOLD_BYTES,
): number {
  let removed = 0;
  for (const [id, att] of reg.attachments) {
    if (att.sizeBytes > thresholdBytes) {
      reg.attachments.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Remove a single attachment by id. Returns true if it existed. */
export function dropAttachment(reg: ContextRegistry, id: number): boolean {
  return reg.attachments.delete(id);
}

export function getAttachment(reg: ContextRegistry, id: number): Attachment | undefined {
  return reg.attachments.get(id);
}

/** Sorted by id ascending. */
export function listAttachments(reg: ContextRegistry): Attachment[] {
  return [...reg.attachments.values()].sort((a, b) => a.id - b.id);
}

/** Sum of `sizeBytes` over all registered attachments. */
export function totalContextBytes(reg: ContextRegistry): number {
  let total = 0;
  for (const att of reg.attachments.values()) total += att.sizeBytes;
  return total;
}

// ── Tokenizer ─────────────────────────────────────────────

/** Extensions we recognise as attachable. Kind is chosen by extension. */
const EXT_TO_KIND: Record<string, AttachmentKind> = {
  png:  'image', jpg:  'image', jpeg: 'image', gif: 'image', webp: 'image',
  txt:  'text',
  md:   'md',
  pdf:  'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
};

const EXT_ALT = Object.keys(EXT_TO_KIND).join('|');

/**
 * Match either
 *   "path with spaces.ext"        double-quoted (any chars except ")
 *   'path with spaces.ext'        single-quoted (macOS Finder drag)
 *   ~/path/to/file.ext            home-relative
 *   ./sub/file.ext | ../x.ext     relative
 *   /abs/path.ext                 absolute
 *
 * Finder/Terminal wrap dragged files in single quotes when the name has
 * spaces or special chars, so single-quoted paths have to match too —
 * that's how a user's ` '~/Downloads/file with spaces.md' ` paste hits
 * the replace. Bare paths use a lookbehind so `https://…/foo.png` won't
 * collide — the match must start at input boundary or whitespace.
 */
const PATH_PATTERN = new RegExp(
  `"([^"]+\\.(?:${EXT_ALT}))"` +
  `|'([^']+\\.(?:${EXT_ALT}))'` +
  `|(?<=^|\\s)((?:~/|\\.{1,2}/|/)[^\\s"']+\\.(?:${EXT_ALT}))`,
  'gi',
);

/** Expand a leading `~`/`~/` to the home directory, else resolve to absolute.
 *  Exported as the single home-expansion helper (PLAN 1-D 단일화) — callers that
 *  wrote arbitrary paths (logs-timeline·rebind export·/export) reuse this. */
export function resolveHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return resolve(p);
}

/** A path the regex picked up but that failed to register. Surfaces to the
 *  dashboard so the user sees `⚠ path not found: /missing.pdf` instead of
 *  silently carrying the bare string into their prompt. */
export interface TokenizeWarning {
  raw: string;         // as the user typed it (pre-resolution)
  resolved: string;    // after ~/. expansion (pre-canonical)
  reason: 'not-found' | 'not-a-file';
}

export interface TokenizeResult {
  text: string;             // input with resolved paths replaced by tokens
  /** Every attachment the tokenizer touched this call — both fresh
   *  registrations (`isNew: true`) and dedup hits against an entry
   *  the registry already had (`isNew: false`). The dashboard renders
   *  these with different log lines so the user can tell when a pick
   *  collapsed onto an existing attachment. */
  added: { attachment: Attachment; isNew: boolean }[];
  warnings: TokenizeWarning[]; // paths that looked valid but didn't resolve
}

/**
 * Scan `input` for supported file-path tokens; for each one that resolves to
 * an existing file, register an Attachment and splice the canonical token
 * (`[PDF #3]`, …) back into the string.
 *
 * Non-existent paths and unknown extensions are left as-is. Registrations are
 * metadata-only — call `loadAllAttachments` from extractors.ts before submit
 * to materialize text / base64.
 */
export function tokenizeInput(
  input: string,
  reg: ContextRegistry,
): TokenizeResult {
  const added: { attachment: Attachment; isNew: boolean }[] = [];
  const warnings: TokenizeWarning[] = [];

  const out = input.replace(PATH_PATTERN, (match, dq?: string, sq?: string, bare?: string): string => {
    const raw = (dq ?? sq ?? bare) as string;
    const resolved = resolveHome(raw);

    // The regex already matched a supported extension, so a miss here is
    // almost certainly a typo or deleted file — worth surfacing to the user.
    let stat;
    try { stat = statSync(resolved); }
    catch { warnings.push({ raw, resolved, reason: 'not-found' }); return match; }
    if (!stat.isFile()) {
      warnings.push({ raw, resolved, reason: 'not-a-file' });
      return match;
    }

    // Canonicalize: two symlinks to the same file dedup to a single
    // attachment (sourcePath+mtime key matches). `realpathSync` throws on
    // missing path, but `statSync` above already succeeded so this is safe.
    // Fall back to the non-canonical path if realpath fails (rare — e.g.
    // permission on an intermediate dir).
    let canonical = resolved;
    try { canonical = realpathSync(resolved); } catch { /* keep resolved */ }

    const ext = canonical.split('.').pop()?.toLowerCase();
    const kind = ext ? EXT_TO_KIND[ext] : undefined;
    if (!kind) return match;

    const result = addAttachmentEx(reg, {
      kind,
      sourcePath: canonical,
      filename: basename(canonical),
      sizeBytes: stat.size,
      mtime: Math.floor(stat.mtimeMs),
    });
    added.push(result);
    return result.attachment.token;
  });

  return { text: out, added, warnings };
}
