import { createContext, useContext, useEffect, useState } from 'react';
export const ThemeContext = createContext(null);
export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('nb_theme');
    return saved ? saved === 'dark' : true;
  });
  useEffect(() => {
    localStorage.setItem('nb_theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return <ThemeContext.Provider value={{ dark, setDark, toggle: () => setDark(d => !d) }}>{children}</ThemeContext.Provider>;
}
export function useTheme() { return useContext(ThemeContext); }
