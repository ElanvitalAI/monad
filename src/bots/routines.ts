/**
 * ⏰ **「무엇이 언제 · «어느 기계에서» 도나」를 채팅에서 본다.**
 *
 * ⭐⭐ 이 파일이 있는 «진짜» 이유는 목록이 아니다 — ***북극성을 «보이게»*** 하는 것이다:
 *    이 축의 북극성은 「봇이 도나」가 아니라 ***「맥이 «꺼져도» 도나」***이고,
 *    지금 답은 「맥」이다. ⇒ 봇은 VM 에 «살고» 시계만 맥에 «있다».
 *    그 간극은 crontab 두 개를 나란히 놓기 «전»에는 사람 눈에 «안 보인다».
 *
 * ⛔ 「모르는 줄」을 조용히 «버리지» 않는다 — 세어서 말한다(안 세면 목록이 «거짓 완전»이 된다).
 * ⛔ 「VM 에 0개」와 「VM 을 «못 물었다»」를 «다른 값»으로 낸다.
 * 🧭 묶임 선언(`binding-intent`): ***«호스트»에 묶인다*** — crontab 은 「이 기계가 무엇을 예약했나」다.
 *    시간창·우주·상한을 쓰지 않는다(쓸 자리가 없다).
 */

export interface CronJob {
  /** 사람이 읽는 이름. */
  readonly label: string;
  /** 봇 루틴이면 그 봇. */
  readonly personaId?: string;
  /** 사람이 읽는 예약 — `07:50 매일` · `매 6시간 :05` · `월 06:00`. */
  readonly when: string;
  /** crontab에서 읽은 원시 다섯 칸 식. */
  readonly cron: string;
  /** 무엇이 도나(스크립트 basename). */
  readonly script: string;
  readonly kind: 'routine' | 'watch' | 'backup' | 'other';
}

export interface CronRead {
  readonly jobs: readonly CronJob[];
  /** botlab 스크립트를 «가리키는데» 못 읽은 줄. ⛔ 조용히 버리지 않는다. */
  readonly unparsed: readonly string[];
}

export type CronScan =
  | { readonly kind: 'read'; readonly read: CronRead }
  /** ⛔ 「0개」가 아니라 «못 물었다». */
  | { readonly kind: 'unmeasured'; readonly why: string };

/** 무엇이 무엇인가. ⛔ 이름을 «박지» 않고 basename 으로 문다(경로가 바뀌어도 산다). */
const KNOWN: readonly { readonly script: string; readonly label: string; readonly kind: CronJob['kind'] }[] = [
  { script: 'bot-routine.ts', label: '봇 루틴', kind: 'routine' },
  { script: 'bot-canary.ts', label: '카나리아', kind: 'watch' },
  { script: 'morning-verdict.ts', label: '아침 판정', kind: 'watch' },
  { script: 'mirror-remote-logs.sh', label: '관측 미러 당김', kind: 'watch' },
  // 🩸🆕 2026-09-01 — ***이 도구가 「VM 예약 1개」라 썼는데 실은 2개였다.***
  //    빠진 하나가 하필 «트리 자기수복»이었고, 그것이 VM 에서 «6시간» 늙어 있던 것을 이 도구는
  //    ⛔ 못 봤다. 봇 트리가 낡으면 그 위의 «모든» 회차가 낡은 코드로 돈다 — 이 축의 일이다.
  { script: 'tree-sync-apply.sh', label: '트리 자기수복', kind: 'watch' },
  // 📬🆕 2026-09-01 — ***`D2` 가 `/botsay` 를 끊었고 이것이 그것을 잇는다.*** 멎으면 사람 말이
  //    «다시» 조용히 사라진다 ⇒ 「무엇이 도나」에 «반드시» 보여야 한다(카나리아 `carried` 와 짝).
  { script: 'carry-bot-mailboxes.ts', label: '우편함 나르기', kind: 'watch' },
  { script: 'elanous-backup.sh', label: '백업', kind: 'backup' },
  { script: 'verify-restore.sh', label: '복원 검증', kind: 'backup' },
];

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 크론 다섯 칸을 «사람 말»로. ⛔ 모르는 꼴이면 ***그 다섯 칸을 그대로 낸다*** —
 * 「매일」이라고 «지어내지» 않는다(그 단정이 이 저장소가 두 번 밟은 자리다).
 */
export function describeCronWhen(min: string, hour: string, dom: string, mon: string, dow: string): string {
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && /^\d+$/.test(min) && dom === '*' && mon === '*' && dow === '*') {
    return `매 ${everyHours[1]}시간 :${min.padStart(2, '0')}`;
  }
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return `${min} ${hour} ${dom} ${mon} ${dow}`;
  const at = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom !== '*' || mon !== '*') return `${at} (${dom} ${mon} ${dow})`;
  if (dow === '*') return `${at} 매일`;
  if (dow === '1-5') return `${at} 평일`;
  if (/^\d$/.test(dow)) return `${DOW[Number(dow) % 7]} ${at}`;
  return `${at} (요일 ${dow})`;
}

/**
 * 🕐⭐⭐ **그 기계의 시간대를 «보는 사람 시각»으로 환산해 꼬리를 단다.**
 *
 * 🩸 **계기 (2026-09-01 · 42차 · 실물)**: 41차가 `D2` 로 맥의 아침 루틴을 VM 으로 옮기면서
 *    crontab 줄을 ***문면 그대로*** 옮겼다 — `50 7 * * *`. ⛔ 그런데 ***맥은 KST 이고 VM 은 UTC 다***.
 *    ⇒ 그 줄은 KST 07:50 이 아니라 ***KST 16:50***에 돈다. 내일 아침 회차가 «안 오고»
 *      08:00 판정이 「no-run 빨강」을 폰으로 배달할 참이었다.
 * 🔑 **그리고 이 도구가 그것을 «못 보였다»** — `/routines` 가 두 기계를 나란히 놓고도
 *    양쪽 다 「07:50 매일」이라고만 말해서 ***똑같아 보였다***. 목록이 옳았는데 «뜻»이 없었다.
 *    ⇒ ***옮김은 그 일을 «재는 자»의 전제를 깬다*** — 41차가 네 번 밟은 그 계급의 다섯째다.
 *
 * ⛔ 「못 쟀다」를 「같다」로 접지 «않는다» — 오프셋 0(UTC)과 `null`(못 물었다)은 다른 값이다.
 * ⛔ 같은 시간대면 «아무 말도 안 한다» — 늘 붙는 줄은 곧 배경이 된다(`describeBotsayReach` 와 같은 규율).
 * ⛔⭐ 시각이 «없는» 꼴(`매 6시간 :05` · 「매 20분」)은 환산하지 않는다
 *    ⛔ 그리고 이 주석에 그 크론 문면을 «그대로» 쓰지 마라 — 별-슬래시가 이 블록을 «닫는다»(42차 실물) — 그 꼴엔 환산할 시각이 없다.
 * ⚠️⭐ 날짜가 넘어가면서 ***요일·날짜 제한이 있으면 그 제한이 어긋난다*** — 그것을 «말한다».
 *    (매일이면 결과가 매일이라 무해하지만, `1-5`(평일)는 UTC 평일 ≠ 그 지역 평일이다)
 */
export function viewerTimeSuffix(input: {
  readonly min: string;
  readonly hour: string;
  readonly dom: string;
  readonly mon: string;
  readonly dow: string;
  /** 그 기계의 UTC 오프셋(분). ⛔ `null` = «못 쟀다» — 0(UTC)과 다른 값이다. */
  readonly hostOffsetMinutes: number | null;
  /** 보는 사람의 UTC 오프셋(분). */
  readonly viewerOffsetMinutes: number;
  /** 보는 사람 시간대의 이름 — `KST` 처럼. ⛔ 박지 않고 받는다(사람이 딴 데 있을 수 있다). */
  readonly viewerLabel: string;
}): string {
  const { min, hour, dom, mon, dow, hostOffsetMinutes, viewerOffsetMinutes, viewerLabel } = input;
  // 시각이 «수»가 아니면 환산할 것이 없다.
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return '';
  if (hostOffsetMinutes === null) {
    return ' (⚠️ 그 기계 «시간대»를 못 쟀다 — 이 시각이 어느 시간대인지 «모른다»)';
  }
  const shift = viewerOffsetMinutes - hostOffsetMinutes;
  if (shift === 0) return '';
  const total = Number(hour) * 60 + Number(min) + shift;
  const dayShift = Math.floor(total / (24 * 60));
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const at = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  // ⚠️ 날짜가 넘어가는데 요일·날짜 제한이 걸려 있으면 그 제한이 «그 지역에서» 어긋난다.
  const restricted = dow !== '*' || dom !== '*' || mon !== '*';
  const drift = dayShift !== 0 && restricted
    ? ` · ⚠️ 날짜가 ${dayShift > 0 ? '넘어가' : '앞당겨져'} ***요일·날짜 제한이 어긋난다***`
    : '';
  return ` (= ${viewerLabel} ${at}${drift})`;
}

/**
 * 🕐 그 기계의 시간대를 사람이 읽는 한 조각으로. ⛔ 「못 쟀다」를 «말한다».
 * ⭐ 헤더에 «한 번» 두는 이유: 사람은 목록을 «훑는다» — 줄마다 꼬리가 있어도 헤더가 없으면
 *    「이 기계가 대체 어느 시간대인가」를 묻지 «않는다»(41차가 그렇게 훑고 놓쳤다).
 */
export function describeHostTz(hostOffsetMinutes: number | null, viewerOffsetMinutes: number): string {
  if (hostOffsetMinutes === null) return ' · 🕐 시간대 «못 쟀다»';
  const sign = hostOffsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(hostOffsetMinutes);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const diff = (viewerOffsetMinutes - hostOffsetMinutes) / 60;
  if (diff === 0) return ` · 🕐 UTC${off}(여기와 «같다»)`;
  return ` · 🕐 UTC${off} — 여기와 ***${Math.abs(diff)}시간*** 차`;
}

/**
 * 🕐 그 기계의 시간대와 «보는 사람»의 시간대. ⛔ 안 주면 환산 꼬리를 «안 단다»
 *    (「같다」가 아니라 「이 호출자는 시간대를 안 본다」다 — `describeBotsayReach` 가 그렇다).
 */
export interface CronTzView {
  /** 그 기계의 UTC 오프셋(분). ⛔ `null` = 못 쟀다 — 0(UTC)과 다른 값이다. */
  readonly hostOffsetMinutes: number | null;
  readonly viewerOffsetMinutes: number;
  readonly viewerLabel: string;
}

/** ⛔ 순수 — `crontab -l` 산출 한 덩이를 «본다». `null` = 못 물었다. */
export function parseBotlabCron(crontab: string | null, tz?: CronTzView): CronScan {
  if (crontab === null) return { kind: 'unmeasured', why: 'crontab 을 «못 물었다» — ⛔ 「예약이 없다」가 아니다' };
  const jobs: CronJob[] = [];
  const unparsed: string[] = [];
  for (const raw of crontab.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const known = KNOWN.find((k) => line.includes(k.script));
    if (!known) continue;
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) {
      // ⛔ botlab 을 «가리키는데» 못 읽은 줄은 «세어서» 말한다 — 버리면 목록이 「거짓 완전」이 된다.
      unparsed.push(line.slice(0, 160));
      continue;
    }
    const [, min, hour, dom, mon, dow, rest] = m as unknown as [string, string, string, string, string, string, string];
    const personaId = known.script === 'bot-routine.ts' ? /bot-routine\.ts\s+(\S+)/.exec(rest)?.[1] : undefined;
    jobs.push({
      label: known.label,
      ...(personaId !== undefined ? { personaId } : {}),
      when: describeCronWhen(min, hour, dom, mon, dow)
        + (tz === undefined ? '' : viewerTimeSuffix({ min, hour, dom, mon, dow, ...tz })),
      cron: [min, hour, dom, mon, dow].join(' '),
      script: known.script,
      kind: known.kind,
    });
  }
  return { kind: 'read', read: { jobs, unparsed } };
}

/** 정렬 — ⛔ crontab 의 «줄 순서»는 아무 뜻이 없다. 사람이 아는 순서(종류 → 시각)로 접는다. */
const KIND_ORDER: Record<CronJob['kind'], number> = { routine: 0, watch: 1, backup: 2, other: 3 };
export function sortJobs(jobs: readonly CronJob[]): readonly CronJob[] {
  return jobs
    .slice()
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.when < b.when ? -1 : a.when > b.when ? 1 : 0) ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
    );
}

export interface RoutinesView {
  readonly mac: CronScan;
  readonly vm: CronScan;
  /**
   * 봇이 «사는» 곳 — 페르소나의 `residence` 에서 온다.
   * ⛔⭐ 셋이다: VM · 다른 곳 · ***«선언 안 함»***.
   * 🩸 첫 판이 「4대 중 3대가 VM 에 산다」라고 썼는데, 넷째(`botlab-4`)는 «다른 데 사는» 게 아니라
   *    ***residence 를 «선언 안 했을»*** 뿐이었다 — 그리고 그 봇은 실제로 VM 에 «있다».
   *    ⇒ 「선언 안 함」을 「다른 데 산다」로 옮기는 것이 이 저장소가 내내 고치는 그 병이다.
   */
  readonly botsLiveOnVm: number;
  readonly botsResidenceUnknown: number;
  readonly botsTotal: number;
  readonly vmAlias: string;
  /**
   * 🕐⭐ 두 기계의 UTC 오프셋(분) ⊕ 보는 사람의 것. ⛔ `null` = «못 쟀다».
   * 🩸 이 칸이 «없어서» 41차가 UTC/KST 어긋남을 못 봤다 — 42차 실물(RFC §41).
   */
  readonly macOffsetMinutes: number | null;
  readonly vmOffsetMinutes: number | null;
  readonly viewerOffsetMinutes: number;
  readonly viewerLabel: string;
}

const KIND_HEAD: Record<CronJob['kind'], string> = {
  routine: '🤖 봇 루틴',
  watch: '🐦 감시·판정',
  backup: '💾 백업',
  other: '❔ 그 밖',
};

function renderSide(icon: string, name: string, scan: CronScan, tzNote: string): string[] {
  if (scan.kind === 'unmeasured') return [`${icon} ${name} — ⛔ ${scan.why}`];
  const { jobs, unparsed } = scan.read;
  if (jobs.length === 0 && unparsed.length === 0) return [`${icon} ${name}${tzNote} — 예약 «0개»(물어서 확인했다)`];
  const lines = [`${icon} ${name}${tzNote} — 예약 ${jobs.length}개`];
  let head: CronJob['kind'] | null = null;
  for (const job of sortJobs(jobs)) {
    if (job.kind !== head) {
      head = job.kind;
      lines.push(`  ${KIND_HEAD[job.kind]}`);
    }
    lines.push(`   • ${job.personaId ?? job.label} — ${job.when}`);
  }
  if (unparsed.length > 0) {
    lines.push(`  ⚠️ 못 읽은 줄 ${unparsed.length}개 — ⛔ 위 목록은 «완전하지 않다»: ${unparsed[0].slice(0, 80)}…`);
  }
  return lines;
}

/**
 * 사람이 받는 한 장. ⭐ 마지막 줄이 «이 도구의 존재 이유»다 —
 * ***봇은 어디 살고 시계는 어디 있나***.
 */
export function formatRoutines(view: RoutinesView): string {
  const lines = ['⏰ **봇 일정 — 무엇이 언제 · «어느 기계»에서 도나**', ''];
  // 🕐⛔⭐ **시간대는 «갈릴 때만» 낸다** — 늘 붙는 줄은 곧 배경이 되고, 그러면 정작 갈린 날
  //    사람이 «안 본다»(`describeBotsayReach` 와 같은 규율). ⚠️ 한쪽을 «못 쟀으면»(null)
  //    그것도 「다르다」로 세어 «말한다» — 모르는 것을 조용히 접지 않는다.
  const tzSplit = view.macOffsetMinutes !== view.vmOffsetMinutes;
  const tzNote = (offset: number | null): string =>
    tzSplit ? describeHostTz(offset, view.viewerOffsetMinutes) : '';
  lines.push(...renderSide('🖥️', '맥(본체)', view.mac, tzNote(view.macOffsetMinutes)));
  lines.push('');
  lines.push(...renderSide('☁️', `VM(${view.vmAlias})`, view.vm, tzNote(view.vmOffsetMinutes)));
  lines.push('');
  lines.push(...northStarNote(view));
  return lines.join('\n');
}

/**
 * ⭐⭐ 「맥이 «꺼져도» 도나」를 «한 줄»로. ⛔ 못 물었으면 ***단정하지 않는다***.
 * 🔑 이 줄이 이 명령의 존재 이유다 — 목록만 내면 사람은 그 간극을 «안 본다».
 */
export function northStarNote(view: RoutinesView): string[] {
  if (view.vm.kind === 'unmeasured' || view.mac.kind === 'unmeasured') {
    return ['⚪ 「맥이 «꺼져도» 도나」는 «못 답한다» — 위에서 한쪽을 못 물었다.'];
  }
  const macCount = view.mac.read.jobs.length;
  const vmCount = view.vm.read.jobs.length;
  const unknown = view.botsResidenceUnknown > 0 ? ` (⊕ ${view.botsResidenceUnknown}대는 «거처를 선언 안 했다» — ⛔ 「다른 데 산다」가 아니다)` : '';
  const where = `봇 ${view.botsTotal}대 중 ${view.botsLiveOnVm}대가 VM 에 «산다»${unknown}`;
  if (vmCount === 0 && macCount > 0) {
    return [
      `🎯 **맥이 «꺼지면» 이 ${macCount}개가 전부 «멎는다»** — ${where}는데 ***시계는 전부 맥에 있다***.`,
      '   ⇒ 이 축의 북극성은 「봇이 도나」가 아니라 ***「맥이 «꺼져도» 도나」***다.',
    ];
  }
  if (macCount === 0 && vmCount > 0) {
    return [`🎯 시계가 «전부» VM 에 있다(${vmCount}개) — ${where}. 맥이 꺼져도 돈다.`];
  }
  return [`🎯 시계가 «갈라져» 있다 — 맥 ${macCount} · VM ${vmCount}. ${where}.`];
}

/**
 * 📬⭐⭐ **`/botsay` 가 「이 말이 «어디서» 읽히나」를 말한다** (2026-09-01 · 41차 · `D2` 후속 Ⓐ).
 *
 * 🚨 계기: `D2` 로 newsbot 이 VM 에 갔는데 `/botsay` 는 ***맥 데몬***이 받아 «맥» 우편함에 담는다.
 *    ⇒ 사람은 `✅ 접수했습니다` 를 보는데 ***그 봇은 그것을 못 읽는다***. 나르기(`carry-bot-mailboxes.ts`)가
 *      그것을 고쳤지만, ⛔ ***나르기가 죽으면 다시 조용해진다.*** 그래서 이 자가 «말한다».
 *
 * ⛔ ***ssh 를 쓰지 않는다*** — `/botsay` 는 채팅에서 사람이 «기다리는» 자리다.
 *    🔑 결정적인 조각은 「이 기계의 크론에 그 봇 줄이 있나」 하나뿐이고 그것은 «공짜»다.
 * ⛔ 그리고 「크론을 못 물었다」를 「없다」로 접지 «않는다» — 셋째 답을 낸다.
 */
export function describeBotsayReach(input: {
  readonly personaId: string;
  /** 이 기계의 `crontab -l` 산출. `null` = 못 물었다(⛔ 「없다」가 아니다). */
  readonly localCrontab: string | null;
}): string {
  const scan = parseBotlabCron(input.localCrontab);
  if (scan.kind === 'unmeasured') {
    return `\n⚠️ 이 말이 «어디서» 읽히는지 못 쟀습니다 — ${scan.why}`;
  }
  const here = scan.read.jobs.some((j) => j.personaId === input.personaId);
  // ⛔ 자리가 맞으면 «아무 말도 안 한다» — 늘 붙는 줄은 곧 배경이 된다.
  if (here) return '';
  const carry = `\n   (\`carry-bot-mailboxes.ts\` · 15분마다 · 그것이 멎으면 이 말은 «영영 안 닿습니다»)`;
  // 🩸⛔⭐ **「이 기계엔 없다」를 「딴 데 있다」로 «단정하지» 않는다** (2026-09-01 · 42차).
  //    🚨 계기: `/botsay botlab-4 …` 가 「나르기가 옮겨야 읽힙니다」라고 답했다 — 그런데
  //       `botlab-4` 는 ***예비 봇이라 어느 기계에도 루틴이 «없다»***. 그 말은 «영영» 안 읽힌다.
  //       ⇒ 사람에게 «거짓 희망»을 준 것이다.
  //    📏 그리고 카나리아는 이 둘을 «이미 가른다»(`해당 없음 — 이 봇에는 루틴이 «없다»(예비 봇)`) —
  //       ⛔ 같은 갈림을 한 표면은 알고 다른 표면은 «모른다».
  //    🔑 이 자는 ssh 를 «안 쓴다»(사람이 기다리는 자리) ⇒ ***가릴 «재료»가 원리상 없다.***
  //       ⛔ 그러면 단정하는 대신 «둘 다 말하고 길을 준다» — 금지만 주면 사람이 갈 곳이 없다.
  const twoCases = `\n   ⓐ 딴 기계에서 돈다 ⇒ 나르기가 옮깁니다`
    + `\n   ⓑ 이 봇에 루틴이 «아예 없다»(예비 봇) ⇒ ***아무도 안 읽습니다***`
    + `\n   ⛔ 이 자로는 그 둘을 «못 가릅니다» — \`/routines\` 가 어느 봇이 어디서 도는지 답합니다`;
  // ⛔⭐ 「봇 줄이 «하나도» 없다」는 「이 봇만 딴 데 있다」보다 ***약한 근거***다 —
  //    이 기계는 봇을 돌리기로 돼 있으므로, 0개는 「딴 데 있다」가 아니라 ***「크론이 통째로 비었다」***
  //    일 수 있다. ⇒ 두 문면을 «가른다». 같은 말을 하면 사람이 엉뚱한 데를 고친다.
  if (scan.read.jobs.length === 0) {
    return `\n⚠️ 이 기계의 크론에 봇 루틴이 «하나도» 없습니다 — 이 봇이 딴 데서 도는 것인지,`
      + ` 크론이 통째로 «빈» 것인지 ***이 자로는 못 가릅니다***. 말은 여기 담겼습니다.${carry}`;
  }
  return `\n⛔ 이 봇의 루틴이 «이 기계엔 없습니다» — 말은 여기 담겼습니다. 둘 중 하나입니다:${twoCases}${carry}`;
}
