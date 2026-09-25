/** Render crawl results to markdown */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env.js';
import { classifyDomain, stagingEnabled, stagingSubdir } from './domain-staging.js';
import type { CrawlResult } from './types.js';

function dateStamp(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('');
}

function safeName(text: string): string {
  return String(text || 'untitled').replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/[^0-9A-Za-z가-힣\s_-]/g, ' ').replace(/\s+/g, '_').trim().substring(0, 60);
}

export function renderMarkdown(results: CrawlResult[], query: string): string {
  const lines: string[] = [];
  lines.push(`# 🔍 ${query}`);
  lines.push(`> 검색일: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  for (const r of results) {
    lines.push(`## ${r.engine} (${r.totalItems}건)`);
    lines.push('');

    // Grok: raw text + annotations
    if (r.rawText) {
      lines.push(r.rawText);
      if (r.annotations?.length) {
        lines.push('\n### 출처');
        for (const url of r.annotations) lines.push(`- ${url}`);
      }
      lines.push('');
      continue;
    }

    // Apify / Firecrawl: item list
    if (r.items.length === 0) {
      lines.push('결과 없음\n');
      continue;
    }

    const top = r.items.slice(0, 20);
    for (let i = 0; i < top.length; i++) {
      const it = top[i];
      const likes = it.likes ? ` ❤️${it.likes}` : '';
      const date = it.date ? ` (${it.date})` : '';
      lines.push(`### ${i + 1}. ${it.author || ''}${likes}${date}`);
      if (it.url) lines.push(`> ${it.url}`);
      lines.push('');
      lines.push(it.text.substring(0, 500));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Sources 섹션 렌더 (deer-flow 인용 규율 이식) — deep 모드에서 인용 강제용.
 *
 * 모든 URL 보유 항목을 dedupe·번호매김하여 클릭 가능한 마크다운 링크로.
 * 하단 지시문으로 다운스트림(omni-digest/Claude)이 본문에 `[citation:Title](url)`
 * 인라인 인용을 달도록 유도. deer-flow lead_agent 의 "MANDATORY citations" 대응.
 */
export function renderSourcesSection(results: CrawlResult[]): string {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string; host: string }> = [];
  const collect = (url?: string, title?: string) => {
    if (!url) return;
    const key = url.replace(/[?#].*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    let host = ''; try { host = new URL(url).hostname; } catch {}
    sources.push({ title: (title || host || url).trim(), url, host });
  };
  for (const r of results) {
    for (const it of r.items) collect(it.url, it.metadata?.title);
    for (const url of r.annotations ?? []) collect(url);
  }
  if (!sources.length) return '';

  const lines: string[] = [];
  lines.push('\n## Sources');
  lines.push('> 아래 출처는 클릭 가능한 링크입니다. 본문 주장마다 `[citation:제목](URL)` 형식으로 인라인 인용하세요.');
  lines.push('');
  sources.forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.url})${s.host ? ` — ${s.host}` : ''}`));
  lines.push('');
  return lines.join('\n');
}

export async function saveMarkdown(markdown: string, query: string): Promise<string | null> {
  const root = env('OBSIDIAN_VAULT_ROOT');
  if (!root) return null;
  // 도메인 스테이징 라우팅 — query+본문을 domain 분류 → 00. Inbox/_staging/<domain>/ (토글 OBSIDIAN_STAGING_BY_DOMAIN)
  const domain = classifyDomain([query, markdown.slice(0, 1200)]);
  const sub = stagingEnabled() ? stagingSubdir(domain) : env('OMNI_CRAWL_SAVE_SUBDIR', '00. Inbox/05. Crawl');
  const dir = join(root, ...sub.split('/'));
  await mkdir(dir, { recursive: true });

  const base = `${dateStamp()}_${safeName(query)}.md`;
  let fp = join(dir, base); let seq = 1;
  while (existsSync(fp)) { fp = join(dir, `${dateStamp()}_${safeName(query)}_${seq}.md`); seq++; }

  const content = `---\ntitle: "${query.replace(/"/g, '\\"')}"\ncreated: ${new Date().toISOString().slice(0, 10)}\ncategory: "${domain}"\ntags:\n  - "OmniCrawl"\n  - "AI검색"\nsource_type: "crawl"\nai_generated: true\n---\n\n${markdown}`;
  await writeFile(fp, content, 'utf-8');
  return fp;
}
