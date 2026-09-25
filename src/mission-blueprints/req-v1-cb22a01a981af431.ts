import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { collectSemisView, type SemisView } from '../domains/kg-semis.js';
import { pickSearchPlan } from '../domains/dig-engine.js';
import { knowledgeDbPath } from '../domains/knowledge.js';
import { readConfiguredMarketIndexMoves, type MarketIndexMove } from '../mission-capabilities/market/quotes.multi.js';
import { readConfiguredSectorScores } from '../mission-capabilities/market/sector.moves.js';
import { collectMarketSurges } from '../mission-capabilities/market/surge.list.js';
import { readConfiguredNewsPlans, type NewsPlan } from '../mission-capabilities/news/resolution.scaled.js';
import { trafficlightVocabulary } from '../mission-capabilities/report/trafficlight.js';
import { hasValuechainView } from '../mission-capabilities/analysis/valuechain.js';
import type { SectorScore } from '../domains/sector-attractiveness.js';
import type { CapabilityProvider } from '../mission-capabilities/registry.js';
import type { MissionBlueprint } from './types.js';

const capabilityIds = ['market.quotes.multi', 'market.sector.moves', 'market.surge.list', 'news.resolution.scaled', 'analysis.valuechain', 'report.trafficlight'] as const;
const indexTargets = [{ region: 'US', name: '미국', symbol: '^GSPC' }, { region: 'US', name: '미국', symbol: '^IXIC' }, { region: 'KR', name: '한국', symbol: 'EWY' }, { region: 'JP', name: '일본', symbol: 'EWJ' }, { region: 'CN', name: '중국', symbol: 'FXI' }] as const;
type Surge = { symbol: string; days: number; cumulativePct: number };

export interface MorningReportReaders { indexes: () => MarketIndexMove[]; sectors: () => SectorScore[]; surges: () => Surge[]; valuechain: () => SemisView | null; news: () => NewsPlan[]; }

function unavailable(section: string, repair: string): string[] { return [`## ${section}`, '', `판정 불가 — 저장된 값이 없습니다. ${repair}`]; }
function safely<T>(read: () => T, fallback: T): T { try { return read(); } catch { return fallback; } }
function formatNumber(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(2); }
function configuredValuechain(): SemisView | null { if (!existsSync(knowledgeDbPath())) return null; const db = new Database(knowledgeDbPath(), { readonly: true }); try { return collectSemisView({ db }); } finally { db.close(); } }
const configuredReaders: MorningReportReaders = { indexes: readConfiguredMarketIndexMoves, sectors: readConfiguredSectorScores, surges: collectMarketSurges, valuechain: configuredValuechain, news: readConfiguredNewsPlans };

function renderIndexes(readers: MorningReportReaders): string[] {
  const bySymbol = new Map(safely(readers.indexes, []).filter(move => indexTargets.some(target => target.symbol === move.symbol && target.region === move.region)).map(move => [move.symbol, move]));
  return ['## 지역 지수 변동', '', '| 지역 | 지수 | 종가 | 1일 등락 |', '| --- | --- | ---: | ---: |', ...indexTargets.map(target => {
    const move = bySymbol.get(target.symbol);
    return move ? `| ${target.name} | ${target.symbol} | ${formatNumber(move.close)} | ${move.return1d === null ? '판정 불가' : `${formatNumber(move.return1d)}%`} |` : `| ${target.name} | ${target.symbol} | 판정 불가 | 판정 불가 |`;
  })];
}
function renderSectors(readers: MorningReportReaders): string[] { const scores = safely(readers.sectors, []).sort((left, right) => left.rank - right.rank || right.score - left.score).slice(0, 8); return scores.length ? ['## 주요 섹터 무브먼트', '', '| 순위 | 시장 | 섹터 | 점수 |', '| ---: | --- | --- | ---: |', ...scores.map(score => `| ${score.rank} | ${score.market}/${score.window} | ${score.chain} | ${formatNumber(score.score)} |`)] : unavailable('주요 섹터 무브먼트', 'src/domains/sector-store.ts에 섹터 점수를 적재하세요.'); }
function planForSurge(surge: Surge): NewsPlan { const item = { id: `pulse:${surge.symbol}`, topic: `${surge.symbol} ${surge.days}일 연속 상승`, sector: 'market', score: surge.cumulativePct }; return { item, plan: pickSearchPlan(item) }; }
function renderSurges(readers: MorningReportReaders): string[] {
  const surges = safely(readers.surges, []);
  return surges.length ? ['## 급등주 리스트', '', '| 종목 | 연속 상승 | 누적 상승 | 뉴스 해상도 |', '| --- | ---: | ---: | --- |', ...surges.map(surge => {
    const plan = surge.days >= 2 ? planForSurge(surge).plan : undefined;
    return `| ${surge.symbol} | ${surge.days}일 | ${formatNumber(surge.cumulativePct)}% | ${plan ? `${plan.label} (${plan.depth})` : '일반 관찰'} |`;
  })] : unavailable('급등주 리스트', 'src/domains/sector-store.ts의 가격 바를 갱신하세요.');
}
function renderValuechain(readers: MorningReportReaders): string[] {
  const view = safely(readers.valuechain, null);
  if (!hasValuechainView(view)) return unavailable('밸류체인 분석', 'src/domains/kg-semis.ts의 반도체 그래프를 채우세요.');
  return ['## 밸류체인 분석', '', `체인: ${view.chainName} (${view.memberCount}개)`, ...(view.supplies.length ? view.supplies.map(supply => `- 상류 ${supply.upName} → 하류 ${supply.downName}`) : ['- 상류→하류 관계: 판정 불가 — src/domains/kg-semis.ts의 반도체 그래프 관계를 채우세요.'])];
}
function renderNewsPlans(readers: MorningReportReaders): string[] { const plans = safely(readers.news, []); return plans.length ? ['## 해상도 조절형 뉴스 분석', '', ...plans.map(({ item, plan }) => `- ${item.topic}: ${plan.label}${plan.depth ? ` (${plan.depth})` : ''}`), '웹 검색은 이 리포트에서 실행하지 않고 조사 깊이만 계획합니다.'] : unavailable('해상도 조절형 뉴스 분석', 'src/domains/dig-engine.ts의 대기 신호를 적재하세요.'); }
function renderTrafficlight(readers: MorningReportReaders): string[] { const [ready, blocked, unmeasurable] = trafficlightVocabulary; const validMoves = safely(readers.indexes, []).filter(move => indexTargets.some(target => target.symbol === move.symbol && target.region === move.region) && move.return1d !== null); const symbols = new Set(validMoves.map(move => move.symbol)); const green = indexTargets.every(target => symbols.has(target.symbol)) && safely(readers.sectors, []).length > 0; const yellow = safely(readers.surges, []).some(surge => surge.days >= 2); return ['## 신호등 요약', '', `- ${green ? ready : unmeasurable} 필수 5개 지수·섹터 근거 ${green ? '확보' : '판정 불가'}`, `- ${yellow ? '⚠️' : ready} 급등주 ${yellow ? '2거래일 이상 종목의 심층 뉴스 분석 우선' : '일반 관찰'}`, `- ${blocked} 값이 비어 있으면 추정하지 않고 각 섹션의 적재 경로를 따릅니다.`]; }

export function createMorningMarketReportBlueprint(readers: MorningReportReaders = configuredReaders): MissionBlueprint {
  return { id: 'req:v1:cb22a01a981af431', requires: capabilityIds.map(id => ({ id })), produces: { kind: 'morning-market-report', deliver: [] }, async run(ctx) { const outcomes = await Promise.all(capabilityIds.map(async id => { const provider: CapabilityProvider | undefined = ctx.capabilities.get(id); try { return provider ? (await provider.probe()).ok : false; } catch { return false; } })); const succeeded = outcomes.filter(Boolean).length; return { ok: succeeded === outcomes.length, body: ['# Morning market report', '', ...renderIndexes(readers), '', ...renderSectors(readers), '', ...renderSurges(readers), '', ...renderValuechain(readers), '', ...renderNewsPlans(readers), '', ...renderTrafficlight(readers)].join('\n'), measured: { probed: outcomes.length, succeeded, failed: outcomes.length - succeeded } }; } };
}
export default createMorningMarketReportBlueprint();
