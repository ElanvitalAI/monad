import { C } from '../tui.js';
import { onEscAbort } from '../chat/index.js';

export interface DashboardAutoRouteCountdownDeps {
  chatLines: string[];
  pushDebugLine: (line: string) => void;
  draw: () => void;
  onEscAbort: typeof onEscAbort;
  stepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DashboardTabConfirmRouteDeps {
  chatLines: string[];
  pushDebugLine: (line: string) => void;
  draw: () => void;
  addInputListener?: (handler: (data: string | Buffer) => void) => void;
  removeInputListener?: (handler: (data: string | Buffer) => void) => void;
  stepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export async function runDashboardAutoRouteCountdown(
  skillName: string,
  totalMs: number,
  deps: DashboardAutoRouteCountdownDeps,
): Promise<boolean> {
  if (totalMs <= 0) return true;
  const abortCtrl = new AbortController();
  const cleanupEsc = deps.onEscAbort(abortCtrl);
  const hudIdx = deps.chatLines.length;
  const step = deps.stepMs ?? 100;
  const sleep = deps.sleep ?? defaultSleep;
  try {
    for (let remaining = totalMs; remaining > 0; remaining -= step) {
      if (abortCtrl.signal.aborted) return false;
      deps.chatLines.length = hudIdx;
      const secs = (remaining / 1000).toFixed(1);
      deps.pushDebugLine(C.muted(`  auto-routing to /run-skill ${skillName} in ${secs}s — press Esc to cancel`));
      deps.draw();
      await sleep(Math.min(step, remaining));
    }
    deps.chatLines.length = hudIdx;
    return !abortCtrl.signal.aborted;
  } finally {
    cleanupEsc();
  }
}

export async function runDashboardTabConfirmRoute(
  skillName: string,
  totalMs: number,
  deps: DashboardTabConfirmRouteDeps,
): Promise<boolean> {
  if (totalMs <= 0) return false;
  let tabPressed = false;
  let otherKey = false;
  const addListener = deps.addInputListener ?? ((handler) => { process.stdin.on('data', handler); });
  const removeListener = deps.removeInputListener ?? ((handler) => { process.stdin.removeListener('data', handler); });
  const handler = (data: string | Buffer) => {
    if (tabPressed || otherKey) return;
    const text = typeof data === 'string' ? data : data.toString();
    if (text === '\t') tabPressed = true;
    else otherKey = true;
  };
  addListener(handler);
  const hudIdx = deps.chatLines.length;
  const step = deps.stepMs ?? 100;
  const sleep = deps.sleep ?? defaultSleep;
  try {
    for (let remaining = totalMs; remaining > 0; remaining -= step) {
      if (tabPressed || otherKey) break;
      deps.chatLines.length = hudIdx;
      const secs = (remaining / 1000).toFixed(1);
      deps.pushDebugLine(C.muted(`  Tab within ${secs}s → /run-skill ${skillName}  (any other key: continue chat)`));
      deps.draw();
      await sleep(Math.min(step, remaining));
    }
    deps.chatLines.length = hudIdx;
    return tabPressed;
  } finally {
    removeListener(handler);
  }
}
