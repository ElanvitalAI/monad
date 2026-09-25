// ── 도메인팩 리서치 공통 헬퍼 — D4 ────────────────────────────────────────
//
// coding/business 팩의 assessNeed(LLM 판단)가 공유하는 LLM JSON 호출 + 관대 파싱.
// 리서치 모델은 research-gate/mission-engine 과 동일(better tier·high 리즈닝·env 오버라이드 동일).
// ⛔ 모델 이름을 박지 않는다 — 활성 provider 의 tier 사다리가 채운다(대표 2026-08-18).
// leaf 모듈(registry/pack 을 import 하지 않음) — 순환 회피.

// leaf 규율을 지키려 tier 해석기도 «lazy» 로 끌어온다(top-level import 금지).
const DMODEL = async (): Promise<string> => {
  const override = process.env.MONAD_DECOMPOSE_MODEL;
  if (override) return override;
  const { tierModel } = await import('../../llm/model-defaults.js');
  return tierModel('better');
};
const DEFFORT = () => (process.env.MONAD_DECOMPOSE_EFFORT || 'high') as
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** LLM 을 JSON 응답으로 호출(streamLLM lazy import·hot path 회피). opts 로 모델/effort override —
 *  섬세·경량 판단은 활성 provider의 budget tier(low), 무거운 분해는 기본 모델을 사용한다. */
export async function llmJson(prompt: string, opts: { model?: string; effort?: DecomposeEffort } = {}): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../../llm.js');
  const model = opts.model ?? await DMODEL();
  const provider = resolveDefaultProvider(model);
  let full = '';
  await streamLLM([{ role: 'user', content: prompt }], (_d, all) => { full = all; },
    { model, reasoningEffort: opts.effort ?? DEFFORT(), ...(provider ? { provider } : {}) });
  return full;
}
type DecomposeEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** fence/prose 관대 JSON 파싱. 실패 null. */
export function parseJsonLoose(raw: string): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/```(?:json)?/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)) as Record<string, any>; } catch { return null; }
}
