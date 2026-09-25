---
version: 1.0.0
name: video-builder
description: |
  영상 자동화 파이프라인 빌더. 슬래시로 «세션을 연 뒤», 그 안에서 자연어로 파이프라인을
  레고처럼 조립한다 — 어느 구간을 돌지, 어떤 능력이 필요한지, 그 능력을 «이 기계에서»
  무엇이 채우는지, 돈이 얼마나 드는지를 실측으로 확정해 추천 스택을 낸다.
  유료 앱이 없는 고객 기계도 «기술»해서 계획할 수 있다(AX 현장 기본값).
  Use when: "/video-builder", "영상 빌더", "파이프라인 조립", "영상 자동화 시작",
  "추천 스택", "영상 만들 준비", "이 기계로 영상 되나".
  NOT for: 단발 이미지·영상 생성(higgsfield-generate) · 이미 정해진 한 갈래를 그냥 돌리기.
minTier: T1
category: visual
# ⛔ 아래 둘이 없으면 monad 가 fail-safe 로 막는다 (실측 2026-09-22: 둘 다 undefined 였다)
# ⛔⭐ 인라인 주석을 «달지 마라» — 파서가 안 벗기고 값에 그대로 붙는다.
#     `sideEffects: write  # 설명` ⇒ 값이 "write  # 설명" 이 되어 조용히 undefined 로 떨어진다.
# sideEffects: probe·plan 은 읽기만 하고, config --init 이 파일을 쓴다
sideEffects: write
# cost: 로컬 probe/plan — 네트워크·생성 없음
cost: light
# ⛔ autoTrigger 는 «일부러» 안 켠다 — 대표 지시: 슬래시로 먼저 열고, 그 «안»에서 자연어 조립.
#    false 여도 트리거가 맞으면 «제안»으로는 뜬다(router.ts §autoTrigger — 자동실행만 가린다).
# 오픈코어 경계(scripts/skill-boundary.ts) — requires = 없으면 이 스킬이 일을 못 하는 catalog/resources.yaml 자원 id
requires: []
---

# 영상 자동화 빌더

> 🧱 **조립은 프로파일 열거가 아니라 「입력을 어디서 얻나」로 정해진다.**
> 📄 운영 매뉴얼(개발 저장소에만 있다 · 공개본엔 없다) = `내부 문서 `MANUAL-unified-video-production-2026-09-22`` — ⛔ 이 스킬은 그 문서 «없이» 읽혀야 한다: 쓰는 법·명령·함정은 여기 적는다.
> 📄 그래프 = `graphs/video/video-production-pipeline.declaration.yaml`

---

## ⛔ 0. 첫 걸음 — 반드시 «먼저» 잰다

```bash
bun scripts/video-pipeline.ts probe
```

⛔ **「있다고 치고」 조립하지 마라.** 이 한 줄이 이 스킬의 관문이다.
고객 기계를 계획하는 것이면 실측 대신 «기술»한다:

```bash
bun scripts/video-pipeline.ts config --init          # 처음 한 번
bun scripts/video-pipeline.ts probe --machine client-no-paid
```

---

## 1. 자연어 → 조립 — 물어야 할 것 넷

사용자 문장에서 아래 넷을 뽑는다. **비면 묻는다. ⛔ 지어내지 않는다.**

```
① 무엇을 만드나   쇼츠(세로) · 광고 · 소개영상 · 브이로그 · 설명영상 …
                  ⇒ target_specs (비율·길이)가 여기서 나온다
② 무엇을 이미 갖고 있나   ⭐⭐ 이것이 «레고 돌기»다 — 구간의 시작을 정한다
                  링크만 / 대본 있음 / 소재 폴더 있음 / 컷 목록 있음 / 마스터 있음
③ 무엇이 더 필요한가   나레이션 · 자막 · 3D · 모션그래픽 · 색보정
                  ⇒ --need 로 넘길 «선택 능력»
④ 어디서 도나      이 기계 / 고객 기계(이름)
                  ⇒ --machine
⑤ ⭐⭐ plan 이 «못 재는» 사실   소재 폴더가 «정말» 있나 · 색보정을 Resolve 로 할 건가 …
                  ⇒ --told (아래 §2b) — ⛔ 이것이 「그다음 한 마디」가 계획을 «변형»하는 자리다
```

### ② → 구간 시작 (⭐ 핵심 표)

| 사용자가 가진 것 | `--from` | 미리 줘야 하는 것 |
|---|---|---|
| 아이디어·링크뿐 | `ground` | `brief` |
| 대본·구조가 있다 | `plan` | `arc` · `target_specs` |
| 소재가 이미 있다 | `assets` 또는 `compose` | `shot_plan` / `timeline`·`asset_files` |
| 컷 목록이 있다 | `compose` | `timeline` · `asset_files` |
| 마스터가 있고 비율만 | `deliver` | `master` · `target_specs` |

```bash
bun scripts/video-pipeline.ts spine    # inputs/outputs 전체 표
```

---

## 2. 스택을 «낸다»

```bash
bun scripts/video-pipeline.ts plan \
  --from <노드> [--to <노드>] \
  --need <능력,능력> \
  [--machine <이름>] [--prefer free|owned]
```

⭐ **기본 선호는 `free`** — AX 현장에서 유료 앱은 «있으면 좋은 것»이지 전제가 아니다.
📏 실측 2026-09-22: **유료 앱 0개인 기계에서 «생성»을 뺀 전 구간이 닫힌다.**

---

## 2b. ⭐⭐ 「그다음 한 마디」가 계획을 «변형»한다 — `--overlay` ⊕ `--told`

> 대표: *"슬래쉬 커멘드 이후 **그다음 말로** 파이프라인을 다이나믹하게 목적에 맞게 설계"*

⛔ ***이것은 「다른 템플릿을 고르는」 것이 아니다.*** 기본 템플릿 **하나**를 «오버레이 1장»으로 변형한다.

```bash
bun scripts/video-pipeline.ts plan --from ground --need tts --overlay \
  --told found_footage=1
```

### 무엇이 달라지나 — 📏 실물

```
--told 없이                    → 얹힌 오버레이 «0장» · profile-found-footage ⚠️ 「상태에 그 키가 «없다»」
--told found_footage=1         → ***1장이 얹혀 계획이 달라진다***
     ⭐ assets  maxVisits 6 → 1   (소재가 있으니 «모으는» 일을 줄이고)
     ⭐ compose maxVisits 5 → 8   (대신 «엮는» 일을 늘린다)
```

### ⛔ 규율 셋 — 어기면 사용자가 «내 말을 도구의 실측으로» 읽는다

1. ⛔ ***`--told` 는 「사용자가 말한 것」만 넣는다.*** 추측해서 채우지 마라 —
   그 값이 계획의 모양을 바꾸는데, 근거는 «사용자 문장» 하나뿐이다.
2. ⛔ ***산출의 두 줄을 그대로 옮겨라.*** 도구가 이미 갈라서 낸다:
   `📏 도구가 «잰» 상태` ⊕ `🗣️ 사람이 «말해 준» 상태 (⛔ 실측이 아니다)`.
   요약하면서 한 줄로 합치지 마라 — ***그 순간 「내가 그렇게 말했다」가 「도구가 쟀다」로 바뀐다.***
3. ⛔ ***도구가 «재는» 키는 못 덮는다.*** `--told selected_app_control=…` 은 거부되고 이유가 찍힌다.
   거부 줄이 뜨면 **읽고 사용자에게 옮겨라**(조용히 넘기면 「반영됐다」로 읽힌다).

### 📌 지금 쓸 수 있는 「못 재는 사실」

| 키 | 뜻 | 어떤 말에서 나오나 |
|---|---|---|
| `found_footage` | 쓸 수 있는 소재가 이미 있다 | *"소재는 있고"* · *"찍어 둔 게 있어요"* |
| `identity_holds` | 새 장면에서도 «같은 캐릭터»다 (character 라인 · 정체성 관문) | ⛔ 말에서 줍지 않는다 — **검증 컷을 보여 주고 물은 답**만 |
| `shots_principled` | 샷에 예비동작·스쿼시 같은 연출이 «보인다» (character 라인 · 연출 관문) | ⛔ 같다 — **샷을 보여 주고 물은 답**만 |

⚠️ 위 표의 뒤 둘(`identity_holds`·`shots_principled`)은 오버레이가 아니라 **레시피가 읽는 키**다(`walk`·`video-character-line` 의 `--told`). 목록은 그때 잰다:
`rg -n "told\(ctx.state, '" src/video-pipeline/recipes/`
⛔ 에이전트가 «대신 보고» 넣었으면 사용자에게 **「제가 보고 넣은 값입니다」**라고 말한다 — 사람이 말한 것처럼 전하지 않는다.

⛔ **표에 없는 키를 지어내지 마라** — 읽는 쪽(오버레이·레시피)이 없으면 아무 일도 안 일어나고,
그런데도 *"반영했습니다"* 라고 말하게 된다. 새 키가 필요하면 그것을 «읽는» 오버레이(`graphs/video/overlays/`)나 레시피가 «먼저» 서야 한다.

---

## 2c. 🎥 찍힌 소재 → 리졸브 납품까지 «한 줄로» — `video-vlog-line`

> 사용자가 **이미 찍은 영상 폴더**를 주고 *「이야기로 엮어 달라」*면 이 라인이다(브이로그·현장 기록·후기).

```bash
bun scripts/video-vlog-line.ts --source <영상 폴더> [--music <bgm>] [--shots <shots.json>] \
  [--whisper-model small|large-v3-turbo] [--project <리졸브 프로젝트 이름>]
```

- 전사 → 구조 → 원장 → 인점 검증 → 층 → 컷(핸들) → 프레임 관문 → 소리·더킹 → ***DaVinci Resolve 조립·되읽기·렌더*** → QC → 납품.
- ⚠️ **DaVinci Resolve 가 떠 있어야** 후반이 돈다(외부 스크립팅 켜짐). 안 떠 있으면 `unobserved`(「못 쟀다」) — 실패가 아니다. **사용자에게 앱을 켜 달라고 말한다.**
- ⭐ 사람이 쓴 `shots.json`(`--shots`)이 있으면 **그것이 SSOT** 다. 없으면 «규칙 기반 초안»이고 — ⛔ **초안이라고 말한다.**
- ⛔ 리졸브에 **새 프로젝트**를 만든다(현재 프로젝트는 먼저 저장 · 덮지 않는다). 이름은 산출에 나온다.
- 📏 실측(2026-09-23): 진짜 소재 24개 → 18걸음 → `delivered`. 산출: `master.mp4` · `final.mp4` · `review_sheet.md`.

---

## 2d. 🎬 구운 소재 → 마스터 ⊕ 소셜 3비율 — `video-film-line`

> AE·HyperFrames·Blender 로 **컷 소재가 이미 있고**, 음악에 맞춰 마스터와 **소셜(1:1·9:16·4:5)**을 뽑을 때.

```bash
bun scripts/video-film-line.ts --plan <plan.json> --sources <sources.json> --track <음악> [--bpm <BPM>] \
  [--native <native.json>] [--hf-projects <hf.json>] [--fps 24] [--target-lufs -14]
#   plan.json    = [["컷", 시작, 길이], …]          sources.json = {"컷": "구운 소재 경로", …}
#   native.json  = {"컷": {"9x16": "전용 합성 경로", …}}   (비율 전용본 — 있으면 자르지 않는다)
#   hf.json      = {"컷": "HyperFrames 프로젝트 디렉토리"}  (전용본이 없으면 그 비율로 «지어서» 쓴다 — §2h)
#   --bpm 을 빼면 음악에서 잰다(hyperframes beats) · 주면 그 값이 이긴다
```
- 마디 격자 → 마스터 → 길이 관문 → **2패스 라우드니스** → 잉크 자 → 소셜 → **검정 띠 검수**.
- ⛔ **소재 생성·음악은 이 라인 밖이다** — 없으면 `host-down`/`no-track` 으로 말한다. 음악은 Epidemic MCP 로 받아 `--track` 으로 준다.
- ⛔ 검수 fail(검정 띠)이면 그 비율은 **전용 합성이 필요하다**고 돌아간다 — 전용본(`--native`)도 HyperFrames 프로젝트(`--hf-projects`)도 없으면 `master-only`(마스터만 났다)로 끝난다. **사용자에게 그 비율을 말한다.**
- 📏 실측(2026-09-23): DaVinciStack 9컷 → 14걸음 → `delivered`.

---

## 2e. 🧑‍🎨 캐릭터 → 영상 — `video-character-line`

> 캐릭터 시트·뷰·Element 등록·샷이 **이미 생성돼 있고**, 그것을 관문에 태워 마스터 ⊕ 소셜까지 갈 때.

```bash
bun scripts/video-character-line.ts --pins <핀 폴더> --sheet <시트> --views <뷰 폴더> --element-id <ID> \
  [--soul-fail <사유>] [--probe <새 장면 검증 컷>] --shots <shots.json> --plan <plan.json> --audio <음악> \
  [--shot-ruler <08_shot_ruler.py>] [--native <native.json>] [--told identity_holds=1,shots_principled=1]
```
- ⛔ **판정 둘은 도구가 못 잰다** — 정체성 유지 · 연출 원칙. 사용자에게 **검증 컷을 보여 주고 물은 뒤** `--told` 로 준다. 안 주면 `unobserved` 로 멎는다(정상).
- ⛔ 잉크 폭 ≈1.00 인 샷은 **그 비율로 다시 그려야 한다** — 러너는 크레딧을 안 쓰므로 `rendered-unedited` 로 끝난다. 다시 그린 파일은 `--native {"샷": {"9x16": 경로}}` 로. **사용자에게 어느 샷·어느 비율인지 말한다.**
- 📏 실측(2026-09-23): NOVA 샷 3 → 11걸음 → `rendered-unedited`(shot2·shot3 fullbleed) · edit 단독 → 마스터 16.875s ⊕ 소셜 3.

## 2f. 🚶 «한 문» — 어느 선언이든 `walk`

```bash
bun scripts/video-pipeline.ts walk --graph <graph_id> --state <state.json> [--told k=v,…] [--out D] [--json]
#   graph_id  = recipes 목록의 이름(video-production · vlog-found-footage-pipeline · film-production-standard · character-video-standard)
#   state.json = 그 선언의 첫 노드들이 읽는 키(라인 스크립트가 인자로 채우던 것과 «같은» 키)
```
- 라인 스크립트(2c·2d·2e)는 **인자 편의**일 뿐 — 걷는 규칙은 `src/video-pipeline/walk-line.ts` «한 벌»이다.
- 📏 실측(2026-09-23): film `walk` ↔ `video-film-line` = 같은 14걸음 `delivered` · character `walk` ↔ `video-character-line` = 같은 11걸음.

## 2g. 🆓 소재가 «없을» 때 — 무료로 «만들어서» 납품까지 `video-full-line`

> 소재·나레이션·음악을 ***node-b 의 로컬 모델로 생성***(크레딧 0)하고, 그대로 무료 라인(합성·렌더·검수·납품)까지 잇는다.

```bash
bun scripts/video-full-line.ts --scene-file <장면.json> [--host node-b] [--out D] [--no-assemble]
#   장면.json 본보기 = graphs/video/scenes/elanvital-selfheal.json (title · voiceInstruct · scenes[{prompt,caption}] · music)
```
- 종료코드 = 조립 라인의 것(0 delivered · 1 · 2 못 쟀다) · 준비 실패 3. ⛔ 호스트가 안 붙으면 **2(못 물어봤다)** — 실패로 말하지 않는다.
- ⏱️ 📏 2026-09-23: 이미지 약 2분 17초/장 · 목소리 9초 · 음악 45초(yue2) ⇒ 6장면 ≈ 17분. **사용자에게 시간을 먼저 말한다.**
- ⚠️ 음악 QC 를 «읽어서» 전한다 — 엔진은 길이를 못 시켜(40초 요청 → 104초) «가사 밖» 구간이 생긴다. 산출이 그 수를 말한다.
- `--no-assemble` 이면 scene.json 에서 멈춘다(다른 편집 라인으로 넘길 때).

## 2h. 🎞️ HyperFrames 로 «짓는다» — 모션 그래픽 · 키네틱 타이포 · 런치 영상 · 비율 전용본

> 컷 소재를 ***HTML(GSAP) 합성으로 직접 짓고*** 렌더할 때. 크레딧 0 · 이 기계에서 돈다.
> ⭐ (개발 저장소에서만) 실측·연결 상태의 이력 = `내부 문서 `MANUAL-unified-video-production-2026-09-22`` **§8c** — 쓰는 데 필요한 것은 아래에 다 있다.

- **입구는 스킬 `/hyperframes` 하나**다 — 작업 흐름(product-launch-video · motion-graphics · music-to-video · general-video …)을 스스로 골라 «처음 쓸 때» 설치한다.
  ⇒ 광고·런치 영상(웹사이트 URL 한 장)은 `/hyperframes` → **product-launch-video**(`capture` 로 사이트를 긁어 짓는다).
- ⛔ CLI 는 PATH 에 «없다» — **`npx hyperframes <명령>`** 으로 부른다. 무인으로 부를 땐 환경에 `HYPERFRAMES_SKIP_SKILLS=1`(렌더마다 GitHub 에 스킬을 묻지 않는다) ⊕ `HYPERFRAMES_NO_TELEMETRY=1`(익명 텔레메트리 끔).
- **짓는 순서**(스킬의 검토 루프): `STORYBOARD.md` 계획 승인 → 스케치(`storyboard.html` · 프레임 `built`) → 빌드(`animated`) → **렌더는 «승인 뒤» 한 번**.
  ⭐ 첫 1~2 합성에서 픽셀 기준을 세우고 나머지는 「같은 처리」 — 합성 폴더가 곧 재사용 자산이다.

| 하려는 것 | 명령 |
|---|---|
| 점검(렌더 «전» · 0건이어야 한다) | `npx hyperframes check --json` — ⚠️ lint 오류가 있으면 layout·contrast 가 «안 돌고» `0 sample(s)` 로 보인다 |
| 프레임 자가 검토 | `npx hyperframes snapshot --at 1.5,4 -o <dir>` → `frame-NN-at-<t>s.png` ⊕ `contact-sheet.jpg` |
| 렌더 | `npx hyperframes render -o <out.mp4> [--quality draft]` · 변수 행마다 `--batch <rows.json>` |
| 비율 전용본(9:16·4:5·1:1) | 루트 `data-width`·`data-height` 만 바꿔 렌더(📏 실측: 두 속성만으로 1080x1920 이 난다) — ⛔ 레이아웃 재배치는 합성 쪽 일 |
| 음악 박자 | `npx hyperframes beats --json` → `{"bpm":…}` ⊕ `beats/<audio>.json`(📏 120BPM 클릭 트랙을 정확히 맞혔다) — 프로젝트에 `<audio>` 가 있어야 한다 |
| 미리보기(사람이 편집) | `npx hyperframes preview --background` |
| 스킬 최신화 | `npx hyperframes skills check` · `… skills update` |

- ✅ **BPM** — `video-film-line` 에서 `--bpm` 을 «빼면» 음악에서 잰다(사람 값이 있으면 그것이 이긴다).
- ✅ **비율 전용본** — `video-film-line --hf-projects <json>`(`{"<컷>": "<HyperFrames 프로젝트 디렉토리>"}`)을 주면 잉크 자가 「다시 그려야 한다」고 한 컷@비율을 HyperFrames 로 «지어서» 쓴다(이미 구운 `--native` 가 있으면 그것이 먼저).
- ⚠️ **점검·렌더(`hyperframes-render`)·스토리보드 관문(`storyboard-gate`)은 레시피만 있고 그래프 노드가 없다**(매뉴얼 §8c 「지었다 ≠ 흐른다」) — 그때까지는 위 표의 명령으로 사람이 돌린다.

## 3. 사용자에게 제시할 것 — 이 순서로

```
① 잰 것        무엇이 있고 무엇이 없나 (probe 결과 · ⛔ 가정이면 그렇다고 말한다)
② 구간         어디서 시작해 어디서 끝나나 ⊕ 미리 줘야 하는 입력
③ 스택         노드별 能力 → 구현 → 계층
③b 🪄 변형      오버레이가 얹혔나 ⊕ ⛔ 「잰 것」과 「말해 준 것」을 «갈라서» 보인다(§2b 규율 2)
④ 💰 과금      metered 구현이 있나. ⛔ 견적이 아니라 «실측 델타»로 잰다고 말한다
⑤ ⛔ 구멍      있으면 «먼저» 말한다. 처방 셋: 설치 / 구간을 자름 / 사람이 그 산출을 줌
⑥ 확인         진행할지 묻는다 ⊕ 유료로 올리면 무엇이 좋아지는지 한 줄
```

⛔ **구멍이 있는데 「일단 해 보자」로 넘어가지 마라** — 그 노드에서 멈춘다.

---

## 4. ⭐⭐ 되돌아가는 간선 — 증상이 나면 «어디로» 가나

파이프라인이 돌다 실패했을 때 쓴다. **같은 증상이라도 원인 노드가 다르다.**

| 증상 | 되돌아갈 곳 | 📏 근거 |
|---|---|---|
| 검정 프레임 | **compose** | `-avoid_negative_ts` 가 범인. 렌더도 조립도 아니다 |
| 층 누락 | **overlay** | 한 층이 타임라인을 못 덮음 |
| 검수표 불일치 | **plan** | 원장이 실물과 갈렸다 |
| 옛 캐시로 잘림 | **compose** | 옛 `ink.json` 이면 0.98x 로 주저앉는다 |
| 팔레트 드리프트 | **assets** | 그림이 틀린 것이지 조립이 틀린 게 아니다 |
| 틈 · 짧은 전환 | **compose** | 둘 다 `endFrame` 배타에서 온다 |
| 길이 틀림 | **plan** | 계획이 틀렸다 |
| 자막 어긋남 | **plan** | 균등분할은 평균 174ms·최대 489ms 어긋났다 |
| 비율 안 맞음 | **assets** | 비율은 «자르기»가 아니라 «확장»(outpaint) |

⛔ **측정 자체가 막히면 `unobserved`** — 실패로 접지 않는다. AE 모달·Resolve 정지 실측 있음.

---

## 4b. ⚠️ 도구 계약 — ⛔ «스키마»보다 «실제 호출»이 정확하다

📏 실측 2026-09-22 — 하루에 셋을 밟았다:
```
TopView  resolution 이 «필수»인데 스키마엔 조건부로만        → 4000: resolution is required
TopView  결과 키가 originImage / compressedImage 인데
         url·imageUrl 을 찾음                               → ***생성 성공·크레딧 소진·다운로드 0***
Blender  bl_render 스키마가 BLENDER_EEVEE_NEXT 를 요구      → 실제는 BLENDER_EEVEE
         ⚠️ bl_get_scene_summary 가 «이미» 그렇게 말해 줬는데 스키마를 믿었다
```
🔑 ⇒ **상태 조회 도구가 답을 갖고 있으면 그것이 스키마를 이긴다.**
⛔ 그리고 둘째가 가장 비싸다 — «성공했는데 못 읽는» 것은 실패보다 늦게 드러나고 돈이 이미 나갔다.

---

## 5. ⚠️ 함정

```
① 「있다고 치고」        ⇒ probe 를 먼저 돌린다. 이 스킬의 관문이다
② 유료를 전제함          ⇒ 기본 선호는 free. 유료는 «품질·속도»를 사는 것이지 가능/불가능이 아니다
③ 견적을 믿음            ⇒ generate cost ≠ 실제 청구. 실측 델타로 재라
④ 3D → 영상 직행         ⇒ 반드시 «실사 변환»을 낀다. 빼면 배경만 3D 인 결과가 나온다
⑤ 팔레트를 한 번만 적음   ⇒ 컷마다 «반복해» 못 박는다. 안 적은 컷에서 색이 드리프트한다
⑥ 마스터를 잘라 소셜      ⇒ 소재에서 «다시 짓는다». 마스터만 고치면 소셜이 안 따라온다
⑦ 배치와 그리기를 한 칸   ⇒ compose(배치) ≠ overlay(그리기). 도구도 실패 양상도 다르다
⑧ 시간을 조립이 소유      ⇒ 시간은 plan 이 갖는다. 조립에서 늘려 때우면 원장과 실물이 갈린다
```

---

## 5b. 🖥️📱 서피스 — 퍼스트 고객은 TUI 와 텔레그램

⛔ **넓은 표를 그대로 뱉지 마라.** 텔레그램은 4096자 상한이고 3800에서 잘리며,
MarkdownV2 parse 실패 시 plain 으로 떨어진다.

```bash
bun scripts/video-pipeline.ts plan ... --surface telegram   # 406자 · 최장 48자
bun scripts/video-pipeline.ts plan ... --surface tui
```
📏 대조: 기본 `cli` 는 같은 계획이 2,077자 · 최장 138자다.

✅ **이 스킬은 monad 도 읽는다** — 📏 실측 2026-09-22:
```
monad config get skills   ⇒ activeSet=claudecode · dirs=["~/.claude/skills"]
monad 스킬 색인 72개 중 video-builder «잡힘» · rootDir=~/.claude/skills
하니스 자식도 접근한다 — scripts/se-monad-self-prompts.ts 가 그 경로의 SKILL.md 를
«읽으라»고 명시한다("read it even though it lives outside the worktree")
```
⚠️ 남은 것은 «닿음»이 아니라 **«어느 서피스인지 핸들러가 아나»**다 —
모르면 `--surface` 를 못 골라 넓은 표가 텔레그램에서 깨진다. 그 값은 골 문서에 있다.

---

## 6. 도구 한 장

```bash
bun scripts/video-pipeline.ts probe   [--machine N] [--json]    무엇이 있나
bun scripts/video-pipeline.ts plan    --need ... --from ... [--machine N]   추천 스택
bun scripts/video-pipeline.ts spine                             레고 돌기 표
bun scripts/video-pipeline.ts config  [--init]                  설정 · 기계 프로파일
bun scripts/check-graph-declaration.ts <yaml>                   그래프 선언 검증
```

⛔ **아직 워커가 없다** — 이 빌더는 «무엇으로 어떻게 할지»를 확정할 뿐, 그래프를 걷지는 않는다.
실행은 확정된 스택의 도구를 직접 친다.
