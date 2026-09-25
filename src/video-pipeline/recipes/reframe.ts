/**
 * 🖼️⭐⭐ 비율 리프레임 — ***「자르기/검은 띠」 말고 «채우는» 길을 고른다.***
 *
 * 대표 2026-09-22: *"affinity 를 이용하여 편집이 가능하지 않을까요? 생성된 이미지가 비율대로 안나오기때문에"*
 *
 * ⛔ 종전 정규화는 «한 가지»였다 — `scale=decrease + pad=black`.
 *   돌기는 돌았고 종단도 delivered 였지만, ***검은 띠가 남은 것을 아무 관문도 안 봤다.***
 *
 * 📐 이제 «셋»을 순서로 고른다. ⛔ 위가 안 되면 아래로 가되 ***무엇이 안 됐는지를 들고 간다.***
 * ```
 *   ① affinity   앱 내장 MCP 로 «커버 블러 배경 ⊕ 원본 온전히»  ⇒ 가장 낫다
 *                ⛔ 앱이 떠 있어야 한다(drive: app-attached)
 *   ② ffmpeg-blur  같은 구도를 ffmpeg 로 — 흐린 배경 ⊕ 원본 온전히
 *   ③ ffmpeg-pad   검은 띠. ***마지막 수단***이고, 쓰였으면 산출이 그렇게 말한다
 * ```
 *
 * 🔑 ⛔ ***「앱이 꺼져 있다」는 «실패»가 아니라 «못 쟀다»다.***
 *   그래서 ①이 안 될 때 그것을 «오류»로 적지 않고 «건너뛴 이유»로 적는다.
 *   ⇒ 산출을 보면 ***「왜 ③으로 갔나」를 알 수 있다.*** 안 그러면 검은 띠만 보이고 이유가 없다.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './ffmpeg.js';

export type ReframeMethod = 'affinity' | 'ffmpeg-blur' | 'ffmpeg-pad';

export interface ReframeResult {
  readonly ok: boolean;
  readonly method?: ReframeMethod;
  /** ⛔ 건너뛴 칸과 «이유» — 비면 「아무것도 안 해 봤다」가 된다. */
  readonly skipped: { method: ReframeMethod; why: string }[];
  readonly why?: string;
}

/**
 * ⛔⭐⭐ ***이 probe 는 «항상» 최대 시간을 다 쓴다*** — 그래서 두 가지를 한다.
 *
 * 🩸 실측 2026-09-22(이 파일의 시험을 쓰다 드러났다):
 *   SSE 는 ***스트림을 「안 닫는 것이 정상」***이라 curl 이 늘 timeout 으로 끝난다.
 *   ⇒ `--max-time 5` 면 ***붙든 안 붙든 «매번» 5초***다. 소재 6장이면 ***탐지에만 30초.***
 *   ⛔ 「돌긴 돈다」라 시험을 안 썼으면 «영영» 못 봤다. 5초 기본 타임아웃이 그것을 때려서 보였다.
 *
 * ✅ ⓐ 상태 줄은 «즉시» 온다 — 2초면 넉넉하다(스트림을 읽을 «이유가 없다»).
 * ✅ ⓑ ***한 런 안에서 캐시한다*** — 앱이 런 도중에 켜지고 꺼지지 않는다.
 *    ⛔ 다만 「못 쟀다」(null)는 «캐시하지 않는다» — 일시적일 수 있고,
 *      그것을 굳히면 ***한 번 흔들린 네트워크가 런 전체를 결정한다.***
 */
let REACH_CACHE: boolean | undefined;

/** Affinity MCP 가 «지금» 붙나. ⛔ 세 값 — 붙는다 · 안 듣는다 · 못 쟀다. */
export function affinityReachable(url = 'http://localhost:6767/sse'): boolean | null {
  if (REACH_CACHE !== undefined) return REACH_CACHE;
  // ⛔⭐ ***상태 코드를 얻었으면 그것이 답이다.*** 종료 코드는 그것을 «못 얻었을 때»만 본다.
  const r = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', url], 8_000);
  const code = Number(`${r.out}`.trim());
  let v: boolean | null;
  if (Number.isFinite(code) && code > 0) v = code >= 200 && code < 400;
  else if (r.code === 7) v = false;            // 아무도 안 듣는다
  else v = null;                                // ⛔ 「없다」와 «다른 값»
  if (v !== null) REACH_CACHE = v;              // ⛔ 「못 쟀다」는 굳히지 않는다
  return v;
}

/** ⛔ 시험·장기 실행이 캐시를 «비울» 수 있어야 한다 — 안 그러면 한 판정이 영원히 남는다. */
export function resetAffinityReachCache(): void { REACH_CACHE = undefined; }

/**
 * 한 장을 목표 크기로 리프레임한다.
 * ⛔ `outPath` 는 ***홈 아래***여야 한다 — Affinity 는 `/tmp` 로 «못 내보낸다»(PERMISSION_DENIED).
 *   그 사실을 여기서 «먼저» 보고 ①을 건너뛴다(스크립트 맨 끝에서 죽는 것을 막는다).
 */
export function reframeOne(opts: {
  src: string; out: string; width: number; height: number;
  scriptDir: string; blur?: number; mirror?: boolean;
}): ReframeResult {
  const skipped: { method: ReframeMethod; why: string }[] = [];
  const { src, out, width: W, height: H } = opts;
  const blur = opts.blur ?? 40;

  // ── ① Affinity ────────────────────────────────────────────────────
  const homeOk = !/^\/(tmp|private\/tmp|var)\//.test(out);
  const reach = homeOk ? affinityReachable() : false;
  if (!homeOk) {
    skipped.push({ method: 'affinity', why: `산출 경로가 «홈 밖»이라 Affinity 가 못 내보낸다: ${out}` });
  } else if (reach === null) {
    skipped.push({ method: 'affinity', why: 'MCP 에 «못 물어봤다» — 실패가 아니라 측정 불가' });
  } else if (reach === false) {
    skipped.push({ method: 'affinity', why: 'Affinity 가 «안 떠 있다»(MCP 6767 무응답)' });
  } else {
    const sh = join(opts.scriptDir, 'affinity', 'reframe.sh');
    if (!existsSync(sh)) {
      skipped.push({ method: 'affinity', why: `러너가 없다: ${sh}` });
    } else {
      const r = run('bash', [sh, src, out, String(W), String(H), String(blur),
        opts.mirror === true ? '1' : '0'], 300_000);
      if (r.ok && existsSync(out)) return { ok: true, method: 'affinity', skipped };
      // ⛔ 종료코드 2 는 «못 쟀다»다 — 실패로 적지 않는다.
      skipped.push({
        method: 'affinity',
        why: r.code === 2 ? 'Affinity 가 «안 떠 있다»(러너가 2를 냈다)'
                          : `러너 실패(code=${r.code}): ${r.err.split('\n').filter(Boolean).slice(-1)[0] ?? ''}`,
      });
    }
  }

  // ── ② ffmpeg 흐린 배경 ────────────────────────────────────────────
  // ⛔ 반경을 «고정»하지 않는다 — 캔버스가 작으면 다 뭉개지고 크면 안 흐려진다.
  const radius = Math.max(2, Math.round(Math.min(W, H) / 18));
  const blurVf =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
    + `boxblur=luma_radius=${radius}:luma_power=2[bg];`
    + `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];`
    + `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  const rb = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-filter_complex', blurVf, '-frames:v', '1', out]);
  if (rb.ok && existsSync(out)) return { ok: true, method: 'ffmpeg-blur', skipped };
  skipped.push({ method: 'ffmpeg-blur', why: rb.err.split('\n').filter(Boolean).slice(-1)[0] ?? `code=${rb.code}` });

  // ── ③ 검은 띠 — 마지막 수단 ───────────────────────────────────────
  const rp = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,`
         + `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-frames:v', '1', out]);
  if (rp.ok && existsSync(out)) return { ok: true, method: 'ffmpeg-pad', skipped };
  return { ok: false, skipped, why: rp.err.split('\n').filter(Boolean).slice(-1)[0] ?? `code=${rp.code}` };
}

/** 사람이 읽는 한 줄. ⛔ 「무엇을 못 썼나」를 «반드시» 같이 낸다. */
export function sayReframe(r: ReframeResult): string {
  const MARK: Record<ReframeMethod, string> = {
    affinity: '🖼️ Affinity(커버 블러 ⊕ 원본 온전히)',
    'ffmpeg-blur': '🌫️ ffmpeg 흐린 배경(원본 온전히)',
    'ffmpeg-pad': '⬛ 검은 띠 — ***마지막 수단***',
  };
  const tail = r.skipped.length > 0
    ? ` · 못 쓴 것: ${r.skipped.map((s) => `${s.method}(${s.why})`).join(' · ')}`
    : '';
  return r.ok ? `${MARK[r.method!]}${tail}` : `⛔ 전부 실패 — ${r.why}${tail}`;
}
