// Working Memory 포맷 — 스테이지 핸드오프 순수 코어 (공용·중립 · 2026-07-20 C4 승격).
//
// 원본: src/autopilot/mission-working-memory.ts. "한 스테이지가 무엇을 했고·무엇을 재사용하기로 했고·무엇을
// 산출했나"를 다음 스테이지 입력으로 넘기는 구조화 핸드오프(§15c 문맥교환 #2 — 재발명 말고 계약 재사용).
//
// ★ 이 모듈은 **순수 포맷/파싱 코어**만 담는다(DESIGN §16 C4): 엔트리 타입·마커 파싱(parseWorkingMemorySignals)·
//   프롬프트 렌더(formatWorkingMemoryForPrompt)·dedup·jsonl 파싱. 저장/아카이브/compaction(fs I/O·미션
//   경로)은 autopilot 잔류. 스몰-폼 하니스가 스테이지 핸드오프에 재사용. 전부 순수·I/O 없음.

/** 스테이지 작업 종류. */
export type PhaseMemoryKind = 'investigation' | 'implementation' | 'operational';

/** 엔트리 출처 태그(하이브리드) — self=스테이지 자신·external=외부 도구 가이드·reconcile=현실 관측·
 *  decision=결정·build=빌드 파이프라인 이관 조사 문맥. 읽는 쪽이 출처를 구분한다. */
export type MemoryProvenance = 'self' | 'external' | 'reconcile' | 'decision' | 'build';

/** 구현 이탈 종류(deviation) — 플랜과 다르게 진행한 스토리의 분류. */
export type DeviationKind =
  | 'scope_reduction' | 'deferred' | 'asked_user' | 'env_improved' | 'regrounded' | 'other'
  | 'satisfied_skip' | 'blocked_dependency' | 'arc_surgery'
  | 'phase_failed'
  | 'self_heal'
  | 'deadlock'
  | 'review_fail';
/** 구현 이탈 1건 — 종류 + 사유. "왜 플랜과 다르게 했나"를 후속·회고가 회상(휘발 방지). */
export interface WorkingMemoryDeviation { kind: DeviationKind; note: string }

/** 국소 메모리 가시성 계층 — agent=소유 스테이지만·subteam=서브팀 공유(기본)·global=전역 승격. */
export type WorkingMemoryScope = 'agent' | 'subteam' | 'global';
/** scope 검증(순수) — 미상/미지정은 false(기본 subteam 취급·비파괴). */
export function isWorkingMemoryScope(v: unknown): v is WorkingMemoryScope {
  return v === 'agent' || v === 'subteam' || v === 'global';
}

/** 워킹 메모리 엔트리 — 한 스테이지가 "무엇을 했고·무엇을 재사용하기로 했고·무엇을 산출했나". */
export interface WorkingMemoryEntry {
  phaseId: string;
  phaseTitle: string;
  kind: PhaseMemoryKind;
  at: string; // ISO
  summary: string;
  reusables: string[];
  decisions: string[];
  artifacts: string[];
  provenance?: MemoryProvenance;
  arcId?: string;
  deviation?: WorkingMemoryDeviation;
  scope?: WorkingMemoryScope;
}

/** dedup 상한 — 유효 엔트리 tail 캡. */
export const MAX_ENTRIES = 60;

/** 배열/스칼라 → 정규화된 문자열 배열(트림·빈값제거·중복제거·상한). 순수. 저장/포맷 공유. */
export function normList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

/** `[MARKER]` 뒤의 첫 균형 잡힌 JSON 객체를 파싱(순수·중괄호 균형 스캔). 없으면 null. */
function extractMarkedJson(text: string, marker: string): Record<string, unknown> | null {
  const idx = text.indexOf(`[${marker}]`);
  const from = idx >= 0 ? idx + marker.length + 2 : 0;
  const start = text.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { const o = JSON.parse(text.slice(start, i + 1)); return (o && typeof o === 'object') ? o : null; }
        catch { return null; }
      }
    }
  }
  return null;
}

const DEVIATION_KINDS: readonly DeviationKind[] = ['scope_reduction', 'deferred', 'asked_user', 'env_improved', 'regrounded', 'other', 'satisfied_skip', 'blocked_dependency', 'arc_surgery', 'phase_failed', 'self_heal', 'deadlock', 'review_fail'];

/** 같은 phaseId(+provenance) 의 중복 엔트리를 최신(마지막 append)만 남긴다(순수). 마지막 등장 위치 순서 유지. */
export function dedupWorkingMemory(entries: readonly WorkingMemoryEntry[]): WorkingMemoryEntry[] {
  const latest = new Map<string, WorkingMemoryEntry>();
  for (const e of entries) {
    // ★ provenance 별로 분리 — 같은 phaseId 라도 self·external·reconcile 은 공존해야. phaseId 비면 title+at 폴백.
    const prov = e.provenance ?? 'self';
    const key = `${e.phaseId || `${e.phaseTitle}@${e.at}`}:${prov}`;
    latest.delete(key); // 재삽입으로 위치를 최신으로 갱신
    latest.set(key, e);
  }
  return Array.from(latest.values()).slice(-MAX_ENTRIES);
}

/** jsonl 텍스트 → 엔트리 배열(순수·깨진 줄 skip). */
export function parseWorkingMemoryJsonl(text: string): WorkingMemoryEntry[] {
  const out: WorkingMemoryEntry[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (!o || typeof o !== 'object') continue;
      out.push({
        phaseId: String(o.phaseId ?? ''),
        phaseTitle: String(o.phaseTitle ?? ''),
        kind: (o.kind === 'implementation' || o.kind === 'operational') ? o.kind : 'investigation',
        at: String(o.at ?? ''),
        summary: String(o.summary ?? ''),
        reusables: normList(o.reusables),
        decisions: normList(o.decisions),
        artifacts: normList(o.artifacts),
        provenance: (o.provenance === 'external' || o.provenance === 'reconcile' || o.provenance === 'decision' || o.provenance === 'build') ? o.provenance : 'self',
        ...(o.arcId ? { arcId: String(o.arcId).slice(0, 80) } : {}),
        ...(parseDeviation(o.deviation) ? { deviation: parseDeviation(o.deviation) as WorkingMemoryDeviation } : {}),
        ...(isWorkingMemoryScope(o.scope) ? { scope: o.scope } : {}),
      });
    } catch { /* 깨진 줄 skip */ }
  }
  return out;
}

/** premise 팩트(`[premise:<verdict>] 아크 "X": <reason>`) → 친절 actionable 교정 메모(순수).
 *  대표 철학(2026-07-21): 플랜단에서 전제 오인을 재분해로 완벽제거하지 말고, 구현이 소화할 친절한 참고 메모로.
 *  단정·부정("무관하다")이 아니라 "구현 전 실제 코드로 재확인하고, 전제가 어긋나면 아크 의도에 맞는 올바른
 *  실제 경로를 탐색·재사용" 지시로 감싼다. 기계 태그(`[premise:...]`)는 사람/에이전트 가독을 위해 벗겨내고,
 *  reason 이 교정 대상(무엇을 대신 쓰라)을 안 담아도 최소한의 재확인·교정 지시를 덧붙인다. */
export function formatPremiseMemo(fact: string): string {
  const m = /^\[premise:[^\]]*\]\s*([\s\S]*)$/.exec(fact.trim());
  const body = (m ? m[1]! : fact).trim();
  if (!body) return fact.trim();
  return `${body} → 구현 전 지목된 파일/전제를 실제 코드로 먼저 재확인하고, 전제가 어긋나면 "이미 있는 대상 수정"이 아니라 아크 의도에 맞는 올바른 실제 경로를 탐색·재사용해 교정하세요.`;
}

/** 워킹 메모리 → 후속 스테이지 프롬프트/PLAN 주입 블록(순수). "이미 파악/결정한 것을 다시 발명하지 말고
 *  재사용하라"를 명시. 비어 있으면 '' 반환. */
export function formatWorkingMemoryForPrompt(
  entriesIn: readonly WorkingMemoryEntry[],
  opts: { arcId?: string; viewerPhaseId?: string } = {},
): string {
  // reconcile(현실 상태 스냅샷)은 재사용 가이드가 아니므로 프롬프트 주입 제외(노이즈 방지).
  const filtered = entriesIn.filter((e) => (e.provenance ?? 'self') !== 'reconcile')
    // agent 스코프 엔트리는 소유 스테이지(viewerPhaseId)만 본다. subteam/global 은 공유.
    .filter((e) => (e.scope ?? 'subteam') !== 'agent' || !opts.viewerPhaseId || e.phaseId === opts.viewerPhaseId);
  // provenance:'build' 는 같은 phaseId 최신 1개만(재분해 재spawn 중복 제거). 뒤(최신)를 남김.
  const entries = filtered.filter((e, i) => {
    if (e.provenance !== 'build') return true;
    return !filtered.slice(i + 1).some((x) => x.provenance === 'build' && x.phaseId === e.phaseId);
  });
  if (!entries.length) return '';
  const reusables = normList(entries.flatMap((e) => e.reusables));
  const decisions = normList(entries.flatMap((e) => e.decisions));
  // ★ mirage 진단 carry(대표 2026-07-21·C) — 아크 preflight non-founded 진단(`[premise:<verdict>]`). skill/code/
  //   corpus 팩트와 달리 "이 전제는 재확인 대상"이라는 교정 메모 — 구현 SE 가 최우선으로 인지하게 블록 최상단에 노출.
  const premiseFacts = decisions.filter((d) => d.startsWith('[premise:'));
  // ★ P1.5 (2026-07-20) — SKILL.md 는 코드 export 가 아니라 스킬 문서. "재사용/재구현금지"로 묶으면
  //   실 구현 에이전트가 worktree 에 코드 없다고 무시한다. "Read 해서 능력·사용법·계약 참조"로 별도
  //   프레이밍 → grounding(P1)이 실은 skill 을 실행층까지 나르게. [[project_reasoning_corpus_unification_2026_07_20]].
  const isSkillDoc = (r: string): boolean => /SKILL\.md$/i.test(r);
  const lines: string[] = [
    '[미션 워킹 메모리 · 이전 페이즈의 조사 결과·결정 — 재사용 필수]',
    '이 미션의 이전 페이즈들이 이미 파악·결정한 내용이다. 아래를 다시 발명·재구현하지 말고 그대로 재사용하라.',
  ];
  // ★ 아크 전제 교정 메모 최우선 노출(대표 2026-07-21·C) — preflight mirage 진단을 블록 최상단(재사용/스킬/코퍼스
  //   팩트 앞)에 실어 구현 SE 가 잘못된 전제를 가장 먼저 인지·교정하게. formatPremiseMemo 로 친절 actionable 렌더.
  if (premiseFacts.length) {
    lines.push('', '★★ 아크 전제 교정 메모(구현 최우선 참고) — 아래 전제는 실제 코드와 다를 수 있으니, 착수 전 재확인하고 올바른 실제 경로로 우아하게 교정:');
    for (const f of premiseFacts.slice(0, 8)) lines.push(`- ${formatPremiseMemo(f)}`);
  }
  // 아크 메모리 2층 — ① 같은 아크 메이트 경계·결정 강조 + ② 다른 아크가 닫은 산출 경계 주입.
  if (opts.arcId) {
    const mates = entries.filter((e) => e.arcId === opts.arcId);
    const mateReusables = normList(mates.flatMap((e) => e.reusables));
    const mateDecisions = normList(mates.flatMap((e) => e.decisions));
    if (mateReusables.length || mateDecisions.length) {
      lines.push('', `★ 같은 아크(${opts.arcId})의 다른 페이즈가 이미 정의 — 반드시 이 계약 위에 배선·통합(아크 통합검증 대상):`);
      lines.push('  ⚠️ 격리 worktree 라 아래 심볼의 실제 코드가 안 보일 수 있다. 그래도 이 계약(이름·시그니처)을 그대로');
      lines.push('     재사용해 배선하라 — "없으니 self-contained 로 다시 만들자"는 금지(통합 시 중복·dead-code 발생).');
      for (const r of mateReusables.slice(0, 20)) if (!isSkillDoc(r)) lines.push(`- (아크 재사용) ${r}`);
      for (const d of mateDecisions.slice(0, 15)) lines.push(`- (아크 결정) ${d}`);
    }
    const others = entries.filter((e) => e.arcId && e.arcId !== opts.arcId);
    if (others.length) {
      const byArc = new Map<string, WorkingMemoryEntry[]>();
      for (const e of others) { const k = e.arcId!; (byArc.get(k) ?? byArc.set(k, []).get(k)!).push(e); }
      lines.push('', '◇ 이전 아크가 닫은 산출(경계 — 이 위에 세워라·중복 구현 금지):');
      for (const [aid, es] of byArc) {
        const rs = normList(es.flatMap((e) => e.reusables)).slice(0, 6);
        lines.push(`- [${aid}] ${es[es.length - 1]!.summary.slice(0, 100)}${rs.length ? ` · 경계: ${rs.join(', ')}` : ''}`);
      }
    }
  }
  const codeReusables = reusables.filter((r) => !isSkillDoc(r));
  const skillDocs = reusables.filter(isSkillDoc);
  // ★ L3(skill 계약)+L4(코드 export 심볼) — build seed 가 decisions 로 실은 팩트(`[skill:...]`·`[code:...]`).
  //   경로(skillDocs)와 달리 **내용**이라, 구현 에이전트가 Read/추측 없이 PLAN.md 에서 계약·심볼을 바로 보유.
  const skillFacts = decisions.filter((d) => d.startsWith('[skill:'));
  const codeFacts = decisions.filter((d) => d.startsWith('[code:'));
  // ★ P2 (2026-07-21) — 기억·자기이력·문서벡터 팩트(`[memory:`/`[self:`/`[doc]`). 코드/skill 과 달리 재사용
  //   **경계**가 아니라 **사실 배경**(참조·판단재료). files/reusables 아님(mirage 가드). [[PLAN-reasoning-corpus-unification-2026-07-20]].
  const corpusFacts = decisions.filter((d) => d.startsWith('[memory:') || d.startsWith('[self:') || d.startsWith('[doc'));
  // premiseFacts 는 블록 최상단(헤더 직후)에서 이미 렌더 — mirage 진단은 구현 SE 최우선 인지 대상(C).
  const realDecisions = decisions.filter((d) => !d.startsWith('[skill:') && !d.startsWith('[code:') && !d.startsWith('[memory:') && !d.startsWith('[self:') && !d.startsWith('[doc') && !d.startsWith('[premise:'));
  if (codeReusables.length) {
    lines.push('', '재사용할 경계/export(반드시 import·재사용, 재구현 금지):');
    for (const r of codeReusables.slice(0, 30)) lines.push(`- ${r}`);
  }
  if (codeFacts.length) {
    lines.push('', '재사용 가능한 코드 export 심볼(grounding 이 찾은 실제 심볼 — 없는 헬퍼를 추측/환각 말고 이것을 재사용):');
    for (const f of codeFacts.slice(0, 10)) lines.push(`- ${f}`);
  }
  if (skillFacts.length || skillDocs.length) {
    lines.push('', '관련 스킬 — grounding 이 이미 찾아 특정(코드베이스 재조사·재구현 금지·아래 계약을 그대로 활용):');
    for (const f of skillFacts.slice(0, 8)) lines.push(`- ${f}`);   // ★ 계약 팩트(내용·Read 없이 즉시 보유)
    if (skillDocs.length) {
      lines.push('  전체 사용법·명령·계약 상세는 이 SKILL.md 를 Read(worktree 밖 절대경로여도 읽기 가능):');
      for (const r of skillDocs.slice(0, 8)) lines.push(`  - ${r}`);
    }
  }
  if (corpusFacts.length) {
    lines.push('', '참조 지식(기억·자기이력·문서 — 사실 배경·판단재료로만 참조·파일 실존/재사용 경계 주장 아님):');
    for (const f of corpusFacts.slice(0, 8)) lines.push(`- ${f}`);
  }
  if (realDecisions.length) {
    lines.push('', '이전 페이즈의 결정(일관성 유지):');
    for (const d of realDecisions.slice(0, 20)) lines.push(`- ${d}`);
  }
  lines.push('', '이전 페이즈 요약:');
  for (const e of entries.slice(-8)) {
    const tag = e.kind === 'investigation' ? '조사' : e.kind === 'implementation' ? '구현' : '운영';
    lines.push(`- [${tag}] ${e.phaseTitle}: ${e.summary.slice(0, 160)}`);
    if (e.deviation) lines.push(`    ↳ 구현 이탈(${e.deviation.kind}): ${e.deviation.note.slice(0, 140)}`);
  }
  return lines.join('\n');
}

/** 셀프 인지 질의용 사람 읽기 요약(순수) — "지금까지 뭐 했어" 응답. */
export function formatWorkingMemoryDigest(entries: readonly WorkingMemoryEntry[]): string {
  if (!entries.length) return '아직 기록된 페이즈 작업이 없습니다(워킹 메모리 비어 있음).';
  const lines = entries.map((e, i) => {
    const tag = e.kind === 'investigation' ? '조사' : e.kind === 'implementation' ? '구현' : '운영';
    const parts = [`${i + 1}. [${tag}] ${e.phaseTitle} — ${e.summary.slice(0, 140)}`];
    if (e.reusables.length) parts.push(`   재사용: ${e.reusables.slice(0, 6).join(', ')}`);
    if (e.decisions.length) parts.push(`   결정: ${e.decisions.slice(0, 4).join('; ')}`);
    if (e.artifacts.length) parts.push(`   산출: ${e.artifacts.slice(0, 4).join(', ')}`);
    if (e.deviation) parts.push(`   구현 이탈(${e.deviation.kind}): ${e.deviation.note.slice(0, 100)}`);
    return parts.join('\n');
  });
  return lines.join('\n');
}

/** deviation 파싱(순수) — {kind,note} 검증. note 없으면 무이탈·kind 미상은 'other' 폴백. */
export function parseDeviation(raw: unknown): WorkingMemoryDeviation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as { kind?: unknown; note?: unknown };
  const note = typeof o.note === 'string' ? o.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!note) return undefined;
  const kind: DeviationKind = (typeof o.kind === 'string' && DEVIATION_KINDS.includes(o.kind as DeviationKind)) ? (o.kind as DeviationKind) : 'other';
  return { kind, note };
}

/** 에이전트 응답에서 [WORKING-MEMORY] 마커+JSON 신호 추출(순수). 마커/JSON 없거나 깨졌으면 fallback
 *  (summary=응답 앞부분·빈 배열). */
export function parseWorkingMemorySignals(
  text: string,
): { summary: string; reusables: string[]; decisions: string[]; deviation?: WorkingMemoryDeviation } {
  const fallback = {
    summary: (text || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    reusables: [] as string[],
    decisions: [] as string[],
  };
  if (!text) return fallback;
  const obj = extractMarkedJson(text, 'WORKING-MEMORY');
  if (!obj) return fallback;
  const summary = typeof obj.summary === 'string' && obj.summary.trim()
    ? obj.summary.replace(/\s+/g, ' ').trim().slice(0, 600)
    : fallback.summary;
  const deviation = parseDeviation(obj.deviation);
  return { summary, reusables: normList(obj.reusables), decisions: normList(obj.decisions), ...(deviation ? { deviation } : {}) };
}

/** 에이전트 응답에서 [WORKING-MEMORY] 마커+JSON 블록 제거(순수) — 표시용 요약 정제. 마커 없으면 원문. */
export function stripWorkingMemoryMarker(text: string): string {
  if (!text) return text;
  const idx = text.indexOf('[WORKING-MEMORY]');
  if (idx < 0) return text;
  const start = text.indexOf('{', idx);
  if (start < 0) return text.slice(0, idx).trimEnd();
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const tail = end >= 0 ? text.slice(end) : '';
  return (text.slice(0, idx).trimEnd() + (tail.trim() ? '\n' + tail.trim() : '')).trim();
}
