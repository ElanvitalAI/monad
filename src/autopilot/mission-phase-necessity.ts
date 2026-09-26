// ── 페이즈 가치/필요성 판정 공용 seam (P4·조율자 주도·대표 2026-07-21) ──────────
//
// 배경(dogfood 조사): 페이즈 과잉생산(generator-prompt arcCount 하한·one-concern·엣지 열거)은 있는데
// **가치/필요성 판정이 시스템 전체에 부재**하다(too_large 게이트 제거·synthesis/preflight/arc 어디에도
// 가치 판정 없음). 그래서 이미 main 에 랜딩된 저가치 테스트 페이즈(705308 의 9·10·11)를 실행 전에
// 트림하지 못하고 하나씩 재실행하며 PR 을 찍어냈다. 정렬(작업 정렬)은 이미 무결(createdAt+DAG)이라
// 재발명 불필요 — 그 위에 얹을 **가치 판정 계층**이 이 seam 이다.
//
// 대표 지시: "조율자가 이 판단을 주도·히스토리안 맥락·에이전트 잘 활용." → 순수 시퀀서(결정론 골격)에
// LLM 판정 seam 을 주입(llm-conflict-merge 동형)·히스토리안 lineage 맥락(landed)을 프롬프트에 주입.
// 이 모듈은 **판정만**(집행=트림 마킹은 P4b 호출부). 트림은 보수적(애매하면 keep·false-trim 방지).

/** 판정. keep=유지 · trim-satisfied=이미 만족(랜딩/done)이라 실행 불필요 · trim-duplicate=다른 페이즈와
 *  중복 · merge=인접 페이즈와 병합(mergeInto 로). trim/merge 는 실행 전에만(랜딩된 산출물 무접촉). */
export type PhaseVerdictKind = 'keep' | 'trim-satisfied' | 'trim-duplicate' | 'merge';

/** 판정 대상 페이즈(최소 계약 — id/title/완료조건). */
export interface PhaseForNecessity {
  id: string;
  title: string;
  /** 완료 조건(acceptance) — 있으면 "이미 만족?" 판정 정밀도↑. */
  acceptance?: string;
}

/** 판정 맥락 — 히스토리안이 공급. goal=미션 의도, landed=이미 랜딩/done 된 산출물 요약(파일·기능·테스트). */
export interface NecessityContext {
  goal: string;
  /** 히스토리안 lineage: 이미 랜딩(main 머지)·이전 세대 done 된 산출물의 사람이 읽는 요약 목록. */
  landed: readonly string[];
}

export interface PhaseVerdict {
  phaseId: string;
  verdict: PhaseVerdictKind;
  reason: string;
  /** merge 시 병합 대상 phaseId(없으면 무시). */
  mergeInto?: string;
}

/** LLM 이 낸 원시 판정(파싱 전). 순수 시퀀서가 검증해 PhaseVerdict 로 정규화. */
export interface RawPhaseVerdict {
  phaseId: string;
  verdict: string;
  reason?: string;
  mergeInto?: string;
}

/** LLM 판정 seam(주입형·테스트 스텁) — 페이즈+맥락 → 원시 판정 배열. 기본=defaultNecessityResolve(luna). */
export type NecessityResolve = (
  phases: readonly PhaseForNecessity[],
  context: NecessityContext,
) => Promise<RawPhaseVerdict[]>;

const VALID_KINDS: ReadonlySet<string> = new Set<PhaseVerdictKind>(['keep', 'trim-satisfied', 'trim-duplicate', 'merge']);

/**
 * ★ 페이즈 가치/필요성 판정(순수 시퀀서·대표 2026-07-21). phases 각각에 대해 LLM(주입) 판정을 받아
 * 검증·정규화한다. **보수적**: 맥락(landed) 없음·판정 누락·유효하지 않은 verdict·병합 대상 부재는 전부
 * `keep` 으로 폴백(false-trim 방지 — 실행 전 잘못 지우면 골 손실). trim/merge 는 명시적·검증된 경우만.
 *
 * @param resolve LLM 어댑터(주입). 실 배선=defaultNecessityResolve.
 */
export async function assessPhaseNecessity(
  phases: readonly PhaseForNecessity[],
  context: NecessityContext,
  resolve: NecessityResolve,
): Promise<PhaseVerdict[]> {
  if (phases.length === 0) return [];
  const keepAll = (reason: string): PhaseVerdict[] =>
    phases.map((p) => ({ phaseId: p.id, verdict: 'keep' as const, reason }));

  // 맥락(이미 랜딩된 것) 없으면 트림 근거 없음 → 전부 keep(보수적·판정 스킵).
  if (context.landed.length === 0) return keepAll('랜딩 맥락 없음 — 트림 근거 없어 전부 유지(보수적)');

  let raw: RawPhaseVerdict[];
  try {
    raw = await resolve(phases, context);
  } catch {
    return keepAll('필요성 판정 LLM 실패 — 전부 유지(fail-soft·보수적)');
  }

  const byId = new Map<string, RawPhaseVerdict>();
  for (const r of raw) if (r && typeof r.phaseId === 'string' && !byId.has(r.phaseId)) byId.set(r.phaseId, r);
  const phaseIds = new Set(phases.map((p) => p.id));

  return phases.map((p): PhaseVerdict => {
    const r = byId.get(p.id);
    // 판정 누락 or 유효하지 않은 verdict → keep(보수적).
    if (!r || !VALID_KINDS.has(r.verdict)) {
      return { phaseId: p.id, verdict: 'keep', reason: r?.reason?.slice(0, 200) ?? '판정 누락 — 유지(보수적)' };
    }
    const kind = r.verdict as PhaseVerdictKind;
    const reason = (r.reason ?? '').slice(0, 200);
    // merge 는 유효한(존재·자기참조 아님) mergeInto 가 있어야 인정 — 없으면 keep(보수적).
    if (kind === 'merge') {
      if (!r.mergeInto || r.mergeInto === p.id || !phaseIds.has(r.mergeInto)) {
        return { phaseId: p.id, verdict: 'keep', reason: `merge 대상 무효(${r.mergeInto ?? '없음'}) — 유지(보수적)` };
      }
      return { phaseId: p.id, verdict: 'merge', reason, mergeInto: r.mergeInto };
    }
    return { phaseId: p.id, verdict: kind, reason };
  });
}

/** 트림/병합 대상만 추린다(집행부 편의·keep 제외). 순수. */
export function trimmablePhases(verdicts: readonly PhaseVerdict[]): PhaseVerdict[] {
  return verdicts.filter((v) => v.verdict !== 'keep');
}

/** ★ 조율자 필요성 판정 프롬프트(순수·테스트) — 히스토리안 맥락(landed) 주입·보수적 트림 지시.
 *  ASCII 마커 + 한글 설명(기존 프롬프트 관례). JSON 배열만 출력하도록 강제. */
export function phaseNecessityPrompt(phases: readonly PhaseForNecessity[], context: NecessityContext): string {
  const landedBlock = context.landed.map((l, i) => `  ${i + 1}. ${l}`).join('\n');
  const phaseBlock = phases
    .map((p) => `- id=${p.id} | ${p.title}${p.acceptance ? ` | 완료조건: ${p.acceptance}` : ''}`)
    .join('\n');
  return [
    '너는 미션 조율자다. 아래 "이미 랜딩/완료된 산출물"(히스토리안 제공) 위에서, 남은 페이즈들이',
    '**여전히 실행할 가치가 있는지** 판정하라. 목적: 이미 된 것을 다시 하지 않도록 실행 전 트림.',
    '',
    `미션 골: ${context.goal.slice(0, 300)}`,
    '',
    '이미 랜딩/완료(히스토리안):',
    landedBlock || '  (없음)',
    '',
    '판정할 남은 페이즈:',
    phaseBlock,
    '',
    '각 페이즈에 대해 판정:',
    '- keep           : 여전히 필요(랜딩된 것으로 충족되지 않음).',
    '- trim-satisfied : 이 페이즈의 산출물이 이미 랜딩/완료돼 실행 불필요.',
    '- trim-duplicate : 다른 남은 페이즈와 실질 중복.',
    '- merge          : 인접 페이즈와 합치는 게 나음(mergeInto=대상 페이즈 id 필수).',
    '',
    '원칙(중요): **보수적으로** 판정하라. 확실히 불필요/중복일 때만 trim/merge, 조금이라도 애매하면 keep.',
    '실행 전에 잘못 지우면 골이 손실된다. 저가치라도 랜딩 안 됐으면 keep.',
    '',
    '출력: 마커/설명 없이 **JSON 배열만**. 각 원소 = {"phaseId":"...","verdict":"keep|trim-satisfied|trim-duplicate|merge","reason":"한줄","mergeInto":"(merge 시만)"}',
  ].join('\n');
}

/** 실 LLM 판정 어댑터(streamLLM·luna 경량분류·대표 model tier). JSON 파싱·실패 시 빈 배열(호출부 keep 폴백). */
export async function defaultNecessityResolve(
  phases: readonly PhaseForNecessity[],
  context: NecessityContext,
): Promise<RawPhaseVerdict[]> {
  const { streamLLM } = await import('../llm.js');
  const { tierModel } = await import('../llm/model-defaults.js');
  const out = await streamLLM(
    [{ role: 'user', content: phaseNecessityPrompt(phases, context) }],
    () => {},
    { model: process.env.ELANOUS_NECESSITY_MODEL || tierModel('budget'), reasoningEffort: 'low' },
  );
  return parseNecessityJson(out);
}

/** LLM 출력에서 JSON 배열 추출·파싱(순수·테스트). 코드펜스/설명 제거. 실패 시 []. */
export function parseNecessityJson(out: string): RawPhaseVerdict[] {
  const stripped = out.replace(/^```[\w.-]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const arr = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        phaseId: String(x.phaseId ?? ''),
        verdict: String(x.verdict ?? ''),
        ...(typeof x.reason === 'string' ? { reason: x.reason } : {}),
        ...(typeof x.mergeInto === 'string' ? { mergeInto: x.mergeInto } : {}),
      }))
      .filter((x) => x.phaseId);
  } catch {
    return [];
  }
}
