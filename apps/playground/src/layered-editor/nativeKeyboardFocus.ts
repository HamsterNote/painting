/** Keep UIKit's responder in the WebView when DOM controls aren't text editors. */
export function installNativeKeyboardFocus(doc: Document, requestFocus: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focusingPage = false;
  const isEditing = (element: Element | null) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable || element.matches('textarea,select')) return true;
    return (
      element instanceof HTMLInputElement &&
      !['button', 'submit', 'reset', 'checkbox', 'radio', 'range'].includes(element.type)
    );
  };
  const request = () => {
    clearTimeout(timer);
    // Let pointer defaults and programmatic focus settle before crossing the bridge.
    timer = setTimeout(() => {
      if (!isEditing(doc.activeElement))
        void requestFocus().catch((error: unknown) => {
          console.warn(
            'Unable to focus the iOS editor WebView; rebuild the development client.',
            error
          );
        });
    }, 0);
  };
  const focusPage = () => {
    // UIKit's first responder and WebKit's focused document/frame are separate.
    // Request page focus during the control interaction, before the async bridge.
    // window.focus() leaves the active control and WebKit's trusted key path intact.
    if (
      focusingPage ||
      doc.visibilityState !== 'visible' ||
      doc.hasFocus() ||
      isEditing(doc.activeElement)
    )
      return;
    focusingPage = true;
    try {
      doc.defaultView?.focus();
    } finally {
      focusingPage = false;
    }
  };
  const focusIn = () => {
    focusPage();
    request();
  };
  const pointerDown = (event: PointerEvent) => {
    // Drawing and PencilKit samples must never incur a per-point native action.
    if (event.target instanceof Element && event.target.closest('[data-interactive="true"]')) {
      if (!isEditing(event.target)) focusPage();
      request();
    }
  };
  doc.addEventListener('focusin', focusIn);
  doc.addEventListener('pointerdown', pointerDown, true);
  request(); // This runs from the DOM effect, after the page has loaded.
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('focusin', focusIn);
    doc.removeEventListener('pointerdown', pointerDown, true);
  };
}
