import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Keyboard, View, type KeyboardEvent, type KeyboardMetrics } from 'react-native';

type HostFrame = { x: number; y: number; width: number; height: number };

/** Bound the WebView by the native keyboard, including interrupted hide/show. */
export function IosKeyboardHost({ children }: PropsWithChildren) {
  const host = useRef<View>(null);
  const measurement = useRef({ version: 0 });
  const [frame, setFrame] = useState<HostFrame>();
  const [keyboard, setKeyboard] = useState<KeyboardMetrics | undefined>(() => Keyboard.metrics());
  const measure = useCallback(() => {
    const version = ++measurement.current.version;
    host.current?.measureInWindow((x, y, width, height) => {
      if (version !== measurement.current.version) return;
      setFrame((old) =>
        old?.x === x && old.y === y && old.width === width && old.height === height
          ? old
          : { x, y, width, height }
      );
    });
  }, []);
  useEffect(() => {
    const generation = measurement.current;
    const update = (name: string, event: KeyboardEvent, completed: boolean) => {
      if (event.isEventFromThisApp === false) return;
      const next = event.endCoordinates;
      // Reserve space as soon as the keyboard approaches. Do not release it
      // on willHide: focus can return to color before that hide completes,
      // producing frame notifications without another willShow.
      setKeyboard((old) =>
        completed || !old || (next.height > 0 && next.screenY < old.screenY) ? next : old
      );
      if (__DEV__)
        console.info('[HAM175 keyboard-frame]', JSON.stringify({ at: Date.now(), name, next }));
      measure();
    };
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', (event) => update('willShow', event, false)),
      Keyboard.addListener('keyboardWillChangeFrame', (event) =>
        update('willChangeFrame', event, false)
      ),
      Keyboard.addListener('keyboardDidShow', (event) => update('didShow', event, true)),
      Keyboard.addListener('keyboardDidChangeFrame', (event) =>
        update('didChangeFrame', event, true)
      ),
      Keyboard.addListener('keyboardWillHide', (event) => {
        if (__DEV__)
          console.info(
            '[HAM175 keyboard-frame]',
            JSON.stringify({ at: Date.now(), name: 'willHide', next: event.endCoordinates })
          );
      }),
      Keyboard.addListener('keyboardDidHide', (event) => {
        if (event.isEventFromThisApp === false) return;
        setKeyboard(undefined);
        if (__DEV__)
          console.info(
            '[HAM175 keyboard-frame]',
            JSON.stringify({ at: Date.now(), name: 'didHide' })
          );
      }),
    ];
    measure();
    return () => {
      generation.version++;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [measure]);
  // RN converts iOS keyboard frames to window coordinates. Use the measured
  // window origin too, including the PencilKit header and safe-area offsets.
  const overlaps =
    frame &&
    keyboard &&
    keyboard.height > 0 &&
    keyboard.screenX < frame.x + frame.width &&
    keyboard.screenX + keyboard.width > frame.x &&
    keyboard.screenY < frame.y + frame.height &&
    keyboard.screenY + keyboard.height > frame.y;
  const maxHeight = overlaps ? Math.max(0, keyboard.screenY - frame.y) : undefined;
  useEffect(() => {
    if (__DEV__)
      console.info(
        '[HAM175 keyboard-layout]',
        JSON.stringify({ at: Date.now(), frame, keyboard, maxHeight })
      );
  }, [frame, keyboard, maxHeight]);
  return (
    <View
      ref={host}
      testID="layered-keyboard-window"
      collapsable={false}
      onLayout={measure}
      style={{ flex: 1 }}
    >
      <View testID="layered-keyboard-host" style={{ flex: 1, minHeight: 0, maxHeight }}>
        {children}
      </View>
    </View>
  );
}
