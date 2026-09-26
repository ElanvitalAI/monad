// ── Reddit 레인 (미국장 커뮤니티) · 버즈 P2b · 2026-07-09 ─────────────────────
//
// PLAN §4a 레인 C. reddit 는 자동접근 강차단(직접 403·Firecrawl 정책상 미지원 확인).
// → 2경로: ① OAuth app-only(무료·구조화 ups/댓글/시각·velocity 가능·앱 등록 1회) 우선,
//   ② RSS 폴백(무자격·볼륨/긍부정/freshness 만·ups 없음·rate-limit 있어 10분 간격 권장).
// FmkoreaPost 구조 재사용(구조적 동일). forum='reddit'·category=subreddit.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FmkoreaPost } from './parse-fmkorea.js';
import { conatusPath } from '../conatus-data-dir.js';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export interface RedditCreds { clientId: string; clientSecret: string }

/** 자격 로드 — user-config(~/.elanous/config.json reddit) → env. 없으면 null(RSS 폴백). */
export function loadRedditCreds(): RedditCreds | null {
  const cfgPath = join(homedir(), '.elanous/config.json');
  if (existsSync(cfgPath)) {
    try {
      const c = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { reddit?: { clientId?: string; clientSecret?: string } };
      if (c.reddit?.clientId && c.reddit?.clientSecret) return { clientId: c.reddit.clientId, clientSecret: c.reddit.clientSecret };
    } catch { /* fall through */ }
  }
  const id = process.env.REDDIT_CLIENT_ID?.trim(), sec = process.env.REDDIT_CLIENT_SECRET?.trim();
  return id && sec ? { clientId: id, clientSecret: sec } : null;
}

const DECODE: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
function decodeEntities(s: string): string { return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, m => DECODE[m] ?? m); }
function field(block: string, re: RegExp): string { return decodeEntities((block.match(re)?.[1] ?? '').trim()); }

/** RSS(Atom) → 게시글. ups/댓글 없음(recommends 0·views null). AutoModerator 제외. */
export function parseRedditRss(xml: string, nowMs: number = Date.now()): FmkoreaPost[] {
  void nowMs;
  const out: FmkoreaPost[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const b = m[1]!;
    const author = field(b, /<name>(.*?)<\/name>/).replace(/^\/u\//, '');
    if (author === 'AutoModerator') continue; // 데일리/공지 스레드 제외
    const title = field(b, /<title>(.*?)<\/title>/);
    const idRaw = field(b, /<id>(.*?)<\/id>/);          // "t3_abc123"
    const postId = idRaw.replace(/^t3_/, '') || idRaw;
    const url = field(b, /<link\s+href="(.*?)"/);
    const published = field(b, /<published>(.*?)<\/published>/);
    const sub = field(b, /label="r\/(.*?)"/) || field(b, /term="(.*?)"/);
    if (!title || !postId) continue;
    out.push({
      postId, category: sub || 'reddit', title, author: author || '?', timeLabel: published,
      postedAt: published || null, views: null, recommends: 0, url: url || `https://www.reddit.com/comments/${postId}`,
    });
  }
  return out;
}

/** OAuth 리스팅 JSON → 게시글(구조화·ups=recommends·num_comments·created_utc). */
export function parseRedditListing(json: unknown, nowMs: number = Date.now()): FmkoreaPost[] {
  void nowMs;
  const children = (json as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data?.children ?? [];
  const out: FmkoreaPost[] = [];
  for (const c of children) {
    const p = c.data; if (!p) continue;
    if (p.stickied === true || p.author === 'AutoModerator') continue;
    const postId = String(p.id ?? '');
    if (!postId) continue;
    const created = typeof p.created_utc === 'number' ? new Date(p.created_utc * 1000).toISOString() : null;
    out.push({
      postId, category: String(p.subreddit ?? 'reddit'), title: String(p.title ?? ''), author: String(p.author ?? '?'),
      timeLabel: created ?? '', postedAt: created, views: null,
      recommends: typeof p.ups === 'number' ? p.ups : 0,
      comments: typeof p.num_comments === 'number' ? p.num_comments : 0,
      url: p.permalink ? `https://www.reddit.com${p.permalink}` : String(p.url ?? ''),
    });
  }
  return out;
}

/** OAuth app-only 토큰(client_credentials·읽기전용). */
async function redditToken(creds: RedditCreds): Promise<string> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'elanous-buzz/0.1' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`reddit token ${r.status}`);
  const j = await r.json() as { access_token?: string };
  if (!j.access_token) throw new Error('reddit token 없음');
  return j.access_token;
}

export interface FetchRedditOpts { limit?: number; creds?: RedditCreds | null; timeoutMs?: number }

/** 서브레딧 hot 게시글 — OAuth(자격) 우선, 없으면 RSS 폴백. 실패 시 [](fail-soft). */
export async function fetchRedditHot(sub: string, opts: FetchRedditOpts = {}): Promise<FmkoreaPost[]> {
  const creds = opts.creds !== undefined ? opts.creds : loadRedditCreds();
  const limit = opts.limit ?? 25;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    if (creds) {
      const token = await redditToken(creds);
      const r = await fetch(`https://oauth.reddit.com/r/${sub}/hot?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'elanous-buzz/0.1' }, signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`reddit oauth ${r.status}`);
      return parseRedditListing(await r.json());
    }
    // RSS 폴백
    const r = await fetch(`https://www.reddit.com/r/${sub}/hot/.rss?limit=${limit}`, {
      headers: { 'User-Agent': BROWSER_UA }, signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`reddit rss ${r.status}`);
    return parseRedditRss(await r.text());
  } catch { return []; }
  finally { clearTimeout(to); }
}

/** 워치리스트에서 활성 reddit CORE 서브 로드. */
export function loadRedditSubs(): string[] {
  const wl = conatusPath('buzz_watchlist.json');
  if (!existsSync(wl)) return [];
  try {
    const c = JSON.parse(readFileSync(wl, 'utf-8')) as { reddit?: { monitorTiers?: string[]; core?: Array<{ sub: string; enabled?: boolean }> } };
    const tiers = c.reddit?.monitorTiers ?? ['core'];
    if (!tiers.includes('core')) return [];
    return (c.reddit?.core ?? []).filter(s => s.enabled !== false).map(s => s.sub);
  } catch { return []; }
}
