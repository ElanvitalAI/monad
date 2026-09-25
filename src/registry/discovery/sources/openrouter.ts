// 대표 2026-09-23 — OpenRouter discovery source («파생» 카탈로그의 입력).
//
// 대표 결정: ① OpenRouter 하나로 시작 · ② `openrouter` provider 를 더한다 · ③ 카탈로그는 «파생»한다.
// ⇒ kimi · qwen · glm 을 손으로 적은 YAML 이 아니라 ***OpenRouter `/models` 의 1차 사실***에서 얻는다.
//
// 🔑 왜 이 소스가 다른 소스보다 «풍부»한가 — 다른 `/v1/models` 는 id 만 주는데, OpenRouter 는
//   가격 · 컨텍스트 · 최대 출력 · `supported_parameters`(tools · reasoning · reasoning_effort) ·
//   입력/출력 modality · 만료일까지 준다. ⇒ `ModelSpec` 의 거의 모든 칸을 «잰 값»으로 채운다.
// 📚 선례: `~/source/ref/openclaw/src/agents/embedded-agent-runner/openrouter-model-capabilities.ts`
//   가 같은 엔드포인트를 SQLite 에 캐시하고 능력을 «동적 판정»한다(TTL 없음 · 미발견 시 갱신).
//
// ⛔⭐ ***키 없이 된다***(공개 엔드포인트 · 2026-09-23 실측 454개). 키가 있으면 Bearer 로 붙이지만
//   ***없다고 실패하지 «않는다»*** — 다른 소스(`missing-api-key`)와 다른 점이다.
//
// ⛔ 이 파서가 «모르는» 값은 «비운다» — 추측으로 채우지 않는다:
//   · 가격이 음수(OpenRouter 가 「가변」을 -1 로 표시하는 경우) → `pricing` 을 «안» 넣는다
//   · `supported_parameters` 가 없으면 → 도구·추론을 «모른다»로 두고 `toolCalling` 을 안 넣는다
//     (⛔ 「없다(none)」로 접지 않는다 — 「안 알려 줬다」와 「못 한다」는 다른 값이다)

import type { ModelSpec } from '../../types.js';
import type {
  DiscoveredModel,
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

export const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const DEFAULT_TIMEOUT_MS = 10_000;

/** OpenRouter `/api/v1/models` 한 항목의 «쓰는 칸»만. */
export interface OpenRouterModelWire {
  id?: string;
  name?: string;
  created?: number;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  } | null;
  pricing?: Record<string, string | number | undefined> | null;
  top_provider?: { context_length?: number | null; max_completion_tokens?: number | null } | null;
  supported_parameters?: string[] | null;
  expiration_date?: string | null;
}

/** 문자열 «토큰당» 가격 → «1M 토큰당» USD. 음수·비수·부재는 `undefined`(=모른다). */
function perMTok(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  // 부동소수 잡음을 12자리에서 자른다(0.00000095 × 1e6 = 0.9499999…).
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

/** 한 항목을 `ModelSpec` 의 «잰 칸»으로. ⛔ 모르는 칸은 넣지 않는다. */
export function openRouterModelToSpec(m: OpenRouterModelWire & { id: string }): Partial<ModelSpec> {
  const spec: Partial<ModelSpec> = {
    id: m.id,
    provider: 'openrouter',
    displayName: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : m.id,
    streamingProtocol: 'sse',
  };
  // family = 벤더 접두(`moonshotai/kimi-k2.6` → `moonshotai`). 별칭 최신성 판정이 같은 벤더 안에서만 겨룬다.
  const slash = m.id.replace(/^~/, '').indexOf('/');
  if (slash > 0) spec.family = m.id.replace(/^~/, '').slice(0, slash);

  const ctx = m.context_length ?? m.top_provider?.context_length;
  if (typeof ctx === 'number' && ctx > 0) spec.contextSize = ctx;
  const maxOut = m.top_provider?.max_completion_tokens;
  if (typeof maxOut === 'number' && maxOut > 0) spec.outputMaxTokens = maxOut;

  const input = perMTok(m.pricing?.prompt);
  const output = perMTok(m.pricing?.completion);
  if (input !== undefined && output !== undefined) {
    const cached = perMTok(m.pricing?.input_cache_read);
    spec.pricing = { inputPerMTok: input, outputPerMTok: output, ...(cached !== undefined ? { cachedInputPerMTok: cached } : {}) };
  }

  const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : undefined;
  if (params) {
    spec.toolCalling = params.includes('tools') ? 'native-openai' : 'none';
    spec.reasoning = params.includes('reasoning') || params.includes('include_reasoning') ? 'high' : null;
    spec.capabilities = {
      effortControl: params.includes('reasoning_effort'),
      thinkingControl: params.includes('reasoning'),
      structuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
    };
  }

  const inMods = m.architecture?.input_modalities ?? [];
  if (inMods.includes('image')) spec.vision = 'images';
  else if (inMods.includes('file')) spec.vision = 'pdf';
  const outMods = m.architecture?.output_modalities ?? [];
  if (outMods.length > 0) spec.kind = outMods.includes('text') ? 'chat' : outMods.includes('image') ? 'image' : outMods.includes('audio') ? 'audio' : 'chat';

  if (typeof m.created === 'number' && m.created > 0) {
    spec.releaseDate = new Date(m.created * 1000).toISOString().slice(0, 10);
  }
  spec.deprecated = typeof m.expiration_date === 'string' && m.expiration_date.trim() ? m.expiration_date.trim() : null;
  return spec;
}

export const openrouterSource: DiscoverySource = {
  id: 'openrouter',
  async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? '';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const externalAbort = opts.signal;
    const onExternalAbort = (): void => ac.abort();
    if (externalAbort) {
      if (externalAbort.aborted) ac.abort();
      else externalAbort.addEventListener('abort', onExternalAbort);
    }
    try {
      const res = await fetchImpl(OPENROUTER_MODELS_ENDPOINT, {
        signal: ac.signal,
        // ⛔ 키는 «선택»이다 — 공개 엔드포인트라 없어도 된다.
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        const code = res.status;
        return {
          source: 'openrouter', ok: false, models: [], durationMs: now() - startedAt,
          error: code === 401 || code === 403 ? `upstream-auth-${code}` : `upstream-http-${code}`,
        };
      }
      const json = (await res.json().catch(() => null)) as { data?: OpenRouterModelWire[] } | null;
      // ⛔ 봉투가 틀리면 «빈 성공»이 아니라 «실패»다 — 「0개 발견」과 「못 읽었다」를 가른다.
      if (!json || !Array.isArray(json.data)) {
        return {
          source: 'openrouter', ok: false, models: [], durationMs: now() - startedAt,
          error: 'upstream-shape: response has no data[] array',
        };
      }
      const lastSeen = new Date(now()).toISOString();
      const models: DiscoveredModel[] = json.data
        .filter((m): m is OpenRouterModelWire & { id: string } => typeof m?.id === 'string' && m.id.length > 0)
        .map((m) => ({
          id: m.id,
          provider: 'openrouter',
          partial: openRouterModelToSpec(m),
          discoveryMeta: { source: 'auto-openrouter-api' as const, lastSeen, autoFilled: true, confidence: 'high' as const },
        }));
      return { source: 'openrouter', ok: true, models, durationMs: now() - startedAt };
    } catch (e) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'openrouter', ok: false, models: [], durationMs: now() - startedAt,
        error: aborted ? 'upstream-timeout' : `upstream-network: ${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      clearTimeout(timer);
      if (externalAbort) externalAbort.removeEventListener('abort', onExternalAbort);
    }
  },
};
