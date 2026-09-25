// ── Preview router — MIME / extension → handler name ──
//
// Mirrors yazi's [plugin].previewers table (yazi-default.toml). A
// handler name maps to a module under ./handlers/<name>.ts. Phase A
// only wires text/image/fallback; later phases add pdf/svg/video/
// archive/folder without touching anything else here.
//
// Matching order:
//   1. folder (trailing slash / isDirectory)
//   2. specific extension whitelist (structured text, code, json)
//   3. image extensions
//   4. future: mime globs from table (pdf/video/etc.)
//   5. fallback

import { extname } from 'node:path';

export type HandlerName =
  | 'text'
  | 'image'
  | 'pdf'
  | 'svg'
  | 'video'
  | 'font'
  | 'archive'
  | 'folder'
  | 'fallback';

interface RoutingInput {
  absPath: string;
  isDirectory: boolean;
}

const TEXT_EXTS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml',
  '.env', '.sh', '.zsh', '.bash', '.fish',
  '.css', '.scss', '.less', '.html', '.xml', '.py', '.rb',
  '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp',
  '.sql', '.graphql', '.cfg', '.ini', '.conf', '.properties',
  '.lua', '.vim', '.nix',
]);

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.ico',
]);

// Handlers wired in later phases — kept here so the table is the
// single source of truth. Router returns the name; index.ts decides
// whether the handler module exists and falls back otherwise.
const PDF_EXTS = new Set(['.pdf']);
const SVG_EXTS = new Set(['.svg']);
const MAGICK_EXTS = new Set(['.avif', '.heic', '.heif', '.jxl']);
const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.wmv', '.flv',
]);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const ARCHIVE_EXTS = new Set([
  '.zip', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz', '.txz',
  '.zst', '.rar', '.lzma', '.cpio', '.arj', '.xar',
]);

const SPECIAL_BASENAMES = new Set([
  'Makefile', 'Dockerfile', 'SKILL.md', 'AGENTS.md', 'CLAUDE.md',
  'README', 'LICENSE', 'CHANGELOG',
]);

export function routeFile({ absPath, isDirectory }: RoutingInput): HandlerName {
  if (isDirectory) return 'folder';
  const ext = extname(absPath).toLowerCase();
  const base = absPath.slice(absPath.lastIndexOf('/') + 1);

  if (TEXT_EXTS.has(ext)) return 'text';
  if (SPECIAL_BASENAMES.has(base) || base.startsWith('.env')) return 'text';

  if (IMAGE_EXTS.has(ext) || MAGICK_EXTS.has(ext)) return 'image';
  if (SVG_EXTS.has(ext)) return 'svg';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (FONT_EXTS.has(ext)) return 'font';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';

  return 'fallback';
}

export const _internal = {
  TEXT_EXTS,
  IMAGE_EXTS,
  PDF_EXTS,
  SVG_EXTS,
  MAGICK_EXTS,
  VIDEO_EXTS,
  FONT_EXTS,
  ARCHIVE_EXTS,
  SPECIAL_BASENAMES,
};
