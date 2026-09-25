/**
 * ⭐⭐ qc — 이 파이프라인의 «심장». ***렌더가 exit 0 이라고 만든 것이 맞는 게 아니다.***
 *
 * ⛔⭐⭐ 이 파일이 생긴 이유: 직전까지 `inspect-master` 는 ***파일 크기만*** 봤다.
 *   그리고 스스로 「검정프레임·자막누락은 «안 봤다»」고 적고 있었다 — ***정직했지만 눈이 없었다.***
 *   🔑 그중 ***자막 누락이 가장 조용한 거짓말***이다:
 *      폰트를 못 찾거나 `ass=` 경로가 틀려도 ***ffmpeg 는 exit 0 을 내고 «아무것도 안 그린다».***
 *      ⇒ 종료코드로는 «원리상» 못 잡는다. ***픽셀로 봐야 한다.***
 *
 * 📏 재는 법 — 「자막이 있어야 할 때」의 master 프레임과 «자막 없는» 원본 컷 프레임을 «뺀다».
 *   차이가 없으면 ***그 자리에 아무것도 안 그려진 것***이다.
 *   ⛔ 「master 의 그 띠가 밝나」로 재지 않는다 — 소재 자체가 밝으면 통과해 버린다.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, run } from './ffmpeg.js';
import { describeFocus, measureFocusPeaks } from './focus.js';
import type { Recipe } from './types.js';

interface Edl { fps: number; w: number; h: number; cuts: { dur: number; text?: string }[]; clips: string[] }

/** 한 프레임의 밝기 통계. ⛔ 못 재면 null 이다 — 0 이 아니다. */
function lumaMax(png: string): number | null {
  const r = run('ffmpeg', ['-hide_banner', '-i', png, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YMAX',
    '-f', 'null', '-'], 60_000);
  const m = /lavfi\.signalstats\.YMAX=([0-9.]+)/.exec(`${r.err}\n${r.out}`);
  return m ? Number(m[1]) : null;
}

/**
 * ⛔ 「빈 렌더」의 문턱 — ***평균이 아니라 «가장 밝은 픽셀»로 가른다.***
 *   📏 실측: 빈 렌더 16~19 ↔ 의도한 어둠 254. 그 사이 어디든 갈라지므로 넉넉히 64 로 둔다.
 *   ⚠️ 이 수는 «자의적»이 아니라 위 두 표본 사이다 — 바꾸려면 두 표본을 다시 재라.
 */
const BLACK_YMAX = 64;

export const inspectMaster: Recipe = async (ctx) => {
  // ⛔ 검정 축이 «통과»했어도 무엇을 봤는지 말한다 — 조용한 통과는 「안 봤다」와 같은 얼굴이다.
  let blackNote = '검정 구간 없음';
  const master = ctx.state.master as string | undefined;
  const edlJson = ctx.state.edl_json as string | undefined;
  if (!master || !existsSync(master)) return { outcome: 'unmeasurable', note: 'master 가 없다' };
  // ⛔⭐⭐ ***종전엔 「10KB 미만이면 빈 렌더」였다. 그 문턱을 걷는다.***
  //
  // 📏 실측 2026-09-22 — 바이트는 「빈 렌더」의 «대리지표»이고, 그 대리가 해상도·길이에 끌린다:
  // ```
  //   정상  320×180×2s + 자막   =  3,466 B   ⇒ 문턱 «아래» ⇒ ***「빈 렌더」로 잡힌다***  ⛔ 거짓 양성
  //   검정  1080×1920× 4s       =  9,511 B   ⇒ 문턱 «아래»(맞게 잡히지만 «이유가 틀렸다»)
  //   검정  1080×1920× 8s       = 11,431 B   ⇒ 문턱 «위»
  // ```
  // ⚠️⭐ ***내 1차 주장은 절반 틀렸다*** — 나는 이것을 「두 방향으로 틀렸다」고 적었다.
  //   그런데 «문턱 위»로 새어도 ***아래의 픽셀 검사가 잡는다***(YMAX 16 < 64). 눌러서 확인했다.
  //   ⇒ 🔑 ***그래서 이 문턱의 죄는 「못 잡는 것」이 아니라 「멀쩡한 것을 막는 것」이다.***
  //     ⛔ 잡는 쪽은 «중복»이고, 통과시키는 쪽은 «해롭다» — 그런 관문은 없는 편이 낫다.
  //
  // ⇒ 대리를 버리고 ***직접 재는 자***(아래 blackdetect ⊕ YMAX)에만 맡긴다.
  //
  // ⛔ 다만 «0바이트»는 남긴다 — 그것은 대리가 아니라 ***사실***이다(파일이 비었다).
  if (statSync(master).size === 0) {
    return { outcome: 'blackframe', note: 'master 가 «0바이트»다 — 아무것도 안 구웠다' };
  }

  // ── ⓐ 검정 구간 — ⛔ 「렌더가 됐다」와 「보인다」는 다른 값이다 ──
  const bd = run('ffmpeg', ['-hide_banner', '-i', master, '-vf', 'blackdetect=d=0.3:pic_th=0.98', '-f', 'null', '-'], 180_000);
  const blacks = [...`${bd.err}`.matchAll(/black_start:([0-9.]+) black_end:([0-9.]+)/g)]
    .map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const blackSec = blacks.reduce((a, b) => a + (b.end - b.start), 0);
  if (blackSec > 0.5) {
    // ⛔⭐⭐ ***`blackdetect` 는 「어두운 그림」과 「빈 렌더」를 «구별하지 못한다».***
    //
    // 🩸 실측 2026-09-22 — 실물 종합 시나리오에서 이 자가 «틀렸다»:
    //   첫 장면 프롬프트가 *"vast dark navy void … deep shadow"* 였고 산출은 정상이었는데,
    //   `pic_th=0.98`(픽셀 98%가 검정 문턱 아래)이 걸려 0~3.27초가 «검정»으로 잡혔다.
    //   ⇒ qc 가 compose 로 되돌렸고, ***compose 는 어두운 소재를 밝게 할 수 «없다»***.
    //   ⇒ compose→overlay→render→readback→qc 를 네 번 돌고 ***예산 소진으로 종단 없이 끝났다.***
    //      ⛔ 「종단 없음」은 가장 나쁜 산출이다 — ***아무것도 안 나온다.***
    //
    // 🔑 ***되돌아가는 간선은 「되돌아간 쪽이 무언가 달리 할 수 있을 때»만 간선이다.***
    //   할 수 없으면 그것은 자기 수복이 아니라 «무한 루프»이고, 예산이 그것을 가린다.
    //
    // 📏 가르는 값을 «알려진 양성»으로 찾았다 — 프레임의 `YMAX`(가장 밝은 픽셀):
    // ```
    //   진짜 빈 렌더 color=black     YMAX  16   ← 리미티드 레인지 검정 바닥
    //   거의 검정   color=0x030304   YMAX  19
    //   의도한 어둠 (우리 산출)      YMAX 254   ← ***하이라이트가 «있다»***
    // ```
    //   ⇒ 빈 렌더는 ***가장 밝은 픽셀조차 어둡다***. 어두운 그림은 어디엔가 빛이 있다.
    //   ⛔ 평균(`YAVG`)으로는 못 가른다 — 둘 다 낮다(16 ↔ 26).
    const mid = blacks.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    const probe = join(ctx.workdir, 'qc-black.png');
    mkdirSync(join(ctx.workdir, '.'), { recursive: true });
    const tBlack = (mid.start + mid.end) / 2;
    if (!ffmpeg(['-ss', String(tBlack), '-i', master, '-frames:v', '1', probe]).ok) {
      // ⛔ 「못 뽑았다」를 「검정이다」로 접지 않는다.
      return { outcome: 'unmeasurable', note: `검정 의심 구간(${tBlack.toFixed(1)}s)의 프레임을 «못 뽑았다»` };
    }
    const ymax = lumaMax(probe);
    if (ymax === null) return { outcome: 'unmeasurable', note: '검정 의심 구간의 밝기를 «못 쟀다»' };
    ctx.log('qc.blackdetect', { seconds: Number(blackSec.toFixed(2)), t: Number(tBlack.toFixed(2)), ymax });
    if (ymax >= BLACK_YMAX) {
      // ✅ 어둡지만 «빛이 있다» — 의도한 화면이다. ⛔ 여기서 되돌리면 못 고치는 곳으로 보낸다.
      blackNote = `⚠️ 어두운 구간 ${blackSec.toFixed(2)}s 가 있으나 «빈 렌더는 아니다»(YMAX ${ymax} ≥ ${BLACK_YMAX})`
        + ' — 의도한 어둠으로 본다';
    } else {
      return {
        outcome: 'blackframe',
        note: `검정 구간 ${blackSec.toFixed(2)}s — ${blacks.slice(0, 3).map((b) => `${b.start.toFixed(1)}~${b.end.toFixed(1)}`).join(', ')}`
             + ` · 가장 밝은 픽셀도 YMAX ${ymax} (< ${BLACK_YMAX}) ⇒ ***빈 렌더다***`
             + ' ⇒ compose 로 되돌린다(렌더가 아니라 조립이 범인이다 — 매뉴얼 §「되돌아가는 간선」)',
      };
    }
  }

  // ── ⓑ 자막 층 — ⛔ «가장 조용한» 거짓말. 픽셀로만 잡힌다 ──
  if (!edlJson || !existsSync(edlJson)) {
    // ⛔ 「못 쟀다」를 「통과」로 읽지 않는다.
    return { outcome: 'unmeasurable', note: 'edl_json 이 없어 자막 층을 «대조할 수 없다»' };
  }
  let edl: Edl;
  try { edl = JSON.parse(readFileSync(edlJson, 'utf8')) as Edl; }
  catch (e) { return { outcome: 'unmeasurable', note: `edl 을 못 읽었다: ${(e as Error).message}` }; }

  // ── ⓒ 샷별 초점(OpenCV) — ⭐ 관측만. 결과(outcome)는 바꾸지 않는다(2026-09-24 · 🅢 실측: 절대값은 정상 근접과 흐림이 겹친다) ──
  const focusClips = edl.clips.filter((clip) => typeof clip === 'string' && existsSync(clip)).slice(0, 12);
  const focus = measureFocusPeaks(focusClips);
  ctx.log('qc.focus', { measured: focus !== null, shots: focus?.map((m) => ({ clip: m.path.split('/').at(-1), focusPeak: m.focusPeak })) ?? null });
  const focusNote = ` · ${describeFocus(focus)}`;

  const withText = edl.cuts.map((c, i) => ({ ...c, i })).filter((c) => (c.text ?? '').length > 0);
  if (withText.length === 0) {
    return { outcome: 'pass', note: `${blackNote} · 자막이 «없는» 판이라 층 대조는 건너뛴다${focusNote}` };
  }

  const shots = join(ctx.workdir, 'qc');
  mkdirSync(shots, { recursive: true });
  let starts = 0;
  const offsets: number[] = edl.cuts.map((c) => { const s = starts; starts += c.dur; return s; });

  for (const c of withText.slice(0, 3)) {          // ⛔ 전수는 비싸다 — 앞 셋만 «표본»으로 본다(그 사실을 note 에 적는다)
    const tMaster = offsets[c.i]! + c.dur / 2;
    const a = join(shots, `m${c.i}.png`), b = join(shots, `c${c.i}.png`), d = join(shots, `d${c.i}.png`);
    if (!ffmpeg(['-ss', String(tMaster), '-i', master, '-frames:v', '1', a]).ok) {
      return { outcome: 'unmeasurable', note: `master 의 ${tMaster.toFixed(1)}s 프레임을 못 뽑았다` };
    }
    const clip = edl.clips[c.i];
    if (!clip || !existsSync(clip)) return { outcome: 'unmeasurable', note: `원본 컷을 못 찾았다: ${clip ?? '(없음)'}` };
    if (!ffmpeg(['-ss', String(c.dur / 2), '-i', clip, '-frames:v', '1', b]).ok) {
      return { outcome: 'unmeasurable', note: `컷 ${c.i} 의 프레임을 못 뽑았다` };
    }
    // ⛔ 두 프레임을 «뺀다» — 소재가 밝든 어둡든 「그려졌나」만 남는다.
    if (!ffmpeg(['-i', a, '-i', b, '-filter_complex', 'blend=all_mode=difference', '-frames:v', '1', d]).ok) {
      return { outcome: 'unmeasurable', note: `차분을 못 만들었다(컷 ${c.i})` };
    }
    const ymax = lumaMax(d);
    if (ymax === null) return { outcome: 'unmeasurable', note: `차분의 밝기를 못 쟀다(컷 ${c.i})` };
    ctx.log('qc.overlay-diff', { cut: c.i, t: Number(tMaster.toFixed(2)), ymax });
    // ⭐ 자막은 흰 글자 + 검은 테두리라 차분에서 «크게» 튄다. 아무것도 안 그렸으면 차분이 납작하다.
    if (ymax < 32) {
      return {
        outcome: 'layer-missing',
        note: `컷 ${c.i}("${c.text}") 자리에 ***자막이 안 그려졌다*** — 차분 YMAX ${ymax}`
             + ' ⇒ overlay 로 되돌린다(ffmpeg 는 exit 0 이었다)',
      };
    }
  }

  return {
    outcome: 'pass',
    note: `${blackNote} · 자막 층 확인 ${Math.min(3, withText.length)}/${withText.length}컷(표본)`
         + ` · ⚠️ 색·구도·오탈자는 «안 본다»${focusNote}`,
  };
};
