import { isLayeredInputMode, type LayeredInputMode } from '../core/layeredInputMode';

export const INPUT_MODE_PREFERENCE_KEY = 'hamster-note.painting.input-mode.v1';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): PreferenceStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function readInputModePreference(
  getStorage: () => PreferenceStorage | undefined = browserStorage
): LayeredInputMode | undefined {
  try {
    const stored = getStorage()?.getItem(INPUT_MODE_PREFERENCE_KEY);
    if (stored == null) return undefined;
    const mode: unknown = JSON.parse(stored);
    return isLayeredInputMode(mode) ? mode : undefined;
  } catch {
    return undefined;
  }
}

export function writeInputModePreference(
  mode: LayeredInputMode,
  getStorage: () => PreferenceStorage | undefined = browserStorage
): void {
  try {
    getStorage()?.setItem(INPUT_MODE_PREFERENCE_KEY, JSON.stringify(mode));
  } catch {
    // The controller already owns the selection; persistence is best effort.
  }
}
