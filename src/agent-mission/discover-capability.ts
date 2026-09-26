// ── L3 역량 발굴(discovery) seam (P4 · 2026-07-26) ────────────────────────────────────────
//
// 감독이 관측한 부족(gap)을 채울 **능력**(pkg/skill/MCP/subagent)을 web 에서 발굴한다. provision(설치)의
// 앞단 — "무엇을 깔지"를 자율 판단하는 조각. 현재 provision 은 자식이 이름을 댈 때만 반응하므로, 이 seam 이
// "정보가 아니라 능력"을 향한 발굴을 담당한다.
//
// ⭐ **단일 research seam (부채 가드 · PLAN §7-5)**: 웹 조회는 오직 `src/web-search` registry(`searchWeb`)
//    하나만 통과한다. omni-crawl 경로를 또 하드코딩하지 않는다(5번째 call-site 금지). registry 는 이미
//    config 선택 provider(tavily/grok/firecrawl)라, 미래의 pluggable search-provider 리팩터는 **이 seam 하나만**
//    교체하면 된다. 커뮤니티(X) 보강만 grok x_search 를 직접 쓴다(registry 미노출 능력·별도 DI seam).
//
// ⚠️ **스코프 = ① DISCOVER("무엇을") 단계만** (PLAN §7-5 2-페이즈 중 첫째). ② REFERENCE("어떻게" — Firecrawl 로
//    후보 도구의 docs/API 통째 스크랩 + FindRepo→SyncRepo→RefConsult repo clone+grep)는 **후속**이다. 여기서
//    firecrawl 은 registry 의 web-search fallback provider 로만 닿고, "docs 전량 스크랩" 전용 모드는 아직 미배선.
//    발굴 후보 → 설치 spec 환원(구조화 식별자·출처)도 그 브리지에서(현재는 사람/후속이 소비).
//
// 관측: elanous logs --category autopilot.provision (discover/discover-fail/discover-community).

import { searchWeb, type WebSearchResult } from '../web-search/index.js';
import { grokAgentSearch } from '../grok/agent-search.js';
import { debug } from '../debug/log.js';

/** 발굴된 후보(능력) — url·요약. 설치 spec 으로의 환원(브리지)은 후속(L3a 스코프 밖). */
export interface CapabilityCandidate {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly score?: number;
  /** 어느 소스에서 왔나(provider 명·'grok-x'). */
  readonly source: string;
}

export interface DiscoverOpts {
  /** 발굴 대상 계층 힌트('pkg'|'skill'|'mcp'|'subagent') — 질의 강화에 사용. */
  readonly layer?: string;
  /** 후보 상한(기본 8·최대 20). */
  readonly limit?: number;
  /** ⭐Grok X(x_search) 커뮤니티 보강 — 최신 툴/스킬 실무자 소스(대표 지목 열쇠). 기본 on. */
  readonly community?: boolean;
  readonly signal?: AbortSignal;
}

export interface DiscoverDeps {
  /** ① DISCOVER seam(테스트 주입) — 기본=registry searchWeb(config 선택 provider). */
  readonly search?: (query: string, limit: number, signal?: AbortSignal) => Promise<WebSearchResult>;
  /** ② 커뮤니티 seam(테스트 주입) — 기본=grok web_search+x_search(X 여론·최신툴). 텍스트 반환. */
  readonly communitySearch?: (query: string, signal?: AbortSignal) => Promise<string>;
}

/** 발굴 질의 강화 — "이 부족을 채우는 도구는 무엇인가"로 향하게(정보가 아니라 능력). */
export function buildDiscoveryQuery(gap: string, layer?: string): string {
  const kind = layer === 'skill' ? 'tool or agent skill'
    : layer === 'mcp' ? 'MCP server'
    : layer === 'pkg' ? 'library or package'
    : layer === 'subagent' ? 'specialized agent or persona'
    : 'tool, library, or MCP server';
  return `best ${kind} to solve this capability gap: ${gap}`.slice(0, 300);
}

async function defaultCommunitySearch(query: string, signal?: AbortSignal): Promise<string> {
  // grokAgentSearch 는 never-throw(키 없음/네트워크 = { ok:false, text:'' }). x_search 로 X 커뮤니티 포함.
  const r = await grokAgentSearch(query, { tools: ['web_search', 'x_search'], maxOutputTokens: 800, signal });
  return r.text ?? '';
}

/**
 * 역량 발굴 — 부족(gap)을 채울 후보 능력을 web(+X 커뮤니티)에서 찾는다. **never-throw**(발굴 실패는 미션
 * 킬러가 아님 · provision graceful 계약). 후보 리스트 반환(빈 배열 = 발굴 실패).
 */
export async function discoverCapability(
  gap: string,
  opts: DiscoverOpts = {},
  deps: DiscoverDeps = {},
): Promise<CapabilityCandidate[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 8, 20));
  const wantCommunity = opts.community !== false;
  // ★ 총 반환 개수 계약 = limit(≤20) 불변식(리뷰 must-fix). 커뮤니티(1개)를 더해도 초과하지 않도록 web 슬롯을
  //   1 예약한다 — 커뮤니티 후보(⭐최신툴 소스)는 web 후보보다 우선 보존 가치가 있어 drop 대신 슬롯 확보.
  const webLimit = wantCommunity ? Math.max(1, limit - 1) : limit;
  const query = buildDiscoveryQuery(gap, opts.layer);
  const out: CapabilityCandidate[] = [];

  // ① DISCOVER "무엇을" — registry(searchWeb) 단일 seam(부채 가드).
  const search = deps.search ?? ((q, lim, signal) => searchWeb({ query: q, limit: lim }, { signal }));
  try {
    const r = await search(query, webLimit, opts.signal);
    for (const h of r.hits.slice(0, webLimit)) {
      out.push({ url: h.url, title: h.title, snippet: h.snippet, score: h.score, source: r.providerName });
    }
    debug.log('autopilot.provision', 'discover', { gap: gap.slice(0, 120), layer: opts.layer, provider: r.providerName, hits: r.hits.length });
  } catch (e) {
    // 실패해도 계속(never-throw) — 커뮤니티 보강이라도 시도.
    debug.log('autopilot.provision', 'discover-fail', { gap: gap.slice(0, 120), reason: (e as Error).message }, { level: 'warn' });
  }

  // ② 커뮤니티 보강 — ⭐Grok X(x_search): 최신 툴·스킬 실무자 소스 보고(대표 지목 열쇠).
  if (wantCommunity) {
    const comm = deps.communitySearch ?? defaultCommunitySearch;
    try {
      const note = (await comm(query, opts.signal))?.trim();
      if (note) {
        out.push({ url: '', title: 'X / community (Grok x_search)', snippet: note.slice(0, 800), source: 'grok-x' });
        debug.log('autopilot.provision', 'discover-community', { chars: note.length });
      }
    } catch (e) {
      debug.log('autopilot.provision', 'discover-community-fail', { reason: (e as Error).message }, { level: 'warn' });
    }
  }

  return out;
}
