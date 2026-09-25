/**
 * 📈 **투자 봇 회차의 «스킬 산출 텍스트»를 구조로 읽는다** (2026-09-04 · 45차).
 *
 * ## 🚨 이 파일이 있는 이유
 * `investor` 봇의 회차는 `RESULT.json`(메타)과 ***`*.txt`(실제 내용)***으로 갈린다.
 * 그런데 그 `.txt` 는 ***스킬 CLI 가 사람에게 보여 주려고 찍은 글***이라, PWA 가 그리려면
 * 누군가 «구조»로 읽어야 한다. ⛔ 그 자리가 지금까지 «없었다» — 그래서 PWA 에
 * 투자 표현이 한 곳도 없다.
 *
 * ## ⛔ 이 자가 지키는 규율
 * ```
 * ① ***「못 읽었다」와 「0」을 «가른다»*** — 파싱 실패는 `null` 이지 「값 0」이 아니다.
 *    🔑 이 저장소가 하루에도 몇 번씩 밟는 얼굴이다(45차 실측: 자기 자로 «스물세 번» 틀렸다).
 * ② ***형식이 바뀔 것을 «전제»한다*** — 스킬 CLI 는 우리 소유가 아니고 산출 문면이 바뀐다.
 *    ⇒ 「못 읽으면 조용히 빈 카드」가 아니라 ***`unparsed` 로 «이름을 대고» 남긴다***.
 * ③ ⛔ 여기서 «그리지» 않는다 — 색·단위·시간대는 화면의 몫이다. 이 자는 «수»만 낸다.
 * ④ ⛔ 시각을 «변환하지» 않는다 — 원장이 UTC 면 UTC 그대로 넘긴다(표시가 고른다).
 * ```
 */

/** 📊 시세 한 종목 — `omni-market quote` 산출에서. ⛔ 못 읽은 칸은 `null`(0 이 아니다). */
export interface QuoteSnapshot {
  readonly symbol: string;
  readonly close: number | null;
  readonly change: number | null;
  /** 퍼센트. `+0.46%` → `0.46`. */
  readonly changePct: number | null;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly volume: number | null;
  readonly prevClose: number | null;
}

/** 🔁 투자자 수급 한 줄 — 기간별이든 날짜별이든 «같은 모양»으로. */
export interface FlowRow {
  /** `5일` · `2026-09-02` 처럼 원문 그대로. ⛔ 해석하지 않는다. */
  readonly key: string;
  readonly foreign: number | null;
  readonly institution: number | null;
  readonly individual: number | null;
}

export interface FlowTable {
  readonly title: string;
  /** 표 머리에 적힌 단위 문면(`백만` 등). 못 찾으면 `null`. */
  readonly unit: string | null;
  readonly rows: readonly FlowRow[];
}

/** 🗂️ 「제목 ⊕ `라벨 : 값`」 꼴 — 비서의 메일·일정 요약이 이 모양이다. */
export interface KeyedSummary {
  readonly title: string;
  readonly entries: readonly { readonly label: string; readonly value: string; readonly num: number | null }[];
}

/** 📰 Omni crawl 한 기사 — 원문의 title·url·date를 이름으로 보존한다. */
export interface OmniCrawlNewsItem {
  readonly title: string | null;
  readonly url: string | null;
  readonly date: string | null;
}

/** 📰 Omni crawl 울타리 JSON에서 읽은 뉴스 목록. 빈 `items`도 정상 산출이다. */
export interface OmniCrawlNews {
  readonly query: string | null;
  readonly items: readonly OmniCrawlNewsItem[];
}

/** 하나의 `.txt` 산출을 읽은 결과. ⛔ `kind: 'unparsed'` 는 «실패를 이름으로» 남긴다. */
export type Artifact =
  | { readonly kind: 'quote'; readonly name: string; readonly quote: QuoteSnapshot }
  | { readonly kind: 'flow'; readonly name: string; readonly flow: FlowTable }
  | { readonly kind: 'news'; readonly name: string; readonly news: OmniCrawlNews }
  | { readonly kind: 'keyed'; readonly name: string; readonly keyed: KeyedSummary }
  /** 🚨 «이 단계가 실패했다» — ⛔ 「모르는 꼴」과 «다른 값»이다. */
  | { readonly kind: 'failure'; readonly name: string; readonly kindOf: string; readonly head: string }
  | { readonly kind: 'unparsed'; readonly name: string; readonly why: string; readonly head: string };

/** ⛔ 「1,234.5」·「-2,576,734」·「+0.46%」를 읽는다. 못 읽으면 `null`. */
export function parseNum(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const t = raw.replace(/[,%\s]/g, '').replace(/\*/g, '').trim();
  if (t === '' || t === '-' || t === 'N/A') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * 📊 `omni-market quote` 산출을 읽는다.
 * ⛔ 「대상:」 줄이 없으면 심볼을 «지어내지 않고» 제목 줄에서 찾는다. 둘 다 없으면 `null`.
 */
export function parseQuote(text: string): QuoteSnapshot | null {
  const sym =
    /^대상:\s*(\S+)/m.exec(text)?.[1]
    ?? /^##\s+(\S+)\s+Real-Time Quote/m.exec(text)?.[1]
    ?? null;
  if (sym === null) return null;
  const pick = (label: string): string | null =>
    new RegExp(`\\*\\*${label}:\\*\\*\\s*([-+0-9.,]+)`, 'i').exec(text)?.[1] ?? null;
  // 「Change: 35.13 (+0.46%)」 — 값과 퍼센트가 «한 줄»에 있다.
  const chg = /\*\*Change:\*\*\s*([-+0-9.,]+)\s*\(([-+0-9.]+)%\)/i.exec(text);
  const q: QuoteSnapshot = {
    symbol: sym,
    close: parseNum(pick('Close')),
    change: chg ? parseNum(chg[1]) : parseNum(pick('Change')),
    changePct: chg ? parseNum(chg[2]) : null,
    open: parseNum(pick('Open')),
    high: parseNum(pick('High')),
    low: parseNum(pick('Low')),
    volume: parseNum(pick('Volume')),
    prevClose: parseNum(pick('Prev Close')),
  };
  // ⛔ 심볼만 있고 «수가 하나도» 없으면 읽은 것이 아니다.
  const anyNum = [q.close, q.change, q.open, q.high, q.low, q.volume, q.prevClose].some((v) => v !== null);
  return anyNum ? q : null;
}

/**
 * 🔁 「외국인 / 기관 / 개인」 3열 마크다운 표를 읽는다.
 * ⛔ 열 «순서»에 기대지 않는다 — 머리글 이름으로 찾는다(순서가 바뀐 산출을 봤다).
 */
export function parseFlow(text: string): FlowTable | null {
  const lines = text.split('\n');
  const headIdx = lines.findIndex(
    (l) => l.includes('|') && l.includes('외국인') && l.includes('기관') && l.includes('개인'),
  );
  if (headIdx < 0) return null;
  const cells = (l: string) => l.split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
  const head = cells(lines[headIdx] as string);
  const col = (want: string) => head.findIndex((h) => h.includes(want));
  const [ci, cf, cg, cp] = [0, col('외국인'), col('기관'), col('개인')];
  if (cf < 0 || cg < 0 || cp < 0) return null;

  const rows: FlowRow[] = [];
  for (let i = headIdx + 1; i < lines.length; i += 1) {
    const l = lines[i] as string;
    if (!l.includes('|')) { if (rows.length > 0) break; continue; }
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(l)) continue;      // 구분선
    const c = cells(l);
    if (c.length <= Math.max(cf, cg, cp)) continue;
    const key = (c[ci] ?? '').trim();
    if (key === '') continue;
    rows.push({ key, foreign: parseNum(c[cf]), institution: parseNum(c[cg]), individual: parseNum(c[cp]) });
  }
  if (rows.length === 0) return null;

  // 제목 = 표 «위»의 가장 가까운 `##`/`###` 줄. 없으면 첫 비어있지 않은 줄.
  let title = '';
  for (let i = headIdx; i >= 0; i -= 1) {
    const m = /^#{2,3}\s+(.+)$/.exec((lines[i] ?? '').trim());
    if (m) { title = m[1] as string; break; }
  }
  if (title === '') title = lines.find((l) => l.trim() !== '' && !l.includes('━'))?.trim() ?? '(제목 없음)';
  const unit = /\((백만|천|억)\)/.exec(head.join(' '))?.[1] ?? (/\(([^)]*원[^)]*)\)/.exec(head.join(' '))?.[1] ?? null);
  return { title, unit, rows };
}

/**
 * 🔁 **같은 수급을 «JSON 으로» 낸 판** — ⛔ 같은 파일 이름인데 형식이 «바뀌었다».
 *
 * 🚨 45차 실측(102회차 · 산출 242개): `KR-수급-삼성전자.txt` 가 ***19회 `unparsed`*** 였다.
 *    파서가 «없어서»가 아니라 ***옛 회차가 JSON 이었기*** 때문이다(2026-08-29 이전).
 *    ⇒ 🔑 ***「같은 이름 = 같은 꼴」이 아니다.*** 스킬은 우리 소유가 아니고 산출 문면이 바뀐다.
 *    ⭐ 그리고 그것을 «인상»이 아니라 ***수로*** 알았다 — `unparsed` 를 «세는 자»가 있었기 때문이다.
 *
 * ⛔ 마크다운 판과 «같은 `FlowTable`» 로 낸다 — 화면은 둘을 구분할 필요가 «없다».
 */
export function parseFlowJson(text: string): FlowTable | null {
  const t = text.trimStart();
  if (!t.startsWith('{')) return null;
  let d: Record<string, unknown>;
  try { d = JSON.parse(t) as Record<string, unknown>; } catch { return null; }

  const pick = (o: Record<string, unknown>, ...keys: string[]): number | null => {
    for (const k of keys) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; }
    return null;
  };
  const rows: FlowRow[] = [];

  // ⭐ 「기간별」이 있으면 그것을 먼저 — 마크다운 판의 「5일/10일/20일」과 같은 축이다.
  const periods = d.periods;
  if (typeof periods === 'object' && periods !== null && !Array.isArray(periods)) {
    for (const [key, raw] of Object.entries(periods as Record<string, unknown>)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const o = raw as Record<string, unknown>;
      rows.push({
        key,
        foreign: pick(o, 'frgn_net_shares', 'frgn_net_amount_million'),
        institution: pick(o, 'inst_net_shares', 'inst_net_amount_million'),
        individual: pick(o, 'prsn_net_shares', 'prsn_net_amount_million'),
      });
    }
  }
  // 기간별이 없으면 「날짜별」로.
  if (rows.length === 0 && Array.isArray(d.rows)) {
    for (const raw of d.rows as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue;
      const o = raw as Record<string, unknown>;
      const key = typeof o.date === 'string' ? o.date : null;
      if (key === null) continue;
      rows.push({
        key,
        foreign: pick(o, 'frgn_net_shares', 'frgn_net_amount_million'),
        institution: pick(o, 'inst_net_shares', 'inst_net_amount_million'),
        individual: pick(o, 'prsn_net_shares', 'prsn_net_amount_million'),
      });
    }
  }
  if (rows.length === 0) return null;
  const ticker = typeof d.ticker === 'string' ? d.ticker : null;
  const name = typeof d.name === 'string' && d.name !== ticker ? d.name : null;
  const title = name !== null && ticker !== null ? `${name}(${ticker}) 투자자 수급`
    : ticker !== null ? `${ticker} 투자자 수급` : '투자자 수급';
  return { title, unit: '주', rows };
}

/**
 * 🗂️ 「제목 ⊕ `라벨 : 값`」을 읽는다 — ⛔ 봇마다 «전용 파서»를 짓지 않기 위한 «공통 꼴»이다.
 *
 * 🔑 45차 실측: 세 봇의 산출이 «전부 다른 모양»이었다(시세 · 표 · 이 꼴 · 크롤 로그 · 감시 리포트).
 *    ⇒ 전용 파서를 다섯 개 지으면 ***스킬이 문면을 바꾸는 날 다섯이 같이 늙는다.***
 *    ✅ 그래서 「자주 나오는 꼴」만 물고 ***나머지는 `unparsed` 로 «정직하게» 보여 준다.***
 *
 * ⛔ 아무 콜론이나 물지 «않는다» — URL(`https://`)·시각(`12:34`)이 걸리면 쓰레기 카드가 된다.
 *
 * ## 🪦 **안 만든 파서 — 그 판단을 «여기» 남긴다**(2026-09-04 · 45차)
 * `삼성전자-차트-.txt` 는 ***`🎯 매력도 53.1 · HOLD`*** 를 갖고 있어 「가장 값진 한 줄」로 «보였다».
 * ⛔ 그런데 ***재 보니 근거가 없었다***:
 * ```
 * 「차트」 산출이 있는 회차:   ***1 / 24***     · 가장 최근 2026-09-01
 * 「매력도」가 본문에 있는 회차: ***1***        ⇒ ***지금은 «안 나온다»***
 * 🎯 까닭: 대표 이 investor 의 차트 단계를 «뺐다»(`#15326`) — 그 «전날» 산출이었다
 * ```
 * ⇒ 🔑 ***만들었으면 「다시는 안 불릴 파서」를 하나 늘리고, 그것이 늙어 다음 창을 헷갈리게 했다.***
 * ⛔ 46차에게: 「매력도」가 «다시» 나오기 시작하면(세는 자가 그 이름을 여러 번 낼 것이다) 그때 만들어라.
 */
export function parseKeyed(text: string): KeyedSummary | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.includes('━'));
  if (lines.length < 2) return null;
  const entries: { label: string; value: string; num: number | null }[] = [];
  for (const raw of lines.slice(1)) {
    // 「  라벨 : 값」 — ⛔ 콜론 «앞뒤에 공백»이 있는 꼴만 문다(URL·시각을 거른다).
    const m = /^\s{1,}(\S[^:]*?)\s+:\s+(.+?)\s*$/.exec(raw);
    if (m === null) continue;
    const label = (m[1] as string).trim();
    const value = (m[2] as string).trim();
    if (label === '' || value === '' || label.includes('//')) continue;
    entries.push({ label, value, num: parseNum(value) });
  }
  if (entries.length === 0) return null;
  const title = (lines[0] as string).trim();
  return { title, entries };
}

/** 정확한 Omni crawl 울타리 사이의 JSON만 읽는다. 울타리 없이는 `null`, 울타리 안 JSON이 깨지면 까닭을 낸다. */
export function parseOmniCrawlNews(text: string): { news: OmniCrawlNews | null; why: string | null; fenced: boolean } {
  const begin = '---BEGIN_OMNI_CRAWL_JSON---';
  const end = '---END_OMNI_CRAWL_JSON---';
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === begin);
  if (start < 0) return { news: null, why: null, fenced: false };
  const finish = lines.findIndex((line, index) => index > start && line === end);
  if (finish < 0) return { news: null, why: 'Omni crawl JSON 끝 울타리를 «못 찾았다»', fenced: true };

  let payload: unknown;
  try { payload = JSON.parse(lines.slice(start + 1, finish).join('\n')); }
  catch { return { news: null, why: 'Omni crawl 울타리 안 JSON을 «못 읽었다»', fenced: true }; }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { news: null, why: 'Omni crawl JSON 최상위가 객체가 아니다', fenced: true };
  }

  const root = payload as Record<string, unknown>;
  if (!Array.isArray(root.results)) return { news: null, why: 'Omni crawl JSON에 results 배열이 없다', fenced: true };
  const items: OmniCrawlNewsItem[] = [];
  for (const result of root.results) {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) continue;
    const rawItems = (result as Record<string, unknown>).items;
    if (!Array.isArray(rawItems)) continue;
    for (const rawItem of rawItems) {
      if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      items.push({
        title: typeof item.title === 'string' ? item.title : null,
        url: typeof item.url === 'string' ? item.url : null,
        date: typeof item.date === 'string' ? item.date : null,
      });
    }
  }
  return { news: { query: typeof root.query === 'string' ? root.query : null, items }, why: null, fenced: true };
}

/**
 * 🚨 **이 산출이 «실패»인가** — ⛔ 「모르는 꼴」과 «다른 값»이다.
 *
 * 🩸 45차 실측: 남은 `unparsed` 중 상당수가 ***파이썬 Traceback*** ⊕ ***`⛔ Gmail 호출 실패:`*** 였다.
 *    그것을 「못 읽었다」로 그리면 ***「봇의 그 단계가 실패했다」는 사실을 «숨긴다»***.
 *    🔑 「가르고 나면 그 안에서 또 갈릴 것이 있다」 — 이 창이 세 번째로 만난 얼굴이다.
 *
 * ⛔ 「실패 같아 보이는 글」을 함부로 물지 않는다 — ***맨 앞 몇 줄***에서만 찾는다.
 *    (뉴스 본문에 「Traceback」이 나올 수 있다.)
 */
export function detectFailure(text: string): { kindOf: string; head: string } | null {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.includes('━'));
  const head = lines.slice(0, 3).join(' / ').slice(0, 160);
  const probe = lines.slice(0, 3).join('\n');
  if (/^Traceback \(most recent call last\):/m.test(probe)) return { kindOf: '파이썬 예외(Traceback)', head };
  if (/^⛔\s*.*(실패|failed|error)/mi.test(probe)) return { kindOf: '스킬이 «실패»라고 말했다', head };
  if (/^(Error|error):/m.test(probe)) return { kindOf: '오류', head };
  if (/^\s*command not found|No such file or directory/m.test(probe)) return { kindOf: '명령·파일이 «없다»', head };
  return null;
}

/**
 * 하나의 산출 파일을 «무엇인지» 판정해 읽는다.
 * ⛔ 못 읽으면 «버리지 않고» `unparsed` 로 이름과 앞머리를 남긴다 —
 *    화면이 「비었다」가 아니라 ***「이건 못 읽었다」***고 말할 수 있어야 한다.
 */
export function readArtifact(name: string, text: string): Artifact {
  // ⛔ 실패를 «먼저» 본다 — 실패 글이 우연히 어떤 파서에 물리면 «거짓 데이터»가 된다.
  const f0 = detectFailure(text);
  if (f0 !== null) return { kind: 'failure', name, kindOf: f0.kindOf, head: f0.head };
  const q = parseQuote(text);
  if (q !== null) return { kind: 'quote', name, quote: q };
  const f = parseFlow(text) ?? parseFlowJson(text);
  if (f !== null) return { kind: 'flow', name, flow: f };
  const omni = parseOmniCrawlNews(text);
  if (omni.news !== null) return { kind: 'news', name, news: omni.news };
  const head = text.split('\n').filter((l) => l.trim() !== '' && !l.includes('━')).slice(0, 2).join(' / ').slice(0, 120);
  if (omni.fenced) return { kind: 'unparsed', name, why: omni.why as string, head };
  const k = parseKeyed(text);
  if (k !== null) return { kind: 'keyed', name, keyed: k };
  return { kind: 'unparsed', name, why: '아는 꼴이 «아니다»(시세·수급표·뉴스·라벨:값 넷 다 아님)', head };
}
