export const POINTER_DOWN_CAPTURE_OPTIONS = { capture: true } as const;

export function shouldCaptureVirtualPaperPointerDown(
  listenerTarget: EventTarget,
  host: HTMLElement,
  virtualPaperEnabled: boolean
): boolean {
  if (!virtualPaperEnabled) {
    return false;
  }
  if (listenerTarget === host) {
    return true;
  }
  if (!(listenerTarget instanceof Node)) {
    return false;
  }
  // Capture is only safe when the listener target is in the same DOM branch as
  // the virtual-paper wrapper. A custom external eventTarget outside the host
  // cannot observe wrapper capture before upstream mouse stopPropagation, so it
  // keeps legacy bubble semantics.
  return listenerTarget.contains(host) || host.contains(listenerTarget);
}
