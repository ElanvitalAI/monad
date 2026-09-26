// ── 로컬 LLM 벤치마크 하니스 · 공개 배럴 (2026-07-15) ──────────────────────────────
//
// node-b/본머신 로컬 모델을 100점 루브릭(코딩50·추론30·RAG10·형식10)으로 공정 재테스트. 대표 방식 이식:
// temperature 0·같은 문항 같은 순서·코딩은 실제 Python 실행 채점. 다운로드(installer)→벤치→preset 역제안
// 루프의 채점 코어. CLI = `elanous local bench`, 미션 배선 = local-model-bench-mission.

export { runPython, extractCodeBlock, tallyMarkers, type PyRunResult, type PyRunOpts } from './code-exec.js';
export {
  BENCH_TASKS, categoryMaxes, extractAnswerTag, flexibleLastInt, flexibleLastToken, RUBRIC_VERSION,
  type BenchTask, type BenchCategory, type BenchGradeResult, type CodeExecutor, type BenchDifficulty,
} from './tasks.js';
export {
  benchmarkModel, makeOpenAiCompatChat,
  type BenchModelTarget, type BenchChat, type BenchChatResult, type BenchmarkDeps, type Scorecard, type TaskResult,
} from './runner.js';
export { formatScorecard, formatRanking, scorecardToRecord } from './format.js';
export { benchmarkFleet, assignTargets, pickMedianCard, targetKey, MAX_CONCURRENCY, type FleetOptions } from './fleet.js';
export {
  runLocalBenchMission,
  type BenchMissionDeps, type BenchMissionResult, type BenchMissionProposal, type BenchProposalRankEntry,
} from './bench-mission.js';
export {
  parseBenchRecords, splitBenchRecords, aggregateRecords, deriveBestPurpose, deriveTier,
  parseParamsB, bytesPerParam, estimateRamGb, buildScoreRows, sortRows,
  formatScoreMap, scoreRowToJson, CATEGORY_MAX,
  type BenchRecord, type BenchScoreMismatch, type Purpose, type InventoryMeta, type ScoreRow, type SortKey,
} from './scores.js';
