/**
 * 📂 **봇 회차를 «원장에서 읽어» 전선 모양으로** — `GET /v1/bots/rounds` 의 «본체» (2026-09-04 · 🅕 45차)
 *
 * ## 🚨 왜 여기 있나 (⛔ `src/nexus/` 가 아니라)
 * 선례 = `botCommandCatalog()`(🅕) ↔ `handleBotCommands()`(🅣 · **28줄**).
 * ***본체는 축 소유자가 세우고, 라우트는 얇게 얹는다.*** 그래야 라우트 없이도 «전부» 시험된다.
 * ⇒ 🅣 가 얹을 것은 한 줄이다:
 * ```ts
 * if (pathname === '/v1/bots/rounds') return jsonResponse(readBotRounds(url.searchParams), 200);
 * ```
 *
 * ## ⛔ 이 자가 지키는 규율
 * ```
 * ① ***「0건」과 「못 읽었다」를 «가른다»*** — 못 읽은 자리를 `unreadable` 로 «세어» 낸다.
 *    🔑 그래야 화면이 「없다」와 「내 수가 과소다」를 다르게 말한다.
 * ② ***시각을 «UTC 그대로»*** — 디렉토리 이름이 UTC 다(45차가 이걸로 「오늘 0건」 오판할 뻔했다).
 * ③ ***파싱하지 않는다*** — `.txt` 는 «본문 그대로» 넘긴다. 읽는 것은 화면 쪽 `investor-round.ts` 의 몫.
 * ④ ***큰 본문을 «막을 수» 있다*** — `withText=0` 이면 이름·크기만(목록 화면이 가벼워진다).
 * ⑤ ⛔ ***경로를 «지어내지» 않는다*** — persona 이름에 `/`·`..` 가 오면 «거부»한다.
 * ⑥ ⛔ 그림(.png)을 «싣지 않는다» — 대표 이 차트를 뺐다(`#15326`). 이름조차 본문으로 안 준다.
 * ```
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RoundArtifactWire {
  readonly name: string;
  readonly chars: number;
  /** `withText=0` 이면 «없다». ⛔ 빈 문자열이 «아니다» — 화면이 그 둘을 가른다. */
  readonly text?: string;
}

export interface RoundWire {
  readonly personaId: string;
  readonly runId: string | null;
  /** ⛔ UTC. 디렉토리 이름이 그 꼴이다. */
  readonly atUtc: string | null;
  readonly ok: boolean | null;
  readonly steps: number | null;
  readonly failed: number | null;
  readonly source: string;
  readonly delivery: { readonly sent: boolean | null; readonly photosSent: number | null; readonly chars: number | null };
  readonly artifacts: readonly RoundArtifactWire[];
}

export interface RoundsWire {
  readonly rounds: readonly RoundWire[];
  /** ⛔ 「0」이 아니라 «못 읽은 자리의 수». 0 이 아니면 위 수는 ***과소***다. */
  readonly unreadable: number;
  /**
   * 🩺⭐ **못 읽은 «까닭»별 수** — ⛔ 「45」라는 수 하나로는 «경보인지 선사시대인지» 못 가른다.
   *
   * 🩸 45차 실물: `unreadable 45` 를 내 손으로 내고도 «무엇인지 안 봤다».
   *    파 보니 ***전부 2026-08-26***(봇 컴퓨터를 처음 세운 날) — `RESULT.json` 이 «생기기 전» 회차였다.
   *    그 뒤 57건은 «전부 있다». ⇒ ***결손이 아니라 선사시대다.***
   *    🔑 그런데 도구는 그것을 「⚠️ 과소다」로만 말해 ***양성을 경보처럼*** 보이게 했다.
   * ⇒ 그래서 «까닭»을 나눈다. 사람이 「이건 옛것」과 「이건 지금 깨졌다」를 가를 수 있게.
   */
  readonly unreadableBy: Readonly<Record<UnreadableReason, number>>;
}

/** 못 읽은 «까닭». ⛔ 늘리려면 화면·도구도 같이 본다(수만 늘면 아무도 안 읽는다). */
export type UnreadableReason =
  /** 회차 디렉토리에 `RESULT.json` 이 «없다» — 옛 회차일 수 있다(도입 전). */
  | 'result-missing'
  /** 있는데 «JSON 이 아니다» — ⚠️ 이건 «지금» 깨진 것이다. */
  | 'result-broken'
  /** persona 나 뿌리 디렉토리를 «못 읽었다». */
  | 'dir-unreadable'
  /** 산출 파일 하나를 «못 읽었다». */
  | 'artifact-unreadable'
  /** 인자가 «안전하지 않다»(경로 탈출 등). */
  | 'rejected';

/** ⛔ 경로 조각으로 «쓸 수 있나». `/`·`..`·빈 것을 거부한다. */
export function isSafeSegment(v: string): boolean {
  return v !== '' && v !== '.' && v !== '..' && !v.includes('/') && !v.includes('\\') && !v.includes('\0');
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** 디렉토리 이름(`2026-09-02T22-40-01-268Z`)을 ISO 로. ⛔ 못 읽으면 `null` — 지어내지 않는다. */
export function dirNameToUtc(name: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  if (m === null) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

/** ⛔ 그림·원장 파일은 «산출»이 아니다. 본문으로 줄 것만 고른다. */
export function isArtifactFile(name: string): boolean {
  return name.endsWith('.txt');
}

export interface ReadOpts {
  /** `~/.elanous` 같은 상태 뿌리. ⛔ 부르는 쪽이 정한다(격리 우주를 이 자가 «가정하지 않는다»). */
  readonly stateRoot: string;
  readonly persona?: string | undefined;
  readonly limit?: number | undefined;
  readonly withText?: boolean | undefined;
  /** 한 산출의 본문 상한(바이트 기준 근사). 넘으면 잘라 «잘렸음»을 chars 로 알 수 있다. */
  readonly maxTextChars?: number | undefined;
}

/**
 * 원장에서 회차를 읽는다.
 * ⛔ 던지지 «않는다» — 못 읽은 자리는 `unreadable` 로 «세어» 낸다(그래야 화면이 과소를 말한다).
 */
export function readBotRounds(opts: ReadOpts): RoundsWire {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));
  const withText = opts.withText !== false;
  const maxChars = Math.max(200, opts.maxTextChars ?? 20_000);
  const root = join(opts.stateRoot, 'botlab');
  const why: Record<UnreadableReason, number> = {
    'result-missing': 0, 'result-broken': 0, 'dir-unreadable': 0, 'artifact-unreadable': 0, rejected: 0,
  };
  const bump = (r: UnreadableReason) => { why[r] += 1; };
  const total = () => Object.values(why).reduce((a, b) => a + b, 0);

  let personas: string[];
  if (opts.persona !== undefined) {
    if (!isSafeSegment(opts.persona)) { bump('rejected'); return { rounds: [], unreadable: total(), unreadableBy: why }; }
    personas = [opts.persona];
  } else {
    try {
      personas = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && isSafeSegment(e.name)).map((e) => e.name).sort();
    } catch { bump('dir-unreadable'); return { rounds: [], unreadable: total(), unreadableBy: why }; }
  }

  const rounds: RoundWire[] = [];
  for (const personaId of personas) {
    const pdir = join(root, personaId);
    let dirs: string[];
    try {
      dirs = readdirSync(pdir, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name)
        .sort().reverse().slice(0, limit);          // ⭐ UTC 이름이라 «사전순 역»이 곧 최신순이다
    } catch { bump('dir-unreadable'); continue; }

    for (const dname of dirs) {
      const ddir = join(pdir, dname);
      let meta: Record<string, unknown> = {};
      const rj = join(ddir, 'RESULT.json');
      if (existsSync(rj)) {
        try { meta = JSON.parse(readFileSync(rj, 'utf8')) as Record<string, unknown>; }
        catch { bump('result-broken'); }
      } else bump('result-missing');

      const artifacts: RoundArtifactWire[] = [];
      let names: string[];
      try { names = readdirSync(ddir).filter(isArtifactFile).sort(); }
      catch { bump('dir-unreadable'); names = []; }
      for (const n of names) {
        const fp = join(ddir, n);
        let chars = 0;
        try { chars = statSync(fp).size; } catch { bump('artifact-unreadable'); continue; }
        if (!withText) { artifacts.push({ name: n, chars }); continue; }
        try {
          const raw = readFileSync(fp, 'utf8');
          artifacts.push({ name: n, chars: raw.length, text: raw.slice(0, maxChars) });
        } catch { bump('artifact-unreadable'); artifacts.push({ name: n, chars }); }
      }

      const d = (meta.delivery ?? {}) as Record<string, unknown>;
      rounds.push({
        personaId: str(meta.personaId) ?? personaId,
        runId: str(meta.runId),
        atUtc: str(meta.finishedAtUtc) ?? dirNameToUtc(dname),
        ok: bool(meta.ok),
        steps: num(meta.steps),
        failed: num(meta.failed),
        source: str(meta.source) ?? 'unknown',      // ⛔ 「손」으로 가정하지 않는다
        delivery: { sent: bool(d.sent), photosSent: num(d.photosSent), chars: num(d.chars) },
        artifacts,
      });
    }
  }
  // ⭐ 여러 봇을 한 번에 물었으면 «시각 역순»으로 섞는다(봇별 묶음이 아니라 «최근순»).
  rounds.sort((a, b) => (b.atUtc ?? '').localeCompare(a.atUtc ?? ''));
  return { rounds, unreadable: total(), unreadableBy: why };
}

/** 🅣 라우트가 부르기 쉬운 꼴 — `URLSearchParams` 하나로. ⛔ 이 자가 stateRoot 를 «정하지 않는다». */
export function readBotRoundsFromQuery(params: URLSearchParams, stateRoot: string): RoundsWire {
  const persona = params.get('persona');
  const limitRaw = params.get('limit');
  const n = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10);
  return readBotRounds({
    stateRoot,
    ...(persona !== null && persona !== '' ? { persona } : {}),
    ...(n !== undefined && Number.isFinite(n) ? { limit: n } : {}),
    withText: params.get('withText') !== '0',
  });
}
