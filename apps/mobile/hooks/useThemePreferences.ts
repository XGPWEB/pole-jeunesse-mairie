import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FontSize = 'small' | 'medium' | 'large';

export interface ThemePreferences {
  accentColor: string;
  fontSize: FontSize;
  compactMode: boolean;
  darkMode: boolean;
}

const DEFAULTS: ThemePreferences = {
  accentColor: '#6B1A6E',
  fontSize: 'medium',
  compactMode: false,
  darkMode: false,
};

const STORAGE_KEY = '@pj_theme_preferences';

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemePreferencesContextValue {
  preferences: ThemePreferences;
  updatePreference: <K extends keyof ThemePreferences>(
    key: K,
    value: ThemePreferences[K],
  ) => Promise<void>;
}

const ThemePreferencesContext = createContext<ThemePreferencesContextValue>({
  preferences: DEFAULTS,
  updatePreference: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemePreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [preferences, setPreferences] = useState<ThemePreferences>(DEFAULTS);

  // Load persisted preferences on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<ThemePreferences>;
          setPreferences((prev) => ({ ...prev, ...parsed }));
        }
      })
      .catch(() => {
        // Silently fall back to defaults if storage is unavailable
      });
  }, []);

  const updatePreference = useCallback(
    async <K extends keyof ThemePreferences>(
      key: K,
      value: ThemePreferences[K],
    ): Promise<void> => {
      const next = { ...preferences, [key]: value };
      setPreferences(next);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Silently ignore write errors
      }
    },
    [preferences],
  );

  return React.createElement(
    ThemePreferencesContext.Provider,
    { value: { preferences, updatePreference } },
    children,
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useThemePreferences(): ThemePreferencesContextValue {
  return useContext(ThemePreferencesContext);
}
