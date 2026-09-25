/**
 * 🎤⭐⭐ 음악 검수 — ***「소리가 난다」와 「가사를 불렀다」는 다른 값이다.***
 *
 * ⛔⭐⭐ 이 파일이 생긴 이유 — ***`probeSoundEnd` 가 «원리상» 못 보는 것이 있다.***
 *
 * 📏 실측 2026-09-22 · YuE2-3B(audio.cpp · Metal) 1발:
 * ```
 * 파일       67.96s · 48kHz stereo · mean −20.2 dB · 꼬리무음 0.84s
 * probeSoundEnd 의 판정                       ⇒ ✅ 「정상」(꼬리무음 1초 미만)
 * 그런데 받아쓰기(whisper-asr)를 눌러 보니:
 *    0.0– 44.0s  내가 «준 가사 4줄»을 글자 그대로 불렀다               4/4
 *   44.0– 67.96s  "Weimy Penetrares" · "可 marketing" · "Thank you."   ⇒ ***가사 밖 24초(35%)***
 * ```
 * > ### 🩸 ***소리는 끝까지 «났다». 그래서 음량·무음 자는 이 결함을 볼 수 없다.***
 *
 * 🔑 두 엔진의 「요청 길이 ≠ 쓸 수 있는 길이」가 ***모양이 서로 다르다***:
 * ```
 * ACE-Step  요청 40s → 소리 36.57s   나머지는 «무음»        ⇒ 무음 자가 «본다»
 * YuE2      요청 40s → 가사 44.0s    나머지는 «가사 밖 노래»  ⇒ 무음 자가 «못 본다»
 * ```
 * ⛔ ⇒ ***자를 하나 더 얹는 것이 아니라, 「이 자가 무엇을 못 보나」를 먼저 물어야 했다.***
 *   (`.rules` 의 상시 규율 — 「관문은 자기가 못 보는 것을 말해야 한다」와 같은 자리다)
 *
 * ⛔ 이 파일은 «순수»다 — ASR 을 부르지 않는다. 받아쓴 SRT 를 «받아서» 잰다.
 *   그래야 자를 «오프라인 픽스처»로 누를 수 있고, 원격이 꺼져도 자 자신은 살아 있다.
 */
import { lastSrtDropped, parseSrt } from './remote.js';

export interface LyricFidelity {
  /** 준 가사 줄 수. ⛔ 0 이면 «잴 것이 없다»(가사 없는 기악) — 결함이 아니다. */
  readonly given: number;
  /** 그중 «글자 그대로» 받아쓴 줄 수. */
  readonly matched: number;
  /** 가사가 «살아 있는» 마지막 시각(초). ⛔ 한 줄도 못 맞히면 null(«못 쟀다»). */
  readonly onScriptEnd: number | null;
  /** 그 뒤 «가사 밖» 구간(초). onScriptEnd 가 null 이면 null. */
  readonly offScript: number | null;
  /** ⛔ 「못 쟀다」의 «이유». 값이 있으면 위 수를 판정에 쓰지 않는다. */
  readonly why?: string;
}

/**
 * ⛔ 대소문자·구두점·공백을 «지운 뒤» 비교한다 — ASR 은 마침표를 안 찍는다.
 *
 * ⚠️⭐ ***이 자는 「동음이의」를 «틀렸다»고 센다*** — 📏 실측 2026-09-22:
 *   준 가사 `What **mends** itself is what we let it know`
 *   받아쓴 것 `What **means** itself is what we let it know`
 *   ⇒ ***귀로는 맞는데*** 글자로는 다르다. 그래서 4/4 가 «3/4» 로 나온다.
 * 🔑 그래서 이 수는 ***「덜 맞았다」 쪽으로만 틀린다***(보수적) — 「더 맞았다」로는 안 틀린다.
 *   ⛔ 그 방향을 «모르고» 쓰면 「가사가 안 맞는다」고 엉뚱한 곳을 고치게 된다.
 * ⇒ 판정에 쓸 때는 `matched` 보다 `onScriptEnd`(어디까지 살아 있나)를 보는 쪽이 튼튼하다.
 */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 가사 문면에서 «부를 줄»만 남긴다.
 * ⛔ `[Verse]`·`[Chorus]`·`[inst]` 같은 구조 태그는 «부르는 말이 아니다» — 세면 분모가 부푼다.
 */
export function lyricLines(lyrics: string): string[] {
  return lyrics.split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[[^\]]*\]$/.test(l));
}

/**
 * 📏 준 가사가 «실제로 불렸나»를 받아쓴 SRT 로 잰다.
 *
 * ⛔⭐ 세 값을 가른다 — 「다 불렀다」 · 「일부만」 · ***「못 쟀다」***.
 *   받아쓰기가 구간을 «하나도» 못 냈으면 그것은 「0줄 불렀다」가 «아니라» 「못 쟀다」다.
 *   (⛔ 이 둘을 접으면 ***ASR 이 죽은 날 모든 음악이 「가사 0」으로 보인다***)
 */
export function lyricFidelity(srtText: string, lyrics: string, audioDur?: number): LyricFidelity {
  const given = lyricLines(lyrics);
  if (given.length === 0) {
    return { given: 0, matched: 0, onScriptEnd: null, offScript: null, why: '가사가 «없다» — 잴 것이 없다(기악)' };
  }
  const cues = parseSrt(srtText);
  // ⛔ 「몇 개를 버렸나」를 «바로» 읽는다 — 다음 호출이 덮는다.
  const dropped = lastSrtDropped();
  if (cues.length === 0) {
    return { given: given.length, matched: 0, onScriptEnd: null, offScript: null,
      why: '받아쓰기에서 구간을 «하나도» 못 읽었다 — 「가사 0줄」이 아니라 「못 쟀다」다'
        + (dropped > 0 ? ` (⊕ 꼴이 깨져 «버린» 구간 ${dropped}개)` : '') };
  }
  const wanted = given.map(norm);
  const used = new Set<number>();
  let onScriptEnd: number | null = null;
  let matched = 0;
  for (const c of cues) {
    const t = norm(c.text);
    if (t.length === 0) continue;
    // ⛔⭐ 「몇 줄을 맞혔나」와 「가사가 어디까지 살아 있나」는 ***다른 물음이다.***
    //   🩸 1판은 «처음 맞힌 한 번»만 셌다. 그래서 후렴이 «되풀이»되면
    //      두 번째 등장이 안 잡혀 `onScriptEnd` 가 ***실제보다 이르게*** 나왔다
    //      ⇒ 쓸 수 있는 구간을 «짧게» 잘라 버린다(안전한 쪽이지만 «틀린 값»이다).
    //   ⇒ `matched` 는 «서로 다른 줄»을 세고, `onScriptEnd` 는 «되풀이도» 인정한다.
    const seen = wanted.indexOf(t);
    if (seen < 0) continue;
    const i = wanted.findIndex((w, k) => !used.has(k) && w === t);
    if (i >= 0) { used.add(i); matched++; }
    // ⛔⭐ ASR 의 타임스탬프는 «깨질 수 있다» — 실측 산출에 `61.3 → 49.2`(끝<시작) 구간이 있었다.
    //   그런 구간의 `end` 를 그대로 쓰면 「가사가 살아 있는 데까지」가 조용히 틀린다.
    const end = c.end >= c.start ? c.end : c.start;
    if (onScriptEnd === null || end > onScriptEnd) onScriptEnd = end;
  }
  if (matched === 0) {
    return { given: given.length, matched: 0, onScriptEnd: null, offScript: null,
      why: `받아쓴 구간 ${cues.length}개 중 준 가사와 «글자 그대로» 맞는 것이 «한 줄도» 없다`
        + ` — 다른 가사를 불렀거나 못 알아들었다`
        + (dropped > 0 ? ` (⊕ 꼴이 깨져 «버린» 구간 ${dropped}개)` : '') };
  }
  // ⛔⭐⭐ 길이를 «모르면» 가사 밖 구간도 «모른다» — 0 으로도, 추정으로도 접지 않는다.
  //
  // 🩸 1판은 여기서 「마지막 자막의 끝」을 길이로 «썼다». 실측에서 그것이 **97.2s** 였다 —
  //   ***파일(67.96s)보다 29초 길다.*** ASR 이 낸 시각이지 파일의 길이가 «아니었다».
  //   ⇒ 그 값으로 가사 밖 구간이 24.0s 대신 **53.2s** 로 나왔고, 그럴듯해서 «틀린 줄 몰랐다».
  // 🔑 ***자막의 시각은 「소리의 길이」를 답하는 칸이 아니다.*** 모르면 null 이다.
  const offScript = audioDur !== undefined && Number.isFinite(audioDur)
    ? Math.max(0, audioDur - onScriptEnd!)
    : null;
  return { given: given.length, matched, onScriptEnd, offScript };
}

/** 사람이 읽는 한 줄. ⛔ 「못 쟀다」를 «초록으로 접지 않는다». */
export function sayLyricFidelity(f: LyricFidelity): string {
  if (f.why !== undefined) return `⚠️ 가사 축을 «못 쟀다» — ${f.why}`;
  const head = `🎤 준 가사 ${f.given}줄 중 «글자 그대로» ${f.matched}줄`
    + ` · 가사 구간 0.0–${f.onScriptEnd!.toFixed(1)}s`;
  if (f.offScript === null) return `${head} · ⚠️ 그 뒤 길이를 «못 쟀다»`;
  if (f.offScript < 1) return `${head} · 가사 밖 구간 없음 ✅`;
  return `${head} · ⛔ ***가사 밖 ${f.offScript.toFixed(1)}s*** — 그만큼은 쓸 수 없다`;
}
