import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { ToolbarPopover } from './ToolbarPopover';
import type { PaneToolbarLayout, ToolbarFileNavigationProps } from './types';

export type ToolbarFileMenuProps = ToolbarFileNavigationProps & {
  layout?: PaneToolbarLayout;
  /** Close sibling tool panels before opening this menu. Outside focus/pointer closes it in reverse. */
  onOpen?: () => void;
};
let requestSequence = 0;

/** Controlled file navigation: only a host snapshot may change the current file or list. */
export function ToolbarFileMenu({
  files,
  currentFileKey,
  paneId,
  busy = false,
  onSelectFile,
  onRequestRemove,
  layout,
  onOpen,
}: ToolbarFileMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [openedPane, setOpenedPane] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const generation = useRef(0);
  const restoreAfterRequest = useRef(false);
  const close = useCallback((restoreFocus: boolean) => {
    generation.current++;
    setOpenedPane(null);
    setError('');
    restoreAfterRequest.current = restoreFocus;
  }, []);
  useLayoutEffect(() => {
    // A successful async request closes while its trigger is still disabled.
    // Restore only after the host and local single-flight locks release.
    if (openedPane === null && restoreAfterRequest.current && !anchor.current?.disabled) {
      restoreAfterRequest.current = false;
      anchor.current?.focus();
    }
  }, [openedPane, pending, busy, paneId]);
  const open = () => {
    if (!paneId || busy || locked.current) return;
    onOpen?.();
    generation.current++;
    restoreAfterRequest.current = false;
    setError('');
    setOpenedPane(paneId);
  };
  const request = async (fileKey: string, remove: boolean) => {
    const handler = remove ? onRequestRemove : onSelectFile;
    if (openedPane === null || busy || locked.current) return;
    if (!remove && fileKey === currentFileKey) {
      close(true);
      return;
    }
    if (!handler) return;
    if (remove && (!files || files.length <= 1)) return;
    const token = generation.current;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const result = await handler({
        fileKey,
        paneId: openedPane,
        requestId: `${id}-${++requestSequence}`,
      });
      if (token !== generation.current) return;
      if (result.status === 'success') close(true);
      else if (result.status === 'failed') setError(result.message);
    } catch (reason) {
      if (token === generation.current)
        setError(reason instanceof Error ? reason.message : '文件操作失败，请重试');
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  if (files === undefined) return null;
  const disabled = busy || pending;
  return (
    <div ref={root} className="hn-toolbar-files" style={{ display: 'flex', flex: '0 0 auto' }}>
      <button
        ref={anchor}
        type="button"
        aria-label="文件"
        title="文件"
        data-interactive="true"
        disabled={disabled || !paneId}
        aria-haspopup="menu"
        aria-expanded={openedPane !== null}
        aria-controls={openedPane !== null ? id : undefined}
        onClick={() => (openedPane === null ? open() : close(false))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
          }
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      {openedPane !== null ? (
        <ToolbarPopover
          id={id}
          label="文件列表"
          menu
          anchor={anchor}
          boundary={root}
          layout={layout}
          onClose={close}
        >
          {files.length === 0 ? <p role="status">没有可切换的文件</p> : null}
          {files.map((file) => (
            <div key={file.key} className="hn-toolbar-file-row">
              <button
                type="button"
                role="menuitemradio"
                style={{ height: 'auto', minHeight: 44 }}
                aria-checked={file.key === currentFileKey}
                disabled={disabled || (!onSelectFile && file.key !== currentFileKey)}
                onClick={() => void request(file.key, false)}
              >
                <span>
                  {file.key === currentFileKey ? '✓ ' : ''}
                  {file.displayName}
                  <small>
                    {file.storageId} · {file.path}
                  </small>
                </span>
              </button>
              {onRequestRemove ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`移除 ${file.displayName}（${file.storageId} · ${file.path}）`}
                  title={files.length <= 1 ? '不能移除最后一个文件' : '移除文件'}
                  disabled={disabled || files.length <= 1}
                  onClick={() => void request(file.key, true)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {pending ? <p role="status">正在处理…</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </ToolbarPopover>
      ) : null}
    </div>
  );
}
