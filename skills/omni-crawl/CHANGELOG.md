## 2026-09-10 — 웹 검색 1순위를 tavily 로 되돌림 (ddg = 폴백 전용)

**문제**: 2026-08-06 에 고정비를 줄이려 무료 `ddg` 를 웹 검색 1순위로 뒀는데,
**DDG HTML 이 차단되면 웹 검색 축이 통째로 0건**이 됐다. 게다가 `applyWebFallback` 의
`wantedWeb` 판정에 `ddg` 가 빠져 있어 **보충 폴백조차 걸리지 않았다** — 실측으로 연속 3회
0건, `--health` 에서 `ddg-free` FAIL 확인.

**변경**
- `src/router.ts` / `scripts/main.ts`: 스위치 판정식을 `=== '1'` → `!== '0'` 로 뒤집어
  **tavily 기본 ON**. `OMNI_CRAWL_TAVILY=0` 으로 옛 동작(ddg 1순위) 복귀 가능.
- `applyWebFallback`: `wantedWeb` 에 `ddg` 포함 + `triedDdg` 도입 →
  **ddg 1순위였다가 0건이면 tavily/firecrawl 로 «승격» 보충**, 이미 돈 ddg 는 재시도 안 함.
- `--health`: `Check.tier` 추가. `ddg-free` 는 `tier:'fallback'` 이라
  **실패해도 `allOk` 를 깨지 않고 ⚠️ 경고로만** 표기 → 결과 문구 `1순위 엔진 전부 정상 (폴백 N건 다운 — 무해)`.
- `--free` / `--engine ddg` 는 그대로 동작(무료 강제 경로 보존).

**검증**: self-test 22/22 PASS · `--health` 1순위 전 엔진 정상 · 0건이던 실쿼리 → tavily 5건(1cr).

# omni-crawl CHANGELOG

## 2026-09-06 — `grok-both` capability 오분류 정정 (community → web-search)

`grok-both` 은 이름과 달리 «X+레딧» 이 아니라 **X+열린 웹** 이다. `src/grok-search.ts` 의
`buildTools()` 가 갈라 놓은 실제 도구 조립이 근거다:

| 모드 | 붙는 도구 | 실제 커버 |
|---|---|---|
| `community` | `x_search` + `web_search(allowed_domains:[reddit.com])` | X + 레딧 |
| `both` | `x_search` + `web_search` **(도메인 제한 없음)** | X + 열린 웹 |

둘을 가르는 건 `allowed_domains` 필터 하나다. `both` 은 여론 축이 아니라 여론·문서 양다리이므로
`capability: 'community'` 는 오분류였고 `'web-search'` 로 정정했다. 그래서 `social-pulse` 표면이
grok-both 을 문서화하지 않는 것이 맞다(그 스킬의 "의견만 담당한다" 계약을 깬다).

**무영향 확인**: 라우터는 이 엔진을 자동 선택하지 않고(`grok-x`/`grok-reddit`/`grok-community` 만),
스킬·스크립트 전체에서 호출처가 0곳이며, `freeFallbackFor()` 는 정의만 있고 **호출처가 없어**
capability 변경이 런타임 폴백을 바꾸지 않는다. 라벨만 실제 동작과 맞춘 정정이다.

## 2026-09-02 — Firecrawl Developer Index 배선(`fc-dev`) + 여론 축 표면 분리(social-pulse)

Firecrawl 이 2026-08-20 공개한 **Developer Index**(README·외부 문서·이슈·PR·OpenAPI·스킬 저장소
7천만+ 아티팩트, 대부분 일 단위 갱신)를 흡수. 일반 웹 검색이 «페이지»를 주는 데 반해 이 인덱스는
**매칭 패시지(마크다운·표/코드블록 보존)** 를 직접 반환하므로, 스크랩 추가 콜 없이 바로 인용된다.

### 추가

- **`fc-dev` 엔진** (`src/firecrawl.ts: searchDeveloperFirecrawl` + `registry.ts` 디스크립터).
  capability `dev-index`. `--engine fc-dev` / 라우터 자동 감지(라이브러리·이슈·PR·에러 인텐트).
- **deep 모드 게이트**: `looksTechnical(query)` 가 참이면 fc-dev 1콜 자동 가세(~2cr).
  금융/일반 주제에는 태우지 않는다 — 자기테스트 5케이스로 고정.
- **`--health` 에 fc-dev 프로브** 추가 ("전 엔진 진단" 주장을 실제로 참으로 만듦).
- **`social-pulse` 스킬** — X/레딧/커뮤니티 여론 «표면»만 분리. 코드 복제 없음(엔진은 이 스킬 공유).

### 실측 (2026-08-31)

- 봉투가 다른 엔드포인트: 파라미터는 `limit` 이 아니라 **`k`**(`limit` → 400 unrecognized_keys),
  응답은 `data` 가 아니라 **`results`**. `id` 접두사가 종류(`readme:`/`doc:`/`issue:`/`pull_request:`/`web:`).
- 비용: k=10 · passages=2 → **2cr**.
- `min_stars`/`language`/`topic`/`license` 는 «저장소» 사실 — `sources` 스코프 없이 보내면
  doc 결과가 통째로 빠진다(문서 대부분은 뒤에 저장소가 없음). 사양이지 결함이 아니다.

### 분리 판단 근거 (벤더 축이 아니라 «표면» 축)

grok 100줄 + apify 66줄 = 전체 2,316줄의 7%. 반면 둘이 공유하는 인프라(env·types·url-safety·
render·registry·router)는 ~700줄이고, `--mode deep` 은 ddg+firecrawl+grok 을 한 파이프라인에서
합성한다. 여기 프로세스 경계를 넣으면 2026-07-06 항목이 기록한 고장(크론 PATH 즉사·키 증발·
execSync 이벤트루프 블로킹)을 재현한다. 따라서 **설명(트리거)만 분리하고 코드는 한 벌 유지**.
`--engine grok-*` CLI 계약은 불변 — asset-attractiveness·omni-digest·yt-vault·
stochastic-multi-agent-consensus 호출 무변경.

### 부수 수정

- 자기테스트가 2026-08-06 tavily 스위치 OFF 전환 이후 갱신되지 않아 **3건 상시 FAIL** 이었다.
  기대값을 스위치에 연동(`WEB`/`NEWS` 파생) → 11 passed/3 failed → **22 passed / 0 failed**.
- 외부 CLI `firecrawl-cli` 1.11.1 → 1.23.3 (1.11.1 엔 `developer` 서브커맨드가 없었다).

## 2026-07-10 — deer-flow 크롤링 강점 이식 (무료 티어 + SSRF + 레지스트리 + 인용 + 캡처)

ByteDance **deer-flow** (`~/source/ref/deer-flow`, harness 에디션) 의 웹 크롤링 아키텍처를
분석해 omni-crawl 에 5가지 강점을 이식. 핵심 원칙은 **"품질 동일 시 무료, 아니면 유료 우선"** —
deer-flow 는 무료(DDG+Jina) 기본·유료 선택이지만, omni-crawl 은 이를 **반전**해
유료를 1순위·기본으로 두고 무료를 안전망으로 배치.

### 배경 — deer-flow 아키텍처 (참고)

- **정규화 툴 이름 + config 스왑**: `web_search`/`web_fetch`/`web_capture`/`image_search` 고정 이름에
  `use: deerflow.community.<provider>.tools:<fn>` 로 프로바이더 동적 import. `if provider==` 분기 없음.
- **검색 10종 / 페치 8종**: DDG·SearXNG·Serper·Brave·Tavily·Exa·Firecrawl·fastCRW·GroundRoute·InfoQuest 등.
- **추출**: Jina Reader(`r.jina.ai`) → 로컬 readabilipy → markdownify, 또는 프로바이더 markdown 직수신.
- **오케스트레이션**: lead-agent 프롬프트가 `[citation:Title](url)` 인라인 인용 + Sources 섹션 **강제**.
- **SSRF 가드**: `url_safety.py` — localhost·RFC1918·메타데이터·난독화 IP 차단.
- **과금**: 본질적으로 무료 (DDG+Jina keyless 기본), 유료는 opt-in 업그레이드.

### 추가/변경 (5 features)

| # | 기능 | 파일 | 요지 |
|---|------|------|------|
| 1 | **SSRF 가드** | `src/url-safety.ts` (신규) | `validatePublicHttpUrl()` — http(s) 검증 + localhost·RFC1918·169.254.169.254 메타데이터·CGNAT·난독화 IPv4(10진/16진/8진)·IPv6(loopback/ULA/link-local/v4-embedded) 차단. DNS 조회 후 IP 검사(rebinding 방어). `--allow-private` opt-out. |
| 2 | **무료 폴백 티어** | `src/free.ts` (신규) | `searchDdg`(DuckDuckGo HTML·키불필요) · `fetchJina`(r.jina.ai 마크다운·keyless) · `fetchDirectReadable`/`extractReadable`(로컬 최소 readability) · `scrapeFree`(jina→직접 체인). **dep-free** = 순수 fetch+regex. |
| 3 | **web_capture** | `src/capture.ts` (신규) | `captureScreenshot()` — headless Chrome `--screenshot` 셸아웃 1순위, Dia CDP(9222·글로벌 WebSocket) 폴백. PNG 아티팩트를 `~/.omni-crawl/captures` 저장. SSRF 가드 적용. |
| 4 | **프로바이더 레지스트리** | `src/registry.ts` (신규) | 엔진→`{id, capability, tier, available, run}` 디스크립터. `main.ts` switch 를 `runRegisteredEngine()` 디스패치로 전환. 신규 프로바이더 = `registerEngine()` 1개 등록. `tier: paid\|free` + `freeFallbackFor()` 가 자동 강등 근거. |
| 5 | **딥모드 인용 강제** | `src/render.ts` (`renderSourcesSection`) | 모든 URL 항목 dedup·번호매김 → 클릭 링크 Sources 섹션 + `[citation:제목](URL)` 인라인 지시문. `--mode deep` 출력에 append (deer-flow 인용 규율 이식). |

### 배선 (기존 파일 수정)

- **`scripts/main.ts`**
  - `--free`(무료 티어 강제) · `--allow-private`(SSRF opt-out) 플래그 신설.
  - `runEngine` switch(~50줄) → `runRegisteredEngine(engine, engineCtx())` 위임.
  - `applyWebFallback`: `tavily → firecrawl → 🆓 ddg` — 유료 양쪽 공백/미가용 시 무료 강등.
  - `runDeep`: tavily 공백 시 ddg 각도 검색 / 스크랩 실패분 `tavily extract → 🆓 jina scrapeFree`.
  - deep 출력에 `renderSourcesSection` append.
  - `--health`: `ddg-free`·`capture` 프로브 추가.
  - `--self-test`: capture·free 케이스 추가 (**14/14 PASS**).
- **`src/router.ts`**: `--free` 인텐트(→ddg/capture) · `스크린샷/screenshot/캡처` 인텐트(→capture).
- **`src/types.ts`**: `SearchEngine` 에 `ddg`·`capture` 추가.
- **`scripts/monitor.ts`**: `create --urls` 에 SSRF 검증 프리필터.

### 폴백 체인 (최종)

```
웹 검색:  tavily → firecrawl → 🆓 ddg
스크랩:   firecrawl scrape(캐시) → waitFor 재시도 → tavily extract → 🆓 jina → 🆓 직접 readable → Dia CDP
딥리서치: 다각도 tavily(+ddg 폴백) → firecrawl 풀스크랩(+jina 폴백) → grok-community → Sources 인용
```

### 신규 엔진 / 환경변수

- 엔진: `ddg`(🆓 검색) · `jina`(🆓 스크랩, scrapeFree 내부) · `capture`(🆓 스크린샷).
- env(전부 선택): `JINA_API_KEY`(rate-limit 상향) · `OMNI_CRAWL_CHROME` · `OMNI_CRAWL_CAPTURE_DIR` · `OMNI_CRAWL_CDP_PORT`.

### 타입 정합

- `@types/node@^26` devDependency 추가 + `tsconfig.json` 에 `"types":["node"]`·`"lib":["ES2023","DOM"]`.
- `npx tsc --noEmit` → **exit 0 (에러 0건)**. 편집기 `process`/`node:*` 경고 전량 제거.

### CLI 계약 (무변경 보장)

`asset-attractiveness`·elanous `research-bridge` 의존 계약 유지:
positional query + `--engine` + `--print` → exit 0 + `---BEGIN_OMNI_CRAWL_MARKDOWN---` 마커.
신규 플래그(`--free`/`--allow-private`)는 전부 추가형.

### 실측 검증

- SSRF 13/13 PASS (localhost·127.0.0.1·169.254.169.254·2130706433·0x7f000001·0177.0.0.1·사설대역·ftp·[::1]).
- DDG 무료 검색 실히트 3건 · Jina 마크다운 수신 · deep end-to-end Sources append 확인.
- headless Chrome 17KB PNG 저장 · localhost 캡처 차단.
- `--health` 6엔진(tavily/firecrawl/grok/apify + ddg-free/capture) 정상.
