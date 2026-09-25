/**
 * flow-script.ts — L3 ***상태 전이*** 를 「사람처럼 밟는」 걸음 목록.
 *
 * ⛔ 무엇을 답하나 — 「***이 행동 뒤에 이 호출이 온다***」 하나뿐이다. 계약의 절반은 «순서»다.
 *
 * ⛔⭐ 이 자는 «자동 크롤»이 아니다 — 걸음이 «파일에 적혀» 있고, 사람이 쓴 것만 밟는다.
 *    RFC §4 L4 규칙 ③(연타 금지)을 «형태»로 지킨다: 걸음마다 최소 대기가 강제되고,
 *    걸음 수에 상한이 있다. ⛔ 규율을 문장으로 지키려 하지 않는다.
 */

export type FlowStep =
  | { readonly kind: 'navigate'; readonly url: string; readonly label?: string }
  | { readonly kind: 'click'; readonly selector: string; readonly label?: string }
  | { readonly kind: 'type'; readonly selector: string; readonly text: string; readonly label?: string }
  | { readonly kind: 'wait'; readonly ms: number; readonly label?: string };

/** ⛔ 「사람 속도」를 «형태»로 — 걸음 사이 최소 대기(밀리초)와 걸음 수 상한 */
export const MIN_STEP_WAIT_MS = 800;
export const MAX_STEPS = 12;

export interface FlowParseResult {
  readonly steps: readonly FlowStep[];
  /** ⛔ 「고쳤다」를 조용히 하지 않는다 — 무엇을 어떻게 바꿨는지 말한다 */
  readonly adjustments: readonly string[];
  readonly error: string | null;
}

export function labelOf(step: FlowStep, index: number): string {
  if (step.label) return step.label;
  switch (step.kind) {
    case 'navigate': return `${index}: navigate ${step.url}`;
    case 'click': return `${index}: click ${step.selector}`;
    case 'type': return `${index}: type "${step.text}" → ${step.selector}`;
    case 'wait': return `${index}: wait ${step.ms}ms`;
  }
}

/**
 * 흐름 파일(JSON 배열)을 읽는다.
 * ⛔ 파싱 실패를 «빈 걸음»으로 삼키지 않는다 — `error` 를 «값으로» 낸다.
 */
export function parseFlow(raw: string): FlowParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { steps: [], adjustments: [], error: `흐름 파일이 JSON 이 아니다: ${String(e).slice(0, 120)}` };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return { steps: [], adjustments: [], error: '흐름은 배열이거나 { steps: [...] } 여야 한다' };
  if (list.length === 0) return { steps: [], adjustments: [], error: '걸음이 «0개»다 — 흐름이 비었다' };

  const adjustments: string[] = [];
  const steps: FlowStep[] = [];
  for (const [i, item] of list.entries()) {
    const o = item as Record<string, unknown>;
    const kind = typeof o?.kind === 'string' ? o.kind : null;
    const label = typeof o?.label === 'string' ? o.label : undefined;
    if (kind === 'navigate' && typeof o.url === 'string') steps.push({ kind, url: o.url, label });
    else if (kind === 'click' && typeof o.selector === 'string') steps.push({ kind, selector: o.selector, label });
    else if (kind === 'type' && typeof o.selector === 'string' && typeof o.text === 'string') steps.push({ kind, selector: o.selector, text: o.text, label });
    else if (kind === 'wait' && typeof o.ms === 'number') {
      const ms = Math.max(MIN_STEP_WAIT_MS, o.ms);
      if (ms !== o.ms) adjustments.push(`걸음 ${i}: 대기 ${o.ms}ms → ${ms}ms (사람 속도 최소값)`);
      steps.push({ kind, ms, label });
    } else {
      return { steps: [], adjustments, error: `걸음 ${i} 를 못 읽었다: ${JSON.stringify(item).slice(0, 120)}` };
    }
  }
  if (steps.length > MAX_STEPS) {
    adjustments.push(`걸음 ${steps.length}개 → ${MAX_STEPS}개로 잘랐다 (연타 금지 · RFC L4 규칙 ③)`);
    return { steps: steps.slice(0, MAX_STEPS), adjustments, error: null };
  }
  return { steps, adjustments, error: null };
}

/**
 * 페이지 «안»에서 셀렉터를 누르거나 채우는 표현식.
 * ⛔ ***찾았는지를 «값으로» 돌려준다*** — 못 찾은 것을 「눌렀다」로 읽으면
 *    그 뒤의 「호출 0건」이 «사이트 탓»으로 오독된다.
 */
export function buildClickExpression(selector: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return JSON.stringify({ found: false });
  el.scrollIntoView({ block: 'center' }); el.click();
  return JSON.stringify({ found: true, tag: el.tagName.toLowerCase() }); })()`;
}

/**
 * ⛔⭐ `el.value = x` 만으로는 ***React·Vue 의 제어 입력이 «못 본다»***.
 *
 * 📏 2026-09-10 🅕 실측(우리가 지은 화면을 우리 도구로 재다가 잡았다):
 *   자는 `찾음 <input>` 이라 말했는데 그 뒤 클릭이 «요청 0건»을 냈다.
 *   React 는 값을 자기 트래커로 기억해서, 프로퍼티를 직접 덮으면 「안 바뀌었다」로 읽고
 *   `onChange` 를 «안 흘린다». ⇒ ***「찾았다」가 「입력됐다」를 뜻하지 않았다.***
 *   ⚠️ 그리고 그 0 은 «그럴듯했다» — 「타이핑은 서버를 안 부른다」로 읽힌다.
 *
 * ✅ 처방: 프로토타입의 «네이티브 setter»로 넣으면 트래커가 갱신되고 프레임워크가 본다.
 * ⭐ 그리고 ***값이 실제로 들어갔는지 «읽어서» 돌려준다*** — 「했다」가 아니라 「됐다」를 낸다.
 */
export function buildTypeExpression(selector: string, text: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return JSON.stringify({ found: false });
  const value = ${JSON.stringify(text)};
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ found: true, tag: el.tagName.toLowerCase(), applied: el.value === value }); })()`;
}

/**
 * ⛔ `found`(찾았나)와 `applied`(정말 들어갔나)를 «가른다» —
 *    프레임워크가 못 본 입력을 「했다」로 읽으면 그 뒤의 「0건」이 사이트 탓이 된다.
 *    ⚪ `applied` 가 `null` 이면 「안 잰 걸음」(click·navigate·wait)이다 — 실패가 «아니다».
 */
export function parseStepOutcome(raw: unknown): { found: boolean; tag: string | null; applied: boolean | null } | null {
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as { found?: unknown; tag?: unknown; applied?: unknown };
    if (typeof o?.found !== 'boolean') return null;
    return {
      found: o.found,
      tag: typeof o.tag === 'string' ? o.tag : null,
      applied: typeof o.applied === 'boolean' ? o.applied : null,
    };
  } catch {
    return null;
  }
}
