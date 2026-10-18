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
  const result = createLayeredEditorController({
    inputMode: options.inputMode ?? readInputModePreference(),
    document,
    activeTool: 'freehand',
    viewport: { revision: 0, viewport: { scale: 1, tx: 0, ty: 0 } },
    settings: {
      freehand: {
        color: '#147d64',
        nominalSize: 8,
        opacity: 1,
        pressureMode: 'auto',
        presetRevision: 1,
      },
      shape: { color: '#20262d', width: 2, opacity: 1 },
    },
    allocateObjectId: () => `editor-${editorId}-object-${++sequence}`,
  });
  if (!result.ok) throw new Error(`Cannot create editor: ${result.error.code}`);
  return result.value;
}
