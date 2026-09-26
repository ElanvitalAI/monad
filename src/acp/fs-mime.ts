// PLAN-ipad-server-side-file-browser §4.2 (F1·5) — extension-only mime
// detection table for elanous/fs/read + elanous/fs/stat. iOS client uses
// the returned mime to decide between markdown render (text/markdown),
// code mono (text/plain), image render (image/*), or binary placeholder.
// The table is intentionally extension-only — `file --mime-type` shell
// calls add per-read latency that the iPad split-view preview cannot
// afford; richer detection can land alongside F4 syntax highlighting.
//
// Boundary policy: when in doubt, prefer text/* over application/octet-
// stream. The iOS preview degrades gracefully on a binary read but
// silently drops content when a text file is misclassified as binary.

import { basename, extname } from 'node:path';

const EXT_MIME: Record<string, string> = {
  // Markdown / docs
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.rtf': 'text/plain',
  // Code (mapped to text/plain — iOS renders monospace; F4 syntax
  // highlight branches on extension separately)
  '.swift': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.js': 'text/plain',
  '.jsx': 'text/plain',
  '.mjs': 'text/plain',
  '.cjs': 'text/plain',
  '.py': 'text/plain',
  '.rb': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.c': 'text/plain',
  '.cc': 'text/plain',
  '.cpp': 'text/plain',
  '.h': 'text/plain',
  '.hpp': 'text/plain',
  '.m': 'text/plain',
  '.mm': 'text/plain',
  '.java': 'text/plain',
  '.kt': 'text/plain',
  '.kts': 'text/plain',
  '.sh': 'text/plain',
  '.bash': 'text/plain',
  '.zsh': 'text/plain',
  '.fish': 'text/plain',
  '.lua': 'text/plain',
  '.pl': 'text/plain',
  '.php': 'text/plain',
  '.scala': 'text/plain',
  '.clj': 'text/plain',
  '.ex': 'text/plain',
  '.exs': 'text/plain',
  '.erl': 'text/plain',
  '.hs': 'text/plain',
  '.ml': 'text/plain',
  '.vim': 'text/plain',
  '.sql': 'text/plain',
  '.r': 'text/plain',
  '.dart': 'text/plain',
  '.zig': 'text/plain',
  '.nim': 'text/plain',
  // Config / data (text-shaped)
  '.toml': 'text/plain',
  '.yml': 'text/plain',
  '.yaml': 'text/plain',
  '.ini': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',
  '.csv': 'text/plain',
  '.tsv': 'text/plain',
  '.log': 'text/plain',
  '.diff': 'text/plain',
  '.patch': 'text/plain',
  // Structured
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.json5': 'application/json',
  '.xml': 'text/xml',
  '.plist': 'text/xml',
  // Web
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/css',
  '.sass': 'text/css',
  '.less': 'text/css',
  // Image
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tiff': 'image/tiff',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  // Documents
  '.pdf': 'application/pdf',
  // A/V
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  // Archive (binary — iOS shows placeholder)
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.7z': 'application/x-7z-compressed',
};

// Files without an extension whose basename signals a text doc.
// Matched case-sensitively for the conventional names; case-insensitive
// for README / LICENSE since both spellings are widespread.
const NAME_MIME: Record<string, string> = {
  Dockerfile: 'text/plain',
  Makefile: 'text/plain',
  Rakefile: 'text/plain',
  Gemfile: 'text/plain',
  Procfile: 'text/plain',
  '.gitignore': 'text/plain',
  '.gitattributes': 'text/plain',
  '.dockerignore': 'text/plain',
  '.npmrc': 'text/plain',
  '.nvmrc': 'text/plain',
  '.editorconfig': 'text/plain',
  '.prettierrc': 'application/json',
  '.eslintrc': 'application/json',
};

const NAME_MIME_CI: Record<string, string> = {
  readme: 'text/markdown',
  license: 'text/plain',
  notice: 'text/plain',
  changelog: 'text/markdown',
  authors: 'text/plain',
  contributors: 'text/plain',
};

/** Map a file path to a mime string. Falls back to
 *  application/octet-stream when neither basename nor extension is
 *  recognised — the iOS preview renders a binary placeholder. */
export function detectMime(p: string): string {
  const base = basename(p);
  const named = NAME_MIME[base];
  if (named) return named;
  const namedCi = NAME_MIME_CI[base.toLowerCase()];
  if (namedCi) return namedCi;
  const ext = extname(p).toLowerCase();
  if (ext.length > 0 && EXT_MIME[ext]) return EXT_MIME[ext];
  return 'application/octet-stream';
}

/** True when `elanous/fs/read` should return `content` (utf8) instead of
 *  `bytes` (base64). Matches text/* + application/json + text-shaped
 *  XML envelopes. image/svg+xml stays binary so the iOS Image renderer
 *  decodes the bytes directly without a re-encode round-trip. */
export function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  return false;
}
