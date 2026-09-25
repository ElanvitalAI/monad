import { C } from '../../tui.js';
import { paintPair, pair } from '../../theme/tokens.js';

export function renderSidebarShellRailRow(
  text: string,
  active: boolean,
  focused: boolean,
): string {
  if (!active) return C.muted(text);
  if (focused) return paintPair(pair('#2f4d63', { bg: '#e2effa', bold: true }))(text);
  return paintPair(pair('#53606b', { bg: '#edf1f4', bold: true }))(text);
}
