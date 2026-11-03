import { Profiler } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Toolbar } from '../layered/Toolbar';
import { commitLayeredStroke, makeLayeredController } from './fixtures/layered';
import { createEditor } from '../layered/createEditor';
import { INPUT_MODE_PREFERENCE_KEY as key } from '../layered/inputModePreference';

function settings() {
  fireEvent.click(screen.getByRole('button', { name: '绘图菜单' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '设置' }));
}
function choose(name: string, family = '形状和对象菜单') {
  fireEvent.click(screen.getByRole('button', { name: family }));
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
}
function dismiss() {
  fireEvent.keyDown(document, { key: 'Escape' });
}

afterEach(() => localStorage.clear());

test('freehand settings are isolated from shapes through the real settings path', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  settings();
  expect(screen.queryByLabelText('形状线型')).toBeNull();
  expect(screen.getByLabelText('压力模式')).toHaveProperty('value', 'auto');
  expect(screen.getAllByRole('slider')).toHaveLength(1);
  dismiss();
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  settings();
  fireEvent.change(screen.getByLabelText('形状线型'), { target: { value: 'dash' } });
  dismiss();
  fireEvent.click(screen.getByRole('button', { name: '绘图（自由笔）' }));
  settings();
  fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: '24' } });
  fireEvent.change(screen.getByLabelText('压力模式'), { target: { value: 'constant' } });
  fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#123456' } });
  fireEvent.change(screen.getByLabelText('不透明度'), { target: { value: '0.7' } });
  expect(screen.queryByLabelText('形状线型')).toBeNull();
  expect(controller.getSnapshot('tools').settings.freehand).toEqual({
    color: '#123456',
    nominalSize: 24,
    opacity: 0.7,
    pressureMode: 'constant',
    presetRevision: 1,
  });
  dismiss();
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  settings();
  expect(screen.getByLabelText('形状线型')).toHaveProperty('value', 'dash');
  expect(screen.getByLabelText('笔宽')).toHaveProperty('value', '2');
});

test('all twelve tools remain reachable, cancel drafts and add no document transactions', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  const history = controller.getSnapshot('history');
  for (const [label, tool] of [
    ['直线', 'line'],
    ['矩形', 'rect'],
    ['椭圆', 'ellipse'],
    ['多边形', 'polygon'],
    ['贝塞尔', 'bezier'],
    ['图片', 'image'],
  ] as const) {
    choose(label);
    expect(controller.getSnapshot('tools').activeTool).toBe(tool);
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
  }
  for (const [label, tool] of [
    ['自由笔', 'freehand'],
    ['选择', 'selection'],
    ['套索', 'lasso'],
    ['橡皮擦', 'eraser'],
    ['平移', 'pan'],
  ] as const) {
    choose(label, '绘图菜单');
    expect(controller.getSnapshot('tools').activeTool).toBe(tool);
  }
  act(() => {
    controller.setTool('freehand');
    controller.beginFreehand({
      type: 'begin',
      commitId: 'draft',
      pressureCapability: 'available',
      batch: {
        sessionId: 'draft',
        pointerId: 1,
        source: 'pen',
        coordinateSpace: 'world',
        viewportRevision: 0,
        batchSequence: 0,
        samples: [{ sequence: 0, x: 20, y: 20, phase: 'down', pressure: 0.5, time: 0 }],
      },
    });
  });
  expect(controller.getSnapshot('interaction').activeFreehand).toBeDefined();
  choose('椭圆');
  expect(controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '文字' }));
  expect(controller.getSnapshot('tools').activeTool).toBe('text');
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
});

test('input preference and navigation settings remain accessible in every tool family', () => {
  localStorage.setItem(key, '"pen"');
  const controller = createEditor();
  const history = controller.getSnapshot('history');
  render(<Toolbar controller={controller} />);
  for (const tool of ['文字', '平移', '选择']) {
    if (tool === '文字') fireEvent.click(screen.getByRole('button', { name: tool }));
    else choose(tool, '绘图菜单');
    settings();
    const menu = screen.getByRole('combobox', { name: '输入模式' });
    expect(
      [...screen.getByLabelText<HTMLSelectElement>('输入模式').options].map((o) => o.text)
    ).toEqual(['自动', '强制手指绘制', '强制手写笔绘制']);
    fireEvent.change(menu, { target: { value: 'finger' } });
    for (const label of ['尺子', '虚拟纸张', '小地图'])
      fireEvent.click(screen.getByLabelText(label));
    expect(screen.queryByLabelText('颜色')).toBeNull();
    dismiss();
  }
  expect(controller.getSnapshot('tools').activeTool).toBe('selection');
  expect(controller.getSnapshot('input').mode).toBe('finger');
  expect(localStorage.getItem(key)).toBe('"finger"');
  expect(controller.getSnapshot('history')).toBe(history);
});

test('palette updates only the current family, never existing objects or history', () => {
  const controller = makeLayeredController();
  commitLayeredStroke(controller, 'ink');
  const document = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  render(<Toolbar controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '蓝', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  fireEvent.click(screen.getByRole('button', { name: '黑', exact: true }));
  expect(controller.getSnapshot('tools').settings.shape.color).toBe('#2D2D2D');
  fireEvent.click(screen.getByRole('button', { name: '绘图（自由笔）' }));
  expect(screen.getByRole('button', { name: '蓝', exact: true }).getAttribute('aria-pressed')).toBe(
    'true'
  );
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#7FA3C3');
  settings();
  fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#123456' } });
  dismiss();
  const palette = screen.getByRole('group', { name: '调色板，用于绘图或形状' });
  expect(within(palette).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '文字' }));
  for (const button of within(palette).getAllByRole('button'))
    expect(button).toHaveProperty('disabled', true);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('document')).toBe(document);
});

test('history and zoom reflect authoritative snapshots and reject invalid or frozen input', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  expect(screen.getByRole('button', { name: '撤销' })).toHaveProperty('disabled', true);
  act(() => {
    commitLayeredStroke(controller, 'ink');
  });
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重做' }));
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  act(() => {
    controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale: 1.25, tx: 0, ty: 0 },
    });
  });
  expect(screen.getByRole('button', { name: '缩放比例' }).textContent).toBe('125%');
  fireEvent.click(screen.getByRole('button', { name: '缩放比例' }));
  const zoom = screen.getByLabelText('缩放');
  for (const value of ['', '0', '801']) {
    fireEvent.change(zoom, { target: { value } });
    fireEvent.blur(zoom);
    expect(zoom).toHaveProperty('value', '125');
  }
  fireEvent.change(zoom, { target: { value: '150' } });
  expect(controller.getSnapshot('viewport').viewport.scale).toBe(1.5);
  // A stale command is rejected even if submitted by a racing host.
  const original = controller.updateViewport.bind(controller);
  jest
    .spyOn(controller, 'updateViewport')
    .mockImplementation((command) => original({ ...command, expectedRevision: 0 }));
  fireEvent.change(zoom, { target: { value: '175' } });
  expect(zoom).toHaveProperty('value', '150');
  jest.restoreAllMocks();
  act(() => {
    controller.beginFreehand({
      type: 'begin',
      commitId: 'draft',
      pressureCapability: 'available',
      batch: {
        sessionId: 'draft',
        pointerId: 1,
        source: 'pen',
        coordinateSpace: 'world',
        viewportRevision: 2,
        batchSequence: 0,
        samples: [{ sequence: 0, x: 20, y: 20, phase: 'down', pressure: 0.5, time: 0 }],
      },
    });
  });
  fireEvent.change(zoom, { target: { value: '200' } });
  expect(zoom).toHaveProperty('value', '150');
  act(() => {
    controller.setTool('text');
  });
  expect(controller.getSnapshot('viewport').viewport.scale).toBe(1.5);
});

test('collapse, pin, OCR and remount affect presentation only and restore focus', () => {
  const controller = makeLayeredController();
  const first = render(<Toolbar controller={controller} />);
  const document = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  const input = controller.getSnapshot('input');
  expect(screen.getByRole('button', { name: 'OCR' })).toHaveProperty('disabled', true);
  const description = screen.getByRole('button', { name: 'OCR' }).getAttribute('aria-describedby');
  expect(window.document.getElementById(description!)?.textContent).toBe('OCR 暂未接入');
  fireEvent.click(screen.getByRole('button', { name: '固定工具栏' }));
  expect(screen.getByRole('button', { name: '收起工具栏' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '固定工具栏' }));
  fireEvent.click(screen.getByRole('button', { name: '收起工具栏' }));
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
  expect(window.document.activeElement).toBe(screen.getByRole('button', { name: '收起工具栏' }));
  fireEvent.click(screen.getByRole('button', { name: '固定工具栏' }));
  first.unmount();
  render(<Toolbar controller={controller} />);
  expect(screen.getByRole('button', { name: '收起工具栏' })).toHaveProperty('disabled', false);
  expect(screen.getByRole('button', { name: '固定工具栏' }).getAttribute('aria-pressed')).toBe(
    'false'
  );
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('input')).toBe(input);
  expect(localStorage.getItem(key)).toBeNull();
});

test('keyboard menu navigation, Escape, outside input and editable fields survive remount', () => {
  const controller = makeLayeredController();
  const first = render(<Toolbar controller={controller} />);
  const trigger = screen.getByRole('button', { name: '形状和对象菜单' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '直线' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '矩形' }));
  dismiss();
  expect(document.activeElement).toBe(trigger);
  settings();
  const width = screen.getByLabelText<HTMLInputElement>('笔宽');
  expect(width.style.userSelect).toBe('text');
  width.focus();
  expect(document.activeElement).toBe(width);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '矩形' }));
  expect(controller.getSnapshot('tools').activeTool).toBe('rect');
  settings();
  first.unmount();
  render(<Toolbar controller={controller} />);
  settings();
  fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: '12' } });
  expect(controller.getSnapshot('tools').settings.shape.width).toBe(12);
  fireEvent(window, new Event('blur'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('toolbar').style.userSelect).toBe('none');
});

test('raw sample batches never reconcile the toolbar', () => {
  const controller = makeLayeredController();
  const renders = jest.fn();
  render(
    <Profiler id="toolbar" onRender={renders}>
      <Toolbar controller={controller} />
    </Profiler>
  );
  const before = renders.mock.calls.length;
  const identity = {
    sessionId: 'hot',
    pointerId: 1,
    source: 'pen' as const,
    coordinateSpace: 'world' as const,
    viewportRevision: 0,
  };
  act(() => {
    expect(
      controller.beginFreehand({
        type: 'begin',
        commitId: 'hot',
        pressureCapability: 'available',
        batch: {
          ...identity,
          batchSequence: 0,
          samples: [{ sequence: 0, x: 20, y: 20, phase: 'down', pressure: 0.5, time: 0 }],
        },
      }).ok
    ).toBe(true);
    for (let sequence = 1; sequence <= 30; sequence++) {
      expect(
        controller.updateFreehand({
          type: 'update',
          batch: {
            ...identity,
            batchSequence: sequence,
            samples: [
              { sequence, x: 20 + sequence, y: 20, phase: 'move', pressure: 0.5, time: sequence },
            ],
          },
        }).ok
      ).toBe(true);
    }
  });
  expect(renders).toHaveBeenCalledTimes(before);
  expect(controller.getSnapshot('interaction').activeFreehand).toBeDefined();
  act(() => {
    controller.setTool('text');
  });
  expect(renders.mock.calls.length).toBeGreaterThan(before);
});
