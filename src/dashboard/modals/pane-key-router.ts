import { toDashboardKeyEvent, type DashboardKeyRouteResult } from '../input/key-types.js';
import type { PaneModalChord } from './pane.js';
import type { Key } from '../../tui.js';
import type { PaneVisibility } from '../../views/pane-policy.js';
import type { PaneFocus } from '../../workspace-types.js';

export interface PaneModalKeyRouteDeps {
  chord: PaneModalChord;
  visibility: () => PaneVisibility;
  openPane: (pane: PaneFocus) => void;
}

export function routePaneModalChordKey(
  key: Key,
  deps: PaneModalKeyRouteDeps,
): DashboardKeyRouteResult {
  const visibility = deps.visibility();
  if (visibility.modalDeferred.length === 0 && !deps.chord.state.armed) {
    return 'passthrough';
  }

  const chordResult = deps.chord.handleKey(toDashboardKeyEvent(key), {
    deferred: visibility.modalDeferred,
    openPane: deps.openPane,
  });
  return chordResult === 'passthrough' ? 'passthrough' : 'consumed';
}
