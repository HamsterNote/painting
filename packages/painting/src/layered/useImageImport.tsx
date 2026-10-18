import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { IDENTITY_TRANSFORM, type Point } from '../model/document';

const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 8192;
const MAX_PIXELS = 40_000_000;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function decodeImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('浏览器无法解码该图片'));
    image.src = src;
  });
}

/** Only decoded, current imports enter the document; data URLs survive save and undo/redo. */
export function useImageImport(controller: LayeredEditorController, allocateId: () => string) {
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<Point | undefined>(undefined);
  const operation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalidate = useCallback(() => {
    operation.current++;
  }, []);
  const cancel = useCallback(() => {
    invalidate();
    anchor.current = undefined;
    setBusy(false);
  }, [invalidate]);
  useEffect(() => {
    const unsubscribe = controller.subscribe('tools', cancel);
    const element = input.current;
    element?.addEventListener('cancel', cancel);
    return () => {
      invalidate();
      unsubscribe();
      element?.removeEventListener('cancel', cancel);
    };
  }, [controller, cancel, invalidate]);

  const openAt = useCallback((point: Point) => {
    operation.current++;
    anchor.current = point;
    setBusy(false);
    setError('');
    input.current?.click();
  }, []);

  async function importFile(file: File) {
    const current = ++operation.current;
    const document = controller.getSnapshot('document');
    const point = anchor.current;
    const { viewport } = controller.getSnapshot('viewport');
    if (!point) return;
    setBusy(true);
    setError('');
    try {
      if (!MIME_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPEG、WebP');
      if (file.size <= 0 || file.size > MAX_FILE_BYTES)
        throw new Error('图片文件须大于 0 且不超过 20 MB');
      const src = await readImage(file);
      if (operation.current !== current) return;
      const { width, height } = await decodeImage(src);
      if (operation.current !== current) return;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width > MAX_EDGE ||
        height > MAX_EDGE ||
        width * height > MAX_PIXELS
      )
        throw new Error('图片尺寸超限（边长 8192 px，总像素 4000 万）');
      const displayWidth = Math.min(240, width) / viewport.scale;
      const displayHeight = (displayWidth * height) / width;
      const result = controller.editObjects({
        expectedDocumentRevision: document.documentRevision,
        upsert: [
          {
            kind: 'image',
            objectId: allocateId(),
            objectRevision: 1,
            transformRevision: 1,
            transform: IDENTITY_TRANSFORM,
            src,
            localBounds: {
              minX: point.x,
              minY: point.y,
              maxX: point.x + displayWidth,
              maxY: point.y + displayHeight,
            },
          },
        ],
      });
      if (!result.ok) throw new Error(`图片未导入：${result.error.code}`);
    } catch (failure) {
      if (operation.current === current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (operation.current === current) {
        anchor.current = undefined;
        setBusy(false);
      }
    }
  }

  return {
    openAt,
    element: (
      <div data-interactive="true" style={{ position: 'absolute', bottom: 8, left: 8 }}>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="导入图片文件"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importFile(file);
            else cancel();
          }}
        />
        {busy ? (
          <div role="status">
            正在导入图片{' '}
            <button type="button" onClick={cancel}>
              取消
            </button>
          </div>
        ) : null}
        {error ? <div role="alert">{error}</div> : null}
      </div>
    ),
  };
}
