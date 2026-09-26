// ── 종료를 «한 자리»로 모은다 ──────────────────────────────────────────────
//
// 🚨 왜 (대표 지시 2026-08-19)
//   대표: *"ctrl+q 등이 종료로 나가는 코드인데 «하드 종료» 상태입니다. 서브 에이전트 잡이라던가
//        기타 모니터링 잡을 종료하는 등의 gracefully stop 이 되도록"*
//   대표: *"터미널 프롬프트가 뜨기전에 session id 출력하고 해당 세션으로 resume 하기 위해서
//        어떻게 하면 될지 안내 문구를"*
//   대표: *"정말 나가는지 물어보는 것까지"*
//
// 📏 실측(2026-08-19) — 종료 계열이 ***일곱 갈래***였고 하는 일이 제각각이었다:
//   ① Ctrl+Q(스트리밍) ② Ctrl+Shift+Q / Ctrl+\ ③ /quit(별칭 q·exit)
//   ④ 평문 `exit`/`quit` 타이핑 ⑤ 마우스 dock ⑥ Ctrl+C ⑦ SIGINT/SIGTERM
//   ⇒ ⭐ ①②⑤ 만 세션 안내를 탔고 ***⑥⑦ 은 안 탔다***. 자식 정리는 ***어디에도 없었다***.
//
// ⛔⭐ 그리고 안내가 «반쪽»이었다: `resume with /session load <id>` 는 ***TUI 안 명령***인데
//   그 문구를 읽는 사람은 그때 «셸»에 있다. TUI 에 `--session` 플래그가 «없어서»
//   실제로 맞는 안내는 ***「elanous 재실행 → /resume <id>」***다.

import { globalAgentRegistry, type AgentRegistry } from '../agent/registry.js';
import { debug } from '../debug/log.js';

export interface GracefulQuitDeps {
  /** 살아 있는 자식들을 멈춘다. 기본 = 전역 레지스트리. */
  registry?: Pick<AgentRegistry, 'abortAll' | 'list'>;
  /** 나가도 계속 도는 하니스 자식 수(알림용). 미주입이면 0. */
  harnessChildren?: number;
  /** 확인 ② 의 답 — `true` 면 계속 도는 것까지 죽인다. ⛔ 기본은 «남겨두기»다. */
  forceKillHarnessChildren?: boolean;
  /** 비상 종료 — 확인 대기와 무관하게 즉시 나간다. */
  forceQuit?: boolean;
  /** 반복 종료 확인의 상태. 같은 종료 경로는 이 객체를 재사용한다. */
  confirmationState?: QuitConfirmationState;
  /** 반복 호출을 확인으로 읽을 시간 창(ms). 기본은 확인 문면의 시간 창이다. */
  confirmationWindowMs?: number;
  /** 시계 주입점 — 테스트에서 실제 시간을 기다리지 않는다. */
  now?: () => number;
  /** 하니스 자식을 실제로 죽이는 자(주입). 미주입이면 「죽일 수 없었다」고 «말한다». */
  killHarnessChildren?: () => number;
  /** TUI 를 닫는다(alt-screen 복원 등). */
  closeTui: () => void;
  /** 이 세션의 id — 안내 문구에 쓴다. */
  getSessionId?: () => string | undefined;
  write?: (message: string) => unknown;
}

export interface GracefulQuitResult {
  /** 종료 전에 반복 확인을 기다리는 중인가. */
  awaitingConfirmation?: boolean;
  /** 실제로 중단 신호를 보낸 in-process 서브에이전트 수. */
  stoppedChildren: number;
  /** 살려 둔(또는 죽인) 하니스 자식 수. ⚠️ 선택 — 옛 소비자를 깨지 않는다. */
  harnessChildren?: number;
  /** 하니스 자식을 실제로 죽였나. ⚠️ 선택 — 옛 소비자를 깨지 않는다. */
  killedHarnessChildren?: boolean;
  sessionId: string | undefined;
  /** 사용자에게 찍은 문구(테스트가 문면을 문다). */
  message: string;
}

/**
 * ★ 종료 시 «돌고 있는 것»의 분류. ⛔ 한 수로 접지 않는다 —
 *   ***둘은 나갈 때 운명이 다르다***(대표 권고안 채택 2026-08-19).
 *
 * 📏 근거(실측):
 *   서브에이전트 = ***in-process***(AbortController + 프로미스) ⇒ 부모가 죽으면 «어차피» 죽는다.
 *                  「살려 둔다」는 선택지가 «아니다».
 *   하니스 자식   = ***별도 PTY 프로세스***, 자기 워크트리에서 일하고 ***스스로 PR 을 연다***
 *                  ⇒ 부모가 죽어도 «산다». (실측: `dev --hold` PTY 들이 부모 종료 뒤에도 살아 있었다)
 * ⚠️ 미측정: 「살아서 «끝까지» 가 PR 까지 여는가」는 아직 실물로 안 쟀다.
 *   ⇒ 그래서 §확인 ② 로 ***사용자에게 고르게 한다*** — 우리가 단정하지 않는다.
 */
export interface LiveWorkSnapshot {
  /** in-process 서브에이전트 — 나가면 함께 죽는다. */
  subagents: number;
  /** 하니스 자식(별도 프로세스) — 나가도 계속 돈다. */
  harnessChildren: number;
}

/**
 * ★ 종료 시 «돌고 있는 것»의 분류. ⛔ 한 수로 접지 않는다 —
 *   ***둘은 나갈 때 운명이 다르다***(대표 권고안 채택 2026-08-19).
 *
 * 📏 근거(실측):
 *   서브에이전트 = ***in-process***(AbortController + 프로미스) ⇒ 부모가 죽으면 «어차피» 죽는다.
 *   하니스 자식   = ⛔⭐⭐⭐ ***2026-08-19 실측으로 «이것도 함께 죽는다»가 확인됐다.***
 *     📏 절차: 격리 TUI(부모 36958)에서 SelfImplement 자식(37800·ppid=36958)을 띄우고
 *        ***부모만*** `kill -TERM` ⇒ 자식도 «같이» 사라졌다(44초째 · 수분짜리 작업 중이었다).
 *     🔑 기전: `pty list` 에 그 런의 PTY 가 ***«하나»***뿐이었다 —
 *        ***자식은 «자기» PTY 를 갖지 않고 부모의 PTY 안에서 돈다*** ⇒ 부모가 죽으면 SIGHUP.
 *     🪞 내가 앞서 근거로 든 「`dev --hold` PTY 14개가 살아 있다」는 ***다른 축의 증거였다*** —
 *        그것들은 「띄운 명령이 끝난 held TUI」이지 「부모가 죽임당한 자식」이 아니다.
 * ⇒ 🎯 그래서 지금은 ***둘 다 죽는다***. 갈림은 «뒤처리»가 아니라 ***«알림»에서만*** 의미가 있다.
 * 🔵 진짜 칸: 자식에게 «자기 PTY」를 주면 그때 수명이 갈리고 「남겨둘까」가 «선택지»가 된다.
 */
export interface LiveWorkSnapshot {
  /** in-process 서브에이전트 — 나가면 함께 죽는다. */
  subagents: number;
  /** 하니스 자식(별도 프로세스) — 나가도 계속 돈다. */
  harnessChildren: number;
}

/**
 * ⭐⭐ 확인 대화의 «타임아웃 기본값» 규율 (대표 지시 2026-08-19).
 *
 * ⛔ 규칙 한 줄: ***기본값은 «되돌릴 수 있는» 쪽이다.***
 *   확인 ①(나가기)   → 타임아웃이면 ***나간다***.
 *      근거: 사용자가 `Ctrl+Q` 를 «눌렀다» — 그것이 이미 의사 표시다.
 *            타임아웃에 「취소」로 가면 Ctrl+Q 가 «가끔 아무 일도 안 하는» 키가 된다.
 *   확인 ②(강제 종료) → 타임아웃이면 ***남겨둔다***.
 *      근거: ⛔ ***파괴적 동작은 «절대» 타임아웃으로 일어나지 않는다.***
 *            남겨 두면 나중에 죽일 수 있지만, 죽인 것은 되돌릴 수 없다.
 */
export const QUIT_CONFIRM_TIMEOUT_MS = 20_000;
export const QUIT_CONFIRM_TIMEOUT_DEFAULT = { quit: true } as const;

/** 반복 종료 확인의 호출 간 상태. */
export interface QuitConfirmationState {
  openedAt?: number;
}

/** 종료 경로별로 한 번 생성해 반복 확인에 명시적으로 주입한다. */
export function createQuitConfirmationState(): QuitConfirmationState {
  return {};
}

function confirmationStateFor(deps: GracefulQuitDeps): QuitConfirmationState {
  return deps.confirmationState ?? createQuitConfirmationState();
}

export const FORCE_KILL_CONFIRM_TIMEOUT_DEFAULT = { forceKill: false } as const;

/** 지금 멈춰야 할 자식이 몇인가 — «나갈까요?» 를 정직하게 묻기 위한 수. */
export function countLiveChildren(
  registry: Pick<AgentRegistry, 'list'> = globalAgentRegistry,
): number {
  try {
    return registry.list().filter((t) => t.state === 'running' || t.state === 'pending').length;
  } catch { return 0; }
}

/**
 * ★ 확인 ① — 종료 확인. ⛔ 「정말 나갈까요」만 묻지 않는다.
 *   ***무엇이 돌고 있고 각각 어떻게 되는지***를 «갈라서» 말한다(대표 지시 2026-08-19).
 *   📌 그래야 사용자가 «정보를 갖고» 답한다.
 */
export function buildQuitConfirmPrompt(
  live: LiveWorkSnapshot,
): { title: string; prompt: string; detail: string; timeoutMs: number; onTimeout: 'quit' } {
  // ⭐⭐ 타임아웃이면 «나간다» — 사용자가 `Ctrl+Q` 를 «눌렀다»는 것이 이미 의사 표시다.
  //   ⛔ 여기서 「취소」로 가면 Ctrl+Q 가 «가끔 아무 일도 안 하는» 키가 된다.
  const base = { timeoutMs: QUIT_CONFIRM_TIMEOUT_MS, onTimeout: 'quit' as const };
  const total = live.subagents + live.harnessChildren;
  if (total === 0) {
    return {
      ...base,
      title: '정말 나가시겠습니까?',
      prompt: '돌고 있는 작업은 없습니다',
      detail: '세션 id 와 이어하는 법을 나가기 전에 알려 드립니다.',
    };
  }
  const lines: string[] = [];
  if (live.subagents > 0) lines.push(`서브에이전트 ${live.subagents}개 → 나가면 중단됩니다`);
  // ⛔ 2026-08-19 실측 정정 — 자식도 «함께» 죽는다(부모 PTY 안에서 돌기 때문). 거짓을 말하지 않는다.
  if (live.harnessChildren > 0) lines.push(`하니스 자식 ${live.harnessChildren}개 → 함께 중단됩니다`);
  return {
    ...base,
    title: '정말 나가시겠습니까?',
    prompt: lines.join(' · '),
    detail: '세션 id 와 이어하는 법을 나가기 전에 알려 드립니다.',
  };
}

/**
 * ★ 확인 ② — ***계속 도는 것마저 강제 종료할까*** (대표 지시 2026-08-19).
 *
 * ⛔ 기본은 ***남겨두기***다. 근거 둘:
 *   ⓐ 하니스 자식은 «스스로 착지»한다(PR 을 연다) — 죽이면 그 일이 통째로 사라진다
 *   ⓑ 되돌릴 수 없는 쪽이 기본이 되면 안 된다. 남겨 두면 나중에 죽일 수 있지만 반대는 없다
 * ⚠️ 자식이 없으면 «묻지 않는다» — 물을 것이 없는데 묻는 것은 소음이다.
 */
export function buildForceKillConfirmPrompt(
  harnessChildren: number,
): {
  title: string; prompt: string; detail: string;
  yesLabel: string; noLabel: string;
  timeoutMs: number; onTimeout: 'keep';
} | null {
  if (harnessChildren <= 0) return null;
  return {
    title: '계속 도는 작업도 강제 종료할까요?',
    prompt: `하니스 자식 ${harnessChildren}개가 나간 뒤에도 계속 돕니다`,
    detail: '그대로 두면 스스로 마무리하고 PR 을 엽니다. 강제 종료하면 그 작업은 사라집니다.',
    yesLabel: '강제 종료 (y)',
    noLabel: '남겨두기 (n/Esc · 기본)',
    // ⛔⭐⭐⭐ ***파괴적 동작은 «절대» 타임아웃으로 일어나지 않는다.***
    //   남겨 두면 나중에 죽일 수 있지만, 죽인 것은 되돌릴 수 없다.
    timeoutMs: QUIT_CONFIRM_TIMEOUT_MS,
    onTimeout: 'keep',
  };
}

/**
 * ★ 이어 하기 안내 — ⛔ ***셸에서 칠 수 있는 명령***으로 준다.
 *   종전 문면(`resume with /session load <id>`)은 TUI 안 명령이라 셸에선 못 친다.
 */
export function buildResumeGuidance(sessionId: string | undefined): string {
  if (!sessionId) {
    return '[session] 세션 id 를 기록하지 못했습니다 — `elanous session list` 로 최근 세션을 확인하십시오.\n';
  }
  return [
    `[session] ${sessionId}`,
    '  이어서 하려면 —',
    `    elanous                     실행 후  /resume ${sessionId}`,
    `    elanous chat --session ${sessionId} "<메시지>"    (한 번만 주고받기)`,
    `    elanous session list        최근 세션 목록`,
    '',
  ].join('\n');
}

/**
 * ★ ***graceful 종료*** — 자식을 멈추고, TUI 를 닫고, 세션 안내를 찍는다.
 *
 * ⛔ 순서에 이유가 있다:
 *   ① 자식 중단 «먼저» — TUI 를 닫은 뒤에 멈추면 그 로그가 갈 곳이 없다
 *   ② closeTui — alt-screen 을 «복원»해야 아래 안내가 사용자 터미널에 남는다
 *   ③ 안내 «마지막» — 셸 프롬프트 «직전»에 보이는 것이 목적이다(대표)
 */
export function gracefulQuit(deps: GracefulQuitDeps): GracefulQuitResult {
  const registry = deps.registry ?? globalAgentRegistry;
  const harnessChildren = deps.harnessChildren ?? 0;
  const confirmationState = confirmationStateFor(deps);
  const now = deps.now ?? Date.now;
  const confirmationWindowMs = deps.confirmationWindowMs ?? QUIT_CONFIRM_TIMEOUT_MS;
  let subagents = 0;
  let runningChildren = harnessChildren;

  if (deps.forceQuit) {
    confirmationState.openedAt = undefined;
    // 강제 종료의 관측은 실패해도 종료를 막지 않게 별도로 센다.
    runningChildren += countLiveChildren(registry);
    debug.log('quit.confirm', 'forced', { runningChildren });
  } else {
    subagents = countLiveChildren(registry);
    runningChildren += subagents;
    if (runningChildren > 0) {
      const currentTime = now();
      if (confirmationState.openedAt === undefined || currentTime - confirmationState.openedAt > confirmationWindowMs) {
        confirmationState.openedAt = currentTime;
        const message = `${buildQuitConfirmPrompt({ subagents, harnessChildren }).prompt}\n`;
        debug.log('quit.confirm', 'open-confirmation', { runningChildren });
        try { (deps.write ?? process.stdout.write.bind(process.stdout))(message); } catch { /* fail-soft */ }
        return { awaitingConfirmation: true, stoppedChildren: 0, harnessChildren, killedHarnessChildren: false, sessionId: undefined, message };
      }
      confirmationState.openedAt = undefined;
      debug.log('quit.confirm', 'confirm-by-repeat', { runningChildren });
    } else {
      debug.log('quit.confirm', 'immediate', { runningChildren });
    }
  }

  // ① in-process 서브에이전트 — 「살려 둔다」가 «선택지가 아니다». 부모와 함께 죽으므로 «깨끗이» 멈춘다.
  let stoppedChildren = 0;
  try {
    stoppedChildren = registry.abortAll();
    if (stoppedChildren > 0) debug.log('dashboard.quit', 'subagents-stopped', { count: stoppedChildren });
  } catch { /* 자식 정리 실패가 종료를 막지 않는다 */ }

  // ② 하니스 자식 — ⛔ 기본은 «남겨둔다». 죽이는 것은 사용자가 «명시»했을 때만.
  let killedHarnessChildren = false;
  if (deps.forceKillHarnessChildren === true && harnessChildren > 0) {
    try {
      const killed = deps.killHarnessChildren?.() ?? 0;
      killedHarnessChildren = killed > 0;
      debug.log('dashboard.quit', 'harness-children-killed', { requested: harnessChildren, killed });
    } catch { /* 실패해도 종료는 계속 — 다만 아래 문면이 «죽였다»고 말하지 않는다 */ }
  }

  try { deps.closeTui(); } catch { /* 이미 닫혔을 수 있다 */ }

  const sessionId = deps.getSessionId?.();
  // ⭐ 「무엇이 돌고 있었고 무엇을 어떻게 했는지」를 «갈라서» 알린다(대표 지시).
  const lines: string[] = [];
  if (stoppedChildren > 0) lines.push(`[quit] 서브에이전트 ${stoppedChildren}개를 중단했습니다.`);
  if (harnessChildren > 0) {
    // ⛔ 실측 정정(2026-08-19): 자식은 부모 PTY 안에서 돌아 «함께» 죽는다.
    //   종전 문면 *"계속 돕니다 — 스스로 PR 을 엽니다"* 는 ***거짓***이었다.
    lines.push(killedHarnessChildren
      ? `[quit] 하니스 자식 ${harnessChildren}개를 강제 종료했습니다.`
      : `[quit] 하니스 자식 ${harnessChildren}개도 함께 중단됐습니다 — 부모 PTY 안에서 돌기 때문입니다.`);
    lines.push('        다시 걸려면 그 골로 재발사하십시오 — 중간 산출은 이력에 남아 있습니다.');
  }
  if (stoppedChildren === 0 && harnessChildren === 0) lines.push('[quit] 돌고 있던 작업은 없었습니다.');
  const message = `${lines.join('\n')}\n` + buildResumeGuidance(sessionId);
  try { (deps.write ?? process.stdout.write.bind(process.stdout))(message); } catch { /* fail-soft */ }
  return { stoppedChildren, harnessChildren, killedHarnessChildren, sessionId, message };
}
