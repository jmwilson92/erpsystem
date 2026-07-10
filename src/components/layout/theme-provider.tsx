"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}>({
  theme: "dark",
  setTheme: () => undefined,
  toggle: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem("forge-theme") as Theme | null) || null;
    const preferred =
      stored ||
      (window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark");
    setThemeState(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
    document.documentElement.classList.toggle("light", preferred === "light");
    document.documentElement.style.colorScheme = preferred;
    setReady(true);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("forge-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.classList.toggle("light", t === "light");
    document.documentElement.style.colorScheme = t;
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Avoid flash mismatch — still render children
  void ready;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
