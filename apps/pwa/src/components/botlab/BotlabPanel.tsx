'use client';

/**
 * 🖥️⭐ **§22 `A0`·`A1` — 봇 화면을 «한 자리»에서 본다** (🅕 45차)
 *
 * ⛔⭐⭐ **이 화면이 «짓지 않는» 것부터 적는다** — 그것이 이 축의 설계다:
 * ```
 * ⛔ 새 전송·새 렌더      화면(noVNC)·경로(tailscale serve)·벽(bot-wall.html)이 «이미» 있다
 * ⛔ iframe 「넷」        §22n ⑵ 실측: 독립 문서 넷 = RFB 세션 넷 ⇒ ***비번을 네 번*** 친다
 *                        ✅ 그래서 ***문서는 «하나»***다(벽이 RFB 를 넷 연다 ⇒ 비번 «한 번»)
 * ⛔ 실행 버튼           POST 라우트가 «없다»(P2 는 🅣 소유) — 없는 것을 버튼으로 만들지 않는다
 * ⛔ 조작                기본이 «보기 전용»이다(§22n ④) — 조작은 벽에서 `&control=1` 로 명시
 * ⛔ 기존 라우트 수정     §22 A0: 새 축이 남의 화면을 흔들면 아무도 안 쓴다
 * ```
 *
 * ### ⛔ 「안 보인다」를 «고장»으로 읽지 않게 — 이 화면은 «자기가 무엇을 못 하는지» 말한다
 * §22n ⑷ 실측이 기기를 «가른다»: 태일넷 «밖» 기기에선 그 주소가 애초에 없고,
 * 태일넷 «안»이어도 http 주소면 Mixed Content 로 막힌다. ⇒ 그래서 ***쓴 주소를 «항상» 보여 준다.***
 */

import { useEffect, useMemo } from 'react';
import { resolveWallHost, WALL_HOST_STORAGE_KEY } from '@/lib/botlab-wall';

/** ⛔ 벽의 «정문»은 화면 3 이다(deploy-bot-wall.sh 가 마지막에 그 주소를 낸다). */
const WALL_PATH = '/bot3/bot-wall.html';

export function botWallUrl(host: string): string {
  return `https://${host}${WALL_PATH}`;
}

export function BotlabPanel({ search, remembered = null }: { search: string; remembered?: string | null }) {
  const resolved = useMemo(() => resolveWallHost(search, remembered), [search, remembered]);
  const url = resolved.source === 'unset' ? null : botWallUrl(resolved.host);
  useEffect(() => {
    // ⭐ 사람이 준 ?host= 는 이 기기에 «기억»한다 — 다음부터는 질의 없이 연다.
    if (resolved.source !== 'query') return;
    try { window.localStorage.setItem(WALL_HOST_STORAGE_KEY, resolved.host); } catch { /* 저장 불가 기기 — 매번 ?host= */ }
  }, [resolved.source, resolved.host]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10" data-testid="botlab-panel">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Bot screens</p>
        <h1 className="mt-2 text-3xl font-bold">Botlab</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Live noVNC screens for the bots, served through Tailscale. One document holds all four sessions,
          so the VNC password is asked <strong>once</strong>, not four times.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          View-only by default. This surface cannot send commands or control the bots.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-4" aria-label="Wall address">
        <h2 className="text-sm font-semibold">Wall address</h2>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground" data-testid="botlab-wall-url">{url ?? '(no host configured)'}</p>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="botlab-host-source">
          {resolved.source === 'query'
            ? 'Host came from the ?host= query parameter (remembered on this device).'
            : resolved.source === 'remembered'
              ? 'Host is the one remembered on this device; override it with ?host=<tailnet-name>.'
              : resolved.source === 'default'
                ? 'Host is the build default (NEXT_PUBLIC_MONAD_BOTLAB_HOST); override it with ?host=<tailnet-name>.'
                : 'No wall host is configured. Open this page once with ?host=<the VM tailnet name> — it is remembered on this device.'}
        </p>
        {resolved.rejected !== null && (
          <p role="alert" className="mt-2 text-xs text-destructive" data-testid="botlab-host-rejected">
            Ignored ?host={resolved.rejected} — not a valid hostname.
          </p>
        )}
        {url !== null && <p className="mt-3 text-xs text-muted-foreground">
          <a className="underline" href={url} target="_blank" rel="noreferrer" data-testid="botlab-open-tab">
            Open the wall in a new tab
          </a>
          {' — '}use this if the embedded frame stays blank.
        </p>}
      </section>

      {url !== null && <section aria-label="Bot screen wall">
        <iframe
          src={url}
          title="Bot screen wall"
          data-testid="botlab-wall-frame"
          className="h-[70vh] w-full rounded-xl border border-border bg-background"
        />
      </section>}

      {/* ⛔ 「빈 화면」을 «고장»으로 읽지 않게 — 그 이유가 «셋»이고 처방이 각각 다르다(§22n ⑷) */}
      <section className="rounded-xl border border-border bg-card p-5" aria-label="If the wall is blank">
        <h2 className="text-sm font-semibold">If the wall stays blank</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A blank frame is not necessarily a broken bot. There are three separate reasons, with different fixes:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <strong>This device is outside the tailnet.</strong> The address simply does not exist here.
            Join the tailnet, or view the screens from a device that is on it.
          </li>
          <li>
            <strong>Tailscale serve is not published.</strong> Re-run{' '}
            <code className="font-mono text-xs">bash scripts/botlab/deploy-bot-wall.sh</code>, which
            re-publishes the paths and then verifies each one returns 200.
          </li>
          <li>
            <strong>The wall loaded but did not connect.</strong> That is a VNC-level failure, not a page
            failure — the wall itself reports connected/failed counts once you enter the password.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          The VNC password is deliberately not carried in this page or in the URL: any page a bot browser
          opens could otherwise reach the local websocket, and websockets have no CORS.
        </p>
      </section>

      {/* ⛔ 「아직 없는 것」을 «말한다» — 없는 것을 UI 로 흉내내지 않는다 */}
      <section className="rounded-xl border border-dashed border-border p-5" aria-label="Not wired yet">
        <h2 className="text-sm font-semibold">Not wired yet</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Per-bot cell headers (name · last round verdict · whether CDP is alive) need{' '}
            <code className="font-mono text-xs">browserPort</code> and round results on the daemon&apos;s
            persona route. That route is owned by another track and is not published today.
          </li>
          <li>Running a command from this surface needs a POST route that does not exist yet.</li>
        </ul>
      </section>
    </main>
  );
}

export function BotlabPageContent() {
  // ⛔ 정적 export 라 서버가 질의를 안 준다 — 브라우저에서 읽는다. SSR 때는 «빈 문자열»이다.
  const search = typeof window === 'undefined' ? '' : window.location.search;
  let remembered: string | null = null;
  try { remembered = typeof window === 'undefined' ? null : window.localStorage.getItem(WALL_HOST_STORAGE_KEY); } catch { remembered = null; }
  return <BotlabPanel search={search} remembered={remembered} />;
}
