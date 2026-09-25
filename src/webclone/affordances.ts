/**
 * affordances.ts — L1 ***DOM 어포던스*** 수집기 (관측 사다리 L1 · `RFC-advanced-clone-…-2026-09-10.md` §4)
 *
 * ⛔ 무엇을 답하나 — 「이 페이지에서 ***사용자가 할 수 있는 일***이 무엇인가」 하나뿐이다.
 *    「그것을 누르면 무엇이 일어나나」는 L2(네트워크)·L3(상태전이)의 몫이고 여기선 «모른다».
 *
 * ⭐ 근거 계급 = `관측`. 페이지 안에서 실제로 읽은 것만 담는다.
 *
 * ⛔⭐ 「무엇을 «못» 보는지」를 «값으로» 담는다(`blindSpots`) — 이 저장소가 반복해서 밟은 함정이
 *    ***「0건」을 「없다」로 읽는 것***이라, 이 자는 자기 사각을 스스로 낸다.
 */

/** 이 자가 원리상 «못 보는» 것들. ⛔ 결과에 «값으로» 실려 나간다 — 읽는 쪽이 0 을 오독하지 않게. */
export const AFFORDANCE_BLIND_SPOTS: readonly string[] = [
  'shadow-dom-closed: closed shadow root 안의 폼·버튼은 안 보인다',
  'iframe-cross-origin: 교차출처 프레임 내부는 안 보인다',
  'after-interaction: 클릭·스크롤 «뒤에» 생기는 어포던스는 안 보인다 (이 자는 «한 시점»만 본다)',
  'js-handler-only: onclick 만 달린 div 는 button 이 아니라 잡히지 않을 수 있다',
  'server-validation: required·pattern 은 «클라이언트» 규칙일 뿐 — 서버 규칙은 L4 의 몫',
];

export interface AffordanceField {
  readonly tag: string;
  readonly type: string | null;
  readonly name: string | null;
  readonly required: boolean;
  readonly pattern: string | null;
  readonly min: string | null;
  readonly max: string | null;
  readonly maxLength: number | null;
  readonly placeholder: string | null;
  readonly label: string | null;
}

export interface AffordanceForm {
  readonly action: string | null;
  readonly method: string;
  readonly fields: readonly AffordanceField[];
}

export interface AffordanceControl {
  readonly tag: string;
  readonly type: string | null;
  readonly text: string;
  readonly ariaLabel: string | null;
}

export interface AffordanceLink {
  readonly href: string;
  readonly text: string;
  readonly sameOrigin: boolean;
}

export interface AffordanceReport {
  readonly url: string;
  readonly forms: readonly AffordanceForm[];
  readonly controls: readonly AffordanceControl[];
  readonly links: readonly AffordanceLink[];
  readonly dataAttributes: readonly string[];
  readonly ariaRoles: readonly string[];
  /** ⛔ 이 자가 못 보는 것 — 「0건」을 「없다」로 읽지 않게 결과에 같이 싣는다 */
  readonly blindSpots: readonly string[];
}

/**
 * 페이지 «안»에서 돌 표현식.
 * ⛔ 반환은 «JSON 문자열»이다 — CDP `Runtime.evaluate` 가 깊은 객체를 온전히 안 돌려줄 수 있다
 *   (`computed-tokens.ts` 가 같은 이유로 같은 규율을 쓴다 — 재발명이 아니라 «같은 계약»이다).
 */
export function buildAffordanceExpression(limits = { links: 200, controls: 200 }): string {
  return `(() => {
  const text = (el) => (el.textContent || '').replace(/\\\\s+/g, ' ').trim().slice(0, 80);
  const attr = (el, n) => { const v = el.getAttribute(n); return v === null ? null : v; };
  const labelFor = (el) => {
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return text(l); }
    const wrap = el.closest('label');
    return wrap ? text(wrap) : (attr(el, 'aria-label') || null);
  };
  const field = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: attr(el, 'type'),
    name: attr(el, 'name'),
    required: el.hasAttribute('required'),
    pattern: attr(el, 'pattern'),
    min: attr(el, 'min'),
    max: attr(el, 'max'),
    maxLength: el.maxLength && el.maxLength > 0 ? el.maxLength : null,
    placeholder: attr(el, 'placeholder'),
    label: labelFor(el),
  });
  const forms = [...document.querySelectorAll('form')].map((f) => ({
    action: attr(f, 'action'),
    method: (attr(f, 'method') || 'get').toLowerCase(),
    fields: [...f.querySelectorAll('input, select, textarea')].map(field),
  }));
  const inForm = new Set([...document.querySelectorAll('form input, form select, form textarea')]);
  const orphanFields = [...document.querySelectorAll('input, select, textarea')].filter((el) => !inForm.has(el));
  if (orphanFields.length) forms.push({ action: null, method: 'none', fields: orphanFields.map(field) });
  const controls = [...document.querySelectorAll('button, [role="button"], input[type=submit], input[type=button]')]
    .slice(0, ${limits.controls})
    .map((el) => ({ tag: el.tagName.toLowerCase(), type: attr(el, 'type'), text: text(el) || attr(el, 'value') || '', ariaLabel: attr(el, 'aria-label') }));
  const here = location.origin;
  const links = [...document.querySelectorAll('a[href]')]
    .slice(0, ${limits.links})
    .map((el) => { let abs = el.href; let same = false; try { same = new URL(abs).origin === here; } catch (e) { same = false; }
                   return { href: abs, text: text(el), sameOrigin: same }; });
  const dataAttributes = [...new Set([...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-'))))].sort();
  const ariaRoles = [...new Set([...document.querySelectorAll('[role]')].map((el) => el.getAttribute('role')))].filter(Boolean).sort();
  return JSON.stringify({ url: location.href, forms, controls, links, dataAttributes, ariaRoles });
})()`;
}

/**
 * ⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다 — `null` 을 내고 부르는 쪽이 「못 쟀다」를 적게 한다.
 *    (이 저장소가 반복해서 밟은 함정: 실패가 「0건」으로 «보인다».)
 */
export function parseAffordances(raw: unknown): AffordanceReport | null {
  const text = typeof raw === 'string' ? raw : null;
  if (!text) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed.url !== 'string') return null;
  const arr = <T,>(v: unknown): readonly T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    url: parsed.url,
    forms: arr<AffordanceForm>(parsed.forms),
    controls: arr<AffordanceControl>(parsed.controls),
    links: arr<AffordanceLink>(parsed.links),
    dataAttributes: arr<string>(parsed.dataAttributes),
    ariaRoles: arr<string>(parsed.ariaRoles),
    blindSpots: AFFORDANCE_BLIND_SPOTS,
  };
}

/** 사람이 읽을 한 화면. ⛔ 「0건」 옆에는 «왜 0일 수 있는지»를 같이 둔다. */
export function formatAffordances(report: AffordanceReport): string[] {
  const lines: string[] = [`L1 어포던스: ${report.url}`];
  const requiredCount = report.forms.reduce((n, f) => n + f.fields.filter((x) => x.required).length, 0);
  lines.push(`  폼 ${report.forms.length}개 · 입력칸 ${report.forms.reduce((n, f) => n + f.fields.length, 0)}개(필수 ${requiredCount})`);
  lines.push(`  컨트롤 ${report.controls.length}개 · 링크 ${report.links.length}개(같은 출처 ${report.links.filter((l) => l.sameOrigin).length})`);
  lines.push(`  data-* ${report.dataAttributes.length}종 · aria role ${report.ariaRoles.length}종`);
  for (const form of report.forms) {
    lines.push(`  ▸ form ${form.method.toUpperCase()} ${form.action ?? '(action 없음)'}`);
    for (const f of form.fields) {
      const rules = [f.required ? 'required' : null, f.pattern ? `pattern=${f.pattern}` : null,
        f.min !== null ? `min=${f.min}` : null, f.max !== null ? `max=${f.max}` : null,
        f.maxLength !== null ? `maxLength=${f.maxLength}` : null].filter(Boolean).join(' ');
      lines.push(`      ${f.name ?? '(이름 없음)'} : ${f.type ?? f.tag}${rules ? '  ' + rules : ''}`);
    }
  }
  if (report.forms.length === 0) {
    lines.push('  ⚪ 폼 0개 — ⛔ 「폼이 없다」가 아닐 수 있다. 아래 사각을 읽어라');
  }
  lines.push('  ⛔ 이 자가 못 보는 것:');
  for (const spot of report.blindSpots) lines.push(`      · ${spot}`);
  return lines;
}
