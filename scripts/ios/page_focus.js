// Evaluate with the existing Web Inspector connection before/after each HID group.
// Read-only snapshot: no focus(), events, listeners, text values or result rewriting.
(() => {
  const active = document.activeElement;
  return {
    at: new Date().toISOString(),
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
    isTopFrame: window === window.top,
    url: location.href,
    active: active
      ? {
          tag: active.tagName,
          type: active.getAttribute('type'),
          role: active.getAttribute('role'),
          label: active.getAttribute('aria-label'),
          contentEditable: active instanceof HTMLElement && active.isContentEditable,
        }
      : null,
  };
})();
