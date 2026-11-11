import { createRoot } from 'react-dom/client';
import { ToolbarShell, ToolbarFileMenu } from '@hamster-note/painting/toolbar';
import { files, useFixtureHost } from './shared';

// Contract adapters for future reader/notes consumers, not copies of those editors.
function Fixture() {
  const host = useFixtureHost();
  const split = new URLSearchParams(window.location.search).has('split');
  const vertical = split && host.edge === 'top';
  return (
    <>
      {host.controls}
      <div
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          height: vertical ? 1000 : 600,
        }}
      >
        {(split ? ['reader', 'notes'] : ['reader', 'notes', 'legacy']).map((consumer) => {
          const layout =
            vertical && consumer === 'notes'
              ? {
                  ...host.layout,
                  edge: 'bottom' as const,
                  insets: { top: 0, bottom: 34, left: 0, right: 0 },
                  headerContentInset: 0,
                }
              : host.layout;
          return (
            <section
              key={consumer}
              data-testid={consumer}
              data-pane-toolbar-boundary
              style={{
                position: 'relative',
                width: 320,
                height: vertical ? 500 : 600,
                flexShrink: 0,
                border: '1px solid #ddd',
                boxSizing: 'border-box',
              }}
            >
              <ToolbarShell placement="floating" label={`${consumer} 工具`} layout={layout}>
                {consumer === 'reader' ? (
                  <button>目录</button>
                ) : (
                  <>
                    <button>撤销</button>
                    <button>重做</button>
                  </>
                )}
                <ToolbarFileMenu
                  files={consumer === 'legacy' ? undefined : files}
                  currentFileKey={host.current}
                  paneId={consumer}
                  onSelectFile={host.onSelectFile}
                  layout={layout}
                />
                <button>保存状态</button>
              </ToolbarShell>
            </section>
          );
        })}
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
