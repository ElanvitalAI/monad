// Persona description write helper — surgical edit for /v1/personas PATCH.
//
// PR #3022 (Phase 3 of `/setup` wizard cascade · 2026-05-19) — PWA
// PersonaCard 의 description textarea 가 호출하는 backend. yaml file 의
// 다른 field 는 보존 (loader 가 알지 못하는 사용자 custom key 까지)하고
// 오직 `description:` 값만 갱신.
//
// Why not yaml.parse → object mutate → yaml.stringify?
//   loader.ts 가 알고 있는 field 들만 통과 — 사용자 yaml 의 comment ·
//   key ordering · custom key 가 손실됨. comment 보존을 위해 string
//   surgical edit 사용.
//
// Strategy:
//   1. yaml file read · `description:` line 찾음
//   2. 발견 시: 그 라인 교체
//   3. 미발견 시: personaId 라인 다음에 description 라인 삽입
//   4. write back atomically (tmp + rename)

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface UpdatePersonaDescriptionResult {
  ok: boolean;
  reason?:
    | 'file-not-found'
    | 'yaml-parse-error'
    | 'persona-id-mismatch'
    | 'description-too-long'
    | 'io-error';
  path?: string;
}

/** Max description length 280 chars — same cap as Hermes PR #27572's
 *  describer (compatible with potential future routing primitive land
 *  per [`RESEARCH-hermes-pr27572-triage-orchestrator-deferred-2026-05-19.md`](../../docs/research/)). */
export const MAX_PERSONA_DESCRIPTION_LENGTH = 280;

/** Resolve the yaml file path for a personaId (convention: `<dir>/<id>.yaml`). */
export function personaYamlPath(dir: string, personaId: string): string {
  return join(dir, `${personaId}.yaml`);
}

/** Surgical edit of `description:` line preserving comments / ordering /
 *  custom keys. Returns ok=true on success, structured failure otherwise.
 *
 *  - Strips surrounding whitespace + max 280 chars (Hermes parity).
 *  - Validates yaml still parses + retains `personaId: <id>` after edit.
 *  - Writes via tmp+rename for atomic replace.
 */
export function updatePersonaDescription(
  personasDir: string,
  personaId: string,
  description: string,
): UpdatePersonaDescriptionResult {
  const path = personaYamlPath(personasDir, personaId);
  if (!existsSync(path)) {
    return { ok: false, reason: 'file-not-found', path };
  }

  const trimmed = description.trim();
  if (trimmed.length > MAX_PERSONA_DESCRIPTION_LENGTH) {
    return { ok: false, reason: 'description-too-long', path };
  }

  let original: string;
  try {
    original = readFileSync(path, 'utf-8');
  } catch {
    return { ok: false, reason: 'io-error', path };
  }

  const edited = rewriteDescriptionLine(original, trimmed, personaId);

  // Validate the edited yaml still parses + the personaId is intact.
  try {
    const parsed = parseYaml(edited) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, reason: 'yaml-parse-error', path };
    }
    if (parsed['personaId'] !== personaId) {
      return { ok: false, reason: 'persona-id-mismatch', path };
    }
  } catch {
    return { ok: false, reason: 'yaml-parse-error', path };
  }

  // Atomic write: tmp + rename. Same-dir tmp 으로 cross-device rename
  // 회피.
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, edited, { encoding: 'utf-8', mode: 0o644 });
    renameSync(tmpPath, path);
  } catch {
    try { writeFileSync(path, edited, 'utf-8'); } catch { return { ok: false, reason: 'io-error', path }; }
  }

  return { ok: true, path };
}

const DESCRIPTION_LINE_RE = /^(\s*)description\s*:.*$/m;
const PERSONA_ID_LINE_RE = /^(\s*)personaId\s*:.*$/m;

/** Replace or insert the `description:` line. Quoting strategy:
 *  yaml-double-quoted with escapes for `\`, `"`, and control chars
 *  (LF / CR / TAB). Multiline descriptions get LF replaced with literal
 *  `\\n` — keeps the value on a single line and avoids YAML block
 *  scalar indentation pitfalls. */
function rewriteDescriptionLine(
  source: string,
  newDescription: string,
  personaId: string,
): string {
  const escaped = yamlDoubleQuote(newDescription);
  const replacement = `description: ${escaped}`;

  if (DESCRIPTION_LINE_RE.test(source)) {
    return source.replace(DESCRIPTION_LINE_RE, (_match, indent: string) => `${indent}${replacement}`);
  }

  // Insert immediately after the personaId line — keeps the two
  // identity fields together.
  if (PERSONA_ID_LINE_RE.test(source)) {
    return source.replace(PERSONA_ID_LINE_RE, (match, indent: string) => `${match}\n${indent}${replacement}`);
  }

  // No personaId line found — append a fresh personaId + description
  // block. yaml-validator step rejects the result if personaId 가 결국
  // 매치 안 함 → caller surfaces error cleanly.
  return `${source.replace(/\s*$/, '')}\npersonaId: ${personaId}\ndescription: ${escaped}\n`;
}

function yamlDoubleQuote(value: string): string {
  // yaml 1.2 double-quoted scalar: \\, \", \n, \r, \t escaped.
  let out = '"';
  for (const ch of value) {
    switch (ch) {
      case '\\': out += '\\\\'; break;
      case '"':  out += '\\"'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      default:   out += ch;
    }
  }
  out += '"';
  return out;
}
