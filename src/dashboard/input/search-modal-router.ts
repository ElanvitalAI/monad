import type { SearchModalHandle } from '../../chat/search/modal.js';
import type { Key } from '../../tui.js';
import { routeSearchModalKeyInput } from '../../chat/search/key-routing.js';

export type SearchModalRouteResult = 'consumed';

export function routeSearchModalKey(key: Key, modal: SearchModalHandle): SearchModalRouteResult {
  return routeSearchModalKeyInput(key, modal);
}
