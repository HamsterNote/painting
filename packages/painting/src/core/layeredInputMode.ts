export type LayeredInputMode = 'auto' | 'finger' | 'pen';

export type LayeredInputSnapshot = Readonly<{
  mode: LayeredInputMode;
  penSeen: boolean;
  effectiveTouch: 'draw' | 'pan';
}>;

export function isLayeredInputMode(value: unknown): value is LayeredInputMode {
  return value === 'auto' || value === 'finger' || value === 'pen';
}

export function createLayeredInputSnapshot(
  mode: LayeredInputMode,
  penSeen = false
): LayeredInputSnapshot {
  return Object.freeze({
    mode,
    penSeen,
    effectiveTouch: mode === 'pen' || (mode === 'auto' && penSeen) ? 'pan' : 'draw',
  });
}
