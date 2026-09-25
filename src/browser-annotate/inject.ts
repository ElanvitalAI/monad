import type { CdpTransport } from '../browser-cdp/client.js';
import { debug } from '../debug/log.js';
import { DEFAULT_TTL_SECONDS, resolveTtl } from './ttl.js';
import { renderAnnotationSvg, SVG_NAMESPACE, type AnnotationShape } from './shapes.js';

/**
 * 🩸⭐⭐ **주입한 뒤 «되읽어» 판정한다** — 2026-09-01 · 42차 · 라이브 반증.
 *
 * ⛔ 첫 판은 `document.body.append(node)` 뒤에 `true` 를 냈다. 그런데 실물에서는
 *    루트 `<svg>` 가 없어 조각이 «HTML 요소»로 붙었고 `rect` 가 **0×0** 이었다 —
 *    ***붙었는데 안 보였다.*** 그리고 이 함수는 그것을 「됐다」고 말했다.
 * 🔑 ⇒ 「붙였다」를 「보인다」로 말하지 않는다. 붙인 «다음» 네임스페이스와 크기를 «되읽어»
 *    셋 중 하나를 낸다: `ok` · `wrong-namespace` · `zero-size`.
 * ⚠️ `zero-size` 는 「그리기가 틀렸다」일 수도 「페이지가 아직 레이아웃 전」일 수도 있다 —
 *    그래서 «거절»이 아니라 «이름 붙은 값»으로 낸다. 판정은 부르는 쪽이 한다.
 */
export function drawExpression(id: string, svg: string): string {
  return `(() => {
    const id = ${JSON.stringify(id)};
    const old = document.querySelector('[data-monad-annot="' + CSS.escape(id) + '"]');
    if (old) old.remove();
    const template = document.createElement('template');
    template.innerHTML = ${JSON.stringify(svg)};
    const node = template.content.firstElementChild;
    if (!node) return { attached: false, verdict: 'no-root' };
    node.setAttribute('data-monad-annot', id);
    document.body.append(node);
    const ns = node.namespaceURI;
    const rect = node.getBoundingClientRect();
    const verdict = ns !== ${JSON.stringify(SVG_NAMESPACE)}
      ? 'wrong-namespace'
      : (rect.width < 1 || rect.height < 1 ? 'zero-size' : 'ok');
    return { attached: true, verdict: verdict, ns: ns,
             width: Math.round(rect.width), height: Math.round(rect.height) };
  })()`;
}

export function eraseExpression(id: string): string {
  return `(() => { const node = document.querySelector('[data-monad-annot="' + CSS.escape(${JSON.stringify(id)}) + '"]'); if (!node) return false; node.remove(); return true; })()`;
}

export function existsExpression(id: string): string {
  return `document.querySelector('[data-monad-annot="' + CSS.escape(${JSON.stringify(id)}) + '"]') !== null`;
}

/** 주입 판정 — ⛔ 「붙었다」가 아니라 「보이나」다. */
export interface DrawOutcome {
  readonly attached: boolean;
  readonly verdict: 'ok' | 'no-root' | 'wrong-namespace' | 'zero-size' | 'unreadable';
  readonly width?: number;
  readonly height?: number;
}

export interface AnnotationLedger {
  /**
   * ⛔⭐ **«도형»을 받는다 — SVG 문자열이 아니다.** 조각 문자열을 받으면 호출자가
   *    루트 `<svg>` 없이 넘길 수 있고, 그러면 조용히 0×0 이 된다(42차 실물).
   *    ⇒ 루트를 «이 원장이» 만든다. 이음매를 남기지 않는다.
   */
  draw(id: string, shapes: readonly AnnotationShape[], ttlSeconds?: number): Promise<DrawOutcome>;
  erase(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  /** Detects page redraw loss and expires elapsed annotations. */
  observe(nowMs?: number): Promise<void>;
}

interface Entry {
  expiresAt: number;
}

export function createAnnotationLedger(
  transport: CdpTransport,
  options: { now?: () => number } = {},
): AnnotationLedger {
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;

  async function evaluate(expression: string): Promise<unknown> {
    return transport.send('Runtime.evaluate', { expression, returnByValue: true });
  }
  async function exists(id: string): Promise<boolean> {
    return valueOf(await evaluate(existsExpression(id))) === true;
  }

  return {
    async draw(id, shapes, ttlSeconds = DEFAULT_TTL_SECONDS) {
      const ttl = resolveTtl(ttlSeconds);
      const rendered = renderAnnotationSvg(shapes);
      if (!rendered.ok) {
        debug.log('browser.annotate', 'rejected', { id, reason: rendered.reason });
        return { attached: false, verdict: 'no-root' };
      }
      const raw = valueOf(await evaluate(drawExpression(id, rendered.svg)));
      // ⛔ 저쪽이 무엇을 돌려줬는지 «모르는» 것과 「안 보인다」를 가른다.
      const outcome: DrawOutcome = isDrawOutcome(raw) ? raw : { attached: false, verdict: 'unreadable' };
      // ⛔⭐ **안 붙은 것을 원장에 넣지 않는다** (자기 리뷰 1차 · `#14999`).
      //    넣으면 `observe()` 가 그것을 «`lost`» 로 낸다 — 「그린 적 없다」와 「그렸는데 사라졌다」가
      //    같은 값이 된다. 이 원장의 존재 이유가 그 둘을 «가르는» 것이므로 그 혼동이 가장 나쁘다.
      //    ⚠️ `zero-size` 는 «붙긴 했다» ⇒ 원장에 넣는다(치워야 할 노드가 페이지에 «있다»).
      if (outcome.attached) entries.set(id, { expiresAt: now() + ttl.seconds * 1_000 });
      debug.log('browser.annotate', outcome.attached ? 'drawn' : 'not-drawn', {
        id, ttlSeconds: ttl.seconds, clamped: ttl.clamped,
        verdict: outcome.verdict, width: outcome.width, height: outcome.height,
      });
      return outcome;
    },
    async erase(id) {
      await evaluate(eraseExpression(id));
      entries.delete(id);
    },
    exists,
    async observe(currentMs = now()) {
      for (const [id, entry] of [...entries]) {
        if (currentMs >= entry.expiresAt) {
          await evaluate(eraseExpression(id));
          entries.delete(id);
          debug.log('browser.annotate', 'expired', { id });
        } else if (!await exists(id)) {
          entries.delete(id);
          debug.log('browser.annotate', 'lost', { id });
        }
      }
    },
  };
}

function valueOf(result: unknown): unknown {
  return (result as { result?: { value?: unknown } } | undefined)?.result?.value;
}

function isDrawOutcome(value: unknown): value is DrawOutcome {
  if (typeof value !== 'object' || value === null) return false;
  // ⛔ `attached` 가 boolean 이 «아니면» 그 산출은 못 읽은 것이다 — 위 분기가 그 값에 걸려 있다.
  if (typeof (value as { attached?: unknown }).attached !== 'boolean') return false;
  const verdict = (value as { verdict?: unknown }).verdict;
  return verdict === 'ok' || verdict === 'no-root' || verdict === 'wrong-namespace' || verdict === 'zero-size';
}
