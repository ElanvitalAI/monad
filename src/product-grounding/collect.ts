/**
 * 🌐 브라우저 «안»에서 도는 수집기 — 페이지를 «사실»로 바꾼다. ⛔ 판정하지 않는다.
 *
 * ⛔⭐ 왜 «문자열»로 내보내나 —
 *   이 저장소의 접지 실행 주체는 `aside`(사람의 실제 브라우저)다. 헤드리스로는 못 간다:
 *     쿠팡  firecrawl → 헤더·내비게이션만        · aside → 전부
 *     네이버 firecrawl → «인스타 릴스»를 돌려줬다 · aside → 전부
 *   ⇒ 운반이 `aside.repl` / CDP `Runtime.evaluate` / Playwright `page.evaluate` 로 갈리므로
 *     ***코드를 「함수」가 아니라 「문자열」로 두고 어느 운반에든 먹인다.***
 *
 * ⛔ 사이트별 선택자를 «박지 않는다». 구조로 잡는다:
 *   · 고시는 `<table>` 일 수도(쿠팡) `li > strong` 일 수도(네이버) 있다 ⇒ «둘 다» 훑는다
 *   · 클래스명은 해시라 늙는다(`OBuaDaC_Hb`) ⇒ 절대 쓰지 않는다
 *   · 펼치기 버튼은 «낱말»로 찾는다 — 사이트마다 문면이 다르므로 목록으로 둔다
 */

/** 펼치기 후보 낱말. ⛔ 「이 사이트는 이 버튼」이라 박지 않는다 — 있으면 누르고 «전후를 잰다». */
export const EXPAND_LABELS: readonly string[] = [
  '상품정보 더보기',
  '상세정보 펼쳐보기',
  '상품정보제공고시 보기',
  '상품 정보 더보기',
  '더보기',
  '펼쳐보기',
  '전체보기',
  '상세 정보 더보기',
];

/**
 * 브라우저에서 평가할 코드. `PageFacts` 를 «JSON 가능한» 형태로 돌려준다.
 * ⚠️ 이 안에서는 저장소 타입을 못 쓴다(다른 프로세스다) — 모양만 맞춘다.
 */
export const COLLECT_SNIPPET = String.raw`
(async () => {
  const LABELS = ${JSON.stringify(EXPAND_LABELS)};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const measureImages = () => {
    const imgs = Array.from(document.querySelectorAll('img'))
      .map(i => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }))
      .filter(o => o.src && o.w > 0);
    return { imgs, count: imgs.length, pixels: imgs.reduce((s, o) => s + o.h, 0) };
  };

  // ⛔ 지연 로딩을 «깨운 뒤에» 세야 한다 — 안 그러면 「없다」가 「아직 안 왔다」다.
  const sweep = async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 1200) { window.scrollTo(0, y); await sleep(110); }
    window.scrollTo(0, 0); await sleep(400);
  };

  await sweep();
  const m0 = measureImages();
  const before = { docHeight: document.body.scrollHeight, imageCount: m0.count, imagePixels: m0.pixels };

  // ── 펼치기: «있는 것만» 누르고 무엇을 눌렀는지 이름을 남긴다 ──
  //
  // 🔴 2026-09-10 실측 사고: 무신사에서 이 루프가 «페이지를 떠났다»(→ /cs/notice).
  //   「더보기」·「전체보기」가 사이트에 따라 ***펼치기가 아니라 네비게이션 링크***다.
  //   ⇒ 그 뒤 모든 수집이 «다른 페이지»를 잰다 — 그리고 조용하다.
  // ✅ 그래서 방어가 «셋»이다:
  //   ① 다른 URL 로 가는 <a href> 는 «누르지 않는다»
  //   ② 누를 때마다 URL 을 확인하고, 바뀌면 «즉시 멈추고 되돌린다»
  //   ③ 무엇을 왜 건너뛰었는지 skipped 로 «남긴다»(조용한 실패 금지)
  //      ⛔ 이 주석에 백틱을 쓰면 «템플릿 리터럴이 그 자리에서 끊긴다» — 실제로 그래서 tsc 가 막았다.
  const clicked = [];
  const skipped = [];
  const startUrl = location.href;
  const navigatesAway = (el) => {
    const a = el.closest ? el.closest('a[href]') : null;
    if (!a) return false;
    const href = a.getAttribute('href') || '';
    if (!href || href === '#' || href.startsWith('javascript:')) return false;
    try { return new URL(href, location.href).href.split('#')[0] !== startUrl.split('#')[0]; }
    catch (_) { return false; }
  };
  for (const label of LABELS) {
    const el = Array.from(document.querySelectorAll('a,button,span,div,[role=button]'))
      .find(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === label && e.offsetParent !== null);
    if (!el) continue;
    if (navigatesAway(el)) { skipped.push(label + ' (링크라 안 누름)'); continue; }
    try { el.scrollIntoView({ block: 'center' }); el.click(); await sleep(1200); } catch (_) { continue; }
    if (location.href.split('#')[0] !== startUrl.split('#')[0]) {
      // ⛔ 떠났다 — 더 누르지 않고 표시한다. 되돌리기는 «바깥»(운반 계층)이 한다.
      skipped.push(label + ' (누르니 페이지를 떠났다: ' + location.href + ')');
      return { url: location.href, navigatedAway: { from: startUrl, to: location.href, by: label }, clicked, skipped };
    }
    clicked.push(label);
  }
  if (clicked.length) await sleep(1500);
  await sweep();

  const m1 = measureImages();
  const after = { docHeight: document.body.scrollHeight, imageCount: m1.count, imagePixels: m1.pixels };

  // ── 고시/사양: 구조 «둘»을 다 훑는다 ──
  const specRows = {};
  const put = (k, v) => {
    k = (k || '').replace(/\s+/g, ' ').trim();
    v = (v || '').replace(/\s+/g, ' ').trim();
    // ⛔ 노이즈 거르기 — 리뷰·알림이 같은 구조를 쓴다(네이버 실측: 평점/알림 3칸이 섞였다)
    if (!k || !v || k.length > 40 || /^평점|알림|가입 혜택|리뷰/.test(k)) return;
    if (!(k in specRows)) specRows[k] = v.slice(0, 240);
  };
  document.querySelectorAll('table tr').forEach(tr => {
    const c = Array.from(tr.querySelectorAll('th,td')).map(x => x.innerText);
    if (c.length >= 2) put(c[0], c.slice(1).join(' '));
  });
  document.querySelectorAll('li,div').forEach(el => {
    if (el.children.length > 4) return;
    const st = el.querySelector(':scope > strong, :scope > dt, :scope > h4');
    if (!st) return;
    const k = st.innerText;
    const full = (el.innerText || '').replace(/\s+/g, ' ').trim();
    const kk = (k || '').replace(/\s+/g, ' ').trim();
    if (kk && full.startsWith(kk)) put(kk, full.slice(kk.length));
  });
  document.querySelectorAll('dl').forEach(dl => {
    const dts = dl.querySelectorAll('dt'), dds = dl.querySelectorAll('dd');
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) put(dts[i].innerText, dds[i].innerText);
  });

  const text = (sel) => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g,' ').trim() : ''; };
  const nameCandidates = ['h1', 'h2', 'h3', '[class*=title i]']
    .map(text).filter(Boolean).concat(document.title || []);
  const priceCandidates = Array.from(document.querySelectorAll('[class*=price i],[class*=Price]'))
    .slice(0, 20).map(e => e.innerText.replace(/\s+/g,' ').trim()).filter(t => t && t.length < 40);

  return {
    url: location.href,
    title: document.title,
    nameCandidates: [...new Set(nameCandidates)].slice(0, 8),
    priceCandidates: [...new Set(priceCandidates)].slice(0, 8),
    specRows,
    images: m1.imgs.filter(o => o.w >= 200).slice(0, 400),
    expansion: { clicked, skipped, before, after },
  };
})()
`;
