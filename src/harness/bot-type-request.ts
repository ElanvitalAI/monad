/**
 * ⌨️ **「이 칸에 이 글을 쳐도 되나」** — 관문만 답한다(브라우저를 안 만진다 · 순수).
 *
 * 🚨 **왜 이 파일이 «관문부터»인가** (대표 승인 2026-08-30 「타이핑도 켜고 끝까지 디버깅」):
 *    매뉴얼 §8 이 이 축의 마지막 열린 칸을 ***「입력(타이핑)」***으로 적어 뒀고,
 *    열 때 정할 것을 ***「어느 칸에 무슨 글을」***이라고 못 박았다.
 *    ⇒ 누르기는 대상이 «선택자 하나»지만 ***타이핑은 「내용」이 붙는다***.
 *
 * ⭐⭐ **위험이 «생각보다 좁다» — 그 이유를 여기 적는다**:
 *    글을 쳐도 ***제출하지 않으면 아무 데도 안 남는다.*** 그리고 제출은
 *    `decideReversibility` 가 «이미» 막는다(`form` 안 · `<button>` · `role=button` 전부 거부).
 *    ⇒ 🔑 그래서 이 관문의 일은 ***「타이핑이 제출이 되지 않게」*** 하는 것이다.
 *
 * ⛔⭐ **그래서 「개행」을 «금지»한다** — `\n` 은 많은 칸에서 ***제출과 같다***.
 *    ⛔ 그리고 이 축의 드라이버는 `Input.insertText` 만 쓴다(키 이벤트를 «안» 보낸다) —
 *       ***Enter 를 보낼 수 있는 길을 아예 안 만든다.***
 *
 * ⛔⭐⭐ **비밀번호 칸은 «절대» 거부한다** — 이 축이 여는 것은 「검색창에 질의를 넣는 것」이지
 *    ***자격을 흘리는 길이 아니다.*** 유사 이름(`password`·`pwd`·`secret`·`token`)도 같이 막는다.
 */

/** ⛔ 상한은 자의적이다. 다만 «없는» 것이 더 나쁘다 — 긴 글은 붙여넣기지 「타이핑」이 아니다. */
export const TYPE_TEXT_MAX = 200;

/** 브라우저에서 «읽어 온» 대상의 꼴. ⛔ 못 읽었으면 null 이고 그것은 거부 사유다. */
export type TypeTarget = {
  readonly tag: string;
  readonly type: string | null;
  readonly name: string | null;
  readonly id: string | null;
  readonly contentEditable: boolean;
  /** 이 칸이 `form` «안»인가. ⛔ 거부 사유가 «아니다» — 세어서 말할 값이다. */
  readonly inForm: boolean;
};

export type TypeVerdict = { readonly allowed: boolean; readonly reason: string };

const SECRETISH = /pass|pwd|secret|token|otp|cvc|card/i;

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    // 🪞 오늘 아침에 배운 것 — 호스트가 같아도 스킴이 다르면 «다른 것»이다.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch { return null; }
}

export function judgeTypeRequest(input: {
  readonly url: string;
  readonly selector: string;
  readonly text: string;
  readonly actionHosts: readonly string[];
  /** ⛔ 클릭과 «같은» 규율 — 이번 한 번을 명시로 무장해야 한다. */
  readonly armed: boolean;
  readonly target: TypeTarget | null;
  readonly maxChars?: number;
}): TypeVerdict {
  const no = (reason: string): TypeVerdict => ({ allowed: false, reason });
  const max = input.maxChars ?? TYPE_TEXT_MAX;

  // ── ① 무장 — ⛔ 클릭과 같은 문턱이다.
  if (!input.armed) return no('무장하지 «않았다» — 이번 한 번을 명시로 열어야 한다(--armed)');

  // ── ② 경계 — 이 축의 상시 물음: 「이것이 «내가 안 본 조작»을 만드나」
  const host = hostOf(input.url);
  if (host === null) return no(`주소가 «http(s) 가 아니거나 못 읽었다»: ${input.url.slice(0, 70)}`);
  if (input.actionHosts.length === 0) {
    return no('이 봇은 «선언된 곳»이 하나도 없다 — 빈 경계는 «전부 허용»이 아니다');
  }
  const inside = input.actionHosts.some((h) => {
    const d = h.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
  if (!inside) return no(`«${host}» 는 이 봇이 선언한 곳 밖이다(선언: ${input.actionHosts.join(' · ')})`);

  // ── ③ 대상을 «못 읽었다」 ⇒ 안 친다. ⛔ 「모른다」를 「괜찮다」로 읽지 않는다.
  const t = input.target;
  if (t === null) return no('대상 칸을 «못 읽었다» — 모르는 곳에는 «안 친다»');

  // ── ④ ⛔⭐ 비밀번호(유사) 칸은 «절대» 거부 — 자격이 흐르는 길을 안 만든다.
  const looksSecret = (t.type ?? '').toLowerCase() === 'password'
    || SECRETISH.test(`${t.name ?? ''} ${t.id ?? ''}`);
  if (looksSecret) {
    return no('⛔ ***비밀번호·자격으로 보이는 칸***이다 — 이 축은 그 길을 «안 연다»'
      + `(type=${t.type ?? '?'} · name=${t.name ?? '?'} · id=${t.id ?? '?'})`);
  }

  // ── ⑤ 칠 수 «있는» 칸인가 — ⛔ 아니면 무엇이 일어날지 모른다.
  const tag = t.tag.toLowerCase();
  const typable = t.contentEditable || tag === 'textarea'
    || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset'].includes((t.type ?? 'text').toLowerCase()));
  if (!typable) return no(`«${tag}${t.type ? `[type=${t.type}]` : ''}» 는 칠 수 있는 칸이 아니다 — 무엇이 일어날지 «모른다»`);

  // ── ⑥ ⛔⭐ 개행 금지 — 많은 칸에서 ***개행은 제출과 같다***.
  if (/[\r\n]/.test(input.text)) {
    return no('⛔ 글에 «개행»이 있다 — 많은 칸에서 ***개행은 제출과 같다***(이 축은 제출을 «안» 연다)');
  }
  if (input.text.trim() === '') return no('칠 글이 «비었다»');
  if (input.text.length > max) return no(`글이 ${input.text.length}자다(상한 ${max}) — 긴 글은 «타이핑»이 아니다`);

  // ── ✅ 통과. ⛔ 폼 «안»인 것은 거부 사유가 아니라 ***말할 값***이다.
  return {
    allowed: true,
    reason: `«${host}» 의 ${tag}${t.type ? `[${t.type}]` : ''} 에 ${input.text.length}자를 친다`
      + (t.inForm ? ' · ⚠️ 이 칸은 «폼 안»이다 — ***제출 버튼은 여전히 못 누른다***(되돌림 관문)' : ''),
  };
}
