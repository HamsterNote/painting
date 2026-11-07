import NativeLayeredEditorDom from './NativeLayeredEditorDom';
import { NativeEditorHost, editorDOMProps } from './NativeEditorHost';

export default function LayeredEditorRoute() {
  return (
    <NativeEditorHost>
      <NativeLayeredEditorDom dom={editorDOMProps} />
    </NativeEditorHost>
  );
}
