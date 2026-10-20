import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useSettings } from '../state/settings';
import { ColorTokens, darkColors, lightColors } from './tokens';

export interface Theme {
  dark: boolean;
  colors: ColorTokens;
}

const ThemeContext = createContext<Theme>({ dark: true, colors: darkColors });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const pref = useSettings((s) => s.appearance);
  const dark = pref === 'system' ? system !== 'light' : pref === 'dark';
  const value = useMemo(() => ({ dark, colors: dark ? darkColors : lightColors }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
