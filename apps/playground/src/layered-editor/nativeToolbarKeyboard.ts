import { tabbable } from 'tabbable';

// Also order cleanup/enable across React effect remounts.
const nativeUpdates = new WeakMap<Document, Promise<void>>();

type NativeToolbarKey = {
  scope: string;
  sequence: number;
  key: 'Escape' | 'Tab';
  shiftKey: boolean;
  source: 'ios-key-command';
  colorEscape?: boolean;
};

declare global {
  interface Window {
    __paintingToolbarKeyboard?: {
      receive: (key: NativeToolbarKey) => boolean;
      snapshot: () => {
        scope: string;
        acknowledgedScope: string;
        tabOnly: boolean;
        acknowledgedTabOnly: boolean;
        composingConnected: boolean;
        activeTag: string | null;
      };
    };
  }
}

/** iOS-only fallback for WKWebView's missing non-editing hardware key delivery. */
export function installNativeToolbarKeyboard(
  doc: Document,
  setNativeScope: (scope: string, tabOnly: boolean) => Promise<void>
) {
  const view = doc.defaultView!;
  let panel: Element | null | undefined;
  let scope = '';
  let acknowledgedScope = '';
  let tabOnly = false;
  let acknowledgedTabOnly = false;
  let sequence = 0;
  let composing: Element | null = null;
  let disposed = false;
  let publication = 0;
  const isColorField = (target: Element | null) =>
    target instanceof HTMLInputElement &&
    target.matches('input[type=text][data-toolbar-color-field="true"]');
  const isEditing = (target: Element | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('[contenteditable="true"]') !== null ||
      target.matches(
        'textarea,input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])'
      ));
  // Keep in-flight calls ordered, but never send a superseded queued enable.
  // Rejecting its callback in receive() is too late: UIKit already took the key.
  const publish = (value: string, onlyTab = false) => {
    const version = ++publication;
    const update = (nativeUpdates.get(doc) ?? Promise.resolve())
      .then(async () => {
        if (value) {
          // Focus/visibility/removal can change while an earlier Expo receipt is
          // pending, including before the corresponding observer has run.
          sync();
          if (disposed || version !== publication || value !== scope || onlyTab !== tabOnly) return;
        }
        // WKContentView's public text state does not identify its DOM editor.
        // Color focus must revoke authority, never grant an
        // editing exception that could outlive the Expo acknowledgement.
        const nativeScope = onlyTab ? '' : value;
        await setNativeScope(nativeScope, false);
        acknowledgedScope = nativeScope;
        acknowledgedTabOnly = false;
      })
      .catch((error: unknown) => {
        console.warn(
          'Unable to configure iOS toolbar keyboard commands; rebuild the client.',
          error
        );
      });
    nativeUpdates.set(doc, update);
  };
  const currentPanel = () => {
    const target = doc.activeElement;
    // WebKit may remove a cancelled IME editor without compositionend. A
    // composition belongs to that editor, never to the whole document forever.
    if (composing && (!composing.isConnected || !composing.contains(target))) composing = null;
    if (
      disposed ||
      composing ||
      doc.visibilityState !== 'visible' ||
      !(target instanceof HTMLElement)
    )
      return null;
    // Retain panel identity across color traversal, but publish a native disable
    // while editing color. Only its original WebKit Tab may move focus out.
    if (isEditing(target) && !isColorField(target)) return null;
    return target.closest('.hn-painting-panel');
  };
  const sync = () => {
    if (disposed) return;
    const next = currentPanel();
    const nextTabOnly = Boolean(next && isColorField(doc.activeElement));
    if (next === panel && nextTabOnly === tabOnly) return;
    const changedPanel = next !== panel;
    panel = next;
    tabOnly = nextTabOnly;
    // Expo development pages can use plain HTTP on the LAN. randomUUID is
    // secure-context-only; getRandomValues also works on that development URL.
    if (changedPanel)
      scope = next
        ? Array.from(view.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join('')
        : '';
    publish(scope, tabOnly);
  };
  const moveTab = (target: HTMLElement, backwards: boolean) => {
    // Share the same order for bridged keys and the real WebKit color-field Tab.
    const order = tabbable(doc.body);
    const index = order.indexOf(target);
    const next = order[index + (backwards ? -1 : 1)];
    if (index >= 0 && next) next.focus();
    else target.blur(); // End of document: leave the panel; never trap/wrap.
    sync();
  };
  const bridge = {
    // Read-only diagnostics for failed transitions; never repairs state on read.
    snapshot: () => ({
      scope,
      acknowledgedScope,
      tabOnly,
      acknowledgedTabOnly,
      composingConnected: Boolean(composing?.isConnected),
      activeTag: doc.activeElement?.tagName ?? null,
    }),
    receive(message: NativeToolbarKey) {
      sync(); // Recheck live focus before consuming an async native callback.
      if (
        !scope ||
        message.scope !== scope ||
        message.source !== 'ios-key-command' ||
        !Number.isSafeInteger(message.sequence) ||
        message.sequence <= sequence ||
        !['Escape', 'Tab'].includes(message.key) ||
        tabOnly ||
        typeof message.shiftKey !== 'boolean'
      )
        return false;
      sequence = message.sequence;
      const target = doc.activeElement as HTMLElement;
      // This event is intentionally untrusted. Never disguise it as WebKit input.
      const event = new KeyboardEvent('keydown', {
        key: message.key,
        code: message.key,
        shiftKey: message.shiftKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      const allowDefault = target.dispatchEvent(event);
      if (message.key === 'Tab' && allowDefault && doc.activeElement === target) {
        // Untrusted Tab has no default action. Use real tab order, including
        // disabled/hidden controls, positive tabindex, and radio groups.
        moveTab(target, message.shiftKey);
      }
      sync();
      return true;
    },
  };
  view.__paintingToolbarKeyboard = bridge;
  const colorTab = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      event.isComposing ||
      composing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !(target instanceof HTMLInputElement) ||
      !target.matches('[data-toolbar-color-field="true"]') ||
      !target.closest('.hn-painting-panel') ||
      doc.activeElement !== target
    )
      return;
    // iOS's editing traversal can jump straight to BODY, skipping the range.
    // Keep this original trusted event; cancel only its incorrect default move.
    event.preventDefault();
    queueMicrotask(() => {
      // Let ToolbarPanel observe the key at its original target before moving.
      if (
        !disposed &&
        target.isConnected &&
        doc.activeElement === target &&
        doc.visibilityState === 'visible'
      )
        moveTab(target, event.shiftKey);
    });
  };
  let focusFrame = 0;
  let focusVersion = 0;
  type Touch = {
    control: HTMLInputElement;
    pointer: number;
    origin: Element | null;
    focusVersion: number;
    released: boolean;
    waitForLabelClick?: boolean;
  };
  let touched: Touch | undefined;
  const cancelFocus = () => {
    view.cancelAnimationFrame(focusFrame);
    focusFrame = 0;
  };
  const touchControl = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const control = target.closest('input') ?? target.closest('label')?.control;
    return control instanceof HTMLInputElement &&
      control.matches('input[type=radio],input[type=checkbox],input[type=range]') &&
      !control.disabled &&
      control.closest('.hn-painting-panel')
      ? control
      : null;
  };
  const restoreTouchedFocus = (touch: Touch) => {
    cancelFocus();
    const { control, origin } = touch;
    const owner = control.closest('.hn-painting-panel');
    // Finish the touch default actions first: UIKit blurs radio/range to BODY.
    focusFrame = view.requestAnimationFrame(() => {
      focusFrame = 0;
      const active = doc.activeElement;
      // iOS range dragging can leave the pre-existing color editor focused.
      // Only that unchanged focus may yield; a newer editor must never lose it.
      const oldColor =
        active === origin &&
        touch.focusVersion === focusVersion &&
        isColorField(origin) &&
        origin?.closest('.hn-painting-panel') === owner;
      if (
        disposed ||
        doc.visibilityState !== 'visible' ||
        !control.isConnected ||
        control.disabled ||
        !owner ||
        control.closest('.hn-painting-panel') !== owner ||
        (active !== doc.body &&
          active !== control &&
          ((isEditing(active) && !oldColor) || active?.closest('.hn-painting-panel') !== owner))
      )
        return;
      control.focus({ preventScroll: true });
      sync();
    });
  };
  const pointerDown = (event: PointerEvent) => {
    cancelFocus(); // A new interaction, including text/canvas, cancels old work.
    const control = touchControl(event.target);
    touched = control
      ? {
          control,
          pointer: event.pointerId,
          origin: doc.activeElement,
          focusVersion,
          released: false,
          // Blurring a color editor can resize/reposition the panel before
          // UIKit hit-tests its delayed compatibility click. Let the label's
          // real activation finish first; focusing a radio never selects it.
          waitForLabelClick: isColorField(doc.activeElement) && event.target !== control,
        }
      : undefined;
  };
  const pointerUp = (event: PointerEvent) => {
    if (touched && !touched.released && touched.pointer === event.pointerId) {
      touched.released = true;
      if (!touched.waitForLabelClick) restoreTouchedFocus(touched);
    }
  };
  const pointerCancel = () => {
    touched = undefined;
    cancelFocus();
  };
  const click = (event: MouseEvent) => {
    // UIKit's compatibility mousedown can blur a control after the pointerup
    // frame already restored it. Restore again after click defaults, keeping
    // the original gesture/old-editor guard even for a drag's ancestor click.
    if (touched?.released && event.detail > 0) {
      restoreTouchedFocus(touched);
      touched = undefined;
      return;
    }
    touched = undefined;
    cancelFocus();
    const control = touchControl(event.target);
    if (control)
      restoreTouchedFocus({
        control,
        origin: doc.activeElement,
        focusVersion,
        pointer: -1,
        released: true,
      }); // Label/AX activation without a pointer.
  };
  const keyDown = (event: KeyboardEvent) => {
    touched = undefined;
    cancelFocus(); // A completed keyboard move must not be undone by an old tap.
    colorTab(event);
  };
  const focusOut = () => queueMicrotask(sync);
  const focusIn = () => {
    focusVersion++;
    sync();
  };
  const compositionStart = (event: CompositionEvent) => {
    composing = event.target instanceof Element ? event.target : null;
    sync();
  };
  const compositionEnd = (event: CompositionEvent) => {
    if (event.target === composing) composing = null;
    sync();
  };
  // No pointermove work and no mutation during input sampling.
  const observer = new MutationObserver(sync);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('focusin', focusIn);
  doc.addEventListener('focusout', focusOut);
  doc.addEventListener('visibilitychange', sync);
  doc.addEventListener('compositionstart', compositionStart);
  doc.addEventListener('compositionend', compositionEnd);
  doc.addEventListener('keydown', keyDown);
  doc.addEventListener('pointerdown', pointerDown, true);
  doc.addEventListener('pointerup', pointerUp, true);
  doc.addEventListener('pointercancel', pointerCancel, true);
  doc.addEventListener('click', click);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    panel = null;
    scope = '';
    tabOnly = false;
    cancelFocus();
    touched = undefined;
    observer.disconnect();
    doc.removeEventListener('focusin', focusIn);
    doc.removeEventListener('focusout', focusOut);
    doc.removeEventListener('visibilitychange', sync);
    doc.removeEventListener('compositionstart', compositionStart);
    doc.removeEventListener('compositionend', compositionEnd);
    doc.removeEventListener('keydown', keyDown);
    doc.removeEventListener('pointerdown', pointerDown, true);
    doc.removeEventListener('pointerup', pointerUp, true);
    doc.removeEventListener('pointercancel', pointerCancel, true);
    doc.removeEventListener('click', click);
    if (view.__paintingToolbarKeyboard === bridge) delete view.__paintingToolbarKeyboard;
    publish('');
  };
}
