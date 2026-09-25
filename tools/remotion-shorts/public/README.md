# `public/` — 렌더 입력

⛔ **에셋(컷 mp4 · VO · BGM · SFX)은 저장소에 «없다»** — 파이프라인 산출물이고 매번 다르다.
`graphs/evas-shorts-pipeline.yaml` 의 `cuts`·`voice`·`music` 노드가 만든다.

필요한 파일:
```
cut1.mp4 · cut2.mp4      ← cuts 노드 (kling3_0_turbo · start_image 고정)
vo-el.mp3                ← voice 노드 (scripts/vo-with-timestamps.ts 가 «captions.ts 와 같이» 쓴다)
vo-en.mp3                ← 영어판 VO
bgm.mp3 · sfx-water.mp3  ← ElevenLabs /v1/music · /v1/sound-generation
fonts/                   ← ⬇️ 아래 명령으로 받는다 (저장소에 안 담는다 · 2.6MB)
```

## 폰트 받기

```bash
mkdir -p fonts && cd fonts
for W in Bold ExtraBold Medium; do
  curl -sL -o "Pretendard-$W.woff2" \
    "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-$W.woff2"
done
curl -sL -o PlayfairDisplay.ttf \
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"
```
⛔⛔ **GitHub raw 경로(`/raw/main/...`)를 쓰지 마라** — 404 가 **HTML 페이지 267KB 로 내려온다**.
`curl -w '%{http_code}'` 를 «반드시» 보고, `file --mime-type` 으로 실제 폰트인지 확인한다.
***바이트가 0이 아니라고 성공이 아니다.***
