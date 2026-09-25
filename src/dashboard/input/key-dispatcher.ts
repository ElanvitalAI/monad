import type { DashboardKeyHandler } from './key-types.js';
import type { InputOwner } from './input-owner.js';
import type { Key } from '../../tui.js';

/** Builds the production dispatch order without exposing question routing
 * while another surface owns the input. */
export function composeDashboardKeyHandlers(
  inputOwner: InputOwner | undefined,
  questionViewHandler: DashboardKeyHandler,
  otherHandlers: readonly DashboardKeyHandler[],
): readonly DashboardKeyHandler[] {
  return inputOwner === 'question-view'
    ? [questionViewHandler, ...otherHandlers]
    : otherHandlers;
}

export type DashboardKeyDispatchResult =
  | { type: 'consumed'; handler: string }
  | { type: 'passthrough' };

export function dispatchDashboardKey(
  key: Key,
  handlers: readonly DashboardKeyHandler[],
  targetHandlerName?: string,
): DashboardKeyDispatchResult {
  const dispatch = (handler: DashboardKeyHandler): DashboardKeyDispatchResult =>
    handler.handle(key) === 'consumed'
      ? { type: 'consumed', handler: handler.name }
      : { type: 'passthrough' };

  if (targetHandlerName) {
    const target = handlers.find((handler) => handler.name === targetHandlerName);
    return target ? dispatch(target) : { type: 'passthrough' };
  }

  for (const handler of handlers) {
    const result = dispatch(handler);
    if (result.type === 'consumed') return result;
  }
  return { type: 'passthrough' };
}
