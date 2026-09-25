// 컴퓨터 유즈 시뮬레이터 — 브라우저 없이 진짜 browser-action 디스패처를 관측한다.
//
// ⛔ `performBrowserAction`의 클릭·캡처·관측 로직을 복제하지 않는다. CDP 경계만
// 주입하여, 라이브에서 만들기 어려운 캡처 상태를 결정론적으로 세운다.
import {
  performBrowserAction,
  type BrowserActionAttribution,
  type BrowserActionCaptureOutcome,
  type BrowserActionResult,
} from '../harness/browser-act.js';
import type { CdpClient, CdpEventListener } from '../browser-cdp/client.js';

export type ComputerUseScenario = 'normal' | 'capture-stalls' | 'capture-fails' | 'target-missing';

const COMPUTER_USE_ENTRY_POINT = 'src/ux-sim/computer-use.ts';

export interface ComputerUseTrajectoryStep {
  target: string;
  /** 실제 디스패처 관측에 실을 클릭 좌표. 알 수 없는 값을 만들지 않는다. */
  coordinates: { x: number; y: number };
}

export interface ComputerUseObservation {
  target: string;
  coordinates: { x: number; y: number };
  attachmentRef: string | null;
  captureOutcome: BrowserActionCaptureOutcome;
  runId: string | null;
  personaId: string | null;
  /** 진짜 디스패처가 실행 관측에 실은 귀속값을 그대로 통과시킨다. */
  attribution: BrowserActionAttribution;
};

export type ComputerUseAttributionState =
  | { status: 'observed'; attribution: BrowserActionAttribution }
  | { status: 'not-observed' };

export interface ComputerUseSimulationResult {
  scenario: ComputerUseScenario;
  actions: readonly BrowserActionResult[];
  /**
   * ⛔ 'not-observed' 는 «관측이 아예 없었을 때»뿐이다.
   *    📌 #13620 이후 실패한 조작도 관측을 남기므로 이 값은 «드물어졌다» — 그러나 «지운 게 아니다»
   *    (관측이 fail-soft 로 못 나가는 판이 여전히 있다).
   */
  captureOutcome: BrowserActionCaptureOutcome | 'not-observed';
  observations: readonly ComputerUseObservation[];
  /** 마지막 실행 관측의 디스패처 귀속값 또는 관측 전 실패 상태. */
  attribution: ComputerUseAttributionState;
};

function simClient(scenario: ComputerUseScenario): CdpClient {
  let lifecycleListener: CdpEventListener | undefined;
  return {
    port: 0,
    pid: 0,
    get isAlive() { return true; },
    on(method, listener) {
      if (method === 'Page.lifecycleEvent') lifecycleListener = listener;
      return () => { lifecycleListener = undefined; };
    },
    async navigate() {
      queueMicrotask(() => lifecycleListener?.({
        method: 'Page.lifecycleEvent',
        params: { name: 'load', frameId: 'ux-sim-frame', loaderId: 'ux-sim-loader' },
      }));
      return { frameId: 'ux-sim-frame', loaderId: 'ux-sim-loader' };
    },
    async screenshot() {
      if (scenario === 'capture-stalls') return new Promise<Buffer>(() => {});
      if (scenario === 'capture-fails') throw new Error('simulated capture failure');
      return Buffer.from([137, 80, 78, 71]);
    },
    async evaluate() { return { x: 0, y: 0 }; },
    async setScriptExecutionDisabled(value) {
      if (value) throw new Error('computer-use simulation cannot disable script execution');
    },
    async close() {},
  };
}

/**
 * 모든 궤적 클릭을 순서대로 진짜 디스패처로 수행하고, 각 호출이 emit한 관측을 돌려준다.
 * `target-missing`은 실행 단계에서 실패하므로 원래 계약처럼 관측 이벤트가 없다.
 */
export async function simComputerUse(opts: {
  scenario: ComputerUseScenario;
  trajectory: readonly ComputerUseTrajectoryStep[];
  url?: string;
  captureTimeoutMs?: number;
  /** ⛔ 심의 로드 대기. 기본 20ms — 심에는 진짜 브라우저가 없다. */
  loadWaitTimeoutMs?: number;
  runId?: string | null;
  personaId?: string | null;
  /** 명시 호출자는 심 기본값보다 자기 진입점으로 귀속된다. */
  entryPoint?: string;
}): Promise<ComputerUseSimulationResult> {
  if (opts.trajectory.length === 0) {
    throw new Error('computer-use simulation requires at least one trajectory step');
  }

  const observations: ComputerUseObservation[] = [];
  const actions: BrowserActionResult[] = [];

  for (const step of opts.trajectory) {
    const action = await performBrowserAction({
      url: opts.url ?? 'https://ux-sim.invalid/',
      target: step.target,
      armed: true,
      entryPoint: opts.entryPoint ?? COMPUTER_USE_ENTRY_POINT,
      ...(opts.personaId ? { persona: { personaId: opts.personaId } as never } : {}),
    }, {
      connect: async () => simClient(opts.scenario),
      execute: async (_client, selected) => {
        if (opts.scenario === 'target-missing') throw new Error(`browser action target not found: ${selected}`);
        return step.coordinates;
      },
      captureTimeoutMs: opts.captureTimeoutMs ?? 10,
      // ⛔ 심에는 «진짜 브라우저»가 없다 — 로드 대기도 «작아야» 한다.
      //    📏 실측 2026-08-28: 안 주면 클릭 뒤 «시작 창»(1.5초)을 그대로 기다려
      //       심 시험 셋이 1.5초씩 늘어났다. 심의 시간은 «주입»으로 정한다.
      loadWaitTimeoutMs: opts.loadWaitTimeoutMs ?? 20,
      // ⛔ 심에는 «진짜 브라우저»가 없다 — 탭 회수는 CDP HTTP 왕복이라 여기서 «켜지면 안 된다».
      //    📏 실측 2026-08-28: 안 끄면 걸음마다 127.0.0.1 로 4초씩 기다려 시험이 5초에 «타임아웃»한다.
      //    🔑 이 파일 머리말의 계약 그대로다 — 「CDP 경계만 대역」.
      reclaimOpenedTabs: false,
      saveAttachment: async () => ({ ok: true, entry: { path: 'ux-sim://capture.png' } } as never),
      getRunId: () => opts.runId ?? null,
      observe: (event, data) => {
        if (event !== 'executed') return;
        observations.push({
          target: data.target as string,
          coordinates: data.coordinates as { x: number; y: number },
          attachmentRef: data.attachmentRef as string | null,
          captureOutcome: data.captureOutcome as BrowserActionCaptureOutcome,
          runId: data.runId as string | null,
          personaId: data.personaId as string | null,
          attribution: data.attribution as BrowserActionAttribution,
        });
      },
    });
    actions.push(action);
  }

  return {
    scenario: opts.scenario,
    actions,
    captureOutcome: observations.at(-1)?.captureOutcome ?? 'not-observed',
    observations,
    attribution: observations.at(-1)
      ? { status: 'observed', attribution: observations.at(-1)!.attribution }
      : { status: 'not-observed' },
  };
}
