import { debug } from '../../debug/log.js';
import type { DashboardMouseWiringDeps } from './mouse-wiring.js';

export interface MousePillContextRuntimeDeps {
  handleForPill: (name: string) => unknown;
  showMenu: (
    handle: unknown,
    pos: { x: number; y: number },
  ) => Promise<{ value: unknown; reason: string } | void>;
  /** 2026-05-05 — pill context-menu 결과 dispatcher. value 는 buildPillMenu
   *  의 command id (`pill.switch` · `pill.remove` · `pill.settings`).
   *  reason 이 'selected' 일 때만 호출됨 (escape · outside-click ·
   *  disposed 는 skip). 미지정 시 결과 무시 (legacy). pos = 우클릭이
   *  발생한 (x,y) — 핸들러가 confirm popup 등을 같은 위치 anchor 로
   *  띄울 때 사용. */
  onPillMenuPick?: (
    name: string,
    value: string,
    pos: { x: number; y: number },
  ) => void | Promise<void>;
}

export interface MousePillContextRuntime
  extends Pick<DashboardMouseWiringDeps, 'onPillRightClick'> {}

export function createMousePillContextRuntime(
  deps: MousePillContextRuntimeDeps,
): MousePillContextRuntime {
  return {
    onPillRightClick: (name, pos) => {
      const handle = deps.handleForPill(name);
      if (debug.enabled) {
        debug.log('mouse.pill.context', 'right-click', {
          name,
          hasHandle: !!handle,
          pos,
        });
      }
      if (!handle) return;
      void Promise.resolve(deps.showMenu(handle, pos))
        .then((result) => {
          if (debug.enabled) {
            debug.log('mouse.pill.context', 'showMenu.resolved', {
              name,
              reason: result?.reason ?? '(no result)',
              value: typeof result?.value === 'string' ? result.value : '(non-string)',
            });
          }
          if (!deps.onPillMenuPick) return;
          if (!result) return;
          // MenuCloseReason 의 canonical 값은 'selected' (context-menu-
          // registry.ts:119). 직전 PR 에서 'select' 로 잘못 비교해 마우스
          // 선택이 항상 skip 되던 버그 — 로그 trail (showMenu.resolved
          // reason='selected') 로 발견.
          if (result.reason !== 'selected') return;
          if (typeof result.value !== 'string') return;
          try {
            void deps.onPillMenuPick(name, result.value, pos);
          } catch {
            /* host owns its error surface */
          }
        })
        .catch((err) => {
          if (debug.enabled) {
            debug.log('mouse.pill.context', 'showMenu.rejected', {
              name,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          /* presenter failures are already surfaced elsewhere */
        });
    },
  };
}
