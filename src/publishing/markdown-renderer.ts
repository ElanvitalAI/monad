import { deflateSync } from 'node:zlib';

import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import {
  MAX_DESCRIPTION_CHARACTERS,
  MAX_RENDERED_HTML_UTF8_BYTES,
  MAX_TITLE_CHARACTERS,
  type PublishRequest,
} from './types.js';

export const ARTICLE_CSS_PATH = '/assets/article-v1.css';
export const DEFAULT_OG_IMAGE_PATH = '/assets/og-default-v1.png';

/**
 * "Work, in progress" 리소(risograph)·에디토리얼 네오브루탈리즘 디자인 시스템.
 * OpenAI work-in-progress.openai.chatgpt.site 를 CDP teardown 으로 추출 → 게시 렌더러에 이식.
 *   시그니처 = ①6색 무지개 마스트헤드 스트라이프 ②하드-오프셋 그림자(5px 6px 0) ③paper/ink 팔레트
 *   ④Geist/Geist Mono 타이포(초타이트 letter-spacing) ⑤콜아웃·hr 을 6색 리소 팔레트로 매핑.
 * 폰트는 Google Fonts @import — graceful fallback(로드 실패 시 시스템 스택). mermaid CDN 선례와 동일 외부 CDN 정책.
 * CSS 변수명(--bg/--fg/--muted/--border/--code-bg/--quote/--link/--stripe/--hr)은 하위호환 위해 보존.
 * teardown 방법론·RFC 계보 = 내부 문서 `HOWTO-web-teardown-and-riso-design-system-2026-07-23`.
 */
export const ARTICLE_CSS = `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap');
:root{color-scheme:light dark;--paper:#f1eee8;--card:#fbfaf7;--ink:#171915;--fg:#171915;--bg:#f1eee8;--muted:#66675f;--line:#23251f;--border:#23251f;--hr:#23251f;--code-bg:#efeae1;--stripe:#ece8df;--quote:#5194b7;--link:#2f6f8f;--red:#dc6a5c;--orange:#e98d58;--yellow:#e5bb52;--green:#77a75b;--blue:#5194b7;--violet:#8875ab;--shadow:5px 6px 0 #1e201b;--shadow-sm:3px 3px 0 var(--line)}
@media(prefers-color-scheme:dark){:root{--paper:#1a1815;--card:#211f1a;--ink:#ece7db;--fg:#ece7db;--bg:#1a1815;--muted:#a39f92;--line:#4a463c;--border:#4a463c;--hr:#4a463c;--code-bg:#26231d;--stripe:#221f19;--quote:#6fa8c8;--link:#7cc0e0;--red:#e8897d;--orange:#efa878;--yellow:#e8c86e;--green:#93bd78;--blue:#6fa8c8;--violet:#a291c2;--shadow:5px 6px 0 #000;--shadow-sm:3px 3px 0 #000}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'Geist','OpenAI Sans',-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Apple SD Gothic Neo",sans-serif;line-height:1.7;font-size:16px;-webkit-text-size-adjust:100%}
.article-shell{max-width:1200px;margin:44px auto;padding:0 20px}
article{position:relative;background:var(--card);border:1.5px solid var(--line);border-radius:4px;box-shadow:var(--shadow);padding:52px 48px 44px;overflow:hidden}
article::before{content:"";position:absolute;inset:0 0 auto;height:7px;background:linear-gradient(90deg,var(--green) 0 16.67%,var(--yellow) 16.67% 33.34%,var(--orange) 33.34% 50%,var(--red) 50% 66.67%,var(--violet) 66.67% 83.34%,var(--blue) 83.34% 100%)}
article>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:1.6em 0 .6em;font-weight:700;line-height:1.25;letter-spacing:-.02em;color:var(--ink);text-wrap:balance}
h1{font-size:2.2em;font-weight:800;letter-spacing:-.045em;line-height:1.06;padding-bottom:.28em;border-bottom:2.5px solid var(--line)}
h2{font-size:1.55em;font-weight:750;letter-spacing:-.03em;padding-bottom:.24em;border-bottom:1.5px solid var(--line)}
h3{font-size:1.28em}h4{font-size:1.05em}h5{font-size:.92em}
h6{font-size:.8em;color:var(--muted);font-family:'Geist Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em}
p{margin:0 0 1.15em}
a{color:var(--link);text-decoration:none;border-bottom:1.5px solid color-mix(in srgb,var(--link) 35%,transparent);transition:border-color .14s,background .14s}
a:hover{border-bottom-color:var(--link);background:color-mix(in srgb,var(--link) 10%,transparent)}
ul,ol{margin:0 0 1.15em;padding-left:1.5em}li{margin:.3em 0}li>ul,li>ol{margin:.3em 0}
blockquote{margin:0 0 1.3em;padding:.7em 1.1em;border:1.5px solid var(--line);border-left:5px solid var(--blue);border-radius:2px;background:var(--paper);color:var(--muted);box-shadow:var(--shadow-sm)}
blockquote>*:first-child{margin-top:0}blockquote>*:last-child{margin-bottom:0}
code{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;background:var(--code-bg);padding:.15em .4em;border-radius:3px;border:1px solid color-mix(in srgb,var(--line) 22%,transparent)}
pre{overflow:auto;padding:16px 18px;background:var(--code-bg);border:1.5px solid var(--line);border-radius:3px;box-shadow:var(--shadow-sm);margin:0 0 1.3em;line-height:1.55}
pre code{background:none;padding:0;border:0;font-size:.85em}
table{border-collapse:collapse;margin:0 0 1.3em;display:block;overflow:auto;max-width:100%;border:1.5px solid var(--line);border-radius:2px}
th,td{border:1px solid var(--line);padding:8px 13px}
th{font-weight:700;font-family:'Geist',sans-serif;background:color-mix(in srgb,var(--yellow) 22%,var(--card))}
tr:nth-child(2n) td{background:var(--stripe)}
img{max-width:100%;height:auto;border:1.5px solid var(--line);border-radius:3px}
hr{border:0;height:5px;margin:2.4em 0;border-radius:2px;background:linear-gradient(90deg,var(--green) 0 16.67%,var(--yellow) 16.67% 33.34%,var(--orange) 33.34% 50%,var(--red) 50% 66.67%,var(--violet) 66.67% 83.34%,var(--blue) 83.34% 100%)}
input[type=checkbox]{margin-right:.4em}
.mermaid{margin:0 0 1.3em;text-align:center;background:var(--card);border:1.5px solid var(--line);border-radius:3px;padding:16px;box-shadow:var(--shadow-sm)}
.mermaid:not([data-processed]){color:transparent;min-height:1em;border-color:transparent;box-shadow:none;background:none}
blockquote.callout{border:1.5px solid var(--line);border-left-width:5px;border-radius:2px;padding:.7em 1.1em;background:var(--paper);color:var(--ink);box-shadow:var(--shadow-sm)}
.callout>.callout-title{font-weight:700;margin:0 0 .3em;font-family:'Geist',sans-serif;letter-spacing:-.01em}
.callout-note,.callout-info{border-left-color:var(--blue)}
.callout-warning,.callout-caution,.callout-danger,.callout-error{border-left-color:var(--red)}
.callout-tip,.callout-success,.callout-done{border-left-color:var(--green)}
.callout-quote,.callout-abstract,.callout-example{border-left-color:var(--violet)}
@media(max-width:640px){.article-shell{margin:18px auto}article{padding:34px 22px 28px}h1{font-size:1.85em}h2{font-size:1.4em}}`;

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** A valid opaque 1200 x 630 PNG, used for every document's default OG image. */
function createDefaultOgImage(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1200, 0);
  header.writeUInt32BE(630, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((1200 * 3 + 1) * 630, 255);
  for (let row = 0; row < 630; row++) pixels[row * 3601] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

export const DEFAULT_OG_IMAGE_PNG = createDefaultOgImage();

export interface RenderMarkdownOptions {
  readonly markdown: string;
  readonly canonicalUrl: string;
  readonly title?: string;
  readonly description?: string;
  readonly lang?: string;
}

export interface RenderedMarkdownDocument {
  readonly html: string;
  readonly title: string;
  readonly description: string;
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'input', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th',
    'thead', 'tr', 'ul',
  ],
  attributes: {
    a: ['href', 'title'],
    code: ['className'],
    div: ['className'],
    input: ['checked', 'disabled', 'type'],
    li: ['className'],
    ol: ['start'],
    span: ['className'],
    table: ['className'],
    th: ['align'],
    td: ['align'],
    ul: ['className'],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
};

function normalize(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

function plainText(markdown: string): string {
  return normalize(
    markdown
      .replace(/```[\s\S]*?```/g, '')
      .replace(/!?(?:\[[^\]]*\]\([^)]*\))/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/^[\s>#*+-]+/gm, '')
      .replace(/[`*_~]/g, ''),
  );
}

function derivedTitle(markdown: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)$/m)?.[1];
  return truncate(normalize(heading ?? 'Untitled summary'), MAX_TITLE_CHARACTERS) || 'Untitled summary';
}

function derivedDescription(markdown: string): string {
  const paragraph = markdown.split(/\n\s*\n/).find((part) => normalize(part).length > 0) ?? '';
  return truncate(plainText(paragraph), MAX_DESCRIPTION_CHARACTERS);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Obsidian 콜아웃(> [!type] title) 을 시각적 callout 블록으로 변환 — sanitize 후 문자열 후처리
 *  (blockquote className 은 sanitize 스키마 밖이라 sanitize 뒤 부여). 타입은 CSS 색으로 구분. */
function applyCallouts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!(\w+)\]\s*([^<]*?)<\/p>/gi,
    (_m, type: string, title: string) => {
      const t = type.toLowerCase().replace(/[^a-z]/g, '');
      const label = title.trim() || (t.charAt(0).toUpperCase() + t.slice(1));
      return `<blockquote class="callout callout-${t}"><p class="callout-title">${label}</p>`;
    },
  );
}

/** Obsidian/YAML frontmatter(문서 최상단 --- ... ---) 를 제거 — 게시 HTML 에 메타 블록이
 *  본문으로 노출되지 않게. 문서가 --- 로 시작할 때만 첫 블록을 잘라낸다. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
}

/** Renders GFM Markdown through unified into a static, script-free HTML document. */
export function renderMarkdownDocument(options: RenderMarkdownOptions): RenderedMarkdownDocument {
  const canonicalUrl = new URL(options.canonicalUrl);
  if (canonicalUrl.protocol !== 'https:') throw new TypeError('canonical URL must use HTTPS');
  const markdown = stripFrontmatter(options.markdown);   // ★ Obsidian YAML frontmatter 제거(본문 노출 방지)
  const title = truncate(normalize(options.title ?? derivedTitle(markdown)), MAX_TITLE_CHARACTERS) || 'Untitled summary';
  const description = truncate(normalize(options.description ?? derivedDescription(markdown)), MAX_DESCRIPTION_CHARACTERS);
  const lang = normalize(options.lang ?? 'ko') || 'ko';
  let body = String(unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).processSync(markdown))
    .replace(/<a href="([^"]+)"/g, '<a href="$1" rel="nofollow noopener noreferrer"');
  body = applyCallouts(body);   // ★ Obsidian 콜아웃 (PWA 차용·dep 0 자체 후처리)
  // ★ mermaid 클라이언트 렌더 — ```mermaid 코드블록을 mermaid.js 가 인식하는 pre.mermaid 로 변환한다.
  //   본문 sanitize 후 치환(pre.mermaid 는 스키마 밖)·mermaid.js(신뢰 CDN·securityLevel strict)는
  //   body 끝 script 로 주입한다(본문 XSS sanitize 는 그대로 유지·게시 시간 0 영향=브라우저가 렌더).
  const hasMermaid = body.includes('<code class="language-mermaid">');
  if (hasMermaid) body = body.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>');
  const mermaidScript = hasMermaid
    ? '<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true,securityLevel:"strict",fontFamily:"\'Geist\',-apple-system,BlinkMacSystemFont,\'Noto Sans KR\',\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif",quadrantChart:{chartWidth:900,chartHeight:600,quadrantLabelFontSize:15,xAxisLabelFontSize:15,yAxisLabelFontSize:15}});</script>'
    : '';
  const canonical = canonicalUrl.toString();
  // CSS 는 인라인(<style>) — 게시물이 S3 에 index.html 만 올라가 외부 CSS(/assets/…)가 404 나던 근본 해소.
  const html = `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta name="twitter:card" content="summary"><link rel="canonical" href="${escapeHtml(canonical)}"><style>${ARTICLE_CSS}</style></head><body><main class="article-shell"><article>${body}</article></main>${mermaidScript}</body></html>`;
  if (Buffer.byteLength(html, 'utf8') > MAX_RENDERED_HTML_UTF8_BYTES) throw new RangeError('rendered HTML exceeds maximum size');
  return { html, title, description };
}

/** Creates a renderer wired to the publisher's immutable canonical document URL. */
export function createMarkdownRenderer(canonicalUrl: string): (request: PublishRequest) => string {
  return (request) => renderMarkdownDocument({ ...request, canonicalUrl }).html;
}
