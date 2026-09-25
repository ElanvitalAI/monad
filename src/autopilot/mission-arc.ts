// ── 미션 아크 — 순수 헬퍼 (RFC-mission-arcs-2026-07-14·A1) ────────────────────
//
// 골→아크(응집 서브골)→페이즈 계층의 토대. A1 은 스키마 + 순수 해석 함수만(무행동변경·회귀 0).
// A2(아크 배리어·통합 acceptance)·A3(페이즈 병렬)·A4(아크 메모리)가 이 위에 선다.
//
// ★ 하위호환 핵심: arcs 없는 flat 미션은 "암묵적 단일 아크"로 해석한다. executor 는 항상
//   resolveArcs() 를 거치므로 flat/multi 를 균일하게 다룬다(flat 미션 회귀 0).

import type { MissionArc, MissionRelationLink } from '../task-orchestrator/mission.js';

/** arcId 생성 — arc_<slug>_<idx>. slug 는 name 에서(한글/특수문자 제거·소문자). */
export function mintArcId(name: string, idx: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'arc';
  return `arc_${slug}_${idx}`;
}

/**
 * 아크 해석 — 명시 아크가 있으면 그대로, 없으면(flat) 전 페이즈를 담은 암묵적 단일 아크 1개.
 * executor·메모리·검증이 전부 이걸 거쳐 flat/multi 를 균일하게 다룬다.
 */
export function resolveArcs(
  arcs: readonly MissionArc[] | undefined,
  allPhaseIds: readonly string[],
): MissionArc[] {
  if (arcs && arcs.length > 0) return arcs.map((a) => ({ ...a }));
  // flat → 암묵적 단일 아크(전 페이즈·의존 없음·통합 acceptance 없음=페이즈 로컬만).
  return [{
    arcId: 'arc_default_0',
    name: '(단일 아크)',
    intent: 'flat 미션 — 전 페이즈를 단일 아크로 순회(하위호환).',
    phaseIds: [...allPhaseIds],
    dependsOnArcs: [],
    acceptance: [],
    status: 'pending',
  }];
}

/** 미션이 flat(명시 아크 없음)인가 — 암묵적 1아크로 도는가. */
export function isFlatMission(arcs: readonly MissionArc[] | undefined): boolean {
  return !arcs || arcs.length === 0;
}

/** 페이즈가 속한 아크 — 없으면 null. */
export function arcForPhase(arcs: readonly MissionArc[], phaseId: string): MissionArc | null {
  return arcs.find((a) => a.phaseIds.includes(phaseId)) ?? null;
}

/**
 * ★ C3(문맥관리 트랙·2026-07-19) — 페이즈가 속한 아크의 통합 의도+acceptance 를 walker RUN 프롬프트 블록으로.
 * 순수·테스트가능(store 조회는 caller). flat(단일 암묵 아크)/미매칭이면 빈 문자열(무주입). walker 가 자기 아크의
 * 통합 intent 를 알고 실행하게 해 국소 최적화가 아크 전체 의도를 벗어나지 않게 한다.
 */
export function formatArcContextForPhase(arcs: readonly MissionArc[] | undefined, phaseId: string): string {
  if (!arcs || isFlatMission(arcs)) return '';
  const arc = arcForPhase(arcs, phaseId);
  if (!arc) return '';
  const acc = arc.acceptance.length ? `\n- 아크 통합 acceptance: ${arc.acceptance.join(' · ')}` : '';
  return `\n\n[아크 컨텍스트] 이 페이즈는 아크 '${arc.name}'에 속한다.\n- 아크 통합 의도: ${arc.intent}${acc}\n이 페이즈의 작업이 아크 전체 의도와 정합하도록 하라(국소 최적화가 아크 intent 를 벗어나지 않게).`;
}

/**
 * ★ C2(문맥관리 트랙·2026-07-19) — 아크 경계 핸드오프. 이 페이즈가 새 아크의 **첫 페이즈**이고 선행 아크가
 * 있으면, 선행 아크들의 name+intent+완주 요약(verifyResult.evidence·없으면 status)을 핸드오프 블록으로.
 * 아크 배리어 통과 후 다음 아크 walker 가 "직전 아크가 무엇을 완수했는지"를 알고 이어가게(재구현 방지).
 * 순수·테스트가능(store 조회는 caller). 첫 페이즈 아님/선행 없음/flat 이면 빈 문자열. 기존 데이터만 사용(non-LLM).
 */
export function formatArcHandoffForPhase(arcs: readonly MissionArc[] | undefined, phaseId: string): string {
  if (!arcs || isFlatMission(arcs)) return '';
  const arc = arcForPhase(arcs, phaseId);
  if (!arc || arc.phaseIds[0] !== phaseId || arc.dependsOnArcs.length === 0) return '';
  const byId = new Map(arcs.map((a) => [a.arcId, a]));
  const lines = arc.dependsOnArcs
    .map((id) => byId.get(id))
    .filter((a): a is MissionArc => a != null)
    .map((prev) => {
      const done = prev.verifyResult?.evidence?.trim() || `상태: ${prev.status}`;
      return `- '${prev.name}' (의도: ${prev.intent}) → ${done}`;
    });
  if (lines.length === 0) return '';
  return `\n\n[아크 핸드오프] 이 페이즈는 새 아크 '${arc.name}'의 시작이다. 선행 아크 완료 요약:\n${lines.join('\n')}\n선행 아크의 산출물 위에서 이어가라(이미 완료된 것을 재구현하지 말 것).`;
}

/** 페이즈의 아크 id — flat(명시 아크 없음)이면 undefined(A4 워킹메모리 태깅용·순수). */
export function arcIdForPhase(missionArcs: readonly MissionArc[] | undefined, phaseId: string): string | undefined {
  if (isFlatMission(missionArcs)) return undefined;
  return arcForPhase(missionArcs!, phaseId)?.arcId;
}

/** 아크가 "해소됨"(완주를 막지 않음) — done 또는 descoped(범위 제외·2026-07-15). 배리어·완주 판정 공용. */
export function isArcResolved(status: MissionArc['status']): boolean {
  return status === 'done' || status === 'descoped';
}

/**
 * ★ 외부 수습 아크 해소(external·대표 2026-07-16) — 외부 도구/대표가 아크의 통합을 미션 밖에서
 * 완성했을 때(예: 글루를 main 에 직접 머지) 그 아크를 done+verified 로 정식 처리한다. 아크 검증기는
 * 미션 브랜치/worktree 를 grounding 하므로 external main-merge 를 못 봐 영원히 verifying·FAIL 로
 * 남는다 — L3 "외부개정 존중"의 아크판(페이즈 inject 의 대칭). 외부 근거를 verifyResult.evidence 에
 * 남겨 "왜 external 통과인지"를 정직히 기록한다(Goodhart 아님 — 실제 완성한 것의 운영자 확인).
 * arcRef = arcId · 정확한 name · name 부분일치 · 순번 index. 순수(배열 반환)·매칭 실패=null.
 */
export function resolveArcExternal(
  arcs: readonly MissionArc[], arcRef: string, evidence: string,
): { arcs: MissionArc[]; resolved: MissionArc | null } {
  const ref = arcRef.trim();
  let target: MissionArc | null =
    arcs.find((a) => a.arcId === ref) ??
    arcs.find((a) => a.name === ref) ??
    (/^\d+$/.test(ref) && Number(ref) < arcs.length ? arcs[Number(ref)]! : null) ??
    arcs.find((a) => a.name.includes(ref)) ?? null;
  if (!target) return { arcs: arcs.map((a) => ({ ...a })), resolved: null };
  const t = target;
  return {
    arcs: arcs.map((a) => a.arcId === t.arcId
      ? { ...a, status: 'done' as const, verifyResult: { ok: true, evidence: evidence.slice(0, 500) } }
      : { ...a }),
    resolved: t,
  };
}

/**
 * 다음 실행 가능 아크(순차 배리어) — 선행 아크(dependsOnArcs)가 전부 해소(done/descoped)이고 아직 미완인
 * 아크들. 반환 순서 = 선언 순(topo 안정). 아크 간 병렬은 하지 않으므로 호출측이 첫 1개만 써도 됨(대표 결정).
 */
export function nextRunnableArcs(arcs: readonly MissionArc[]): MissionArc[] {
  const resolvedIds = new Set(arcs.filter((a) => isArcResolved(a.status)).map((a) => a.arcId));
  return arcs.filter(
    (a) => !isArcResolved(a.status) && a.status !== 'failed' && a.dependsOnArcs.every((d) => resolvedIds.has(d)),
  );
}

/**
 * ★ 과분할 구조 가드(RFC §14b·A7-L1·2026-07-14) — 단편화된 1-페이즈 사슬을 응집 아크로 흡수.
 * 대표 지시("불필요하게 아크를 부풀려 나누는 것 방지"). **보수적**: 아크 B(1-페이즈·단일 선행)를
 * 그 선행 A 로 흡수하되 **A 도 1-페이즈일 때만**(둘 다 1-페이즈 = 단편화 신호). `[관측(2ph)→집행(1ph)]`
 * 같은 정당한 소deliverable 경계는 건드리지 않는다(A 가 2+페이즈면 흡수 안 함). 흡수 시 B 의 acceptance·
 * 의존 재배선을 보존. fixpoint 반복. 순수 — 새 배열 반환.
 */
export function mergeTrivialArcChains(arcs: readonly MissionArc[]): MissionArc[] {
  // 작업용 mutable 사본(MissionArc 의 배열 필드는 readonly — 병합을 위해 가변 배열로).
  type MutArc = Omit<MissionArc, 'phaseIds' | 'dependsOnArcs' | 'acceptance'>
    & { phaseIds: string[]; dependsOnArcs: string[]; acceptance: string[] };
  const cur: MutArc[] = arcs.map((a) => ({
    ...a, phaseIds: [...a.phaseIds], dependsOnArcs: [...a.dependsOnArcs], acceptance: [...a.acceptance],
  }));
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of cur) {
      if (b.phaseIds.length !== 1 || b.dependsOnArcs.length !== 1) continue;
      const a = cur.find((x) => x.arcId === b.dependsOnArcs[0]);
      if (!a || a.arcId === b.arcId || a.phaseIds.length !== 1) continue; // 둘 다 1-페이즈일 때만.
      // B 를 A 로 흡수 — 페이즈·acceptance 병합.
      a.phaseIds.push(...b.phaseIds);
      for (const acc of b.acceptance) if (!a.acceptance.includes(acc)) a.acceptance.push(acc);
      a.acceptance = a.acceptance.slice(0, 5);
      // B 를 의존하던 아크들 → A 로 재배선(중복·자기참조 제거).
      for (const c of cur) {
        if (c.arcId === b.arcId || c.arcId === a.arcId) continue;
        if (c.dependsOnArcs.includes(b.arcId)) {
          c.dependsOnArcs = [...new Set(c.dependsOnArcs.map((d) => (d === b.arcId ? a.arcId : d)))].filter((d) => d !== c.arcId);
        }
      }
      const idx = cur.findIndex((x) => x.arcId === b.arcId);
      cur.splice(idx, 1);
      changed = true;
      break; // fixpoint 재시작.
    }
  }
  return cur;
}

/** 아크 순환 의존 감지(설계 검증용) — dependsOnArcs 에 사이클이 있으면 true. */
export function hasArcCycle(arcs: readonly MissionArc[]): boolean {
  const byId = new Map(arcs.map((a) => [a.arcId, a]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=미방문·1=방문중·2=완료
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true; // 사이클
    if (s === 2) return false;
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOnArcs ?? []) {
      if (byId.has(d) && visit(d)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return arcs.some((a) => visit(a.arcId));
}

/** 전 아크 해소(done 또는 descoped)인가 — 미션 아크 완주 판정. descoped(범위 제외)는 완주를 막지 않는다. */
export function allArcsDone(arcs: readonly MissionArc[]): boolean {
  return arcs.length > 0 && arcs.every((a) => isArcResolved(a.status));
}

/**
 * ★ 결정론 아크 파생(#4498 3A·ANS 축A·2026-07-17) — classifyArcs 의 LLM 그룹핑이 없거나 실패해도,
 * 대표가 확정한 arcHint(아크 수)를 존중해 페이즈를 contiguous 그룹으로 나눈다(배열=위상 순서 근사).
 * 각 아크는 순차 배리어(linear dependsOn chain). 과계층화 6캡·1-페이즈 사슬 병합·사이클 검증 재사용.
 * 병합 후 2아크 미만이면 [](single·flat 폴백). 순수·결정론(LLM 무관) — "arcHint=5 인데 arcs=0" 갭 수복.
 */
export function deriveArcGroups(
  phases: readonly { id: string; title: string }[],
  arcHint: number,
): MissionArc[] {
  const k = Math.min(6, Math.max(2, Math.floor(arcHint)));
  if (arcHint < 2 || phases.length < k) return []; // 나눌 수 없음(과계층화 방지)
  const base = Math.floor(phases.length / k);
  const rem = phases.length % k; // 앞 rem 그룹이 base+1 (균등 분할)
  const arcs: MissionArc[] = [];
  let idx = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < rem ? 1 : 0);
    const slice = phases.slice(idx, idx + size);
    idx += size;
    if (slice.length === 0) continue;
    const name = (slice[0]!.title || `아크 ${i + 1}`).slice(0, 60);
    arcs.push({
      arcId: mintArcId(name, i),
      name,
      intent: `결정론 파생 아크(arcHint ${arcHint}·페이즈 ${idx - size + 1}~${idx}).`,
      phaseIds: slice.map((p) => p.id),
      dependsOnArcs: i > 0 ? [arcs[i - 1]!.arcId] : [],
      acceptance: [],
      status: 'pending',
    });
  }
  // 1-페이즈 사슬 흡수 후 2아크 미만/사이클이면 single(flat) 폴백.
  const merged = mergeTrivialArcChains(arcs);
  if (merged.length < 2 || hasArcCycle(merged)) return [];
  return merged;
}

/**
 * arc-aware split(2026-07-14) — split 등이 페이즈 P 를 서브페이즈로 재분해할 때, P 를 담은 아크의
 * phaseIds 에서 P 를 서브페이즈 ids 로 치환한다(순수·같은 위치 삽입). 아크 도입 前 split 이 arcs 를
 * 안 건드려 ①사라진 P 를 dangling 참조(arc 완성 조건 phaseIds.every(done) 영영 false → 하류 배리어
 * 영구 블록) ②서브페이즈 arc-less(아크 통합검증 미발동)가 되던 것을 수복. 어느 아크에도 없으면(flat)
 * 원본 그대로 반환(회귀 0). 라이브 실증: a6230f arc0 이 split 후 dangling + 서브페이즈 arc-less.
 */
export function replaceArcPhase(
  arcs: readonly MissionArc[] | undefined,
  oldPhaseId: string,
  newPhaseIds: readonly string[],
): readonly MissionArc[] | undefined {
  if (!arcs?.length) return arcs;
  let changed = false;
  const out = arcs.map((a) => {
    const idx = a.phaseIds.indexOf(oldPhaseId);
    if (idx < 0) return a;
    changed = true;
    const merged = [...a.phaseIds.slice(0, idx), ...newPhaseIds, ...a.phaseIds.slice(idx + 1)];
    return { ...a, phaseIds: [...new Set(merged)] };  // 순서 유지·중복 방어
  });
  return changed ? out : arcs;
}

// ── 아크 구조 편집 (E2·E3 · PLAN-arc-phase-lifecycle-editing-2026-07-15) ──────
//
// 아크를 read-only 에서 편집 가능 계층으로. 대표 지시: "아크 사이즈 오판 → 아크를 중간에 껴서
// 늘려야". 순수 헬퍼(store 배선은 mission-lifecycle/CLI). 편집 후 hasArcCycle 로 무결성 검증 권장.

/** 기존 아크와 충돌하지 않는 새 arcId 발급 — 최대 수치 suffix+1(위치 아닌 유일성 보장). */
export function mintUniqueArcId(arcs: readonly MissionArc[], name: string): string {
  const maxIdx = arcs.reduce((mx, a) => {
    const m = /_(\d+)$/.exec(a.arcId);
    return m ? Math.max(mx, Number(m[1])) : mx;
  }, -1);
  return mintArcId(name, maxIdx + 1);
}

/**
 * 아크 중간 삽입(E2) — `afterArcId` 바로 뒤에 `newArc` 를 끼운다(배열 위치 + 배리어 재배선).
 * 시맨틱: A 뒤에 B 삽입 → A→B→(기존 A 후속들). B.dependsOnArcs=[A], A 를 의존하던 아크는 B 를 의존
 * 하도록 재배선(B 가 A 와 후속 사이의 배리어). afterArcId 미존재면 원본 그대로 반환(회귀 0). 순수.
 * newArc 의 arcId 는 호출측이 mintUniqueArcId 로 발급(충돌 방지). 기존 arcId 는 재발급 안 함(참조 안정).
 */
export function insertArc(
  arcs: readonly MissionArc[],
  afterArcId: string,
  newArc: MissionArc,
): MissionArc[] {
  const idx = arcs.findIndex((a) => a.arcId === afterArcId);
  if (idx < 0) return arcs.map((a) => ({ ...a })); // 앵커 없음 — 무변경.
  // A 를 의존하던 아크 → B 의존으로 재배선(B 가 A 뒤 배리어). B 자신은 제외.
  const rewired = arcs.map((a) => {
    if (a.arcId === newArc.arcId) return { ...a };
    if (a.dependsOnArcs.includes(afterArcId)) {
      return { ...a, dependsOnArcs: [...new Set(a.dependsOnArcs.map((d) => (d === afterArcId ? newArc.arcId : d)))] };
    }
    return { ...a };
  });
  const inserted: MissionArc = { ...newArc, dependsOnArcs: [afterArcId] };
  return [...rewired.slice(0, idx + 1), inserted, ...rewired.slice(idx + 1)];
}

/**
 * 아크 순서 재배치(E3) — `arcId` 아크를 배열 위치 `newIdx` 로 이동한다(표시 순번=핸들 A<ord> 갱신).
 * dependsOnArcs(배리어 위상)는 건드리지 않는다 — 위치는 표시/핸들용, 실행 순서는 의존 그래프가 진실.
 * 이동 후 위상이 배열 순서와 어긋나면(선행이 뒤로) 호출측이 hasArcCycle/위상 검증. 순수·범위 clamp.
 */
export function reorderArc(
  arcs: readonly MissionArc[],
  arcId: string,
  newIdx: number,
): MissionArc[] {
  const from = arcs.findIndex((a) => a.arcId === arcId);
  if (from < 0) return arcs.map((a) => ({ ...a }));
  const clamped = Math.max(0, Math.min(newIdx, arcs.length - 1));
  const out = arcs.map((a) => ({ ...a }));
  const [moved] = out.splice(from, 1);
  out.splice(clamped, 0, moved!);
  return out;
}

// ── 연관 미션(RFC §9) 순수 헬퍼 ───────────────────────────────────────────────

/** 연관 링크 추가(중복 id+relation 은 병합·note 갱신). 순수 — 새 배열 반환. */
export function upsertRelationLink(
  links: readonly MissionRelationLink[] | undefined,
  add: MissionRelationLink,
): MissionRelationLink[] {
  const base = (links ?? []).filter((l) => !(l.id === add.id && l.relation === add.relation));
  return [...base, add];
}

/** 연관 링크 제거. 순수. */
export function removeRelationLink(
  links: readonly MissionRelationLink[] | undefined,
  id: string,
  relation?: MissionRelationLink['relation'],
): MissionRelationLink[] {
  return (links ?? []).filter((l) => (relation ? !(l.id === id && l.relation === relation) : l.id !== id));
}
