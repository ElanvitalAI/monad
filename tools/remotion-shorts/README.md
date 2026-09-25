# `remotion-shorts` — 쇼츠 «편집»을 코드로

> 🅢 그래프 트랙 · 2026-09-10 · 매뉴얼 §2ⓠ 가 canonical

## 왜 여기 있나

⛔ **이 머신의 `ffmpeg` 은 자막을 «못 굽는다»** — `libass`·`drawtext`·`subtitles` 필터가
빌드에 **0건**이다(실측). 그런데 «인코딩»(`libx264`+`aac`)은 된다.

⇒ 그래서 **브라우저가 텍스트를 그리고 ffmpeg 은 프레임만 합친다**. 그것이 Remotion 이다.

## 무엇이 달라지나

***자막이 「에디터에서 고른 스타일」이 아니라 «코드»가 된다.***

- 같은 입력 = 같은 프레임 — `useCurrentFrame()` 이 **순수 함수**
- **git 에 들어간다** — 편집본에 diff·리뷰·되돌리기가 생긴다
- **크론이 돈다** — 웹 상태에 기대지 않는다(⛔ Topview 조립이 거기서 막혔다 · §2ⓟ)

## 돌리는 법

```bash
cd tools/remotion-shorts
bun install
npx remotion render src/index.ts EvasShorts out/shorts.mp4 --log=warn
```

⚠️ 입력 에셋(컷 mp4 · VO · BGM · SFX)은 저장소에 «없다**. `src/Shorts.tsx` 상단의
경로 상수를 자기 산출물로 바꾼다 — 그 산출은 `graphs/evas-shorts-pipeline.yaml` 의
`cuts` · `voice` · `music` 노드가 만든다.

## 🎙️ 보이스 — 표준이 «정해져 있다»

```
voice_id = ksaI0TCD9BstzEzlxj4q     # Seulki · ko · seoul · female · professional
model_id = eleven_v3
```
대표 2026-09-10 확정. ⛔ 다른 것을 쓰려면 먼저 묻는다(`EL_VOICE_ID`/`EL_MODEL_ID` 로 덮을 수 있다).

⛔ 그전엔 `Roger`(영어 american male)가 들어가 있었다 — `/v1/voices` 의 **첫 번째**를 그냥 썼다.
계정엔 한국어 professional voice 가 «넷» 있었다.
📌 ***기본값을 쓰기 전에 「계정에 무엇이 있나」를 «센다».***

## ⭐ 자막 타이밍은 «손으로 추정하지 않는다»

```bash
ELEVENLABS_API_KEY=$(cat ~/.cache/elevenlabs_api_key) bun scripts/vo-with-timestamps.ts
```
이 한 줄이 **`public/vo-el.mp3` 와 `src/captions.ts` 를 «같이» 쓴다.**

대표 2026-09-10 지적으로 축이 바뀌었다:

| | whisper 축 | **ElevenLabs 축** |
|---|---|---|
| 흐름 | 대본 → TTS → 오디오 → **되받아 듣기** → 정렬 | 대본 → TTS ⊕ **정렬을 같은 응답에서** |
| 오차 | ⛔ ASR 오차가 «반드시» 낀다 | ✅ 텍스트가 우리 대본 그대로 ⇒ **원리상 0** |
| 모델 | 둘 (TTS ⊕ ASR) | 하나 |

📏 그전의 «손추정»(구간을 낱말 수로 균등분할)이 얼마나 틀렸나 — 낱말 21개:
**평균 |오차| 174ms(5.2 프레임 @30fps) · 최대 489ms(14.7 프레임)**.
원인은 한국어 어절 길이 편차다 — `샤워하고` 615ms 對 `아직` 174ms (**3.5배**).

### 📏 whisper 와 대 봤다 — «독립된 자»로

「ElevenLabs 정렬이 정답」이라 놓고 재면 순환이다. 그래서 **오디오 파형 자체**를 자로 썼다 —
`ffmpeg silencedetect` 의 **발화 재개 시각**(무음이 끝나면 반드시 낱말이 시작한다). 모델과 무관하다.

| 자 | **ElevenLabs** | whisper.cpp `--dtw` (large-v3-turbo) |
|---|---|---|
| 파형 기준 평균 \|Δ\| | ⭐ **29 ms** | 75 ms |
| 파형 기준 최대 \|Δ\| | **61 ms** | 197 ms |
| 받아쓰기 누락 | 없음 | 🔴 **낱말 2개 소실** (`바디`·`퍼퓸이에요`) |

⇒ whisper 는 「다른 선택지」가 아니라 이 용도에서 **나쁘다**. 받아쓰기가 틀리면 정렬할 낱말이 없다.
⚠️ 속도 문제가 아니다 — M5 Max 에서 13.5초 오디오를 2.95초에 처리했다. ***속도는 정확도를 못 산다.***

⛔⛔ **ElevenLabs 는 «비결정적»이다** — 같은 대본·같은 설정이 **13.42s / 11.89s / 13.84s** 로 갈렸다(실측 3회).
⇒ ***오디오와 타이밍을 «따로» 만들면 싱크가 깨진다.*** 위 스크립트가 둘을 한 호출에서 내므로
구조적으로 막혀 있다. ⛔ `src/captions.ts` 를 **손으로 고치지 마라** — 그것은 생성물이다.

## 함정 셋 (실측)

1. ⛔ **`tsconfig.json` 이 없으면 렌더가 죽는다** — `create-video` 를 안 쓰면 아무도 안 만들어 준다.
   오류 문면이 「타입」 이야기라 원인처럼 «안 보인다».
2. ⛔ **한글 폰트를 «명시»한다** — `Apple SD Gothic Neo` 스택. 기본 sans 는 렌더 머신의 폴백에 맡겨진다.
3. ⛔ **`durationInFrames` 는 오디오보다 «길게»** — 짧으면 마지막 낱말이 잘린다.

## 믹스 비율

`VO 1.0` · `BGM 0.22` · `SFX 0.35` — ⛔ BGM 0.4 면 한국어 자음이 묻힌다.
