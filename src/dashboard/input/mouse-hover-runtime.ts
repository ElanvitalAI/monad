import type { DashboardMouseWiringDeps } from './mouse-wiring.js';

export interface MouseHoverRuntimeDeps {
  dispatchHoverToWidget: (
    paneId: string,
    event: import('../../widgets/types.js').WidgetHoverEvent,
  ) => void;
  setConversationHoverLabel: (label: string) => void;
  clearConversationHoverLabel: () => void;
  conversationHoverHudLabel: (
    hit: Extract<
      NonNullable<
        NonNullable<
          Parameters<NonNullable<DashboardMouseWiringDeps['onPaneHoverEvent']>>[0]['target']
        >['hit']
      >,
      { kind: 'conversation-message' }
    >,
  ) => string;
}

export interface MouseHoverRuntime
  extends Pick<DashboardMouseWiringDeps, 'dispatchHoverToWidget' | 'onPaneHoverEvent'> {}

export function createMouseHoverRuntime(
  deps: MouseHoverRuntimeDeps,
): MouseHoverRuntime {
  return {
    dispatchHoverToWidget: (paneId, event) => {
      deps.dispatchHoverToWidget(
        paneId,
        event as import('../../widgets/types.js').WidgetHoverEvent,
      );
    },
    onPaneHoverEvent: (event) => {
      const hit = event.target.hit;
      if (hit?.kind === 'conversation-message') {
        deps.setConversationHoverLabel(
          deps.conversationHoverHudLabel(hit),
        );
        return;
      }
      deps.clearConversationHoverLabel();
    },
  };
}
