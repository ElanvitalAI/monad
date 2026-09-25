/**
 * ua-default-expression.ts — 페이지 «안»에서 돌 표현식 하나.
 *
 * ⛔⭐⭐ ***백틱을 «한 자도» 쓰지 않는다*** — 이 저장소가 그 함정을 «두 번» 밟았고,
 *    `page-expression-backtick.test.ts` 가 «관문»으로 서 있다(새 표현식은 «거기에도» 더한다).
 * ⛔ 정규식도 쓰지 않는다 — 템플릿 안에서 역슬래시가 죽은 적이 있다.
 */

/**
 * ⭐⭐ 🩸 2026-09-12 ***두 번째 판*** — 첫 판은 ***내가 아는 태그 «열여덟»만*** 훑었다.
 *    그래서 `bilryo 6px` · `hankeot 17px` 의 출처를 ***못 짚었다***(사각 `known-tags-only`).
 * ⇒ ✅ 이제 ***요소를 «전부»*** 훑고 «마진이 0이 아닌 것»만 모은다.
 *    ⛔ 「아는 태그인가」는 ***순수 함수가 «뒤에서» 가른다*** — 여기서 거르면 사각이 다시 생긴다.
 *
 * ⛔⭐⭐ 🩸 ***세 번째 판*** — 두 번째 판은 위·아래 마진을 `Math.max` 로 «접었다».
 *    그래서 `margin-top: 40 · margin-bottom: 17` 인 요소에서 ***17 이 «사라졌다»***
 *    (`hankeot-lab` 의 17px 를 그래서 못 찾았다). ⇒ ✅ ***두 쪽을 «따로» 센다.***
 *    🪞 「두 값 중 하나만 남기면 나머지는 «없는 것»이 된다」 — 이 창의 §0 이 스무 번 적은 그 모양이다.
 *
 * 태그별로 ***세로 마진과 글자 크기***를 모은다.
 * ⛔ 「기본값인가」는 ***여기서 판정하지 않는다*** — 순수 함수(`ua-default-leak.ts`)가 한다.
 *    (그래야 판정선을 시험으로 못 박을 수 있다.)
 */
export const UA_DEFAULT_EXPRESSION =
  "(() => {"
  + " const rows = new Map();"
  + " const all = document.querySelectorAll('body *');"
  + " const limit = Math.min(all.length, 3000);"
  + " for (let i = 0; i < limit; i++) {"
  + "   const el = all[i];"
  + "   const r = el.getBoundingClientRect();"
  + "   if (r.width <= 0 && r.height <= 0) continue;"
  + "   const cs = getComputedStyle(el);"
  + "   if (cs.display === 'none' || cs.visibility === 'hidden') continue;"
  + "   const fs = Number.parseFloat(cs.fontSize);"
  + "   if (!(fs > 0)) continue;"
  + "   const tag = el.tagName.toLowerCase();"
  + "   for (const raw of [cs.marginTop, cs.marginBottom]) {"
  + "     const m = Number.parseFloat(raw);"
  + "     if (!(m > 0)) continue;"
  + "     const key = tag + '|' + Math.round(m * 100) + '|' + Math.round(fs * 100);"
  + "     const cur = rows.get(key);"
  + "     if (cur) { cur.count += 1; }"
  + "     else { rows.set(key, { tag: tag, count: 1, marginPx: Math.round(m * 100) / 100, fontSizePx: Math.round(fs * 100) / 100 }); }"
  + "   }"
  + " }"
  + " return [...rows.values()];"
  + "})()";
