// ── Mission RFC 문서 store (R1b · RFC-plan-as-rfc-generation) ─────────────────
//
// 저작된 RFC/DESIGN 문서를 미션 디렉토리에 영속한다(mission-grounding-cache 동형 패턴).
// R1b(se-mission-prepare)가 write, R2(추출기)가 read. 순수 저작/파싱은 mission-rfc-author.ts
// (이 파일은 I/O 만·fail-soft·비파괴).
//
// 경로: ~/.elanous state/conatus/missions/<id>/rfc.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { elanousStateRoot } from './state-paths.js';

/** 미션 RFC 문서 경로(id 안전화 — grounding-cache 와 동일 규율). */
export function rfcDocPath(missionId: string): string {
  const safe = missionId.replace(/[^A-Za-z0-9_-]/g, '_');
  return join(elanousStateRoot(), 'conatus/missions', safe, 'rfc.md');
}

/** RFC markdown 저장(디렉토리 보장·fail-soft). 성공 시 경로 반환, 실패 시 null. */
export function writeRfcDoc(missionId: string, markdown: string): string | null {
  try {
    const p = rfcDocPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, markdown, 'utf-8');
    return p;
  } catch { return null; }
}

/** 저장된 RFC markdown 읽기(없거나 실패면 null·fail-soft). */
export function readRfcDoc(missionId: string): string | null {
  try {
    const p = rfcDocPath(missionId);
    if (!existsSync(p)) return null;
    const md = readFileSync(p, 'utf-8');
    return md.trim() ? md : null;
  } catch { return null; }
}

/** ★ ②RFC 내용 주입(근본·2026-07-22) — RFC-preset 미션에서 walker/SE 가 설계 본문을 못 보고
 *  즉흥 확장하던 근본 해소(핸드오프 3근본 #2). rfcToProposedTasks 는 페이즈에 RFC 제목+아크명+경로만
 *  넣고 **본문 미주입**이었다(build-context 도 research/ground/dedup 만·RFC-blind). 이 헬퍼가 rfc.md
 *  본문을 실행 페이즈 프롬프트/PLAN 에 직접 주입할 계약 블록으로 포맷한다(경로만 주고 "Read 하겠지"에
 *  의존하지 않음 — 확실 가시성). RFC 없으면 ''(비-RFC 미션 무영향·fail-soft). bounded(기본 8000자·
 *  초과 시 절단+전문 경로 안내). walker=run-mission·SE=se-bridge writePhasePlan 두 조립 seam 공유. */
export function formatRfcDesignForPrompt(missionId: string, opts: { maxChars?: number } = {}): string {
  const md = readRfcDoc(missionId);
  if (!md) return '';
  return renderRfcDesignBlock(md, rfcDocPath(missionId), opts.maxChars ?? 8000);
}

/** 순수 렌더러(테스트 가능·I/O 없음) — RFC markdown → 실행 프롬프트 계약 블록. 빈 md 는 ''.
 *  maxChars 초과면 절단하고 전문 경로를 안내(walker/SE 가 필요 시 Read). */
export function renderRfcDesignBlock(md: string, docPath: string, maxChars = 8000): string {
  if (!md.trim()) return '';
  const truncated = md.length > maxChars;
  const body = truncated ? md.slice(0, maxChars) : md;
  return [
    '[★ 이 미션의 RFC 설계 계약 — 반드시 준수]',
    '이 미션은 아래 RFC 설계에 따라 저작·분해됐다. 설계가 정한 범위·경계·처분(무엇을 만들고/고치고/제거하고/남길지)·',
    '무회귀 원칙을 그대로 따르라. 설계에 없는 구조·파일·기능을 즉흥적으로 새로 만들지 마라(설계 이탈=회귀).',
    '각 페이즈는 이 설계의 한 조각을 구현한다 — 설계 밖으로 스코프를 확장하지 말 것.',
    truncated ? `(아래는 설계 일부 · 전문은 필요 시 Read: ${docPath})` : '',
    '',
    '--- RFC 설계 ---',
    body,
    truncated ? `… (절단됨 · 전문: ${docPath})` : '',
    '--- /RFC 설계 ---',
  ].filter(Boolean).join('\n');
}
