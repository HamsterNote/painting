import { tabbable } from 'tabbable';

// Also order cleanup/enable across React effect remounts.
const nativeUpdates = new WeakMap<Document, Promise<void>>();

type NativeToolbarKey = {
  scope: string;
  sequence: number;
  key: 'Escape' | 'Tab';
  shiftKey: boolean;
  source: 'ios-key-command';
};

declare global {
  interface Window {
    __paintingToolbarKeyboard?: {
      receive: (key: NativeToolbarKey) => boolean;
      snapshot: () => {
        scope: string;
        acknowledgedScope: string;
        composingConnected: boolean;
        activeTag: string | null;
      };
    };
  }
}

/** iOS-only fallback for WKWebView's missing non-editing hardware key delivery. */
export function installNativeToolbarKeyboard(
  doc: Document,
  setNativeScope: (scope: string) => Promise<void>
) {
  const view = doc.defaultView!;
  let panel: Element | null | undefined;
  let scope = '';
  let acknowledgedScope = '';
  let sequence = 0;
  let composing: Element | null = null;
  let disposed = false;
  // Serialize the async Expo action so an old enable cannot overtake a disable.
  const publish = (value: string) => {
    const update = (nativeUpdates.get(doc) ?? Promise.resolve())
      .then(async () => {
        await setNativeScope(value);
        acknowledgedScope = value;
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
    if (
      target.isContentEditable ||
      target.closest('[contenteditable="true"]') ||
      target.matches(
        'textarea,input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])'
      )
    )
      return null;
    return target.closest('.hn-painting-panel');
  };
  const sync = () => {
    const next = currentPanel();
    if (next === panel) return;
    panel = next;
    // Expo development pages can use plain HTTP on the LAN. randomUUID is
    // secure-context-only; getRandomValues also works on that development URL.
    scope = next
      ? Array.from(view.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      : '';
    publish(scope);
  };
  const bridge = {
    // Read-only diagnostics for failed transitions; never repairs state on read.
    snapshot: () => ({
      scope,
      acknowledgedScope,
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
        const order = tabbable(doc.body);
        const index = order.indexOf(target);
        const next = order[index + (message.shiftKey ? -1 : 1)];
        if (index >= 0 && next) next.focus();
        else target.blur(); // End of document: leave the panel; never trap/wrap.
      }
      sync();
      return true;
    },
  };
  view.__paintingToolbarKeyboard = bridge;
  const focusOut = () => queueMicrotask(sync);
  const compositionStart = (event: CompositionEvent) => {
    composing = event.target instanceof Element ? event.target : null;
    sync();
  };
  const compositionEnd = (event: CompositionEvent) => {
    if (event.target === composing) composing = null;
    sync();
  };
  // No per-point pointer listeners, and no DOM mutation during input sampling.
  const observer = new MutationObserver(sync);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('focusin', sync);
  doc.addEventListener('focusout', focusOut);
  doc.addEventListener('visibilitychange', sync);
  doc.addEventListener('compositionstart', compositionStart);
  doc.addEventListener('compositionend', compositionEnd);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    panel = null;
    scope = '';
    observer.disconnect();
    doc.removeEventListener('focusin', sync);
    doc.removeEventListener('focusout', focusOut);
    doc.removeEventListener('visibilitychange', sync);
    doc.removeEventListener('compositionstart', compositionStart);
    doc.removeEventListener('compositionend', compositionEnd);
    if (view.__paintingToolbarKeyboard === bridge) delete view.__paintingToolbarKeyboard;
    publish('');
  };
}
