import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  ToolbarFileMenu,
  ToolbarShell,
  type ToolbarFile,
  type ToolbarRequestResult,
} from '../toolbar';
import { Toolbar } from '../layered/Toolbar';
import { makeLayeredController, commitLayeredStroke } from './fixtures/layered';

const files: readonly ToolbarFile[] = [
  { key: 's1/A.pdf', storageId: 's1', path: '/A.pdf', displayName: 'A.pdf', resolvedFormat: 'pdf' },
  { key: 's2/A.pdf', storageId: 's2', path: '/A.pdf', displayName: 'A.pdf', resolvedFormat: 'pdf' },
  { key: 's1/B.hnn', storageId: 's1', path: '/B.hnn', displayName: 'B.hnn', resolvedFormat: 'hnn' },
];

test('legacy caller has no files control; opening and relocating preserve editor snapshots', () => {
  const controller = makeLayeredController();
  commitLayeredStroke(controller, 'ink');
  const document = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  const view = render(<Toolbar controller={controller} />);
  expect(screen.queryByRole('button', { name: '文件', exact: true })).toBeNull();
  const layout = {
    edge: 'top' as const,
    insets: { top: 24, bottom: 0, left: 0, right: 0 },
    headerContentInset: 44,
  };
  view.rerender(
    <Toolbar
      controller={controller}
      files={files}
      currentFileKey={files[0].key}
      paneId="primary"
      layout={layout}
      placement="floating"
    />
  );
  const buttons = screen.getByRole('toolbar').querySelectorAll('button');
  expect([...buttons].slice(0, 3).map((button) => button.getAttribute('aria-label'))).toEqual([
    '撤销',
    '重做',
    '文件',
  ]);
  expect(screen.getByRole('region').style.top).toBe('60px');
  fireEvent.click(screen.getByRole('button', { name: '文件', exact: true }));
  expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
    '✓ A.pdfs1 · /A.pdf',
    'A.pdfs2 · /A.pdf',
    'B.hnns1 · /B.hnn',
  ]);
  fireEvent.keyDown(window.document.activeElement!, { key: 'Escape' });
  view.rerender(
    <Toolbar
      controller={controller}
      layout={{ ...layout, edge: 'bottom', insets: { ...layout.insets, bottom: 34 } }}
      placement="floating"
    />
  );
  expect(screen.getByRole('region').style.bottom).toBe('42px');
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
});

test('explicit zero overrides env and header/safe top overlap rather than accumulate', () => {
  const view = render(
    <ToolbarShell placement="floating">
      <button>tool</button>
    </ToolbarShell>
  );
  expect(screen.getByRole('region').style.bottom).toContain('env(');
  view.rerender(
    <ToolbarShell
      placement="floating"
      layout={{
        edge: 'bottom',
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        headerContentInset: 0,
      }}
    >
      <button>tool</button>
    </ToolbarShell>
  );
  expect(screen.getByRole('region').style.bottom).toBe('8px');
});

test('host owns current item, request is single flight and pins opening pane', async () => {
  let finish!: (result: ToolbarRequestResult) => void;
  const select = jest.fn(
    () =>
      new Promise<ToolbarRequestResult>((resolve) => {
        finish = resolve;
      })
  );
  const props = { files, currentFileKey: files[0].key, onSelectFile: select };
  const view = render(
    <ToolbarShell>
      <ToolbarFileMenu {...props} paneId="primary" />
    </ToolbarShell>
  );
  fireEvent.keyDown(screen.getByRole('button', { name: '文件', exact: true }), {
    key: 'ArrowDown',
  });
  view.rerender(
    <ToolbarShell>
      <ToolbarFileMenu {...props} paneId="secondary" />
    </ToolbarShell>
  );
  const other = screen.getAllByRole('menuitemradio')[1];
  fireEvent.click(other);
  fireEvent.click(other);
  expect(select).toHaveBeenCalledTimes(1);
  expect(select.mock.calls[0]).toEqual([
    { fileKey: files[1].key, paneId: 'primary', requestId: expect.any(String) },
  ]);
  expect(screen.getAllByRole('menuitemradio')[0].getAttribute('aria-checked')).toBe('true');
  await act(async () => finish({ status: 'success' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '文件', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '文件', exact: true }));
  expect(screen.getAllByRole('menuitemradio')[0].getAttribute('aria-checked')).toBe('true');
});

test.each(['cancelled', 'failed', 'throw'] as const)(
  'selection %s keeps original current item and permits retry',
  async (status) => {
    const select = jest.fn(async (): Promise<ToolbarRequestResult> => {
      if (status === 'throw') throw new Error('保存失败');
      return status === 'failed' ? { status, message: '保存失败' } : { status };
    });
    render(
      <ToolbarShell>
        <ToolbarFileMenu
          files={files}
          currentFileKey={files[0].key}
          paneId="primary"
          onSelectFile={select}
        />
      </ToolbarShell>
    );
    fireEvent.click(screen.getByRole('button', { name: '文件', exact: true }));
    await act(async () => fireEvent.click(screen.getAllByRole('menuitemradio')[1]));
    expect(screen.getAllByRole('menuitemradio')[0].getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('menuitemradio')[1]).toHaveProperty('disabled', false);
    expect(screen.queryByRole('alert')?.textContent ?? '').toBe(
      status === 'cancelled' ? '' : '保存失败'
    );
  }
);

test('current selection is a no-op, last file removal and host busy are blocked', () => {
  const select = jest.fn();
  const remove = jest.fn();
  const props = {
    files: files.slice(0, 1),
    currentFileKey: files[0].key,
    paneId: 'primary',
    onSelectFile: select,
    onRequestRemove: remove,
  };
  const view = render(
    <ToolbarShell>
      <ToolbarFileMenu {...props} />
    </ToolbarShell>
  );
  const trigger = screen.getByRole('button', { name: '文件', exact: true });
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitem')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('menuitem'));
  fireEvent.click(screen.getByRole('menuitemradio'));
  expect(select).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  view.rerender(
    <ToolbarShell>
      <ToolbarFileMenu {...props} busy />
    </ToolbarShell>
  );
  expect(trigger).toHaveProperty('disabled', true);
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(screen.queryByRole('menu')).toBeNull();
});

test('keyboard traversal skips disabled removal and Escape restores file trigger', () => {
  render(
    <ToolbarShell>
      <ToolbarFileMenu
        files={files.slice(0, 1)}
        currentFileKey={files[0].key}
        paneId="primary"
        onRequestRemove={jest.fn()}
      />
    </ToolbarShell>
  );
  const trigger = screen.getByRole('button', { name: '文件', exact: true });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio'));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio'));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
});
