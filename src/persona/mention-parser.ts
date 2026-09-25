// Persona mention parser — `@sage` resolution.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.2 (M2.3)
//
// Parses free text and extracts persona mentions, resolving each to
// a registered persona via the registry. Default match patterns:
//   - `@<personaId>` (case-insensitive · word boundary)
//   - any string in `persona.mentionPatterns`:
//       · `'foo,?'` — substring match (case-insensitive)
//       · `'/regex/flags'` — regex (slash-wrapped)
//
// Returns spans so callers can highlight in the IDX render or strip
// the mention before forwarding to the persona's LLM call.

import type { PersonaProfile } from './types.js';

export interface MentionMatch {
  /** Resolved persona. */
  readonly persona: PersonaProfile;
  /** The exact substring that triggered the match. */
  readonly raw: string;
  /** Character offsets into the input text. */
  readonly start: number;
  readonly end: number;
}

/** Subset of registry surface needed by the parser — keeps the
 *  module independent of the registry implementation. */
export interface PersonaSource {
  list(): PersonaProfile[];
  get(personaId: string): PersonaProfile | undefined;
}

/** Find all persona mentions in `text`. Matches are returned in
 *  source order. Overlapping matches are deduped — the longest match
 *  wins, ties resolved by registry list order. */
export function parseMentions(text: string, source: PersonaSource): MentionMatch[] {
  if (!text) return [];
  const personas = source.list();
  if (personas.length === 0) return [];

  const candidates: MentionMatch[] = [];
  for (const p of personas) {
    // Default pattern: @<personaId>
    const defaultPat = `@${escapeRegex(p.personaId)}\\b`;
    pushAll(candidates, p, text, makeRegex(`/${defaultPat}/gi`));
    // Custom patterns from yaml.
    if (p.mentionPatterns) {
      for (const pat of p.mentionPatterns) {
        const re = makePatternRegex(pat);
        if (re) pushAll(candidates, p, text, re);
      }
    }
  }
  return dedupeOverlaps(candidates);
}

/** Resolve a single mention string (without surrounding text) to a
 *  persona — convenience for slash-command argument parsing. Returns
 *  null on no match. */
export function resolveMention(raw: string, source: PersonaSource): PersonaProfile | null {
  if (!raw) return null;
  const cleaned = raw.startsWith('@') ? raw.slice(1) : raw;
  const direct = source.get(cleaned);
  if (direct) return direct;
  // Try patterns
  const matches = parseMentions(`@${cleaned}`, source);
  return matches[0]?.persona ?? null;
}

// ── internal ────────────────────────────────────────────────────

function pushAll(
  out: MentionMatch[],
  persona: PersonaProfile,
  text: string,
  regex: RegExp,
): void {
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    out.push({ persona, raw: m[0], start: m.index, end: m.index + m[0].length });
    // Avoid zero-length infinite loop.
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
}

/** Convert a mentionPatterns entry into a RegExp. Conventions:
 *    `/foo/gi`   — slash-wrapped: explicit regex with flags
 *    otherwise   — raw regex pattern, case-insensitive global
 *                  (e.g., `'sage,?'` = "sage" optionally followed by ",")
 *
 *  This matches openclaw v2026.4.29 차용 — yaml mentionPatterns 가
 *  regex 로 취급되어 사용자 친화적. literal `?` 를 의도하면 `\?` 로
 *  escape. Returns null if pattern is invalid. */
function makePatternRegex(pat: string): RegExp | null {
  const slashWrapped = /^\/(.+)\/([gimsuy]*)$/.exec(pat);
  if (slashWrapped) {
    try {
      const flags = ensureGlobal(slashWrapped[2]!);
      return new RegExp(slashWrapped[1]!, flags);
    } catch {
      return null;
    }
  }
  // Raw regex, case-insensitive global.
  try {
    return new RegExp(pat, 'gi');
  } catch {
    return null;
  }
}

function makeRegex(slashWrapped: string): RegExp {
  // already-validated slash form (we built it ourselves) — unwrap
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(slashWrapped)!;
  return new RegExp(m[1]!, ensureGlobal(m[2]!));
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drop fully-contained matches (longest wins). Sort by start for
 *  deterministic output. */
function dedupeOverlaps(matches: MentionMatch[]): MentionMatch[] {
  if (matches.length <= 1) return matches.slice();
  const sorted = [...matches].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: MentionMatch[] = [];
  for (const m of sorted) {
    // If a previous match fully covers this span (or vice versa), skip.
    let dominated = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i]!;
      if (prev.end <= m.start) break;  // disjoint, no need to look further back
      if (prev.start <= m.start && prev.end >= m.end) {
        dominated = true; break;
      }
      if (m.start <= prev.start && m.end >= prev.end) {
        // m strictly larger — replace prev
        out.splice(i, 1);
      }
    }
    if (!dominated) out.push(m);
  }
  return out.sort((a, b) => a.start - b.start);
}
