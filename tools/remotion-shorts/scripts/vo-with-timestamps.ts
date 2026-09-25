#!/usr/bin/env bun
/**
 * VO 를 «타임스탬프와 함께» 만든다 — 그리고 그 타임스탬프로 `src/captions*.ts` 를 «쓴다».
 *
 * ⛔ 왜 이 스크립트가 있나 (2026-09-10 · 대표 *"whisper-cpp 가 아니라 elevenlabs 와 결합도 가능한 것 아닌가요"*)
 *
 *   whisper 축:      대본 → TTS → 오디오 → **다시 들어서 받아쓰기** → 정렬
 *                    ⛔ ASR 오차가 «반드시» 낀다. 모델이 하나 더 붙는다.
 *   ElevenLabs 축:   대본 → TTS ⊕ **정렬을 같은 응답에서 받는다**
 *                    ✅ 텍스트가 «우리가 넣은 대본 그대로»라 받아쓰기 오차가 «원리상 없다».
 *
 * 📏 독립된 자(`ffmpeg silencedetect` 의 발화 재개 시각)로 잰 값 — 한국어 21낱말:
 *      ElevenLabs 평균 29ms · 최대 61ms   |   whisper.cpp --dtw 평균 75ms · 최대 197ms
 *      ⊕ whisper 는 낱말 «둘»을 아예 놓쳤다(받아쓰기 오차) ⇒ 정렬할 낱말이 «없다».
 *
 * 사용:
 *   ELEVENLABS_API_KEY=$(cat ~/.cache/elevenlabs_api_key) bun scripts/vo-with-timestamps.ts        # ko
 *   ELEVENLABS_API_KEY=…                                  bun scripts/vo-with-timestamps.ts en
 */
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('ELEVENLABS_API_KEY 없음 — ~/.cache/elevenlabs_api_key');

const LANG = (process.argv[2] ?? 'ko') as 'ko' | 'en';

/**
 * 🎙️ 보이스는 대표 이 «들어 보고» 고른 값이다 — 후보를 실제로 뽑아 텔레그램으로 보내고 받은 답이다.
 *
 * ⛔ 그전엔 `/v1/voices` 응답의 **첫 번째**를 그냥 썼다(`Roger` · 영어 american male).
 *    한국어를 영어 목소리에 태웠고 대표 이 *"음성이 지금 구립니다"* 로 잡았다.
 *    ⇒ ***기본값을 쓰기 전에 「계정/라이브러리에 무엇이 있나」를 «센다».***
 *
 * ⛔ 영어는 한국어 보이스로 대신할 수 없다 — `Seulki` 로 영어를 읽히면 억양이 섞인다.
 *    그리고 「계정에 원래 있던 프리메이드」와 「이 톤을 찾아서 고른 것」도 다르다:
 *    대표 이 *"좀더 소프트하고 감성적인 톤"* 을 요구해 라이브러리를 soft/gentle/intimate/warm/
 *    soothing/asmr/calm 으로 검색(고유 79건)해 복제수 상위 5종을 들려 드렸고, 그중 골랐다.
 *    *"감성적인 톤은 samantha 가 어울리네요. 나머지는 과합니다."*
 */
const VOICE = {
  ko: 'ksaI0TCD9BstzEzlxj4q', // Seulki · ko · seoul · female · professional
  en: 'uIZsnBL0YK1S5j69bAih', // Samantha · Emotional relaxed · american · young
} as const;

/** ⛔ 대본은 `05_script.json` 의 `vo` 필드가 canonical. 여기 적힌 것은 그 사본이다. */
const LINES = {
  ko: [
    '샤워하고 나왔는데, 향이 아직 남아 있어요.',
    '바디워시가 아니라, 바디 퍼퓸이에요.',
    '냉장고에 넣어두면 더 좋습니다. 브랜드가 그렇게 안내해요.',
    '에바스 블루 로즈마인 샤워코롱.',
  ],
  en: [
    'Just stepped out of the shower — and the scent is still there.',
    "It's not a body wash. It's a body perfume.",
    'Keep it in the fridge. The brand actually recommends it.',
    'Evas Blue Rosemine Shower Cologne.',
  ],
} as const;

const voiceId = process.env.EL_VOICE_ID ?? VOICE[LANG];
const modelId = process.env.EL_MODEL_ID ?? 'eleven_v3';
const lines = LINES[LANG];

const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
  {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join(' '), model_id: modelId }),
  },
);
if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
const data = (await res.json()) as {
  audio_base64: string;
  alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
};

const audioFile = LANG === 'ko' ? 'public/vo-el.mp3' : 'public/vo-en.mp3';
await Bun.write(audioFile, Buffer.from(data.audio_base64, 'base64'));

// 문자 단위 → 낱말 단위. ⚠️ 문장부호는 앞 낱말에 붙는다(공백만 경계).
const { characters: ch, character_start_times_seconds: st, character_end_times_seconds: en } = data.alignment;
type W = { t: string; a: number; b: number };
const words: W[] = [];
let cur = '', s0 = 0, pb = 0;
for (let i = 0; i < ch.length; i++) {
  if (/\s/.test(ch[i])) { if (cur) { words.push({ t: cur, a: s0, b: pb }); cur = ''; } continue; }
  if (!cur) s0 = st[i];
  cur += ch[i]; pb = en[i];
}
if (cur) words.push({ t: cur, a: s0, b: pb });

// 페이지 = 대본의 한 줄. ⛔ 낱말 수로 자른다 — 줄과 낱말의 대응이 무너지면 여기서 어긋난다.
const pages: string[] = [];
let i = 0;
for (const line of lines) {
  const ws = words.slice(i, i + line.split(/\s+/).filter(Boolean).length);
  i += ws.length;
  if (ws.length === 0) throw new Error(`페이지 접기 실패: "${line}" — 낱말이 모자란다`);
  const body = ws.map((w) => `{ t: '${w.t.replace(/'/g, "\\'")}', atMs: ${Math.round(w.a * 1000)} }`).join(', ');
  pages.push(`  { fromMs: ${Math.round(ws[0].a * 1000)}, toMs: ${Math.round(ws[ws.length - 1].b * 1000)}, words: [${body}] },`);
}
if (i !== words.length) throw new Error(`낱말 ${words.length}개 중 ${i}개만 배정됐다 — 대본과 정렬이 어긋났다`);

const outFile = LANG === 'ko' ? 'src/captions.ts' : 'src/captions-en.ts';
await Bun.write(outFile, [
  '// ⛔ 손으로 추정하지 않는다 — ElevenLabs /with-timestamps 가 «오디오와 같은 호출»에서 낸 실측값.',
  '// ⛔ 이 파일은 «생성물»이다. 손으로 고치지 말고 scripts/vo-with-timestamps.ts 를 다시 돌려라.',
  LANG === 'ko'
    ? 'export type Page = { fromMs: number; toMs: number; words: { t: string; atMs: number }[] };'
    : "import type { Page } from './captions';",
  '',
  'export const PAGES: Page[] = [',
  ...pages,
  '];',
  '',
].join('\n'));

console.log(`✓ ${audioFile} ${en[en.length - 1].toFixed(3)}s · 낱말 ${words.length} · 페이지 ${pages.length} · ${LANG}/${modelId}`);
