/**
 * 앞단 — ⛔ «얇지만 진짜»다. 목이 아니다.
 *
 * ⭐ 무료 라인을 증명하려면 `compose` 부터 잘라 돌리면 «안 된다» —
 *   선언의 진입은 `ground` 이고, ***앞단이 채워 주지 않으면 compose 의 계약 입력이 빈다.***
 *   ⇒ 그래서 앞단도 실제로 state 를 만든다. 다만 «생성(metered)»은 안 쓴다 — 그것이 요점이다.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './ffmpeg.js';
import { parseSrt } from './remote.js';
import type { Cut } from './free-line.js';
import type { Recipe } from './types.js';
import { reframeOne, type ReframeMethod } from './reframe.js';


/**
 * ⛔ 리프레임 러너(`scripts/affinity/reframe.sh`)를 찾는 뿌리.
 *   ⚠️ `process.cwd()` 를 읽지 «않는다» — 이 저장소의 상시 규율이다
 *   (맥락은 «한 번» 정해지고 아래로는 «인자»로만 내려간다).
 *   ⇒ 이 파일의 «자기 위치»에서 올라간다: src/video-pipeline/recipes → <repo>/scripts
 */
const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts');

const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic']);

export const collectGroundTruth: Recipe = async (ctx) => {
  const dir = ctx.state.source_dir as string | undefined;
  if (!dir || !existsSync(dir)) {
    // ⛔ 「소재가 없다」는 «실패»가 아니라 «사람을 부를 일»이다 — 선언이 그렇게 갈라 놨다.
    return { outcome: 'empty', note: `source_dir 이 없다: ${dir ?? '(안 줬다)'}` };
  }
  const files = readdirSync(dir)
    .filter((f) => IMG.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).size > 0)
    .sort();
  if (files.length === 0) return { outcome: 'empty', note: `${dir} 에 쓸 수 있는 이미지가 «0개»다` };
  ctx.log('ground.collected', { dir, n: files.length });
  return { outcome: 'ok', produced: { source_files: files }, note: `소재 ${files.length}개` };
};

export const findNarrative: Recipe = async (ctx) => {
  // ⛔⭐ 이 이름을 «두 선언»이 쓴다 — 계약이 다르다(2026-09-23 실측).
  //   video-production: inputs [source_files] → outputs [beats]
  //   vlog-found-footage: inputs [transcripts] → outputs [arc, peaks, why_filmed]
  //   🩸 `recipes` 명령은 이름만 보고 vlog 쪽을 «묶임»으로 셌지만, 걸으면 source_files 가 없어 죽었다.
  //   ⇒ 이름이 같은 한, ***입력으로 갈래를 고른다***. 전사가 있으면 «이야기는 소리가 준다».
  const transcripts = ctx.state.transcripts as { clip: string; segments: { start: number; end: number; text: string }[] }[] | undefined;
  if (transcripts) {
    const segs = transcripts.flatMap((t) => t.segments.map((s) => ({ clip: t.clip, ...s })));
    const words = (x: string): number => x.split(/\s+/).filter(Boolean).length;
    // ⛔ 「하이라이트 모음」으로 흘러가지 않게 — 말이 «충분히» 있어야 이야기다(구간 3개 ⊕ 소재 2개 이상에서).
    const clipsWithSpeech = new Set(segs.map((s) => s.clip)).size;
    if (segs.length < 3 || clipsWithSpeech < 2) {
      return { outcome: 'thin', produced: { arc: [], peaks: [], why_filmed: null }, note: `말 구간 ${segs.length}개 · 소재 ${clipsWithSpeech}개 — 이야기로는 얇다(사람이 구조를 줘야 한다)` };
    }
    const maxN = Number(ctx.state.max_chapters ?? 8);
    const peaks = [...segs].sort((a, b) => words(b.text) - words(a.text)).slice(0, maxN);
    // ⭐ 순서는 «찍힌 순서»(소재 순 ⊕ 시각 순) — 가장 긴 말을 «고르되» 시간을 뒤섞지 않는다.
    const order = new Map(transcripts.map((t, i) => [t.clip, i]));
    const arc = [...peaks].sort((a, b) => (order.get(a.clip)! - order.get(b.clip)!) || a.start - b.start);
    const why_filmed = arc[0]?.text ?? null;
    return { outcome: 'found', produced: { arc, peaks, why_filmed }, note: `마디 ${arc.length}개(말이 가장 긴 구간 ${maxN}개를 찍힌 순서로) · ⚠️ 규칙 기반 초안` };
  }
  const src = ctx.state.source_files as string[] | undefined;
  if (!src) return { outcome: 'unmeasurable', note: 'source_files 가 없다' };
  // ⛔ 「얇다」를 «성공»으로 읽지 않는다 — 컷이 둘 미만이면 이야기가 아니다.
  if (src.length < 2) return { outcome: 'thin', note: `소재가 ${src.length}개뿐이라 이야기를 못 만든다` };
  const beats = src.map((_, i) => ({ idx: i, role: i === 0 ? 'open' : i === src.length - 1 ? 'close' : 'body' }));
  return { outcome: 'found', produced: { beats }, note: `마디 ${beats.length}개` };
};

export const authorShotPlan: Recipe = async (ctx) => {
  const src = ctx.state.source_files as string[] | undefined;
  const captions = (ctx.state.captions as string[] | undefined) ?? [];
  if (!src) return { outcome: 'unmeasurable', note: 'source_files 가 없다' };
  const per = Number(ctx.state.seconds_per_cut ?? 2.5);
  const shot_plan: Cut[] = src.map((asset, i) => ({ asset, dur: per, text: captions[i] }));
  const target_dur = shot_plan.reduce((a, c) => a + c.dur, 0);
  ctx.log('plan.authored', { cuts: shot_plan.length, target_dur });
  // ⭐ target_dur 를 «여기서» 못 박는다 — 되읽기가 «무엇과» 비교할지가 여기서 정해진다.
  return { outcome: 'ok', produced: { shot_plan, target_dur }, note: `컷 ${shot_plan.length} · 목표 ${target_dur}s` };
};

export const produceOrGatherAssets: Recipe = async (ctx) => {
  const plan = ctx.state.shot_plan as Cut[] | undefined;
  if (!plan) return { outcome: 'unmeasurable', note: 'shot_plan 이 없다' };

  // ⛔⭐⭐ ***되돌아온 회차*** — 게이트가 「비율이 어긋났다」고 돌려보냈다.
  //   🔑 여기가 이 파이프라인의 «자기 수복»이 실제로 일어나는 자리다:
  //      ***게이트는 «찾기만» 하고, 고치는 것은 «그 일을 하는 노드»다.***
  //   ⛔ 게이트가 스스로 고치면 「무엇이 틀렸었나」가 기록에서 사라진다.
  const toFix = (ctx.state.assets_to_normalize as string[] | undefined) ?? [];
  if (toFix.length > 0) {
    const ratio = Number(ctx.state.target_ratio ?? 16 / 9);
    const dir = join(ctx.workdir, 'normalized');
    mkdirSync(dir, { recursive: true });
    const remap = new Map<string, string>();
    // ⛔⭐⭐ ***종전에는 여기가 «검은 띠» 하나뿐이었다***(`scale=decrease + pad=black`).
    //   돌기는 돌았고 종단도 delivered 였지만, ***그 검은 띠를 아무 관문도 안 봤다.***
    //   대표 2026-09-22: *"생성된 이미지가 비율대로 안나오기때문에 … 다양한 기법으로 편집"*
    //   ⇒ 이제 «셋»을 순서로 고른다 — Affinity ▸ ffmpeg 흐린 배경 ▸ 검은 띠.
    //   🔑 ⛔ 「앱이 꺼져 있다」는 «실패»가 아니라 ***«못 쟀다»***다 ⇒ 건너뛰되 «이유»를 들고 간다.
    const used: ReframeMethod[] = [];
    const whyNot = new Set<string>();
    for (const src of toFix) {
      const out = join(dir, `n-${basename(src)}`);
      // 목표 비율의 판에 «넣는다» — ⛔ 늘리지 않는다(찌그러진 소재는 고친 것이 아니다).
      const h = 720, w = Math.round(h * ratio / 2) * 2;
      const rf = reframeOne({ src, out, width: w, height: h, scriptDir: SCRIPT_DIR });
      if (!rf.ok) return { outcome: 'error', note: `정규화 실패: ${basename(src)} — ${rf.why ?? ''}` };
      used.push(rf.method!);
      for (const sk of rf.skipped) whyNot.add(`${sk.method}: ${sk.why}`);
      remap.set(src, out);
      ctx.log('assets.normalized', { src, out, ratio: Number(ratio.toFixed(3)), method: rf.method });
    }
    const fixed = plan.map((c) => (remap.has(c.asset) ? { ...c, asset: remap.get(c.asset)! } : c));
    // ⛔ 「무엇으로 고쳤나」와 「무엇을 «못 썼나»」를 «둘 다» 낸다.
    //   안 적으면 검은 띠만 보이고 ***왜 거기로 갔는지가 사라진다.***
    const byMethod = [...new Set(used)].join(' · ');
    const fellBack = used.some((m) => m === 'ffmpeg-pad');
    return {
      outcome: 'ok',
      // ⛔ 깃발을 «반드시» 비운다 — 안 비우면 같은 회차를 예산까지 돈다.
      produced: { shot_plan: fixed, asset_files: fixed.map((c) => c.asset), assets_to_normalize: [] },
      note: `♻️ 되돌아와서 ${toFix.length}개를 «비율 정규화»했다(${byMethod}) — ${toFix.map((f) => basename(f)).join(', ')}`
          + (whyNot.size > 0 ? ` · 못 쓴 것: ${[...whyNot].join(' · ')}` : '')
          + (fellBack ? ' · ⛔ ***검은 띠가 남았다*** — 위 이유를 읽어라' : ''),
    };
  }

  // ⛔ 무료 라인은 «생성하지 않는다» — 모으기만 한다. 그것이 found-footage 갈래다.
  const missing = plan.filter((c) => !existsSync(c.asset));
  if (missing.length > 0) {
    return { outcome: 'error', note: `소재 ${missing.length}개가 «없다» — ${missing[0]!.asset}`
      + ' (무료 라인은 생성하지 않는다 — 소재를 주거나 --synth 로 판을 만들어라)' };
  }
  return { outcome: 'ok', produced: { asset_files: plan.map((c) => c.asset) }, note: `모은 소재 ${plan.length}개` };
};

export const verifyAssets: Recipe = async (ctx) => {
  const files = ctx.state.asset_files as string[] | undefined;
  if (!files) return { outcome: 'unmeasurable', note: 'asset_files 가 없다' };
  // ⛔ 빈 목록은 «잰 0»이 아니라 «못 쟀다»다(🩸 2026-09-23: 종전엔 중앙값이 undefined 라 `toFixed` 에서 «던졌다»).
  if (files.length === 0) return { outcome: 'unmeasurable', note: 'asset_files 가 «비었다» — 잴 소재가 0개다(통과가 아니다)' };

  // ⛔ 「파일이 있다」로 통과시키지 않는다 — ffprobe 가 «읽을 수 있나»를 본다(깨진 png 를 거른다).
  //   ⭐ 칸 이름을 살려 읽는다 — `csv=p=0` 은 «순서를 가정»하게 만든다(2026-09-22 에 그것으로 데였다).
  const dims: { f: string; w: number; h: number }[] = [];
  for (const f of files) {
    const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'default=noprint_wrappers=1:nokey=0', f]);
    const get = (k: string): number => Number(r.out.split('\n').find((l) => l.startsWith(`${k}=`))?.split('=')[1]);
    const w = get('width'), h = get('height');
    if (!r.ok || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return { outcome: 'missing', note: `소재를 «디코드 못 한다»: ${f}` };
    }
    dims.push({ f, w, h });
  }

  // ⛔⭐ ***비율이 섞이면 조립이 아니라 «소재»가 틀린 것이다*** — 그래서 되돌아갈 곳이 assets 다
  //   (매뉴얼: 「그림이 틀린 것이지 조립이 틀린 게 아니다」).
  //   📏 기준은 «중앙값»이다 — 평균은 이탈자 하나에 끌려간다.
  const ratios = dims.map((d) => d.w / d.h).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)]!;
  const off = dims.filter((d) => Math.abs(d.w / d.h - median) / median > 0.15);
  if (off.length > 0 && off.length < dims.length) {
    // ⛔⭐⭐ ***소재가 «둘»이면 중앙값은 「다수」가 아니다*** — 그냥 «큰 쪽»이다.
    //   📏 실측 2026-09-22 — 자를 모집단별로 눌러 봤다:
    //   ```
    //     16:9×4 + 1:1×1   중앙값 1.778 · 이탈 1/5   ⇐ 다수결로 «맞다»
    //     16:9  + 1:1      중앙값 1.778 · 이탈 1/2   ⇐ ***다수가 «없다»*** — 정렬해서 큰 쪽이 됐다
    //     1:1×3 + 16:9×2   중앙값 1.000 · 이탈 2/5   ⇐ 다수가 이긴다(맞다)
    //   ```
    //   🔑 ***수가 같으면 「기준」이 «판정»이 아니라 «정렬 순서»다.*** 그 사실을 숨기면
    //     사람은 다수결로 정해진 줄 안다 ⇒ ***이름으로 말한다.***
    //   ⛔ 동작은 «안 바꾼다» — 무엇을 기준으로 삼을지는 정책이고(선언한 납품 비율?),
    //     그것은 별건이다. 여기서는 ***「이건 다수결이 아니다」를 말하는 것***까지가 몫이다.
    const noMajority = dims.length === 2;
    return {
      outcome: 'ratio',
      // ⛔ 게이트는 «찾기만» 한다 — 고치는 것은 그 일을 하는 노드다(assets).
      produced: { assets_to_normalize: off.map((d) => d.f), target_ratio: median },
      note: `비율이 어긋난 소재 ${off.length}개 — ${off.map((d) => `${basename(d.f)}(${d.w}x${d.h})`).join(', ')}`
           + ` · 기준 ${median.toFixed(3)} ⇒ assets 로 되돌린다`
           + (noMajority
             ? ' · ⚠️ 소재가 «둘»뿐이라 ***다수가 없다*** — 기준은 「정렬해서 큰 쪽」이다(다수결이 아니다)'
             : ''),
    };
  }

  ctx.log('assetgate.verified', { n: files.length, median: Number(median.toFixed(3)) });
  return { outcome: 'pass', note: `소재 ${files.length}개 · 디코드 ok · 비율 일치(기준 ${median.toFixed(3)})` };
};

export const voiceAndMusic: Recipe = async (ctx) => {
  const plan = ctx.state.shot_plan as Cut[] | undefined;
  if (!plan) return { outcome: 'unmeasurable', note: 'shot_plan 이 없다' };

  // ⛔⭐ 이미 «만들어 둔» 나레이션이 있으면 다시 만들지 않는다.
  //   🩸 2026-09-22: `--scene` 으로 넘긴 칸을 레시피가 «안 읽어» 조용히 무시될 뻔했다.
  //      ⇒ 🔑 ***칸을 만드는 것과 「그 칸을 읽는 자가 있다」는 다른 값이다.***
  // ⛔⭐⭐ ***음악은 「나레이션이 있는 갈래」에만 실려 있었다.***
  //   🩸 실측 2026-09-22: `--scene` 에 `music` 을 줬는데 `vo` 가 null 이면
  //      아래 세 갈래가 `music: null` 로 «덮어써서» ***render 가 withMusic:false 로 구웠다.***
  //      exit 0 · 종단 delivered · 자막 검수까지 통과 — ***소리만 조용히 빠졌다.***
  //   🔑 갈래가 다섯인데 그중 «둘»만 이 칸을 읽고 있었다 ⇒ 나머지 셋은 「읽는 자가 없는 칸」이었다.
  //   ⇒ 값을 «한 곳»에서 읽는다. 갈래가 늘어도 이 칸이 다시 새지 않는다.
  const music = (ctx.state.pregenerated_music as string | null | undefined) ?? null;
  const pre = ctx.state.pregenerated_vo as string | null | undefined;
  if (pre && existsSync(pre)) {
    const d = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=0', pre], 60_000);
    const total = Number(d.out.split('=')[1]);
    if (!Number.isFinite(total) || total <= 0) {
      return { outcome: 'unmeasurable', note: `미리 만든 나레이션의 길이를 못 쟀다: ${pre}` };
    }
    // ⭐⭐ ***받아쓰기(SRT)가 있으면 그것이 「진짜 타이밍」이다*** — 균등분할을 «안 한다».
    //   🩸 2026-09-22 까지 이 자리는 언제나 균등분할이었고, note 가 그 한계를 말하고 있었다.
    //      ⇒ 그 note 가 «없어지는 것»이 이 축이 닫혔다는 신호다.
    const srtPath = ctx.state.vo_srt as string | undefined;
    if (srtPath && existsSync(srtPath)) {
      const segs = parseSrt(readFileSync(srtPath, 'utf8'));
      // ⛔ 「구간 0개」를 「타이밍 0」으로 읽지 않는다 — 받아쓰기가 «실패한» 것이다.
      if (segs.length === 0) {
        return { outcome: 'unmeasurable', note: `받아쓰기에서 구간을 «하나도» 못 읽었다: ${srtPath}` };
      }
      // 컷 수와 구간 수가 다르면 «맞는 만큼»만 쓰고 그 사실을 말한다.
      const n = Math.min(segs.length, plan.length);
      const ts = plan.map((c, i) => (i < n
        ? { start: segs[i]!.start, end: segs[i]!.end, text: c.text ?? '' }
        : { start: segs[n - 1]!.end, end: segs[n - 1]!.end + c.dur, text: c.text ?? '' }));
      ctx.log('audio.srt-aligned', { srt: srtPath, segments: segs.length, cuts: plan.length });
      return {
        outcome: 'ok',
        produced: { vo: pre, music, word_timestamps: ts },
        note: `🔊 미리 만든 나레이션 ⊕ ***받아쓰기로 정렬***(구간 ${segs.length} · 컷 ${plan.length})`
            + (segs.length < plan.length ? ` · ⚠️ 구간이 «모자라» 뒤쪽 ${plan.length - segs.length}컷은 계획 길이` : ''),
      };
    }

    // ⛔ 받아쓰기가 «없으면» 균등분할이다 — 그 사실을 반드시 말한다.
    const per = total / plan.length;
    let t0 = 0;
    const ts = plan.map((c) => { const s0 = t0; t0 += per; return { start: s0, end: t0, text: c.text ?? '' }; });
    ctx.log('audio.pregenerated', { vo: pre, total: Number(total.toFixed(2)), cuts: plan.length });
    return {
      outcome: 'ok',
      produced: { vo: pre, music, word_timestamps: ts },
      note: `🔊 미리 만든 나레이션을 쓴다(${total.toFixed(2)}s)`
          + ` · ⚠️ 줄별 길이를 «모른다» — 컷 수로 균등분할했다(--scene 에 vo_srt 를 주면 없어진다)`,
    };
  }

  const voice = (ctx.state.voice as string | undefined) ?? '';
  // ⛔ 나레이션을 «안 만드는» 갈래도 정당하다 — 그때는 계획 길이를 그대로 쓴다고 «말한다».
  if (!voice) {
    let t0 = 0;
    const ts = plan.map((c) => { const s0 = t0; t0 += c.dur; return { start: s0, end: t0, text: c.text ?? '' }; });
    return {
      outcome: 'ok', produced: { vo: null, music, word_timestamps: ts },
      note: '⚠️ 나레이션 «없음»(--voice 를 안 줬다) — 자막 길이는 계획값 그대로다',
    };
  }

  // ⛔⭐⭐ 여기가 「균등분할이 174ms 어긋났다」를 실제로 고치는 자리다.
  //   🔑 ***ASR 이 없어도 «내가 만든» 소리는 길이를 잴 수 있다.***
  //      `say` 로 줄마다 따로 굽고 ffprobe 로 재면, 그것이 ***그 줄의 진짜 길이***다.
  //   ⛔ whisper 모델이 없어 ASR 은 «못 한다» — 그래서 「맞췄다」가 아니라 「잰 값을 쓴다」고 적는다.
  const audioDir = join(ctx.workdir, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const parts: string[] = [];
  const ts: { start: number; end: number; text: string }[] = [];
  const pad = Number(ctx.state.line_pad ?? 0.45);   // 줄 사이 숨
  let t = 0;

  for (const [i, c] of plan.entries()) {
    const text = (c.text ?? '').trim();
    if (!text) { ts.push({ start: t, end: t + c.dur, text: '' }); t += c.dur; continue; }
    const aiff = join(audioDir, `l${i}.aiff`), wav = join(audioDir, `l${i}.wav`);
    const sr = run('say', ['-v', voice, '-o', aiff, text], 120_000);
    if (!sr.ok) return { outcome: 'error', note: `say 실패(줄 ${i}): ${sr.err.split('\n')[0]}` };
    // 무음 꼬리를 붙여 «숨»을 준다 — ⛔ 자막이 소리보다 먼저 사라지면 읽을 수 없다.
    const conv = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff,
      '-af', `apad=pad_dur=${pad}`, '-ar', '48000', '-ac', '2', wav], 120_000);
    if (!conv.ok) return { outcome: 'error', note: `오디오 변환 실패(줄 ${i}): ${conv.err.split('\n')[0]}` };
    const d = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=0', wav], 60_000);
    const dur = Number(d.out.split('=')[1]);
    // ⛔ 「못 쟀다」를 「0초」로 읽지 않는다.
    if (!Number.isFinite(dur) || dur <= 0) return { outcome: 'unmeasurable', note: `줄 ${i} 의 길이를 못 쟀다` };
    parts.push(wav);
    ts.push({ start: t, end: t + dur, text });
    t += dur;
    ctx.log('audio.line', { i, dur: Number(dur.toFixed(2)), chars: text.length });
  }

  if (parts.length === 0) {
    return { outcome: 'ok', produced: { vo: null, music, word_timestamps: ts }, note: '읽을 자막이 없었다' };
  }
  const listPath = join(audioDir, 'vo.txt');
  writeFileSync(listPath, parts.map((p2) => `file '${p2}'`).join('\n') + '\n', 'utf8');
  const vo = join(audioDir, 'vo.m4a');
  const cat = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', listPath, '-c:a', 'aac', '-b:a', '160k', vo], 180_000);
  if (!cat.ok) return { outcome: 'error', note: `나레이션 합치기 실패: ${cat.err.split('\n')[0]}` };

  return {
    outcome: 'ok',
    produced: { vo, music, word_timestamps: ts },
    note: `🔊 나레이션 ${parts.length}줄 · 총 ${t.toFixed(2)}s (${voice}) · ⚠️ 음악은 «없다»`
        + ' · ⚠️ ASR 모델이 없어 «내가 만든 소리»를 잰 값이다(받아쓰기로 «맞춘» 것이 아니다)',
  };
};

export const alignTime: Recipe = async (ctx) => {
  const plan = ctx.state.shot_plan as Cut[] | undefined;
  const ts = ctx.state.word_timestamps as { start: number; end: number }[] | undefined;
  if (!plan) return { outcome: 'unmeasurable', note: 'shot_plan 이 없다' };
  if (!ts) return { outcome: 'no-timestamps', note: 'word_timestamps 가 없다 — 소리 단계로 되돌아간다' };
  // ⛔ 균등분할이 평균 174ms 어긋났던 것이 이 노드가 있는 이유다(매뉴얼 §5).
  //   무료 라인은 ASR 이 없으므로 «계획한 길이 그대로»를 쓴다 — 그것을 「맞췄다」고 하지 않는다.
  const timeline: Cut[] = plan.map((c, i) => ({ ...c, dur: (ts[i]?.end ?? 0) - (ts[i]?.start ?? 0) || c.dur }));
  // ⛔⭐ 목표 길이를 «여기서 다시» 못 박는다 — 소리가 컷 길이를 바꿨으면 되읽기가 «무엇과» 비교할지도 바뀐다.
  //   🩸 안 고치면 readback 이 «옛 목표»와 비교해 wrong-length 로 무한히 되돌린다(자가 자기 수리를 막는다).
  const target_dur = timeline.reduce((a, c) => a + c.dur, 0);
  const changed = Math.abs(target_dur - Number(ctx.state.target_dur ?? target_dur)) > 0.01;
  return {
    outcome: 'pass',
    produced: { timeline, target_dur },
    note: `타임라인 ${timeline.length}컷 · 목표 ${target_dur.toFixed(2)}s`
        + (changed ? ' ⭐ 소리 길이에 맞춰 «다시» 잡았다' : ' (계획 길이 그대로)'),
  };
};


import { inspectMaster as qcInspect } from './qc.js';

export const UPSTREAM: Readonly<Record<string, Recipe>> = {
  'inspect-master': qcInspect,
  'collect-ground-truth': collectGroundTruth,
  'find-narrative': findNarrative,
  'author-shot-plan': authorShotPlan,
  'produce-or-gather-assets': produceOrGatherAssets,
  'verify-assets': verifyAssets,
  'voice-and-music': voiceAndMusic,
  'align-time': alignTime,
};
