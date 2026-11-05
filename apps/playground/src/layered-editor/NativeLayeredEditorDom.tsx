import {
  useCallback,
  useRef,
  type ComponentProps,
  type ComponentType,
  type RefAttributes,
} from 'react';
import { Platform } from 'react-native';
import type { DomWebViewRef } from '@expo/dom-webview';
import LayeredEditorDom from './LayeredEditorDom';

type LayeredEditorDomProps = ComponentProps<typeof LayeredEditorDom>;

const DomComponent = LayeredEditorDom as unknown as ComponentType<
  LayeredEditorDomProps & RefAttributes<DomWebViewRef>
>;

export default function NativeLayeredEditorDom(props: LayeredEditorDomProps) {
  const webView = useRef<DomWebViewRef>(null);
  const requestKeyboardFocus = useCallback(async () => {
    await webView.current?.requestFocus();
  }, []);
  return (
    <DomComponent
      {...props}
      ref={webView}
      onRequestKeyboardFocus={Platform.OS === 'ios' ? requestKeyboardFocus : undefined}
    />
  );
}
