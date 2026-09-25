import {
  classifyBgMode,
  queryTerminalBg,
  type TerminalBgResult,
} from '../panes/terminal-bg-query.js';
import { THEME_REGISTRY } from '../themes/index.js';

type AutoThemeRegistryEntry = {
  name: string;
  isDark?: boolean;
};

type AutoThemeSuggestion = {
  themeName: string | null;
  reason:
    | 'explicit-user-selection'
    | 'terminal-background'
    | 'terminal-background-unavailable'
    | 'no-matching-theme';
  mode: 'dark' | 'light' | null;
};

type SuggestAutoThemeOptions = {
  currentThemeName: string;
  hasExplicitUserSelection: boolean;
  registry?: ReadonlyArray<AutoThemeRegistryEntry>;
  query?: () => Promise<TerminalBgResult> | TerminalBgResult;
};

/**
 * Suggest a registered theme for the terminal background without applying
 * or persisting it. An explicit user selection always takes precedence.
 */
export async function suggestAutoTheme(
  options: SuggestAutoThemeOptions,
): Promise<AutoThemeSuggestion> {
  if (options.hasExplicitUserSelection) {
    return {
      themeName: options.currentThemeName,
      reason: 'explicit-user-selection',
      mode: null,
    };
  }

  let terminalBackground: TerminalBgResult;
  try {
    terminalBackground = await (options.query ?? queryTerminalBg)();
  } catch {
    return {
      themeName: null,
      reason: 'terminal-background-unavailable',
      mode: null,
    };
  }

  if (!terminalBackground.rgb || terminalBackground.mode === null) {
    return {
      themeName: null,
      reason: 'terminal-background-unavailable',
      mode: null,
    };
  }

  const mode = classifyBgMode(terminalBackground.rgb);
  const theme = (options.registry ?? THEME_REGISTRY).find(
    ({ isDark }) => isDark !== undefined && isDark === (mode === 'dark'),
  );
  if (!theme) {
    return { themeName: null, reason: 'no-matching-theme', mode };
  }

  return { themeName: theme.name, reason: 'terminal-background', mode };
}
