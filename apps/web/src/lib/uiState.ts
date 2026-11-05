import { useCallback, useSyncExternalStore } from "react";

/** Layout preferences persisted per browser (sidebar, right panel, terminal drawer). */
export interface UiState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: "info" | "files" | "diff" | "preview";
  terminalOpen: boolean;
  paletteOpen: boolean;
}

const KEY = "orbs:ui";
const defaults: UiState = {
  sidebarOpen: true,
  rightPanelOpen: false,
  rightPanelTab: "info",
  terminalOpen: false,
  paletteOpen: false,
};
const listeners = new Set<() => void>();
let state: UiState = (() => {
  try {
    return {
      ...defaults,
      ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiState>),
      paletteOpen: false,
    };
  } catch {
    return defaults;
  }
})();

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  const { paletteOpen: _transient, ...persisted } = state;
  localStorage.setItem(KEY, JSON.stringify(persisted));
  for (const listener of listeners) listener();
}

export function useUi<T>(select: (s: UiState) => T): T {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return useSyncExternalStore(subscribe, () => select(state));
}
