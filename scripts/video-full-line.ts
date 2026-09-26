#!/usr/bin/env bun
/**
 * 🎬🎬 종합 시나리오 — ***소재·나레이션·음악을 «전부 생성»해서 광고 한 편을 만든다.***
 *
 * ⛔⭐⭐ 무료 라인(`video-free-line.ts`)과 무엇이 다른가:
 * ```
 * 무료 라인   소재를 «준다» · 나레이션은 macOS say · 음악 «없음»        ⇒ 로컬 ffmpeg 만
 * 종합        소재를 «만든다» · 나레이션 Qwen3-TTS · 음악 MiniMax-Music3 ⇒ node-b 의 로컬 모델
 * ```
 * 🔑 둘 다 ***과금 0***이다. 차이는 「돈」이 아니라 ***「어느 기계가 일하나」***다.
 *
 * ⛔ 실패 갈래를 «셋»으로 가른다 — 0 만들었다 · 1 실패 · ***2 못 물어봤다*** · 3 준비 실패.
 *   「호스트가 꺼져 있다」를 「못 만든다」로 접지 않는다.
 *
 * 돌리는 법:
 *   bun scripts/video-full-line.ts --scene-file <장면.json> [--host <media 호스트>] [--out <dir>] [--no-assemble]
 *   ⭐ 기본은 생성 «뒤» 무료 라인(`video-free-line --scene`)까지 «이어서» 돈다 — 종료코드는 그 라인의 것(0 delivered · 1 · 2 못 쟀다).
 *      `--no-assemble` 이면 scene.json 에서 멈춘다(종료 0). `--json` 은 기계 계약이라 «잇지 않는다»(scene 메타만 낸다).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgv, type FlagKind } from './lib/argv.js';
import { probeSoundEnd } from '../src/video-pipeline/recipes/ffmpeg.js';
import { lyricFidelity, lyricLines, sayLyricFidelity, type LyricFidelity } from '../src/video-pipeline/recipes/music-qc.js';
import { genImage, genMusicAny, genVoice, parseSrt, scpFrom, sshRun, transcribe,
  type MusicEngine, type RemoteResult } from '../src/video-pipeline/recipes/remote.js';
import { writeStdoutJson } from '../src/cli/stdout-json.js';
import { mediaSshHost } from '../src/ssh/ssh-hosts.js';

interface Scene { prompt: string; caption: string }
interface SceneFile {
  title: string;
  voiceInstruct: string;
  scenes: Scene[];
  music?: { caption: string; lyrics: string; duration?: number; engines?: MusicEngine[] };
  specs?: string[];
}

const KNOWN: Record<string, FlagKind> = {
  '--scene-file': 'value', '--host': 'value', '--out': 'value',
  '--skip-music': 'bool', '--json': 'bool', '--music-engine': 'value', '--no-assemble': 'bool',
};
const P = parseArgv(process.argv.slice(2), { known: KNOWN, label: 'video-full-line' });
if (P.errors.length > 0) { for (const e of P.errors) console.error(`⛔ ${e}`); process.exit(3); }

const sceneFile = P.values['scene-file'];
if (!sceneFile || !existsSync(sceneFile)) { console.error('⛔ --scene-file <장면.json> 이 필요하다'); process.exit(3); }
let S: SceneFile;
try { S = JSON.parse(readFileSync(sceneFile, 'utf8')) as SceneFile; }
catch (e) { console.error(`⛔ 장면 파일을 못 읽었다: ${(e as Error).message}`); process.exit(3); }
if (!Array.isArray(S.scenes) || S.scenes.length < 2) { console.error('⛔ scenes 가 둘 이상이어야 한다'); process.exit(3); }

const HOST_OR_NULL = P.values.host ?? mediaSshHost();
if (!HOST_OR_NULL) { console.error('⛔ media 호스트가 없다 — --host 를 주거나 ~/.elanous/ssh-hosts.json 에 `roles: ["media"]` 호스트를 둔다(또는 ELANOUS_MEDIA_HOST).'); process.exit(2); }
const HOST: string = HOST_OR_NULL;
const OUT = P.values.out ?? mkdtempSync(join(tmpdir(), 'fullline-'));
mkdirSync(join(OUT, 'source'), { recursive: true });
const REMOTE = `~/fullline-${Date.now()}`;

const say = (s: string): void => { if (!P.flags.has('json')) console.log(s); };
say(`\n🎬 종합 시나리오 — ${S.title}`);
say(`   호스트 ${HOST} · 작업 ${OUT}`);
say(`   장면 ${S.scenes.length} · 음악 ${S.music && !P.flags.has('skip-music') ? '생성' : '없음'}\n`);

// ⛔ 「못 물어봤다」를 만나면 «거기서 멈춘다» — 반쯤 만든 것을 성공으로 내지 않는다.
const bail = (r: RemoteResult, what: string): never => {
  if (r.kind === 'unmeasurable') {
    console.error(`⚠️ ${what}: «못 물어봤다» — ${r.why}`);
    console.error('   ⛔ 이것은 「못 만든다」가 «아니다». 그 기계를 켜고 다시 쳐라.');
    process.exit(2);
  }
  console.error(`⛔ ${what}: ${r.why}`);
  process.exit(1);
};

sshRun(HOST, `mkdir -p ${REMOTE}/img ${REMOTE}/voice ${REMOTE}/music`, 60_000);

// ── ① 소재를 «만든다» ──
//
// ⛔⭐⭐ ***장면이 「어떤 비율로 납품한다」고 «선언»했는데 소재는 정사각으로 만들고 있었다.***
//   🩸 실측 2026-09-22: `specs: ["1080x1920"]` 인 장면의 소재를 1024×1024 로 박아 만들었고,
//      합성이 그것을 9:16 에 «레터박스»로 넣어 ***위아래로 검은 띠가 생겼다.***
//      ⇒ 종단은 delivered, 검수도 pass — ***아무 관문도 이것을 안 봤다.***
//   🔑 ***「선언한 비율」과 「만든 비율」이 갈리면 그 차이는 «검은 띠»로만 드러난다.***
//   ⇒ 첫 spec 에서 «그때» 읽는다. ⛔ 여기에 수를 박지 않는다.
const SPECS = S.specs ?? ['1080x1920'];
const specMatch = /^(\d+)x(\d+)$/.exec(SPECS[0]!.trim());
if (specMatch === null) {
  console.error(`⛔ specs[0] 이 <가로>x<세로> 꼴이 아니다: ${SPECS[0]}`);
  process.exit(3);
}
// ⛔ mflux 는 «8의 배수»를 요구한다 — 내림해서 맞춘다(올리면 요청보다 커진다).
const floor8 = (n: number): number => Math.max(8, Math.floor(n / 8) * 8);
const IMG_W = floor8(Number(specMatch[1])), IMG_H = floor8(Number(specMatch[2]));
if (IMG_W !== Number(specMatch[1]) || IMG_H !== Number(specMatch[2])) {
  say(`  ⚠️ 소재 크기를 8의 배수로 내렸다: ${specMatch[1]}x${specMatch[2]} → ${IMG_W}x${IMG_H}`);
}
say(`  📐 소재 ${IMG_W}x${IMG_H} (첫 납품 규격 ${SPECS[0]} 에서 «읽었다»)`);

const localImages: string[] = [];
for (const [i, sc] of S.scenes.entries()) {
  const name = `s${String(i).padStart(2, '0')}.png`;
  say(`  🖼️  장면 ${i + 1}/${S.scenes.length} 생성 중…`);
  const r = genImage(HOST, { prompt: sc.prompt, outRemote: `${REMOTE}/img/${name}`, width: IMG_W, height: IMG_H, seed: 42 + i });
  if (r.kind !== 'ok') bail(r, `장면 ${i} 이미지`);
  const got = scpFrom(HOST, `${REMOTE}/img/${name}`, join(OUT, 'source', name));
  if (got.kind !== 'ok') bail(got, `장면 ${i} 가져오기`);
  localImages.push(join(OUT, 'source', name));
  say(`      ✅ ${name} (${r.seconds}초)`);
}

// ── ② 나레이션을 «만든다» ──
say('  🔊 나레이션 생성 중…');
const voiceText = S.scenes.map((s) => s.caption).join(' ');
const rv = genVoice(HOST, { text: voiceText, instruct: S.voiceInstruct, outDirRemote: `${REMOTE}/voice`, prefix: 'vo' });
if (rv.kind !== 'ok') bail(rv, '나레이션');
const voLocal = join(OUT, 'vo.wav');
const gotVo = scpFrom(HOST, `${REMOTE}/voice/vo_000.wav`, voLocal);
if (gotVo.kind !== 'ok') bail(gotVo, '나레이션 가져오기');
say(`      ✅ vo.wav (${rv.seconds}초)`);

// ── ②b 받아쓰기 — ⭐ ***자막 타이밍을 「계획」이 아니라 「소리」에서 얻는다*** ──
//   ⛔ 실패해도 «계속 간다» — 그때는 균등분할이고, 그 사실을 무료 라인이 말한다.
let srtLocal: string | null = null;
say('  📝 받아쓰기(타이밍) …');
const rt = transcribe(HOST, { audioRemote: `${REMOTE}/voice/vo_000.wav`, outBaseRemote: `${REMOTE}/voice/vo` });
if (rt.kind === 'ok') {
  const gs = scpFrom(HOST, `${REMOTE}/voice/vo.srt`, join(OUT, 'vo.srt'));
  if (gs.kind === 'ok') {
    const segs = parseSrt(readFileSync(join(OUT, 'vo.srt'), 'utf8'));
    // ⛔ 「구간 0개」를 성공으로 읽지 않는다.
    if (segs.length > 0) { srtLocal = join(OUT, 'vo.srt'); say(`      ✅ 구간 ${segs.length}개 (${rt.seconds}초)`); }
    else say('      ⚠️ 받아쓰기에서 구간을 «하나도» 못 읽었다 — 균등분할로 간다');
  } else say(`      ⚠️ SRT 를 못 가져왔다 — ${gs.why}`);
} else {
  say(`      ⚠️ 받아쓰기 실패(${rt.kind}) — ${rt.why}`);
  say('      ⇒ 균등분할로 «계속 간다»(그 사실을 산출이 말한다)');
}

// ── ③ 음악을 «만든다»(선택) ──
//
// ⛔⭐ 무료 음악 엔진이 «셋»이고 ***런타임이 서로 다르다***(MLX · GGML×2).
//   🩸 2026-09-22 까지 이 자리는 `genMusic`(MiniMax·MLX) «하나»에 못 박혀 있었다.
//      그래서 그 엔진이 죽으면 ***음악 축이 통째로 0***이 됐고, 산출은 그냥 「없음」이라고만 했다.
//   ⇒ 🔑 ***순서를 데이터로 받고, 「어느 엔진이 만들었나」와 「무엇을 못 물어봤나」를 «둘 다» 적는다.***
//
// ⚠️ 기본 순서의 근거 — 가사가 있으면 «노래»가 필요하니 YuE2 가 먼저,
//   기악 배경이면 ACE-Step 이 빠르다(실측 21초). MiniMax 는 마지막 안전망.
const DEFAULT_ENGINES: MusicEngine[] = ['yue2-audiocpp', 'acestep-cpp', 'minimax-mlx'];
const VALID_ENGINES: readonly MusicEngine[] = ['yue2-audiocpp', 'acestep-cpp', 'minimax-mlx'];

let musicEngines: MusicEngine[] = S.music?.engines ?? DEFAULT_ENGINES;
const engFlag = P.values['music-engine'];
if (engFlag !== undefined) {
  const picked = engFlag.split(',').map((x) => x.trim()).filter(Boolean);
  // ⛔ 모르는 이름을 «조용히 버리지» 않는다 — 버리면 「내가 고른 엔진이 안 돌았다」가 안 보인다.
  const bad = picked.filter((x) => !VALID_ENGINES.includes(x as MusicEngine));
  if (bad.length > 0) {
    console.error(`⛔ --music-engine 에 모르는 이름: ${bad.join(', ')} — 쓸 수 있는 것: ${VALID_ENGINES.join(', ')}`);
    process.exit(3);
  }
  musicEngines = picked as MusicEngine[];
}

let musicLocal: string | null = null;
let musicEngineUsed: MusicEngine | null = null;
let musicSkipped: { engine: MusicEngine; why: string }[] = [];
// ⛔ 「못 쟀다」(null)와 「0초」를 «다른 값»으로 둔다 — 0 은 「통째로 무음」이라는 다른 사실이다.
let musicSoundEnd: number | null = null;
let musicTailSilence: number | null = null;
let musicLyric: LyricFidelity | null = null;
// ⛔ 「여기까지는 «쓸 수 있다»」 — null 은 「못 쟀다」이지 「0초」가 아니다.
let musicUsableEnd: number | null = null;
if (S.music && !P.flags.has('skip-music')) {
  say(`  🎵 음악 생성 중… (순서: ${musicEngines.join(' → ')})`);
  const rm = genMusicAny(HOST, musicEngines, {
    caption: S.music.caption, lyrics: S.music.lyrics,
    outRemote: `${REMOTE}/music/bgm.wav`, duration: S.music.duration ?? 30,
  });
  musicSkipped = rm.skipped ?? [];
  for (const sk of musicSkipped) say(`      ↷ ${sk.engine} — ${sk.why}`);
  // ⛔ 「전부 못 물어봤다」면 그것은 «실패»가 아니라 ***측정 불가***다 — 여기서 멈춘다.
  if (rm.kind === 'unmeasurable') bail(rm, '음악');
  if (rm.kind !== 'ok') {
    // ⛔ 음악은 «없어도» 광고가 된다 — 실패를 말하고 «계속 간다».
    say(`      ⚠️ 음악 실패 — ${rm.why}`);
    say('      ⇒ 음악 «없이» 계속한다(그 사실을 산출이 말한다)');
  } else {
    const gm = scpFrom(HOST, `${REMOTE}/music/bgm.wav`, join(OUT, 'bgm.wav'));
    if (gm.kind === 'ok') {
      musicLocal = join(OUT, 'bgm.wav');
      musicEngineUsed = rm.engine ?? null;
      say(`      ✅ bgm.wav (${rm.seconds}초 · 엔진 ${musicEngineUsed})`);
      // ⛔⭐ ***「파일이 몇 초냐」는 「소리가 몇 초까지 나냐」가 «아니다».***
      //   🩸 실측: ACE-Step 에 40초를 시키면 파일은 39.60초인데 «마지막 3.03초가 무음»이다.
      //      그것만 보고 넘기면 ***음악이 3초 일찍 끝나는 광고***가 그대로 나간다.
      //   ⛔ 꼬리 무음은 «비례하지 않아»(4.95s ↔ 3.03s) 상수로 뺄 수도 없다 ⇒ «잰다».
      const snd = probeSoundEnd(musicLocal);
      if (snd.dur === null) {
        musicSoundEnd = null;
        say(`      ⚠️ 음악의 «소리 끝»을 못 쟀다 — ${snd.why}`);
      } else {
        musicSoundEnd = snd.soundEnd;
        musicTailSilence = snd.tailSilence;
        const want = S.music.duration ?? 30;
        say(`      📏 길이 ${snd.dur.toFixed(2)}s · 소리 끝 ${snd.soundEnd!.toFixed(2)}s`
          + ` · 꼬리무음 ${snd.tailSilence!.toFixed(2)}s`);
        // ⛔ 어긋남을 «양쪽 다» 말한다 — 모자란 것만 보면 「너무 긴」 산출이 조용히 통과한다.
        //   🩸 실측: YuE2 는 40s 를 시켜도 104.32s 를 낸다(그 엔진은 길이를 «못 시킨다»).
        //      ⇒ 「모자란가」만 물으면 그 판은 ✅ 로 읽힌다.
        if (snd.soundEnd! < want - 0.5) {
          say(`      ⚠️ 요청 ${want}s 인데 «소리»는 ${snd.soundEnd!.toFixed(2)}s 까지다`
            + ` — ${(want - snd.soundEnd!).toFixed(2)}s 모자란다`);
        } else if (snd.soundEnd! > want + 0.5) {
          say(`      ⚠️ 요청 ${want}s 인데 «소리»가 ${snd.soundEnd!.toFixed(2)}s 까지 간다`
            + ` — ${(snd.soundEnd! - want).toFixed(2)}s 넘는다(이 엔진은 길이를 «못 시킨다»)`);
        }
      }

      // ⛔⭐⭐ ***위의 무음 자가 «원리상» 못 보는 축이 하나 더 있다.***
      //   🩸 실측 2026-09-22 · YuE2: 꼬리무음 0.84s 라 무음 자는 ✅ 라고 답했는데,
      //      받아쓰기를 눌러 보니 ***44.0s 뒤 24초(35%)가 «가사 밖 흥얼거림»***이었다.
      //      ⇒ ***소리는 끝까지 «났다». 그래서 음량·무음 축에서는 «볼 수가 없다».***
      //   🔑 두 엔진의 「요청 ≠ 쓸 수 있는 길이」가 ***모양이 다르다***:
      //      ACE-Step 은 «무음»으로 끝나고(무음 자가 본다), YuE2 는 «가사 밖 노래»로 끝난다(못 본다).
      // ⛔ 부를 가사가 «없으면»(기악) 이 축은 잴 것이 없다 — ASR 을 태우지 않는다.
      const sing = lyricLines(S.music.lyrics);
      if (musicLocal !== null && sing.length > 0) {
        const srtBase = `${REMOTE}/music/bgm-asr`;
        const tr = transcribe(HOST, { audioRemote: `${REMOTE}/music/bgm.wav`, outBaseRemote: srtBase, lang: 'en' });
        if (tr.kind !== 'ok') {
          // ⛔ 「가사 축 실패」로 «전체»를 죽이지 않는다 — 검수 축이지 생산 축이 아니다.
          say(`      ⚠️ 가사 축을 «못 쟀다» — 받아쓰기 ${tr.kind}: ${tr.why ?? ''}`);
        } else {
          const localSrt = join(OUT, 'bgm-asr.srt');
          const gs = scpFrom(HOST, `${srtBase}.srt`, localSrt);
          if (gs.kind !== 'ok' || !existsSync(localSrt)) {
            say(`      ⚠️ 가사 축을 «못 쟀다» — 받아쓴 자막을 못 가져왔다: ${gs.why ?? ''}`);
          } else {
            // ⛔ 길이를 «준다» — 안 주면 자가 「모른다」로 답한다(추정하지 않는다).
            musicLyric = lyricFidelity(readFileSync(localSrt, 'utf8'), S.music.lyrics, musicSoundEnd ?? undefined);
            say(`      ${sayLyricFidelity(musicLyric)}`);
            // ⛔⭐ 하류가 «자를 수 있도록» 한 값으로 접어 넘긴다 — 두 축 중 «먼저 끝나는» 쪽이다.
            //   ⛔ 「못 쟀다」(null)는 이 접기에서 «빠진다» — 모르는 값으로 자르면 안 된다.
            const ends = [musicSoundEnd, musicLyric.onScriptEnd].filter((x): x is number => x !== null);
            musicUsableEnd = ends.length > 0 ? Math.min(...ends) : null;
          }
        }
      }
    } else say(`      ⚠️ 음악을 못 가져왔다 — ${gm.why}`);
  }
}

// ── ④ 무료 라인에 «넘긴다» ──
const meta = {
  title: S.title, host: HOST, images: localImages, vo: voLocal, vo_srt: srtLocal, music: musicLocal,
  captions: S.scenes.map((s) => s.caption), specs: SPECS,
  provenance: { images: `Qwen-Image-2.1(${HOST})`, voice: `Qwen3-TTS-VoiceDesign(${HOST})`,
                timing: srtLocal ? `whisper-large-v3-turbo-asr(${HOST})` : '⚠️ 균등분할(받아쓰기 없음)',
                music: musicLocal ? `${musicEngineUsed}(${HOST})` : null,
                musicSoundEnd, musicTailSilence, musicLyric, musicUsableEnd,
                // ⛔ 「안 쓴 엔진」과 「못 물어본 엔진」을 «기록»한다 — 안 적으면 「없다」와 같은 얼굴이 된다.
                musicSkipped: musicSkipped.length > 0 ? musicSkipped : undefined,
                cost: '크레딧 0' },
};
writeFileSync(join(OUT, 'scene.json'), JSON.stringify(meta, null, 2), 'utf8');
sshRun(HOST, `rm -rf ${REMOTE}`, 60_000);   // ⛔ 남의 기계에 쓰레기를 안 남긴다

// ⛔⭐⭐ ***`console.log(JSON.stringify(...))` 는 바이트를 «잃을 수 있다».***
//   프로세스가 끝나면서 stdout 이 다 비워지기 «전»에 나갈 수 있고, 그러면
//   ***기계가 읽는 계약이 「잘린 JSON」으로 도착한다*** — 그리고 그것은 「빈 산출」처럼 보인다.
//   ⇒ `writeStdoutJson` 은 «다 쓸 때까지» 기다린다.
// 🩸 2026-09-22: 이 규칙의 게이트(`ci-stdout-json-gate`)가 «있었는데 아무 데도 안 걸려 있었다»
//   (🅢 보고 · #19747). 그래서 내 PR 이 4건을 이고 있었고 ***나는 몰랐다.***
//   🔑 ***「관문이 있다」와 「그 관문이 «불린다»」는 다른 값이다.***
if (P.flags.has('json')) await writeStdoutJson(JSON.stringify(meta, null, 2) + '\n');
else {
  say('\n═══ 생성 끝 ═══');
  say(`   소재 ${localImages.length}장 · 나레이션 ✅ · 타이밍 ${srtLocal ? '받아쓰기' : '⚠️ 균등분할'} · 음악 ${musicLocal ? `✅ ${musicEngineUsed}` : '없음'}`);
  say(`   ⇒ ${join(OUT, 'scene.json')}`);
  if (P.flags.has('no-assemble')) {
    say(`\n   ⏸️ --no-assemble — 여기서 멈춘다. 잇는 한 줄: bun scripts/video-free-line.ts --scene ${join(OUT, 'scene.json')}`);
  } else {
    // ⛔⭐ 「다음에 이걸 치세요」는 ***아직 안 이어진 것***이다(🩸 2026-09-23 실물: 생성 끝에서 사람이 그 줄을 «손으로» 쳤다).
    //   ⇒ 이제 «잇는다». 무료 라인이 합성·렌더·검수·납품을 하고, 그 종료코드가 이 러너의 종료코드다.
    say('\n═══ 조립으로 잇는다 — video-free-line --scene ═══');
    const freeLine = join(import.meta.dir, 'video-free-line.ts');
    const r = spawnSync('bun', [freeLine, '--scene', join(OUT, 'scene.json'), '--out', join(OUT, 'assembled')], { stdio: 'inherit' });
    if (r.status === null) { console.error(`⛔ 조립 라인이 죽었다(signal=${String(r.signal)}) — 생성물은 ${join(OUT, 'scene.json')} 에 있다`); process.exit(1); }
    process.exit(r.status);
  }
}
process.exit(0);
