# elanous voice (PWA)

monad-agent 의 PWA frontend. 모바일/데스크톱 브라우저에서 voice channel
사용 — getUserMedia 로 마이크 캡처, AudioWorkletNode 로 24kHz mono PCM
다운샘플링, WebSocket 으로 daemon 의 `/v1/voice/ws` 에 전송, 응답 PCM 을
AudioBufferSourceNode 큐에서 재생.

WebRTC AEC3 echo cancellation 자동 활용 (`getUserMedia({ audio: { echoCancellation: true } })`)
→ TUI 에서 OS-level cross-talk 으로 발생하던 echo loop 마찰이 frontend
측에서 자연 해소.

## 개발

```bash
cd apps/pwa
npm install   # 또는 bun install / pnpm install
npm run dev   # localhost:3210
```

monad-agent daemon 이 별도 포트 (기본 8443) 에서 실행 중이어야 합니다.
`.env.local` 에서 daemon endpoint override 가능.

## 구조

```
apps/pwa/
├── package.json              # Next.js 15 + React 19 + Tailwind v4
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── public/
│   └── manifest.webmanifest  # PWA manifest
└── src/
    ├── app/
    │   ├── layout.tsx        # PWA shell layout
    │   └── page.tsx          # 메인 voice 페이지
    └── voice/
        ├── voice-capture.ts        # getUserMedia + AudioWorkletNode (24kHz mono)
        ├── voice-playback.ts       # AudioBufferSourceNode 큐 (TTS PCM 재생)
        ├── voice-websocket.ts      # PWA_VOICE_FRAME_KIND 프레임 프로토콜
        └── voice-control-bar.tsx   # 마이크 토글 / 상태 indicator / 비용
```

## Frame protocol

`src/voice/channel-adapters/pwa-voice-adapter.ts:PWA_VOICE_FRAME_KIND` 와
1:1 매칭. `voice-websocket.ts` 가 raw binary 프레임을 인코딩/디코딩.

| 방향 | 코드 | 이름 | 페이로드 |
|---|---|---|---|
| Browser → Server | 0x01 | UPSTREAM_PCM | int16 LE 16kHz mono |
| Browser → Server | 0x02 | UPSTREAM_FINALIZE | (empty) |
| Browser → Server | 0x03 | UPSTREAM_HELLO | JSON capabilities |
| Server → Browser | 0x81 | DOWNSTREAM_PCM | int16 LE 24kHz mono |
| Server → Browser | 0x82 | DOWNSTREAM_STATE | JSON `{state}` |
| Server → Browser | 0x83 | DOWNSTREAM_ERROR | JSON `{error}` |

프레임 포맷: 4-byte BE 헤더 (kind uint8 · flags uint8 · reserved uint16) +
페이로드.
