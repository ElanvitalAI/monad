import {
  DEFAULT_WIDGET_TOKENS,
  type ModalChromeWidgetTokens,
  type SelectViewWidgetTokens,
  type ThemeTokens,
} from '../theme/tokens.js';

export type SubmenuPopupThemeRole = 'parent' | 'child';

export function deriveSubmenuPopupRoleTheme(
  theme: ThemeTokens | undefined,
  role: SubmenuPopupThemeRole,
): ThemeTokens | undefined {
  if (!theme) return theme;
  const widgetTokens = theme.widgetTokens ?? DEFAULT_WIDGET_TOKENS;
  const chrome = widgetTokens.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome;
  const selectView = widgetTokens.selectView ?? DEFAULT_WIDGET_TOKENS.selectView;
  const rowBg = role === 'parent' ? theme.colors.highlight : theme.colors.info;
  const hoverBg = role === 'parent' ? theme.colors.warning : theme.colors.accent;
  const accentFg = role === 'parent' ? theme.colors.highlight : theme.colors.info;
  const textOnAccent = '#1e1e2e';
  return {
    ...theme,
    widgetTokens: {
      ...widgetTokens,
      modalChrome: deriveModalChromeRoleTokens(chrome, accentFg),
      selectView: deriveSelectViewRoleTokens(selectView, rowBg, hoverBg, textOnAccent),
    },
  };
}

function deriveModalChromeRoleTokens(
  chrome: ModalChromeWidgetTokens | undefined,
  accentFg: string,
): ModalChromeWidgetTokens | undefined {
  if (!chrome) return chrome;
  return {
    ...chrome,
    titleText: {
      ...chrome.titleText,
      fg: accentFg,
      bold: true,
    },
    borderActive: {
      ...chrome.borderActive,
      fg: accentFg,
    },
    separator: {
      ...(chrome.separator ?? chrome.borderActive),
      fg: accentFg,
    },
  };
}

function deriveSelectViewRoleTokens(
  selectView: SelectViewWidgetTokens,
  rowBg: string,
  hoverBg: string,
  textOnAccent: string,
): SelectViewWidgetTokens {
  return {
    ...selectView,
    cursor: {
      ...selectView.cursor,
      fg: textOnAccent,
      bg: rowBg,
      bold: true,
    },
    selected: {
      ...selectView.selected,
      fg: textOnAccent,
      bg: rowBg,
      bold: true,
    },
    hovered: {
      ...(selectView.hovered ?? selectView.selected),
      fg: textOnAccent,
      bg: hoverBg,
    },
  };
}
