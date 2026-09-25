#!/usr/bin/env bun
/**
 * 골이 «전제로 단언한 식별자»를 판정 신호가 «목으로 세우는지» 찾는다.
 *
 * 왜: 그런 골은 판정 신호가 「구현이 골을 따랐나」만 답하고 「골이 옳았나」는
 * 구조적으로 못 답한다 — 어떤 리뷰 라운드도 그 오류를 잡을 수 없다.
 * 실측 계기: 2026-09-01 🅣 `#15031` — 골이 `/v1/sessions` 를 전제로 댔고
 * 판정 신호가 그 주소를 목으로 세웠다. 무인 완주·자동 병합했고 실물은 0건이었다.
 */
import { readFileSync } from 'node:fs';

/** 「이미 있다·존재한다」류 — 골이 재지 않고 참으로 «놓은» 문장. */
const PREMISE_SENTENCE = /(?:이미\s*(?:있다|존재|구현)|존재한다|already exists?|is already)/u;
/** 판정 신호가 «흉내»를 낸다고 말하는 문면. */
const MOCK_WORD = /(?:목|mock|스텁|stub|흉내|fake|더미)/iu;

/** 문면에서 식별자로 쓸 만한 것 — 라우트·이벤트·config 키·환경변수. */
export function identifiersIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\/v\d+\/[a-z0-9/_-]+/giu)) found.add(m[0].replace(/\/$/u, ''));
  // ⛔ 밑줄 «없는» 대문자 낱말(NOTICE·ISSUES·AGENTS)은 식별자가 아니라 «낱말»이다 — 위양성 넷을 냈다.
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/gu)) found.add(m[0]);
  for (const m of text.matchAll(/`([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,})`/gu)) found.add(m[1]);
  return [...found];
}

export interface Finding {
  readonly identifier: string;
  readonly premiseLine: number;
  readonly signalLine: number;
}

/** 전제 문장에 나온 식별자가 판정 신호의 «목» 문장에도 나오면 잡는다. */
export function findPremiseMockedBySignal(source: string): Finding[] {
  const lines = source.split('\n');
  const premises = new Map<string, number>();
  const findings: Finding[] = [];

  lines.forEach((line, index) => {
    if (!PREMISE_SENTENCE.test(line)) return;
    for (const id of identifiersIn(line)) if (!premises.has(id)) premises.set(id, index + 1);
  });

  lines.forEach((line, index) => {
    if (!/판정\s*신호/u.test(line) || !MOCK_WORD.test(line)) return;
    for (const id of identifiersIn(line)) {
      const premiseLine = premises.get(id);
      if (premiseLine !== undefined) findings.push({ identifier: id, premiseLine, signalLine: index + 1 });
    }
  });

  return findings;
}

/** 알려진 양성·음성으로 자를 «먼저» 재고, 못 재면 자 자신을 실패시킨다. */
export function selfCheck(): number {
  const positive = [
    '서버 문은 이미 있다. `GET /v1/sessions`(`handleSessionsList` · `src/nexus/api/http-server.ts:1987`).',
    '판정 신호: 조건 = `/v1/sessions` 를 흉내 내는 목 HTTP 서버를 띄운다; 관측 = 요청 기록; 기대 = 받았다.',
  ].join('\n');
  const negativeMockOnly = [
    '이 축은 아직 없다. 새로 만든다.',
    '판정 신호: 조건 = `/v1/other` 를 흉내 내는 목 서버를 띄운다; 관측 = 기록; 기대 = 받았다.',
  ].join('\n');
  const negativePremiseOnly = [
    '서버 문은 이미 있다. `GET /v1/sessions`.',
    '판정 신호: 조건 = 실물 데몬을 그대로 친다; 관측 = 산출; 기대 = 세션 id 가 나온다.',
  ].join('\n');

  const caught = findPremiseMockedBySignal(positive);
  const sparedA = findPremiseMockedBySignal(negativeMockOnly);
  const sparedB = findPremiseMockedBySignal(negativePremiseOnly);

  const ok = caught.length === 1 && caught[0]?.identifier === '/v1/sessions' && sparedA.length === 0 && sparedB.length === 0;
  console.log(`[self-check] 알려진 양성 ${caught.length}건(기대 1) · 목만 ${sparedA.length}건(기대 0) · 전제만 ${sparedB.length}건(기대 0) ⇒ ${ok ? 'PASS' : 'FAIL'}`);
  return ok ? 0 : 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--self-check') process.exit(selfCheck());

  let total = 0;
  let readCount = 0;
  let readFailureCount = 0;
  for (const path of args) {
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
      readCount += 1;
    } catch {
      readFailureCount += 1;
      console.log(`⚪ ${path} — 읽지 못했다 (「없다」가 아니라 「못 쟀다」)`);
      continue;
    }
    const findings = findPremiseMockedBySignal(source);
    total += findings.length;
    if (findings.length === 0) { console.log(`✅ ${path}`); continue; }
    console.log(`⛔ ${path}`);
    for (const f of findings) console.log(`   «${f.identifier}» — 전제 ${f.premiseLine}줄에서 단언 · 판정 신호 ${f.signalLine}줄에서 목으로 세움`);
  }
  console.log(`\n검사 ${readCount}개 · 못 읽음 ${readFailureCount}개 · 잡힌 것 ${total}건`);
  process.exit(total > 0 ? 1 : readFailureCount > 0 ? 2 : 0);
}
