import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'resume-generator-theme';

export interface ThemeStore {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function getStoredTheme(): Theme {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return 'system';
}

export function persistTheme(theme: Theme): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Ignore storage errors
  }
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    }
    return 'light';
  }
  return theme;
}

export function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = resolveTheme(theme);
  if (typeof document !== 'undefined' && document.documentElement) {
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
  return resolved;
}

let activeMediaQueryCleanup: (() => void) | null = null;

export function setupSystemThemeListener(): () => void {
  if (activeMediaQueryCleanup) {
    activeMediaQueryCleanup();
    activeMediaQueryCleanup = null;
  }

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  try {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const currentTheme = useThemeStore.getState().theme;
      if (currentTheme === 'system') {
        const isDark = Boolean(event.matches);
        if (typeof document !== 'undefined' && document.documentElement) {
          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
        useThemeStore.setState({ resolvedTheme: isDark ? 'dark' : 'light' });
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemChange);
      const cleanup = () => mediaQuery.removeEventListener('change', handleSystemChange);
      activeMediaQueryCleanup = cleanup;
      return cleanup;
    } else if (typeof (mediaQuery as { addListener?: (fn: (e: MediaQueryList) => void) => void }).addListener === 'function') {
      (mediaQuery as { addListener: (fn: (e: MediaQueryList) => void) => void }).addListener(handleSystemChange);
      const cleanup = () => (mediaQuery as { removeListener: (fn: (e: MediaQueryList) => void) => void }).removeListener(handleSystemChange);
      activeMediaQueryCleanup = cleanup;
      return cleanup;
    }
  } catch {
    // Ignore media query registration issues in mock environments
  }

  return () => {};
}

const initialTheme = getStoredTheme();
const initialResolved = resolveTheme(initialTheme);

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: initialResolved,
  setTheme: (theme: Theme) => {
    persistTheme(theme);
    const resolved = applyTheme(theme);
    set({ theme, resolvedTheme: resolved });
  },
  toggleTheme: () => {
    const current = get().theme;
    const order: Theme[] = ['system', 'light', 'dark'];
    const nextIndex = (order.indexOf(current) + 1) % order.length;
    get().setTheme(order[nextIndex]);
  },
}));

if (typeof window !== 'undefined') {
  applyTheme(initialTheme);
  setupSystemThemeListener();
}
