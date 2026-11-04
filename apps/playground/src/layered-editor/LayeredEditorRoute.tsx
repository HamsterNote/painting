import LayeredEditorDom from './LayeredEditorDom';
import { NativeEditorHost, editorDOMProps } from './NativeEditorHost';

export default function LayeredEditorRoute() {
  return (
    <NativeEditorHost>
      <LayeredEditorDom dom={editorDOMProps} />
    </NativeEditorHost>
  );
}
