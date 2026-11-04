import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DOMProps } from 'expo/dom';

// The native host consumes all insets; WebView must not add a second safe area.
export const editorDOMProps: DOMProps = {
  style: { flex: 1, width: '100%' },
  containerStyle: { flex: 1, width: '100%' },
  contentInsetAdjustmentBehavior: 'never',
  automaticallyAdjustContentInsets: false,
  scrollEnabled: false,
};

function AndroidKeyboardHost({ children }: PropsWithChildren) {
  const host = useRef<View>(null);
  const [hostTop, setHostTop] = useState<number>();
  const [keyboardTop, setKeyboardTop] = useState(() => Keyboard.metrics()?.screenY);
  const measure = useCallback(() => {
    // Keyboard coordinates and measureInWindow share the native window space;
    // subtract the actual host origin, including safe area / embedded offsets.
    host.current?.measureInWindow((_x, y) => setHostTop(y));
  }, []);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      setKeyboardTop(endCoordinates.height > 0 ? endCoordinates.screenY : undefined);
      measure();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(undefined));
    measure();
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [measure]);
  return (
    <View
      ref={host}
      testID="layered-keyboard-window"
      collapsable={false}
      onLayout={measure}
      style={{ flex: 1 }}
    >
      <View
        testID="layered-keyboard-host"
        style={{
          flex: 1,
          minHeight: 0,
          // API 36 edge-to-edge may leave adjustResize's root at full height.
          // Cap, rather than subtract from, the available parent height so an
          // already resized window is not reduced by the IME a second time.
          maxHeight:
            keyboardTop !== undefined && hostTop !== undefined
              ? Math.max(0, keyboardTop - hostTop)
              : undefined,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function NativeEditorHost({ children, testID }: PropsWithChildren<{ testID?: string }>) {
  return (
    <SafeAreaView testID={testID} style={{ flex: 1, backgroundColor: '#fff' }}>
      {Platform.OS === 'android' ? (
        <AndroidKeyboardHost>{children}</AndroidKeyboardHost>
      ) : (
        <KeyboardAvoidingView testID="layered-keyboard-host" style={{ flex: 1 }} behavior="padding">
          {children}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
