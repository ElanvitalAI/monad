'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { debugLog } from '@/lib/debug';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';

export const THEMES = [
  'catppuccin-mocha',
  'mocha-pastel-accent',
  'catppuccin-latte',
  'rose-pine-dawn',
  'nord-light',
  'monad-pastel-default',
] as const;

export type ThemeName = (typeof THEMES)[number];

const STORAGE_KEY = 'monad.pwa.theme';
const SWITCH_ID = 'dashboard.theme.active';
const DEFAULT_THEME: ThemeName = 'catppuccin-mocha';

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEMES.includes(value as ThemeName);
}

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  themes: readonly ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const client = useOptionalNexusClient();
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const daemonThemeGeneration = useRef(0);

  const applyTheme = useCallback((next: ThemeName): void => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      document.documentElement.dataset.theme = next;
    }
  }, []);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const next = isThemeName(saved) ? saved : DEFAULT_THEME;
    applyTheme(next);
    debugLog('webterm.provider.theme.init', { theme: next });
  }, [applyTheme]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    const generation = daemonThemeGeneration.current;

    void client.getSwitch(SWITCH_ID)
      .then(({ switch: themeSwitch }) => {
        if (!active || generation !== daemonThemeGeneration.current || !isThemeName(themeSwitch.value)) return;
        applyTheme(themeSwitch.value);
        localStorage.setItem(STORAGE_KEY, themeSwitch.value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [applyTheme, client]);

  const setTheme = useCallback((next: ThemeName): void => {
    if (!isThemeName(next)) return;
    daemonThemeGeneration.current += 1;
    applyTheme(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
    }
    debugLog('webterm.provider.theme.set', { theme: next });
    void client?.putSwitch(SWITCH_ID, { value: next }).catch(() => undefined);
  }, [applyTheme, client]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
