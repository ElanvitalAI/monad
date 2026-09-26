// ── Obsidian Vault REST 브릿지 (2026-07-09 · OP0) ─────────────────────────
//
// iPad Obsidian 기능을 PWA에 이식(PLAN-obsidian-pwa-port). ACP(elanous/obsidian/*)는
// WebSocket 전용이라 PWA read 작업엔 REST 가 깔끔 — 기존 obsidian 헬퍼를 얇게 노출.
// 로직 중복 0(resolveObsidianRoot + 헬퍼 재사용). dashboard.ts 패턴(CORS·jsonResponse).
//
//   GET  /v1/vault/info              vault 가용성·root·source
//   GET  /v1/vault/list?cwd=&limit=  폴더 목록(obsidian root·clamp)
//   GET  /v1/vault/read?path=        파일 읽기(text/bytes·mime)
//   GET  /v1/vault/search?q=&limit=  전문검색(ripgrep)
//   GET  /v1/vault/notes?query=      노트 목록(wikilink 자동완성)
//   GET  /v1/vault/backlinks?target= 역참조
//   GET  /v1/vault/tags              태그 집계
//   GET  /v1/vault/templates         템플릿 목록
//   GET  /v1/vault/poll-changes?sinceMs=  외부 변경 감지
//   GET  /v1/vault/orphans           고아 노트
//   GET  /v1/vault/graph?focus=&hops=&limit=  노트 그래프
//   POST /v1/vault/template-expand   {templatePath,title?} 토큰 전개

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveObsidianRoot, resolveFsRoot, clampToRoot, isHiddenForBrowser } from '../../acp/fs-roots.js';
import { detectMime } from '../../acp/fs-mime.js';
import { rgJsonMatchesAsync } from '../../tool-runtime/ripgrep-core.js';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
}

const READ_SECTIONS = ['info', 'list', 'read', 'search', 'notes', 'backlinks', 'tags', 'templates', 'poll-changes', 'orphans', 'graph'];

/** /v1/vault/:section GET 섹션(POST=template-expand 별도). */
export function parseVaultPath(pathname: string): string | null {
  const m = /^\/v1\/vault\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const seg = decodeURIComponent(m[1]!);
  return READ_SECTIONS.includes(seg) ? seg : null;
}

function num(v: string | null, def: number): number { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; }

/** ripgrep 전문검색 — 공유 ripgrep-core(rg --json·obsidian·acp 와 동일 프리미티브). */
async function ripgrepSearch(root: string, query: string, limit: number): Promise<{ matches: Array<{ path: string; snippet: string; lineNumber: number }>; error?: string }> {
  const res = await rgJsonMatchesAsync(query, {
    roots: [root], ignoreCase: true, lineNumber: true, perFileMaxCount: 3,
    typeAdd: ['md:*.md'], types: ['md'], relTo: root, snippetMax: 240, limit,
  });
  if (!res.ok) return { matches: [], error: `rg-exit-${res.code}: ${res.stderr.slice(0, 200)}` };
  return { matches: res.matches.map((m) => ({ path: m.path, snippet: m.text, lineNumber: m.line })) };
}

/** GET 디스패치 — parseVaultPath 로 매칭된 섹션. */
export async function handleVaultGet(req: Request, seg: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const ob = resolveObsidianRoot();

  if (seg === 'info') {
    return ob.available ? json({ available: true, root: ob.root, source: ob.source }) : json({ available: false, source: ob.source });
  }
  if (!ob.available) return json({ error: 'obsidian-vault-unavailable', available: false }, 200);

  try {
    switch (seg) {
      case 'list': {
        const base = resolveFsRoot('obsidian');
        const rawCwd = url.searchParams.get('cwd') || base;
        const cwd = clampToRoot(base, rawCwd);
        if (cwd == null) return json({ cwd: base, entries: [], error: 'cwd-escapes-root' });
        const dirents = await readdir(cwd, { withFileTypes: true });
        const entries = dirents
          .filter(e => !isHiddenForBrowser(e.name))
          .map(e => ({ name: e.name, isDir: e.isDirectory(), relPath: e.name }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
          .slice(0, 500);
        return json({ cwd, root: 'obsidian', base, entries });
      }
      case 'read': {
        const rel = url.searchParams.get('path');
        if (!rel) return json({ error: 'path-required' }, 400);
        const base = resolveFsRoot('obsidian');
        const abs = clampToRoot(base, join(base, rel));
        if (abs == null) return json({ error: 'path-escapes-root' }, 400);
        const maxBytes = num(url.searchParams.get('maxBytes'), 256 * 1024);
        const mime = detectMime(abs);
        const buf = await readFile(abs);
        const truncated = buf.length > maxBytes;
        const slice = truncated ? buf.subarray(0, maxBytes) : buf;
        if (mime.startsWith('text/') || mime === 'application/json' || abs.endsWith('.md')) {
          return json({ path: rel, mime, size: buf.length, truncated, content: slice.toString('utf8') });
        }
        return json({ path: rel, mime, size: buf.length, truncated, bytes: slice.toString('base64') });
      }
      case 'search': {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json({ matches: [], error: 'query-required' });
        return json(await ripgrepSearch(ob.root, q, num(url.searchParams.get('limit'), 50)));
      }
      case 'notes': {
        const { findNotes } = await import('../../acp/obsidian-notes.js');
        return json(await findNotes({ vaultRoot: ob.root, query: url.searchParams.get('query') || undefined, limit: num(url.searchParams.get('limit'), 500) }));
      }
      case 'backlinks': {
        const target = (url.searchParams.get('target') || '').trim();
        if (!target) return json({ matches: [], error: 'target-required' });
        const { findBacklinks } = await import('../../acp/obsidian-backlinks.js');
        return json(await findBacklinks({ vaultRoot: ob.root, target, limit: num(url.searchParams.get('limit'), 100) }));
      }
      case 'tags': {
        const { findTags } = await import('../../acp/obsidian-tags.js');
        return json(await findTags({ vaultRoot: ob.root }));
      }
      case 'templates': {
        const { findTemplates } = await import('../../acp/obsidian-templates.js');
        return json(await findTemplates({ vaultRoot: ob.root }));
      }
      case 'poll-changes': {
        const { pollVaultChanges } = await import('../../acp/obsidian-poll-changes.js');
        return json(await pollVaultChanges({ vaultRoot: ob.root, sinceMs: num(url.searchParams.get('sinceMs'), 0) }));
      }
      case 'orphans': {
        const { findOrphanNotes } = await import('../../acp/obsidian-cleanup-orphans.js');
        return json(await findOrphanNotes({ vaultRoot: ob.root }));
      }
      case 'graph': {
        const { buildVaultGraph } = await import('../../acp/obsidian-graph.js');
        const focus = url.searchParams.get('focus') || undefined;
        return json(await buildVaultGraph({ vaultRoot: ob.root, limit: num(url.searchParams.get('limit'), 500), ...(focus ? { focus, hops: num(url.searchParams.get('hops'), 1) } : {}) }));
      }
      default: return json({ error: 'unknown section' }, 404);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/** POST /v1/vault/template-expand — {templatePath, title?} 토큰 전개. */
export async function handleTemplateExpand(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const ob = resolveObsidianRoot();
  if (!ob.available) return json({ error: 'obsidian-vault-unavailable' }, 200);
  let body: { templatePath?: unknown; title?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json({ error: 'invalid JSON' }, 400); }
  const templatePath = typeof body.templatePath === 'string' ? body.templatePath : '';
  if (!templatePath) return json({ error: 'templatePath-required' }, 400);
  const { expandTemplate } = await import('../../acp/obsidian-template-expand.js');
  return json(await expandTemplate({ vaultRoot: ob.root, templatePath, ...(typeof body.title === 'string' ? { title: body.title } : {}) }));
}
