import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
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

export function NativeEditorHost({ children, testID }: PropsWithChildren<{ testID?: string }>) {
  return (
    <SafeAreaView testID={testID} style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView
        testID="layered-keyboard-host"
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
