'use client';

/**
 * 🤖 **봇 회차 카드** — 봇이 «실제로 낸 것»을 사람이 보는 자리 (2026-09-04 · 🅕 45차)
 *
 * ## 🚨 왜 있나
 * 📏 실측: `/bots` 는 ***「명령 카탈로그」만*** 그렸고, 봇이 «실제로 낸 것»(주가·수급)은
 * PWA 어디에도 «없었다». 순수 층(`summarizeBotRound`)은 있었지만 ***소비자 0건***이었다
 * — 이 저장소가 「있는데 안 닿는다」라 부르는 그 얼굴.
 *
 * ## ⛔ 이 화면이 지키는 것
 * ```
 * ① ***「없다」와 「못 받았다」를 «다르게» 그린다*** — 0건은 안내, 오류는 alert
 * ② ***못 읽은 산출을 «숨기지» 않는다*** — `unparsed` 를 이름과 앞머리로 보여 준다
 *    🔑 스킬 산출 문면이 바뀌면 «화면이 먼저 말해야» 한다(조용히 비면 아무도 모른다)
 * ③ ***시각에 시간대를 «붙인다»*** — 이 저장소가 UTC/KST 로 여러 번 틀렸다
 * ④ ⛔ ***차트를 안 그린다*** — 대표 이 investor 차트를 뺐다(`#15326`). 「글」만 낸다
 * ```
 */
import { useEffect, useState } from 'react';
import type { DaemonClient } from '@/lib/daemon-client';
import {
  toRoundsState, formatWhen, fmtNum,
  type RoundsState, type RoundView,
} from '@/lib/bot-rounds';
import type { Artifact } from '../../../../../src/bots/investor-round';

/** ⛔ 라우트는 🅣 소유다 — 아직 «없을 수» 있고, 그때 화면은 «조용히 비면 안 된다». */
async function loadRounds(
  client: Pick<DaemonClient, 'fetchJson'>, persona: string, limit: number,
): Promise<RoundsState> {
  try {
    const raw = await client.fetchJson<unknown>(`/v1/bots/rounds?persona=${encodeURIComponent(persona)}&limit=${limit}`);
    return toRoundsState(raw);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error);
    return { kind: 'error', reason };
  }
}

/**
 * ⛔⭐ **아래 세 블록은 «시험 때문에» export 한다 — 그 이유를 여기 적어 둔다.**
 * `react-hook-harness` 의 `textOf` 는 `props.children` 만 훑고 ***함수 컴포넌트를 «호출하지 않는다»***.
 * ⇒ 상위(`RoundCard`)에서 물면 ***헤더만 잡히고 블록은 «안 보인다»*** — 45차가 그걸 모르고 세 번 헛짚었다.
 * 🔑 ***제품 코드를 시험에 맞춰 «비틀지» 않고, 시험을 «층에» 맞춘다*** — 그래서 블록마다 문다.
 */
export function QuoteBlock({ a }: { a: Extract<Artifact, { kind: 'quote' }> }) {
  const q = a.quote;
  const up = q.changePct !== null && q.changePct > 0;
  const down = q.changePct !== null && q.changePct < 0;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3" data-testid={`quote-${q.symbol}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h4 className="font-mono text-sm font-semibold">{q.symbol}</h4>
        <span className="text-lg font-bold tabular-nums">{fmtNum(q.close)}</span>
        <span
          className={`text-sm font-semibold tabular-nums ${up ? 'text-emerald-600' : down ? 'text-rose-600' : 'text-muted-foreground'}`}
        >
          {fmtNum(q.change, { sign: true })}
          {q.changePct !== null && ` (${fmtNum(q.changePct, { sign: true })}%)`}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        {([['시가', q.open], ['고가', q.high], ['저가', q.low], ['전일', q.prevClose]] as const).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt>{k}</dt>
            <dd className="tabular-nums text-foreground">{fmtNum(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FlowBlock({ a }: { a: Extract<Artifact, { kind: 'flow' }> }) {
  const f = a.flow;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3" data-testid="flow-block">
      <h4 className="text-sm font-semibold">{f.title}</h4>
      {f.unit !== null && <p className="mt-0.5 text-xs text-muted-foreground">단위: {f.unit}</p>}
      {/* ⛔ 넓은 표는 «자기 안에서» 스크롤한다 — 페이지 가로 스크롤을 만들지 않는다 */}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-medium">기간</th>
              {['외국인', '기관', '개인'].map((h) => (
                <th key={h} className="py-1 text-right font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {f.rows.slice(0, 6).map((r) => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="py-1 font-mono">{r.key}</td>
                {([r.foreign, r.institution, r.individual] as const).map((v, i) => (
                  <td
                    key={i}
                    className={`py-1 text-right tabular-nums ${v === null ? 'text-muted-foreground' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : ''}`}
                  >
                    {fmtNum(v, { sign: true })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.rows.length > 6 && (
        <p className="mt-1 text-xs text-muted-foreground">…{f.rows.length - 6}줄 더 (전체는 회차 원본에)</p>
      )}
    </div>
  );
}

/** 🗂️ 「제목 ⊕ 라벨:값」 — 비서의 메일·일정 요약이 이 모양이다. */
export function KeyedBlock({ a }: { a: Extract<Artifact, { kind: 'keyed' }> }) {
  const k = a.keyed;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3" data-testid="keyed-block">
      <h4 className="text-sm font-semibold">{k.title}</h4>
      <dl className="mt-2 grid gap-1 sm:grid-cols-2">
        {k.entries.map((e) => (
          <div key={e.label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{e.label}</dt>
            {/* ⛔ 「0」을 «흐리게» 그리지 않는다 — 0 도 «잰 값»이다 */}
            <dd className="font-semibold tabular-nums">{e.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 📰 Omni crawl 기사를 title·url·date로 전용 표시한다. */
export function NewsBlock({ a }: { a: Extract<Artifact, { kind: 'news' }> }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3" data-testid="news-block">
      <h4 className="text-sm font-semibold">{a.news.query === null ? '뉴스' : `뉴스: ${a.news.query}`}</h4>
      {a.news.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">수집된 기사가 0건이다.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {a.news.items.map((item, index) => (
            <li key={`${item.url ?? item.title ?? 'article'}-${index}`} className="text-sm">
              {item.url === null ? item.title ?? '(제목 없음)' : <a className="font-medium underline underline-offset-2" href={item.url}>{item.title ?? item.url}</a>}
              {item.date !== null && <span className="ml-2 text-xs text-muted-foreground">{item.date}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 🚨 **이 단계가 «실패»했다** — ⛔ 「모르는 꼴」과 «다르게» 그린다.
 * 🩸 45차 실측: Traceback·「⛔ Gmail 호출 실패」를 `unparsed` 로 그리면
 *    ***「봇이 실패했다」는 사실이 «회색 안내»에 묻힌다.***
 */
export function FailureBlock({ a }: { a: Extract<Artifact, { kind: 'failure' }> }) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3" data-testid="failure-block">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="font-mono text-sm font-semibold">{a.name}</h4>
        <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700">이 단계가 «실패»했다</span>
      </div>
      <p className="mt-1 text-xs text-rose-700">{a.kindOf}</p>
      {/* ⛔ 본문을 «자르되» 보여 준다 — 무엇이 실패했는지 사람이 알아야 한다 */}
      <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{a.head}</p>
    </div>
  );
}

/** ⛔ 「못 읽었다」를 «보여 준다» — 숨기면 산출 문면이 바뀐 것을 아무도 모른다. */
export function UnparsedBlock({ a }: { a: Extract<Artifact, { kind: 'unparsed' }> }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/40 p-3" data-testid="unparsed-block">
      <h4 className="font-mono text-sm">{a.name}</h4>
      <p className="mt-1 text-xs text-amber-600">⚠️ 이 산출을 «못 읽었다» — {a.why}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{a.head}</p>
    </div>
  );
}

export function RoundCard({ round }: { round: RoundView }) {
  const failed = round.failed !== null && round.failed > 0;
  return (
    <article className="rounded-xl border border-border bg-card p-5" data-testid={`round-${round.runId ?? 'unknown'}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{formatWhen(round.atUtc)}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* ⭐ 「무인인가」를 화면이 «말한다» — 이 축이 이 저장소의 관심사다 */}
          <span className={`rounded px-2 py-0.5 font-medium ${round.source === 'cron' ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
            {round.source === 'cron' ? '무인(cron)' : round.source === 'manual' ? '손' : '출처 «모름»'}
          </span>
          <span className={`rounded px-2 py-0.5 font-medium ${failed ? 'bg-rose-500/15 text-rose-700' : 'bg-muted text-muted-foreground'}`}>
            {round.steps === null ? '단계 «모름»' : `${round.steps}단계`}{failed && ` · 실패 ${round.failed}`}
          </span>
          <span className={`rounded px-2 py-0.5 font-medium ${round.delivered === true ? 'bg-sky-500/15 text-sky-700' : 'bg-muted text-muted-foreground'}`}>
            {round.delivered === null ? '배달 «모름»' : round.delivered ? '폰에 갔다' : '안 갔다'}
          </span>
        </div>
      </header>

      <div className="mt-4 space-y-3">
        {round.artifacts.map((a, i) =>
          a.kind === 'quote' ? <QuoteBlock key={i} a={a} />
            : a.kind === 'flow' ? <FlowBlock key={i} a={a} />
              : a.kind === 'news' ? <NewsBlock key={i} a={a} />
                : a.kind === 'keyed' ? <KeyedBlock key={i} a={a} />
                  : a.kind === 'failure' ? <FailureBlock key={i} a={a} />
                  : <UnparsedBlock key={i} a={a} />)}
        {round.artifacts.length === 0 && round.textless.length === 0 && (
          <p className="text-sm text-muted-foreground">이 회차에 산출이 «없다».</p>
        )}
        {round.textless.length > 0 && (
          <p className="text-xs text-muted-foreground">
            본문을 «안 받은» 산출 {round.textless.length}건: {round.textless.join(' · ')}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * ⛔⭐ **봇 «하나»의 회차 절 — 투자 전용이 아니다.**
 * 🔑 45차 실측: 세 봇의 산출이 «전부 다른 모양»이라 전용 절을 셋 지으면 같이 늙는다.
 *    ⇒ ***절은 하나고, 모르는 산출은 `unparsed` 로 «정직하게» 보여 준다.***
 */
export function BotRounds({
  client, persona, title, subtitle, limit = 3,
}: {
  client: Pick<DaemonClient, 'fetchJson'>;
  persona: string;
  title: string;
  subtitle: string;
  limit?: number;
}) {
  const [state, setState] = useState<RoundsState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void loadRounds(client, persona, limit).then((next) => { if (active) setState(next); });
    return () => { active = false; };
  }, [client, persona, limit]);

  return (
    <section className="flex flex-col gap-4" aria-label={`${persona} rounds`} data-testid={`rounds-${persona}`}>
      <header>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {state.kind === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">투자 회차를 불러오는 중…</p>
      )}

      {/* ⛔ 「못 받았다」는 alert 다 — 「0건」과 «다르게» 보여야 한다 */}
      {state.kind === 'error' && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">회차를 «못 받았다».</p>
          <p className="mt-1 text-xs text-muted-foreground">{state.reason}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            ⚠️ 라우트 <code className="font-mono">/v1/bots/rounds</code> 가 아직 «없을 수» 있다(🅣 축).
            그때는 이 자리가 비는 것이 «맞다» — 화면이 그것을 말하고 있다.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.rounds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          회차가 «0건»이다.{state.unreadable > 0 && ` (못 읽은 자리 ${state.unreadable}곳 — 「없다」가 아니다)`}
        </p>
      )}

      {state.kind === 'ready' && state.rounds.length > 0 && (
        <>
          {/* 🩺 ⛔ 「못 읽음」을 «한 덩어리»로 경보하지 않는다 — 45차 실물: 45곳이 «전부 옛 회차»였는데
              화면이 그것을 경보처럼 보이게 했다. ⇒ ***「지금 깨진 것」이 있을 때만*** alert 를 올린다. */}
          {state.unreadableNow > 0 ? (
            <p role="alert" className="text-xs text-amber-600">
              ⚠️ ***지금 못 읽는 자리 {state.unreadableNow}곳*** — 아래 수는 «과소»다.
            </p>
          ) : state.unreadable > 0 ? (
            <p className="text-xs text-muted-foreground">
              못 읽은 자리 {state.unreadable}곳(옛 회차) — 「지금 깨진 것」은 «없다».
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            {state.rounds.map((r) => <RoundCard key={r.runId ?? r.atUtc ?? Math.random()} round={r} />)}
          </div>
        </>
      )}
    </section>
  );
}

/** 📈 투자 봇 — ⛔ 차트는 «일부러» 안 그린다(대표 이 뺐다 · `#15326`). */
export function InvestorRounds({ client, limit = 3 }: { client: Pick<DaemonClient, 'fetchJson'>; limit?: number }) {
  return (
    <BotRounds
      client={client} persona="investor" limit={limit}
      title="📈 투자 회차"
      subtitle="봇이 «실제로 낸» 산출이다. ⛔ 차트는 «일부러» 안 그린다 — 글만 낸다."
    />
  );
}

/** 🗓️ 비서 봇 — 메일·일정 요약. */
export function AssistantRounds({ client, limit = 2 }: { client: Pick<DaemonClient, 'fetchJson'>; limit?: number }) {
  return (
    <BotRounds
      client={client} persona="assistant" limit={limit}
      title="🗓️ 비서 회차"
      subtitle="안 읽은 메일·앞으로의 일정. ⛔ 「0」도 «잰 값»이라 그대로 보여 준다."
    />
  );
}

/** 📰 뉴스 봇 — ⚠️ 산출 꼴이 여럿이라 상당수가 `unparsed` 로 뜬다(그것이 «정직»하다). */
export function NewsbotRounds({ client, limit = 2 }: { client: Pick<DaemonClient, 'fetchJson'>; limit?: number }) {
  return (
    <BotRounds
      client={client} persona="newsbot" limit={limit}
      title="📰 뉴스 회차"
      subtitle="⚠️ 이 봇의 산출은 꼴이 여럿이다 — 못 읽은 것은 «이름을 대고» 남는다."
    />
  );
}
