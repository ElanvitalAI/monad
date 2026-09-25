# 🎬 `hyperframes-shorts` — Remotion 과 «같은 조건»으로 잰 대조 프로젝트

> 대표 2026-09-10: *"hyperframe 도 별도 테스트해서 성능 최적화까지 진행해주세요"*
> 📚 수치·결론은 `내부 문서 `MANUAL-marketing-ad-pipeline-automation-2026-09-10`` **§2ⓥ** 가 canonical.

## 왜 있나

**HyperFrames 는 HTML 이 곧 타임라인**이다 — `class="clip"` ⊕ `data-start`/`data-duration`/`data-track-index`,
애니메이션은 GSAP 타임라인 하나(`window.__timelines["main"]`).
Remotion(React ⊕ `useCurrentFrame()`)과 **같은 컷·같은 오디오·같은 «실측» 자막 타이밍**으로 세워
「어느 쪽이 이 저장소에 맞나」를 «수»로 답하려고 만들었다.

⛔ ***다른 입력으로 잰 수는 비교가 아니다*** — 그래서 자막 타이밍은 Remotion 판의 `captions.ts`
(ElevenLabs `/with-timestamps` 실측값)를 그대로 옮겨 왔다.

## 돌리는 법

```bash
cd tools/hyperframes-shorts
# ⚠️ assets/ 는 저장소에 «없다» — 파이프라인 산출물이다(cut1/cut2.mp4 · vo-el/bgm/sfx-water.mp3 · 폰트)
npx hyperframes lint          # 빠른 피드백
npx hyperframes check         # 최종 게이트 (런타임 오류·레이아웃·WCAG 대비까지 문다)
npx hyperframes benchmark --runs 2 --json
npx hyperframes render --quality standard --workers 4 --output out.mp4
```

## ⭐ 최적화 (실측이 말한 것)

| | |
|---|---|
| **워커 2→4** | `33.7s → 23.2s` (**31% 단축**) · 출력 **바이트 동일** ⇒ 품질 손실 0의 «공짜» |
| ⚠️ `high` 對 `standard`(2w) | **26.1s < 33.7s** — 「높은 품질=느리다」가 «거짓». 워커 수가 지배적 |
| 60fps | 4워커에서도 30fps 대비 **53% 느린데 파일은 1.7%만** 크다 ⇒ 쇼츠는 30fps |

📌 권고: **`30fps · standard · 4w`**.

## ⛔ 함정 (실측)

- **`doctor.ok` 로 게이트하지 마라** — 선택 항목(Kokoro TTS · MusicGen · Docker)만으로 `false` 가 된다.
  ✅ 렌더 필수는 넷이다: `Version` · `Node.js` · `FFmpeg` · `Chrome`. 그 넷을 «이름으로» 본다.
- **`init` 은 비대화형에서 `--example` 을 요구한다** — `hyperframes init <name> --example blank`.
- `lint` 의 `timeline_track_too_dense` 는 «경고»다 — 한 트랙에 4개 넘으면 서브컴포지션을 권한다.
