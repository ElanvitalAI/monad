---
name: omni-market
description: >
  멀티 프로바이더 금융 데이터 통합 스킬. EODHD(1순위) + FinancialDatasets.ai(fallback) 자동 전환.
  주식(미국/한국/유럽/일본/중국 등 70+거래소), 환율(50+통화), 원자재, 암호화폐,
  국채(28개국 115종), 수익률곡선, 주가지수(INDX), ETF, 기술적 지표(20+종),
  펀더멘털(재무제표/밸류에이션), 거시경제, 뉴스/센티먼트, 배당, 내부자 거래,
  SEC 공시(10-K/10-Q/8-K), 기관 보유(13F), 실적 서프라이즈, 종목 스크리너.
  EODHD 키 없이도 FDS 키만으로 US 종목 조회 가능. 프로바이더 장애 시 자동 fallback.
  Use when the user wants to: 주가, 환율, 금 가격, 유가, 국채, 금리, 수익률곡선,
  종목 분석, 재무제표, 기술적 분석, RSI, MACD, 배당, 실적, IPO, 경제지표,
  Forward PE, PER, PBR, 밸류에이션, 상대강도, 스크리너, SEC 공시, 기관 보유,
  stock price, forex, gold, oil, bond yield, treasury, fundamentals, technical analysis,
  earnings, dividend, screener, financial data, 포트폴리오, 자산배분,
  KOSPI, S&P500, NASDAQ, DAX, crypto, bitcoin, ETF, macro, DXY, VIX,
  insider trades, institutional ownership, SEC filings, 13F.
minTier: T2
composes: [kr-flow, asset-attractiveness]
category: market
# 오픈코어 경계(scripts/skill-boundary.ts) — requires = 없으면 이 스킬이 일을 못 하는 catalog/resources.yaml 자원 id
requires: []
---

# OmniMarket — Multi-Provider Financial Data

EODHD + FinancialDatasets.ai 멀티 프로바이더 금융 데이터 CLI.
EODHD 장애/미구독 시 FDS로 자동 fallback. 프로바이더 확장 구조.

## 트리거

주가, 환율, 금/유가, 국채/금리, 거시경제, 종목 분석, 기술적 분석, 배당, 실적,
SEC 공시, 기관 보유, 내부자 거래, 포트폴리오 등 모든 금융 데이터 요청.

## 실행

```bash
npx tsx ~/.claude/skills/omni-market/scripts/main.ts <command> [target] [OPTIONS]
```

## 프로바이더 구조

```
글로벌 지수(eod/quote) → [yahoo] ──→ 응답 (무료·키 불필요)
그 외 요청 → Router → [eodhd] ──성공──→ 응답
                         │
                         └──실패──→ [fds] ──성공──→ 응답 (fallback 표시)
                                      │
                                      └──실패──→ 에러
```

| 프로바이더 | 커버리지 | 환경변수 |
|-----------|---------|---------|
| **yahoo** (지수 authority) | 글로벌 주가지수 eod/quote — N225/GDAXI/BSESN/BVSP/SSEC/KS11/GSPC 등. EODHD가 빈값 주는 비-US/KR 지수까지. `CODE.INDX` 또는 `^CODE` | (불필요) |
| **eodhd** (1순위) | 글로벌 — 70+ 거래소, 환율, 국채, 암호화폐, 거시경제 | `EODHD_API_KEY` |
| **fds** (fallback) | US 전용 — 17,000+ 미국 종목, SEC 공시, 13F, 실적 | `FDS_API_KEY` |

## 명령어

### 공통 (EODHD + FDS 모두 지원, 자동 fallback)

| 명령 | 설명 | 예시 |
|------|------|------|
| `eod <SYMBOL>` | EOD 히스토리컬 가격 | `eod AAPL.US --from -3m` |
| `quote <SYMBOL>` | 실시간(지연) 시세 | `quote NVDA.US` |
| `fundamentals <SYMBOL>` | 기업 펀더멘털 | `fundamentals MSFT.US` |
| `insider [SYMBOL]` | 내부자 거래 | `insider AAPL.US` |
| `screener` | 종목 스크리너 | `screener --filters '[["market_capitalization",">",1e11]]'` |
| `search <QUERY>` | 종목 검색 | `search "삼성전자"` |

### EODHD 전용 (글로벌 데이터)

| 명령 | 설명 | 예시 |
|------|------|------|
| `intraday <SYMBOL>` | 장중 가격 (1m/5m/1h) | `intraday AAPL.US --interval 5m` |
| `technical <SYMBOL>` | 기술적 지표 | `technical AAPL.US --func rsi --func-period 14` |
| `news [SYMBOL]` | 금융 뉴스 | `news AAPL.US --limit 10` |
| `sentiment <SYMBOLS>` | 뉴스 센티먼트 | `sentiment AAPL.US,TSLA.US` |
| `dividends <SYMBOL>` | 배당 히스토리 | `dividends AAPL.US` |
| `splits <SYMBOL>` | 액면분할 | `splits AAPL.US` |
| `market-cap <SYMBOL>` | 히스토리컬 시총 | `market-cap AAPL.US` |
| `macro [COUNTRY]` | 거시경제 지표 | `macro USA --indicator gdp_current_usd` |
| `events` | 경제 이벤트 캘린더 | `events --country US` |
| `calendar` | 실적/IPO/분할 캘린더 | `calendar --calendar-type earnings` |
| `ust [TYPE]` | 미국채 수익률곡선 | `ust yield-rates --from 2025` |
| `exchanges` | 거래소 목록 | `exchanges` |
| `tickers [EXCHANGE]` | 거래소 종목 리스트 | `tickers US` |
| `bulk [EXCHANGE]` | 벌크 EOD | `bulk US --symbols AAPL,MSFT` |

### FDS 전용 (US 종목 심층 데이터)

| 명령 | 설명 | 예시 |
|------|------|------|
| `earnings <TICKER>` | 실적 (서프라이즈 포함) | `earnings NVDA` |
| `filings <TICKER>` | SEC 공시 (10-K, 10-Q, 8-K) | `filings AAPL --filing-type 10-K` |
| `institutional <TICKER>` | 기관 보유 (13F) | `institutional TSLA` |
| `company <TICKER>` | 기업 기본 정보 | `company MSFT` |

## 공통 옵션

| 옵션 | 설명 |
|------|------|
| `--from <DATE>` | 시작일 (절대/상대: -1m, -3m, ytd, 2025-01-01) |
| `--to <DATE>` | 종료일 (기본: today) |
| `--period d\|w\|m` | 일/주/월 |
| `--limit N` | 결과 수 제한 |
| `--json` | JSON 원본 출력 |
| `--filing-type <type>` | SEC 공시 유형 (10-K, 10-Q, 8-K) |

## 심볼 형식

EODHD 형식 사용: `{TICKER}.{EXCHANGE}` (예: `AAPL.US`, `005930.KO`, `USDKRW.FOREX`)
FDS 전용 명령은 plain ticker도 가능 (예: `earnings NVDA`)

**선물 (yahoo 경유 · 2026-07-15)**: `{ROOT}.FUT` → Yahoo 연속물 `{ROOT}=F` 매핑.
`CL.FUT`(WTI) · `BZ.FUT`(브렌트) · `ES.FUT`(S&P) · `NQ.FUT`(나스닥) · `GC.FUT`(금) ·
`NG.FUT`(천연가스) + 별칭 `WTI.FUT`/`BRENT.FUT`/`SP500.FUT`/`NASDAQ.FUT`/`GOLD.FUT`.
raw `CL=F` 형식도 통과. EODHD `.COMM` quote 는 빈값이므로 유가/지수선물은 반드시 `.FUT` 사용.
⚠️ KS11.INDX 등 일부 지수의 yahoo 일봉은 최근 1세션이 늦게 붙을 수 있음 — 정밀 일간
등락률·확정 종가는 kr-flow `krx-index` 가 authority.

> 전체 심볼 레퍼런스는 eodhd 스킬의 SKILL.md 참조.

## 한국 시장 데이터 — kr-flow 연계 가이드

omni-market은 EODHD 기반으로 한국 종목(005930.KO 등)의 **EOD 가격, 기술적 지표, 뉴스/센티먼트, 펀더멘털, 배당**을 제공한다.
그러나 **한국 시장 고유 데이터는 kr-flow 스킬이 압도적으로 우수**하므로, 아래 데이터는 반드시 kr-flow를 사용할 것:

| 데이터 | omni-market | kr-flow | 사용 스킬 |
|--------|-------------|---------|----------|
| 종목 실시간 시세 | 15분 지연 | **실시간** | → kr-flow `price` |
| 투자자 수급 (외국인/기관/개인) | X | **O** | → kr-flow `foreign-net`, `investor` |
| 시장별 투자자매매동향 | X | **O** | → kr-flow `market-flow` |
| 외국인/기관 매매종목 가집계 | X | **O** | → kr-flow `frgn-institution` |
| 공매도 일별추이 | X | **O** | → kr-flow `short-sale` |
| KOSPI/KOSDAQ 전체 지수 | X (KOSPI.INDX 404) | **O** (91개 지수) | → kr-flow `krx-index`, `krx-kosdaq-index` |
| ETF/ETN 전종목 매매 | X | **O** (1,400+) | → kr-flow `krx-etf`, `krx-etn` |
| 채권/국채 매매 | X | **O** | → kr-flow `krx-bond`, `krx-kts` |
| 전종목 일별매매정보 | X | **O** (KOSPI 950 + KOSDAQ 1,823) | → kr-flow `krx-market`, `krx-kosdaq` |
| 종목기본정보 (한글) | 영문만 | **O** (한글 상세) | → kr-flow `krx-stock-info` |
| **기술적 지표** (RSI/SMA/MACD 등) | **O** (20+종) | X | → omni-market `technical` |
| **뉴스/센티먼트** | **O** (영문) | X | → omni-market `news`, `sentiment` |
| **글로벌 표준 펀더멘털** | **O** (재무제표/PER/PBR) | X | → omni-market `fundamentals` |
| **배당 히스토리** | **O** | X | → omni-market `dividends` |

**요약: 한국 시장 분석 시 최적 조합**
- **수급/수량 데이터**: kr-flow (한투API + KRX Open API)
- **가격/기술적 분석**: omni-market (EODHD technical)
- **글로벌 비교/펀더멘털**: omni-market (EODHD fundamentals)

## 새 프로바이더 추가 방법

`src/providers/` 디렉토리에 `Provider` 인터페이스를 구현하는 파일을 추가하고,
`src/router.ts`의 `ALL_PROVIDERS` 배열에 등록하면 자동으로 fallback 체인에 포함됩니다.

```typescript
// src/providers/your-provider.ts
export const yourProvider: Provider = {
  name: 'your-provider',
  available() { return hasEnv('YOUR_API_KEY'); },
  supports(command, symbol) { /* ... */ },
  async execute(command, target, opts) { /* ... */ },
};
```
