// ── Mission RFC/DESIGN 저작 (R1 · RFC-plan-as-rfc-generation-2026-07-22) ──────
//
import { debug } from '../debug/log.js';
import { resolveDefaultProvider, streamLLM } from '../llm.js';
import { tierCall, tierModel } from '../llm/model-defaults.js';

// "플랜 = RFC/설계문서 생성" 재프레임의 R1 substrate. discovery(골 + 내부 grounding +
// 외부 research + Intake 인터뷰 답변) 재료를 house 포맷 RFC/DESIGN 문서로 저작한다.
// 산출은 실행 태스크가 아니라 **markdown 문서** — 그 설계 섹션이 아크, 작업항목이 페이즈가
// 된다(R2 추출·gradeArcConformance 정합). 크기·경계를 RFC가 사전 확정해 재분해 소동의 근원
// (설계 부재)을 제거한다.
//
// 설계: 내부 문서 `RFC-plan-as-rfc-generation-2026-07-22` §2·§6(R1).
// 골격 재사용: LLM resolve 주입(mission-heal-triage 동형)·기존 코딩 decompose 경로 무접촉.
// opt-in: autopilot.planAsRfc(기본 OFF·무회귀). 순수 함수(프롬프트/파서)라 LLM 없이 단위 검증.

/** 저작 입력 — discovery 산출 재료. 전부 옵션(있는 것만 프롬프트에 실림). */
export interface RfcAuthorContext {
  goal: string;
  /** 내부 코드 조사(grounding — codeFacts/files 요지). */
  groundingContext?: string;
  /** 외부 조사(research) 요지. */
  researchContext?: string;
  /** Intake 인터뷰(되묻기) 확정 답변 — RFC 갭을 채운 결정. */
  clarifyAnswers?: string;
  /** 도메인 라벨(coding/investment/business) — 어투 힌트. */
  domainLabel?: string;
  /** R3 amend 모드 — 기존 RFC markdown. 있으면 전면 재작성 대신 정정 지시 반영 수정(재분해=RFC 수정). */
  priorRfc?: string;
  /** R3 amend 사유 — 실패/정정 지시(재분해 트리거). priorRfc 와 함께 amend 모드. */
  reviseReason?: string;
}

/** RFC 작업항목 = 페이즈 후보(R2 추출). */
export interface RfcWorkItem {
  /** 짧은 페이즈명(≤80·명령형). 파싱 시 title/detail 분리·구형 "제목 — 상세" 폴백. */
  title: string;
  /** 구체 산출물·완료계약(길어도 됨) — description 으로 합류. 없으면 빈 문자열. */
  detail?: string;
}
/** RFC 설계 섹션 = 아크 후보(R2 추출). */
export interface RfcArc {
  heading: string;
  workItems: RfcWorkItem[];
}
/** 저작·파싱 결과. */
export interface AuthoredRfc {
  markdown: string;
  title: string;
  /** 구조화 작업분해 블록에서 파싱한 아크/페이즈(R2 추출 타깃). */
  arcs: RfcArc[];
  /** #2 iterative 인터뷰 — RFC 가 확신 있게 못 정한 설계 결정(열린 질문). 있으면 재-clarify 로 재개입
   *  (1회성 아님). 확실하면 빈 배열. RFC-plan-as-rfc-generation flow(대표 2026-07-22). */
  openQuestions: string[];
}

/** RFC 저작 LLM resolver — primary failure 때 별 endpoint의 fallback으로 즉시 재시도한다.
 *
 * ⛔⭐⭐ 2026-09-23 — ***모델 «이름»을 여기 박지 않는다.*** 종전엔 두 줄이 이랬다:
 *     `process.env.MONAD_RFC_MODEL` 이 없으면 ***codex 심층 모델 이름을 문자열로*** 폴백,
 *     `MONAD_RFC_FALLBACK_MODEL` 이 없으면 ***opus 4-8 을 문자열로*** 폴백.
 *   `llm/model-defaults.ts` 의 머리말이 ***그 모양을 예시로 들어*** 없애려던 것이고,
 *   회귀 가드(`model-defaults.test.ts`)가 이 파일을 위반으로 세고 있었다.
 *   ⚠️ ***그 가드는 주석도 센다*** — 그래서 여기 옛 문자열을 «그대로 인용하지 않는다».
 *     (자기 위반을 다시 만들지 않으려고 «말로» 적었다. 가드의 알려진 한계이기도 하다.)
 *   🩸 그리고 실제로 늙었다 — 사다리가 GPT-6 으로 옮긴 뒤에도 여기만 `gpt-5.6-sol` 이었고,
 *     `claude-opus-4-8` 은 별칭 감사가 ***stale*** 로 판정한 값이다(권장 `claude-opus-5`).
 *
 * ⭐ RFC 저작은 «무거운 저작»이므로 `best` 티어다 — `planning` 역할과 같은 칸.
 *   ⊕ `reasoningEffort` 도 박지 않는다. 그 티어가 «자기 강도»를 같이 낸다(`tierCall`).
 * ⛔ 폴백이 ***다른 provider***인 것은 의도다 — *"별 endpoint"* 가 이 함수의 목적이다.
 *   그래서 폴백만 `anthropic` 을 «명시»하고, 그 안에서 모델은 역시 사다리가 고른다. */
export function createRfcResolver(missionId = 'harness-plan'): (prompt: string) => Promise<string> {
  const primary = tierCall('best');
  // ⚠️ 티어의 `reasoningLevel` 은 `'off'` 를 포함하지만 `streamLLM` 의 effort 는 안 받는다.
  //   ⛔ 'off' 를 «high 로 승격»하지 않는다 — 그건 티어의 뜻을 뒤집는 것이다. undefined 로 넘겨
  //     모델 기본을 쓰게 한다(그게 「강도를 지정하지 않음」의 정확한 표현이다).
  const rfcEffort = primary.reasoningEffort && primary.reasoningEffort !== 'off'
    ? primary.reasoningEffort
    : undefined;
  const rfcPrimary = process.env.MONAD_RFC_MODEL || primary.model;
  const rfcFallback = process.env.MONAD_RFC_FALLBACK_MODEL || tierModel('best', 'anthropic');
  return async (prompt: string): Promise<string> => {
    try {
      return await streamLLM([{ role: 'user', content: prompt }], () => {}, { model: rfcPrimary, reasoningEffort: rfcEffort });
    } catch (error) {
      const provider = resolveDefaultProvider(rfcFallback);
      try { debug.log('mission.rfc', 'author-fallback', { missionId, from: rfcPrimary, to: rfcFallback, error: error instanceof Error ? error.message.slice(0, 120) : String(error) }); } catch { /* fail-soft */ }
      return await streamLLM([{ role: 'user', content: prompt }], () => {}, { model: rfcFallback, reasoningEffort: 'high', ...(provider ? { provider } : {}) });
    }
  };
}

/** 저작 프롬프트 — house 포맷 산문 + 파싱 가능한 구조화 작업분해 블록.
 *  순수 함수(테스트 가능). 어느 재료가 있으면 그것만 포함(조건부). */
export function buildRfcAuthorPrompt(ctx: RfcAuthorContext): string {
  const lines: string[] = [];
  lines.push(`너는 monad 미션의 설계자다. 아래 골과 조사 재료로 **RFC/DESIGN 문서**를 저작하라.`);
  lines.push(`목적: 이 설계문서에서 아크(설계 섹션)와 페이즈(작업항목)가 자연히 파생되고, 문서 자체가`);
  lines.push(`빌드 단계에 전달되는 **설계 계약**이 된다. 크기·경계를 여기서 확정해 이후 재분해가 없게 하라.`);
  lines.push('');
  lines.push(`## 골`);
  lines.push(ctx.goal);
  if (ctx.domainLabel) { lines.push(''); lines.push(`도메인: ${ctx.domainLabel}`); }
  // R3 amend 모드 — 재분해 = RFC 수정(전면 재작성 아님). 실패/정정 교훈을 반영해 최소 수정.
  if (ctx.priorRfc?.trim()) {
    lines.push(''); lines.push(`## ★ 기존 RFC (수정 대상 — 전면 재작성 금지·최소 정정)`);
    lines.push(ctx.priorRfc.trim().slice(0, 5000));
    if (ctx.reviseReason?.trim()) {
      lines.push(''); lines.push(`## ★ 정정 지시(재분해 사유 — 반드시 반영)`);
      lines.push(ctx.reviseReason.trim().slice(0, 800));
    }
    lines.push(''); lines.push(`위 기존 RFC 를 정정 지시만큼 **수정**하라 — 유효한 설계·작업항목은 유지하고 지적된 부분만 고친다.`);
  }
  if (ctx.groundingContext?.trim()) {
    lines.push(''); lines.push(`## 내부 조사(grounding — 이미 제공됨·재조사 금지)`);
    lines.push(ctx.groundingContext.trim().slice(0, 4000));
  }
  if (ctx.researchContext?.trim()) {
    lines.push(''); lines.push(`## 외부 조사(research)`);
    lines.push(ctx.researchContext.trim().slice(0, 3000));
  }
  if (ctx.clarifyAnswers?.trim()) {
    lines.push(''); lines.push(`## 확정 설계(인터뷰 답변 — 반드시 반영)`);
    lines.push(ctx.clarifyAnswers.trim().slice(0, 2000));
  }
  lines.push('');
  lines.push(`## 저작 규칙`);
  lines.push(`1. house 포맷 산문 섹션: "## 0. 왜(근거)", "## 1. 목표", "## 2. 설계", "## 3. 무회귀·안전".`);
  lines.push(`2. 설계는 **기존 심볼·파일 재사용을 명시**하고 새 엔진/직렬화기 재발명 금지. grounding 재료 위에서`);
  lines.push(`   재조사 없이 설계로 직행하라(historian 이 공급한 재료 활용).`);
  lines.push(`3. 제약·불변식 존중(매매/arming/safety/재부팅 등 불변 코어 무접촉).`);
  lines.push(`4. **"## 2. 설계" 섹션 바로 뒤에** 파싱용 구조화 작업분해 블록을 아래 정확한 형식으로 출력하라`);
  lines.push(`   (이 블록에서 아크/페이즈가 추출된다·산문 설계와 작업분해가 인접해 사람이 읽기 쉽다). 한 아크 =`);
  lines.push(`   응집된 설계 단위, 한 작업항목 = 한 번의 에이전트 실행으로 완주 가능한 단일책임 페이즈.`);
  lines.push(`   승인요청/HITL 페이즈 금지. 자동 게이트로 충분하면 검증 페이즈 별도 생성 금지.`);
  lines.push(`   각 페이즈는 **title(짧은 페이즈명·명령형·60자 이내·절대 80자 초과 금지)** 과 **detail(구체 산출물·`);
  lines.push(`   완료계약·길어도 됨)** 을 **별도 필드로 분리**하라. title 에 "—" 로 설명을 이어붙이지 말 것.`);
  lines.push('');
  lines.push(`\`\`\`work-breakdown`);
  lines.push(`### 아크 1: <설계 단위 제목>`);
  lines.push(`- title: <짧은 페이즈명 · 60자 이내>`);
  lines.push(`  detail: <구체 산출물·완료계약>`);
  lines.push(`- title: <짧은 페이즈명>`);
  lines.push(`  detail: <구체 산출물·완료계약>`);
  lines.push(`### 아크 2: <설계 단위 제목>`);
  lines.push(`- title: <짧은 페이즈명>`);
  lines.push(`  detail: <구체 산출물·완료계약>`);
  lines.push(`\`\`\``);
  lines.push('');
  lines.push(`5. **불확실성이 남으면** — 설계를 확신 있게 못 정하는 결정(범위 경계·구조 선택·제약)이 있으면`);
  lines.push(`   아래 블록에 열거하라(추측으로 채우지 말고 사람에게 되물을 것). 확실하면 이 블록 생략.`);
  lines.push(`\`\`\`open-questions`);
  lines.push(`- <불확실한 설계 결정 1 — 무엇을 정해야 하나>`);
  lines.push(`\`\`\``);
  lines.push('');
  lines.push(`문서 제목은 첫 줄에 "# RFC — <요지>" 로 시작하라. ASCII·한글 혼용 가능.`);
  return lines.join('\n');
}

/** 작업항목 라인 → {title, detail}. 순수. 신규 "title: <제목>" 프리픽스 제거 + 구형 "제목 — 상세"
 *  (공백 감싼 —·–·- 구분자) 분리 폴백 + title 80자 캡(Task.title 한도 무회귀 안전망·초과 throw 근절). */
export function splitWorkItem(raw: string): { title: string; detail?: string } {
  let s = raw.replace(/^title\s*[:：]\s*/i, '').trim();
  let detail: string | undefined;
  const m = s.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (m) { s = m[1]!.trim(); detail = m[2]!.trim(); }
  const title = s.slice(0, 80).trim();
  return detail ? { title, detail } : { title };
}

/** 저작된 RFC markdown 에서 제목 + 구조화 작업분해 블록(아크/페이즈) 파싱. 순수 함수.
 *  work-breakdown 펜스가 없으면(레거시/자유형) 최상위 "### 아크 N:" 헤딩을 문서 전체에서 탐색 폴백. */
export function parseAuthoredRfc(markdown: string): AuthoredRfc {
  const md = markdown ?? '';
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1]!.trim() : 'RFC (untitled)';

  // work-breakdown 펜스 우선, 없으면 전체에서 탐색.
  const fence = md.match(/```work-breakdown\s*([\s\S]*?)```/);
  const scope = fence ? fence[1]! : md;

  const arcs: RfcArc[] = [];
  let current: RfcArc | undefined;
  for (const rawLine of scope.split('\n')) {
    const line = rawLine.trim();
    const arcMatch = line.match(/^###\s+아크\s*\d*\s*[:：]?\s*(.+)$/);
    if (arcMatch) {
      current = { heading: arcMatch[1]!.trim(), workItems: [] };
      arcs.push(current);
      continue;
    }
    // 신규 형식 — "  detail: <상세>" 는 직전 작업항목의 detail 필드에 합류(제목/상세 분리·80자 초과 근절).
    const detailMatch = line.match(/^(?:[-*]\s*)?detail\s*[:：]\s*(.+)$/i);
    if (detailMatch && current?.workItems.length) {
      const last = current.workItems[current.workItems.length - 1]!;
      last.detail = detailMatch[1]!.trim();
      continue;
    }
    // 작업항목: "- title: X" / "- [ ] title" / "- [x] title" / "- title" / "1. title"
    const itemMatch = line.match(/^(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+\.\s+)(.+)$/);
    if (itemMatch && current) {
      const raw = itemMatch[1]!.trim();
      if (!raw) continue;
      const { title, detail } = splitWorkItem(raw);
      if (title) current.workItems.push(detail ? { title, detail } : { title });
    }
  }
  // #2 — open-questions 블록(불확실 설계 결정) 파싱. 없으면 빈 배열(확실).
  const oqFence = md.match(/```open-questions\s*([\s\S]*?)```/);
  const openQuestions: string[] = [];
  if (oqFence) {
    for (const raw of oqFence[1]!.split('\n')) {
      const m = raw.trim().match(/^(?:[-*]\s*|\d+\.\s+)(.+)$/);
      const q = m?.[1]?.trim();
      // 플레이스홀더(예시 텍스트) 제외 — 실제 질문만.
      if (q && !/^<.*>$/.test(q) && !/불확실한 설계 결정 \d/.test(q)) openQuestions.push(q);
    }
  }
  return { markdown: md, title, arcs: arcs.filter((a) => a.workItems.length > 0), openQuestions };
}

/** RFC 저작 — 프롬프트 저작 → LLM(주입 resolve) → 파싱. resolve 는 호출측이 streamLLM 등으로 주입
 *  (mission-heal-triage 동형). fail-soft: 파싱 결과 아크 0 이면 호출측이 폴백 판단(무회귀). */
export async function authorMissionRfc(
  ctx: RfcAuthorContext,
  resolve: (prompt: string) => Promise<string>,
): Promise<AuthoredRfc> {
  const text = await resolve(buildRfcAuthorPrompt(ctx));
  return parseAuthoredRfc(text);
}
