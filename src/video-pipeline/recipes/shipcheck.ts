/**
 * 📦⭐⭐ shipcheck — ***납품물을 «독립적으로» 본다.***
 *
 * ⛔⭐⭐ 이 노드가 생긴 이유는 «한 문장»이다:
 *   🩸 2026-09-22 — 1080×1920 마스터에서 뽑은 1920×1080 납품물에 ***자막이 통째로 없었다.***
 *      그런데 종단은 `delivered` 였고 `qc` 도 `pass` 였다.
 *      📏 선언 전수: `inputs: [deliverables]` 를 갖는 노드가 ***종단뿐***이었다.
 *      ⇒ ***납품물을 보는 눈이 「없었다」.*** 사람이 파일을 열어야만 보이는 결함이었다.
 *
 * 🔑 그리고 ***`deliver` 가 자기 산출을 재는 것으로는 이 자리를 못 메운다.***
 *   이 저장소의 상시 규율: ***판정 결과가 흐르는 채널은 그 판정의 «대상»이 쓸 수 없어야 한다.***
 *   ⇒ 그래서 만드는 노드(`deliver`)와 «보는 노드»(여기)를 가른다.
 *
 * 📏 무엇을 재나 — ⛔ ***전부 「픽셀·수」로 잰다.*** 종료코드·로그를 믿지 않는다.
 * ```
 *   ⓐ 규격     요청한 <가로>x<세로> 가 «실제로» 나왔나
 *   ⓑ 길이     마스터와 «같은» 길이인가 (프레임을 센다 — 컨테이너 duration 은 거짓말한 적이 있다)
 *   ⓒ 소리     마스터에 소리가 있었으면 납품물에도 «있나»
 *   ⓓ 자막     ***마스터에서 자막이 있던 시각***에 납품물도 그 자리에 «무언가를 그렸나»
 * ```
 * ⛔ ⓓ 가 핵심이다 — 그리고 ***이것이 종전에 아무도 안 본 축이다.***
 *
 * ⛔ 「못 쟀다」를 «통과»로 읽지 않는다. 못 쟀으면 `unmeasurable` 이다.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, probeDuration, run } from './ffmpeg.js';
import type { Recipe } from './types.js';

interface Edl { fps: number; w: number; h: number; cuts: { dur: number; text?: string }[] }

/** 한 프레임의 «가장 밝은 픽셀». ⛔ 못 재면 null 이다 — 0 이 아니다. */
function lumaMax(png: string): number | null {
  const r = run('ffmpeg', ['-hide_banner', '-i', png,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YMAX', '-f', 'null', '-'], 60_000);
  const m = /lavfi\.signalstats\.YMAX=([0-9.]+)/.exec(`${r.err}\n${r.out}`);
  return m ? Number(m[1]) : null;
}

function streamCount(path: string, kind: 'a' | 'v'): number | null {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', kind,
    '-show_entries', 'stream=index', '-of', 'csv=p=0', path]);
  if (!r.ok) return null;
  return r.out.split('\n').filter((l) => l.trim().length > 0).length;
}

export const inspectDeliverables: Recipe = async (ctx) => {
  const made = ctx.state.deliverables as string[] | undefined;
  const master = ctx.state.master as string | undefined;
  if (!made || made.length === 0) return { outcome: 'unmeasurable', note: '납품물 목록이 «없다»' };
  if (!master || !existsSync(master)) return { outcome: 'unmeasurable', note: 'master 가 없어 «견줄 것»이 없다' };

  const mDur = probeDuration(master);
  if (mDur.dur === null) return { outcome: 'unmeasurable', note: `master 길이를 못 쟀다 — ${mDur.why}` };
  const mAudio = streamCount(master, 'a');
  // ⛔ 자막 띠의 «자리»를 기하로 계산하려면 마스터 규격이 필요하다.
  const mSize = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', master]).out.trim();
  if (!/^\d+,\d+$/.test(mSize)) return { outcome: 'unmeasurable', note: `master 규격을 못 쟀다: ${mSize || '(빈 값)'}` };

  // ⛔ 자막이 «있어야 할 시각»을 edl 에서 얻는다. 없으면 ⓓ 를 «건너뛰고 그 사실을 말한다».
  const edlJson = ctx.state.edl_json as string | undefined;
  let capT: number | null = null;
  if (edlJson && existsSync(edlJson)) {
    try {
      const edl = JSON.parse(await Bun.file(edlJson).text()) as Edl;
      let t = 0;
      for (const c of edl.cuts) {
        if ((c.text ?? '').length > 0) { capT = t + c.dur / 2; break; }
        t += c.dur;
      }
    } catch { capT = null; }
  }

  // ⛔ 디렉토리를 «먼저» 만든다 — 1판은 안 만들었고, ffmpeg 가 못 써서 ***전부 「못 쟀다」***가 됐다.
  //   🔑 ⭐ 그래도 ***「통과」로 새지는 않았다*** — 세 값을 가른 덕이다.
  //     ⛔ 두 값(pass/fail)이었으면 이 버그가 ***초록으로 보였다.***
  const shots = join(ctx.workdir, 'shipcheck');
  mkdirSync(shots, { recursive: true });
  const bad: string[] = [];
  const unmeasured: string[] = [];
  let capChecked = 0;

  for (const p of made) {
    const name = p.split('/').pop() ?? p;
    if (!existsSync(p)) { bad.push(`${name}: 파일이 «없다»`); continue; }

    // ⓐ 규격 — 파일 이름이 약속한 것과 «실제»를 견준다
    const m = /(\d+)x(\d+)\.mp4$/.exec(name);
    const got = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]).out.trim();
    if (m && got !== `${m[1]},${m[2]}`) {
      bad.push(`${name}: 규격이 다르다 — ${got || '(못 쟀다)'}`); continue;
    }

    // ⓑ 길이 — ⛔ 프레임을 «센다»(컨테이너 duration 은 이 축에서 거짓말한 적이 있다)
    const d = probeDuration(p);
    if (d.dur === null) { unmeasured.push(`${name}: 길이를 못 쟀다`); continue; }
    if (Math.abs(d.dur - mDur.dur) > 0.15) {
      bad.push(`${name}: 길이가 다르다 — ${d.dur.toFixed(2)}s (마스터 ${mDur.dur.toFixed(2)}s)`); continue;
    }

    // ⓒ 소리 — 마스터에 있었으면 납품물에도 있어야 한다
    const a = streamCount(p, 'a');
    if (a === null || mAudio === null) unmeasured.push(`${name}: 소리 스트림을 못 쟀다`);
    else if (mAudio > 0 && a === 0) { bad.push(`${name}: ***소리가 «없다»***(마스터엔 있다)`); continue; }

    // ⓓ ⭐ 자막 — ***여기가 종전에 아무도 안 본 축이다.***
    //   ⛔ 「자막 글자를 읽는다」가 아니라 ***「그 자리에 무언가 그려졌나」***를 본다.
    //     아래쪽 25% 띠를 잘라 «가장 밝은 픽셀»을 본다 — 흰 글자는 크게 튄다.
    //   ⚠️ 소재가 원래 밝으면 통과할 수 있다 ⇒ ***마스터의 같은 띠와 «견준다».***
    if (capT !== null) {
      // ⛔⭐⭐ ***자막이 「아래 띠」에 있다고 가정하면 안 된다 — 비율이 뒤집히면 «가운데»로 간다.***
      //
      // 🩸 실측 2026-09-22 — 640×360 마스터에서 360×640 을 뽑아 «행별로» 쟀다:
      // ```
      //   맞춰 넣기(fit)   자막이 y=320..480 (YMAX 190)   ← ***가운데***(레터박스라 내용이 가운데 온다)
      //   잘라 채우기(crop) 자막이 y=560..640 (YMAX 235)   ← 아래
      // ```
      //   ⛔ 1판은 «아래 25%»만 봤다 ⇒ ***기본 경로(fit)에서 「자막이 사라졌다」는 거짓 양성***을 냈다.
      //   🔑 ***내가 방금 세운 관문이, 내가 방금 바꾼 기본값을 «틀렸다»고 말했다.***
      //     초록만 봤으면 못 봤고, 두 모드를 «나란히» 돌려서 보였다.
      //
      // ⇒ 위치를 «가정»하지 않고 ***기하로 «계산»한다.*** 어느 모드였는지는 deliver 가 알려준다.
      const mode = ctx.state.deliver_mode === 'crop' ? 'crop' : 'fit';
      const mw = Number(mSize.split(',')[0]), mh = Number(mSize.split(',')[1]);
      const tw2 = Number(got.split(',')[0]), th2 = Number(got.split(',')[1]);
      // fit = 안에 «다 들어간다»(min) · crop = 덮고 «잘린다»(max)
      const sc = mode === 'crop' ? Math.max(tw2 / mw, th2 / mh) : Math.min(tw2 / mw, th2 / mh);
      const sh = mh * sc, oy = (th2 - sh) / 2;
      // 마스터의 «아래 25%»가 납품물에서 어디에 오나
      let bandY = oy + mh * 0.75 * sc, bandH = mh * 0.25 * sc;
      // ⛔ 화면 «밖»으로 나간 만큼은 ***잘려 나간 것***이다 — 잘라서 남는 것만 본다.
      if (bandY < 0) { bandH += bandY; bandY = 0; }
      if (bandY + bandH > th2) bandH = th2 - bandY;
      ctx.log('shipcheck.caption-band', { file: name, mode, band: [Math.round(bandY), Math.round(bandH)] });
      if (bandH < 2) {
        // ⛔ 자막이 설 자리가 «통째로» 잘렸다 — 픽셀을 볼 것도 없다.
        bad.push(`${name}: ***자막 자리가 «통째로 잘렸다»***(${mode} · 남은 높이 ${bandH.toFixed(1)}px)`);
        continue;
      }
      const mb = join(shots, `m-${name}.png`), db = join(shots, `d-${name}.png`);
      const cropM = 'crop=iw:ih*0.25:0:ih*0.75';
      const cropD = `crop=${tw2}:${Math.round(bandH)}:0:${Math.round(bandY)}`;
      const okM = ffmpeg(['-ss', String(capT), '-i', master, '-vf', cropM, '-frames:v', '1', mb]).ok;
      const okD = ffmpeg(['-ss', String(capT), '-i', p, '-vf', cropD, '-frames:v', '1', db]).ok;
      const ym = okM ? lumaMax(mb) : null;
      const yd = okD ? lumaMax(db) : null;
      if (ym === null || yd === null) {
        unmeasured.push(`${name}: 자막 띠를 못 쟀다`);
      } else {
        capChecked++;
        ctx.log('shipcheck.caption', { file: name, t: Number(capT.toFixed(2)), masterYmax: ym, shipYmax: yd });
        // ⛔ 마스터에 «밝은 글자»가 있는데 납품물 띠가 납작하면 ***잘려 나간 것***이다.
        // ⚠️ 축소되면 안티에일리어싱으로 «밝기가 준다» — 실측 235 → 190(배율 0.56).
        //   ⇒ 배율을 감안해 문턱을 낮춘다. ⛔ 그래도 «납작한 것»(배경만)은 여전히 잡힌다.
        if (ym >= 200 && yd < ym * 0.6) {
          bad.push(`${name}: ***자막이 «사라졌다»*** — 마스터 띠 YMAX ${ym} ↔ 납품물 ${yd}`);
        }
      }
    }
  }

  const tail = (capT === null
    ? ' · ⚠️ 자막 축은 «안 봤다»(edl 에 자막이 없다)'
    : ` · 자막 띠 대조 ${capChecked}/${made.length}`)
    + (unmeasured.length > 0 ? ` · ⚠️ 못 잰 것 ${unmeasured.length}: ${unmeasured.join(' · ')}` : '');

  if (bad.length > 0) {
    // ⛔ deliver 로 «되돌린다» — 고치는 것은 만드는 노드의 일이다(게이트는 찾기만 한다).
    return { outcome: 'ship-broken', note: `납품물 ${bad.length}종이 «틀렸다» — ${bad.join(' · ')}${tail}` };
  }
  // ⛔ 「못 잰 것」만 있고 「틀린 것」이 없으면 그것은 «통과»가 아니다.
  if (unmeasured.length > 0 && capChecked === 0 && capT !== null) {
    return { outcome: 'unmeasurable', note: `납품물을 «못 쟀다» — ${unmeasured.join(' · ')}` };
  }
  return { outcome: 'pass', note: `납품물 ${made.length}종 확인 — 규격·길이·소리${tail}` };
};
