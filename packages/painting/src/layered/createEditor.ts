import { createLayeredEditorController } from '../core/layeredEditorController';
import type { EditorDocument } from '../model/document';
import type { LayeredInputMode } from '../core/layeredInputMode';
import { readInputModePreference } from './inputModePreference';

let nextEditor = 0;
export function createEditor(
  document: EditorDocument = { schemaVersion: 3, documentRevision: 0, objects: [] },
  options: { inputMode?: LayeredInputMode } = {}
) {
  const editorId = ++nextEditor;
  let sequence = 0;
  const reservedIds = new Set(document.objects.map((object) => object.objectId));
  const result = createLayeredEditorController({
    inputMode: options.inputMode ?? readInputModePreference(),
    document,
    activeTool: 'freehand',
    viewport: { revision: 0, viewport: { scale: 1, tx: 0, ty: 0 } },
    settings: {
      freehand: {
        color: '#2D2D2D',
        nominalSize: 8,
        opacity: 1,
        pressureMode: 'auto',
        presetRevision: 1,
      },
      shape: { color: '#2D2D2D', width: 2, opacity: 1 },
    },
    allocateObjectId: () => {
      let id: string;
      do {
        id = `editor-${editorId}-object-${++sequence}`;
      } while (reservedIds.has(id));
      reservedIds.add(id);
      return id;
    },
  });
  if (!result.ok) throw new Error(`Cannot create editor: ${result.error.code}`);
  return result.value;
}
