import { useCallback, useSyncExternalStore } from 'react';

/**
 * App-wide "Show formulas & data sources" preference (demo aid). Stored per browser in
 * localStorage; every component using this hook re-renders when it changes, in this tab
 * (custom event) and in other tabs (storage event).
 */
export const SHOW_FORMULAS_STORAGE_KEY = 'irongate_show_formulas';
const CHANGE_EVENT = 'irongate:show-formulas-change';

// Used only when localStorage is unavailable (private mode, blocked storage).
let memoryValue = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(SHOW_FORMULAS_STORAGE_KEY) === 'true';
  } catch {
    return memoryValue;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHOW_FORMULAS_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useShowFormulas(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => false);
  const setValue = useCallback((next: boolean) => {
    memoryValue = next;
    try {
      window.localStorage.setItem(SHOW_FORMULAS_STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      // Storage unavailable: the in-memory value still applies until the page reloads.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [value, setValue];
}
