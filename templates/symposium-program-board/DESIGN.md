# 심포지엄 프로그램 보드 — DESIGN

> 🧪 **이 템플릿은 「시험」이다.** 대표 지시(2026-09-08): *"자산화 된 것을 바탕으로 «다른 컨셉»으로 구현까지 테스트"*.
> 물음은 ***「추출본이 «디자인 시스템»으로 쓰이나, 아니면 그 페이지 «한 장»의 사본일 뿐인가」***다.
> 씨앗은 [`../event-landing-editorial/DESIGN.md`](../event-landing-editorial/DESIGN.md) — 웹 레퍼런스에서
> `monad repo design-extract` 로 뽑은 것이다.

## Design direction

- monad-pastel-default

> ⚠️ 이 칸의 한계는 씨앗 문서와 같다 — 고를 수 있는 여섯이 전부 터미널 색 구성표다.
> ✅ 다만 이제 **문서가 «자기 방향»을 선언할 수 있다**(`directionFromDesignMd` · `#16229`).

## Craft rulebooks

- anti-ai-slop

## 1. 무엇이 «달라졌나» (컨셉)

| | 원본 — 행사 랜딩 | 이것 — 프로그램 보드 |
|---|---|---|
| 목적 | 설득(신청하게 만든다) | **운영**(지금 무엇이 도는지 본다) |
| 첫 화면 | 히어로 이미지 | ⛔ **히어로가 없다** — 상단바 + 상태 띠 |
| 본체 | 서사 섹션 | **표 3개**(트랙별 시간표) |
| 밀도 | 낮다 | 높다 — 한 화면에 14세션 |
| 상태 | 없음 | **칩 4종**(진행 중 · 다음 · 종료 · 정원 마감) |
| 숫자 | 요금 하나 | `tabular-nums` 로 정렬된 시각·정원 |

## 2. 무엇이 «같은가» (시스템)

📏 실측: **CSS 리터럴 색 12가지 · 전부 씨앗에서 · 지어낸 색 0 ⇒ 재사용률 100%**.
서체도 그대로다(`--font-display` · `--font-body` · `--font-eyebrow`).

## Palette

- --ground: #ffffff
- --ink: #172d24
- --ink-muted: #606f66
- --brand: #07513b
- --brand-deep: #103e2e
- --brand-panel: #0d4c39
- --surface: #f4f6f2
- --surface-cool: #eef3ed
- --line: #dbe4de
- --line-soft: #edf0ec
- --accent: #9d783f
- --danger: #a63823
- --on-brand: #ffffff

## Typography

- --font-display: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif
- --font-body: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif
- --font-eyebrow: Arial, "Helvetica Neue", sans-serif

## 3. 🆕 이 컨셉이 «요구해서» 더한 것 — ⛔ 이름을 대고 적는다

```
--live: var(--brand)         진행 중   ← 새 «색»이 아니라 씨앗 색의 «역할»이다
--done: var(--ink-muted)     종료      ← 같음
```
🔑 원본 랜딩엔 **「지금 무엇이 도는가」라는 상태 축이 없었다.** 운영 화면은 그것이 본체다.
⛔ 그래서 토큰이 «늘어난» 것은 결손이 아니라 **컨셉 차이의 증거**다.
⭐ 다만 **새 색상을 들이지 않았다** — 둘 다 씨앗 색을 가리킨다(그래서 재사용률이 100%로 남는다).

## Contrast pairs

- --ink on --ground
- --ink on --surface
- --ink-muted on --ground
- --ink-muted on --surface
- --on-brand on --brand
- --on-brand on --brand-deep

## Motion

- 전환·애니메이션 없음 — 운영 화면은 «읽는» 화면이다
- `prefers-reduced-motion: reduce` 를 존중한다(모든 전환·애니메이션 차단)

## 🖼️ 에셋

`assets/logo.svg` 는 **플레이스홀더**다(씨앗 템플릿에서 가져왔다) — 원본 로고가 아니다.
⛔ 배포하려면 자기 로고로 교체한다.

## ⛔ 이 문서가 «답하지 못하는» 것

- 이 보드가 **실제 운영에서 쓸 만한가** — 사람이 현장에서 써 봐야 안다. 여기서는 «디자인 시스템이 옮겨졌나»만 쟀다.
- 실시간 갱신 배선(상태 칩을 «누가» 바꾸나)은 **없다**. 정적 템플릿이다.
