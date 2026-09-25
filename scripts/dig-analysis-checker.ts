#!/usr/bin/env bun
// ── Phase A1 · dig 분석 독립 checker CLI (builder != checker · 2026-07-08) ──
//
// dig 자율 골의 종료조건(§5-④ terminationPresetWithChecker)이 goalRoot 를 cwd 로
// 이 스크립트를 spawn 한다. ANALYSIS.md 를 읽어 assessDigAnalysis 로 품질 판정 →
// exit 0(통과) / 1(미달). writer(분석 agent)와 분리된 프로세스라 자기채점 불가.
//
// import 는 스크립트 파일 기준으로 해석되므로(cwd=goalRoot 무관) ../src 경로 안전.

import { existsSync, readFileSync } from 'node:fs';
import { assessDigAnalysis } from '../src/domains/dig-analysis-quality.js';

const PATH = 'ANALYSIS.md'; // cwd = goalRoot
let text = '';
try { if (existsSync(PATH)) text = readFileSync(PATH, 'utf-8'); } catch { /* 부재 = 빈 본문 = FAIL */ }

const r = assessDigAnalysis(text);
console.log(`[dig-checker] ${r.pass ? 'PASS' : 'FAIL'} score=${r.score}/3${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`);
process.exit(r.pass ? 0 : 1);
