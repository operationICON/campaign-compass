import { useState, useEffect, useRef } from "react";

/**
 * Drop-in replacement for useState that persists the value to localStorage
 * under the given key. Used for table preferences (sort, filter, page size,
 * activity filter) so they survive page refresh.
 *
 * Storage key pattern: "ct_table_prefs_{page}_{tab}_{field}"
 *
 * If parsing fails or the saved value is missing, falls back to `initial`.
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  // Avoid writing on the very first render if value === initial (saves a write)
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota / serialization errors
    }
  }, [key, value]);

  return [value, setValue];
}

/** Clear a set of persisted table prefs (used by "Reset to defaults" buttons). */
export function clearPersistedKeys(keys: string[]) {
  try {
    keys.forEach(k => localStorage.removeItem(k));
  } catch {}
}
