import { Profiler } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Toolbar } from '../layered/Toolbar';
import { commitLayeredStroke, makeLayeredController } from './fixtures/layered';
import { createEditor } from '../layered/createEditor';
import { INPUT_MODE_PREFERENCE_KEY as key } from '../layered/inputModePreference';
import { parseLayeredDocument, serializeLayeredDocument } from '../model/documentReader';
import { createLayeredToolSession } from '../core/layeredToolSession';

function settings() {
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
}
function stroke() {
  const trigger = screen.getByRole('button', { name: '笔触设置', exact: true });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
}
function choose(name: string) {
  if (['选择', '橡皮擦', '套索', '平移'].includes(name)) {
    fireEvent.click(screen.getByRole('button', { name: name === '平移' ? '移动' : name }));
    return;
  }
  fireEvent.click(screen.getByRole('button', { name: '工具菜单' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: name === '自由笔' ? '画笔' : name }));
}
function dismiss() {
  fireEvent.keyDown(document, { key: 'Escape' });
}

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
});

test('primary width follows tool parameters, committed object history and document reload', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  const input = () => {
    stroke();
    return screen.getByLabelText<HTMLInputElement>('笔宽');
  };
  expect(within(screen.getByRole('toolbar')).queryByLabelText('笔宽')).toBeNull();
  stroke();
  expect(within(screen.getByRole('dialog', { name: '笔触设置' })).getByLabelText('笔宽')).toBe(
    input()
  );
  settings();
  expect(within(screen.getByRole('dialog')).queryByLabelText('笔宽')).toBeNull();
  dismiss();
  const history = controller.getSnapshot('history');
  fireEvent.change(input(), { target: { value: '4' } });
  expect(controller.getSnapshot('history')).toBe(history);
  act(() => {
    commitLayeredStroke(controller, 'thin');
  });
  fireEvent.change(input(), { target: { value: '16' } });
  act(() => {
    commitLayeredStroke(controller, 'thick');
  });
  choose('矩形');
  fireEvent.change(input(), { target: { value: '3' } });
  act(() => {
    const session = createLayeredToolSession(controller, () => 'shape');
    session.begin({ x: 200, y: 100 });
    session.update([{ x: 250, y: 150 }]);
    session.end();
    session.destroy();
  });
  choose('画笔');
  expect(input().value).toBe('16');
  act(() => {
    controller.setFreehandSettings({
      ...controller.getSnapshot('tools').settings.freehand,
      nominalSize: 24,
    });
  });
  expect(input().value).toBe('24');
  const objects = controller.getSnapshot('document').objects;
  expect(
    objects.map((object) =>
      object.kind === 'freehand'
        ? object.brushSnapshot.nominalSize
        : object.kind === 'shape'
          ? object.style.width
          : null
    )
  ).toEqual([4, 16, 3]);
  act(() => {
    controller.undo();
    controller.redo();
  });
  expect(controller.getSnapshot('document').objects).toEqual(objects);
  expect(input().value).toBe('24');
  const serialized = serializeLayeredDocument(controller.getSnapshot('document'));
  expect(serialized.ok).toBe(true);
  if (!serialized.ok) throw new Error(serialized.error.code);
  const parsed = parseLayeredDocument(serialized.value);
  if (!parsed.ok) throw new Error(parsed.error.code);
  expect(createEditor(parsed.value).getSnapshot('document').objects).toEqual(objects);
  choose('选择');
  expect(screen.getByRole('button', { name: '笔触设置' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('dialog')).toBeNull();
  choose('矩形');
  expect(input().value).toBe('3');
});

test('freehand settings are isolated from shapes through the real settings path', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  stroke();
  expect(screen.queryByLabelText('形状线型')).toBeNull();
  expect(screen.getByLabelText('压力模式')).toHaveProperty('value', 'auto');
  expect(screen.getAllByRole('slider')).toHaveLength(2);
  dismiss();
  choose('矩形');
  stroke();
  fireEvent.change(screen.getByLabelText('形状线型'), { target: { value: 'dash' } });
  dismiss();
  choose('自由笔');
  stroke();
  fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: '24' } });
  fireEvent.change(screen.getByLabelText('压力模式'), { target: { value: 'constant' } });
  fireEvent.change(screen.getByLabelText('自由取色'), { target: { value: '#123456' } });
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
  choose('矩形');
  stroke();
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
    expect(screen.getByRole('button', { name: '工具菜单' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  }
  for (const [label, tool] of [
    ['自由笔', 'freehand'],
    ['选择', 'selection'],
    ['套索', 'lasso'],
    ['橡皮擦', 'eraser'],
    ['平移', 'pan'],
  ] as const) {
    choose(label);
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
  choose('文字');
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
    choose(tool);
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
  stroke();
  fireEvent.click(screen.getByRole('button', { name: '蓝', exact: true }));
  choose('矩形');
  stroke();
  fireEvent.click(screen.getByRole('button', { name: '黑', exact: true }));
  expect(controller.getSnapshot('tools').settings.shape.color).toBe('#2D2D2D');
  choose('自由笔');
  stroke();
  expect(screen.getByRole('button', { name: '蓝', exact: true }).getAttribute('aria-pressed')).toBe(
    'true'
  );
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#7FA3C3');
  stroke();
  fireEvent.change(screen.getByLabelText('自由取色'), { target: { value: '#123456' } });
  const palette = screen.getByRole('group', { name: '颜色' });
  expect(within(palette).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  choose('文字');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '笔触设置' })).toHaveProperty('disabled', true);
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
  expect(zoom).toHaveProperty('type', 'range');
  expect(zoom).toHaveProperty('min', '25');
  expect(zoom).toHaveProperty('max', '800');
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

test('independent circular collapse control preserves state and restores focus', () => {
  const controller = makeLayeredController();
  const first = render(<Toolbar controller={controller} />);
  const document = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  const input = controller.getSnapshot('input');
  expect(screen.queryByRole('button', { name: 'OCR' })).toBeNull();
  expect(screen.queryByRole('button', { name: '固定工具栏' })).toBeNull();
  expect(
    screen.getByRole('toolbar').contains(screen.getByRole('button', { name: '收起工具栏' }))
  ).toBe(false);
  settings();
  fireEvent.click(screen.getByRole('button', { name: '收起工具栏' }));
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(window.document.activeElement).toBe(screen.getByRole('button', { name: '展开工具栏' }));
  fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
  expect(window.document.activeElement).toBe(screen.getByRole('button', { name: '收起工具栏' }));
  first.unmount();
  render(<Toolbar controller={controller} />);
  expect(screen.getByRole('button', { name: '收起工具栏' })).toBeTruthy();
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('input')).toBe(input);
  expect(localStorage.getItem(key)).toBeNull();
});

test('black defaults apply only to new editors and the custom ring tracks each family', () => {
  const controller = createEditor();
  render(<Toolbar controller={controller} />);
  stroke();
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#2D2D2D');
  expect(controller.getSnapshot('tools').settings.shape.color).toBe('#2D2D2D');
  const palette = screen.getByRole('group', { name: '颜色' });
  expect(within(palette).getAllByRole('button')[0].getAttribute('aria-label')).toBe('黑');
  fireEvent.change(screen.getByLabelText('自由取色'), { target: { value: '#123456' } });
  expect(controller.getSnapshot('tools').settings.freehand.color).toBe('#123456');
  expect(
    screen.getByLabelText('自由取色').parentElement?.style.getPropertyValue('--current-color')
  ).toBe('#123456');
  choose('矩形');
  stroke();
  expect(screen.getByLabelText('自由取色')).toHaveProperty('value', '#2d2d2d');
  choose('文字');
  expect(screen.queryByLabelText('自由取色')).toBeNull();
  expect(screen.getByRole('button', { name: '笔触设置' })).toHaveProperty('disabled', true);
});

test('clear is atomic, reversible and does nothing on an empty board or active stroke', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  const clear = screen.getByRole('button', { name: '清空画布' });
  expect(clear).toHaveProperty('disabled', true);
  act(() => {
    commitLayeredStroke(controller, 'one');
    commitLayeredStroke(controller, 'two');
  });
  const objects = controller.getSnapshot('document').objects;
  fireEvent.click(clear);
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(clear).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(controller.getSnapshot('document').objects).toEqual(objects);
  fireEvent.click(screen.getByRole('button', { name: '重做' }));
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
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
        viewportRevision: 0,
        batchSequence: 0,
        samples: [{ sequence: 0, x: 20, y: 20, phase: 'down', pressure: 0.5, time: 0 }],
      },
    });
  });
  const document = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  fireEvent.click(clear);
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('interaction').activeFreehand).toBeDefined();
  act(() => controller.setTool('text'));
  expect(controller.getSnapshot('document')).toBe(document);
});

test('keyboard menu navigation, Escape, outside input and editable fields survive remount', () => {
  const controller = makeLayeredController();
  const first = render(<Toolbar controller={controller} />);
  const trigger = screen.getByRole('button', { name: '工具菜单' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '画笔' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '直线' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '矩形' }));
  dismiss();
  expect(document.activeElement).toBe(trigger);
  stroke();
  const width = screen.getByLabelText<HTMLInputElement>('笔宽');
  expect(width.style.userSelect).toBe('text');
  width.focus();
  expect(document.activeElement).toBe(width);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  choose('矩形');
  expect(controller.getSnapshot('tools').activeTool).toBe('rect');
  stroke();
  first.unmount();
  render(<Toolbar controller={controller} />);
  stroke();
  fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: '12' } });
  expect(controller.getSnapshot('tools').settings.shape.width).toBe(12);
  fireEvent(window, new Event('blur'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('toolbar').style.userSelect).toBe('none');
});

/** Traversal past a document edge blurs to BODY; a keyboard user must not lose focus. */
function tabOutOfPanel(panel: HTMLElement, shiftKey: boolean, losesWindow = false) {
  const controls = [
    ...panel.querySelectorAll<HTMLElement>('button, input, select, textarea'),
  ].filter((control) => !(control as HTMLButtonElement).disabled);
  const edge = shiftKey ? controls[0] : controls[controls.length - 1];
  edge.focus();
  expect(document.activeElement).toBe(edge);
  fireEvent.keyDown(edge, { key: 'Tab', shiftKey });
  edge.blur();
  // Browsers fire window blur when traversal leaves the document for browser chrome.
  if (losesWindow) fireEvent(window, new Event('blur'));
  act(() => jest.runOnlyPendingTimers());
}

test.each([
  ['设置', false],
  ['设置', true],
  ['缩放比例', false],
] as const)('%s: Tab past the panel edge (%s) restores its trigger', (triggerName, shiftKey) => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  jest.useFakeTimers();
  const trigger = screen.getByRole('button', { name: triggerName });
  fireEvent.click(trigger);
  tabOutOfPanel(screen.getByRole('dialog'), shiftKey);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('window blur during Tab traversal still restores the trigger', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  jest.useFakeTimers();
  const trigger = screen.getByRole('button', { name: '设置' });
  fireEvent.click(trigger);
  tabOutOfPanel(screen.getByRole('dialog'), false, true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('color entry closes onto the 自由取色 button, the same target as Shift+Tab', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} inlinePickers />);
  jest.useFakeTimers();
  const trigger = screen.getByRole('button', { name: '笔触设置' });
  fireEvent.click(trigger);
  tabOutOfPanel(screen.getByRole('dialog'), false);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('closing after Tab does not steal focus that landed on another control', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  jest.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const edge = screen.getByRole('dialog').querySelector<HTMLElement>('select')!;
  edge.focus();
  fireEvent.keyDown(edge, { key: 'Tab' });
  const outside = screen.getByRole('button', { name: '工具菜单' });
  outside.focus();
  act(() => jest.runOnlyPendingTimers());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(outside);
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

test('brush leads the menu and selection and eraser are direct controls', () => {
  const controller = makeLayeredController();
  render(<Toolbar controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '工具菜单' }));
  expect(screen.getAllByRole('menuitemradio')[0]).toBe(
    screen.getByRole('menuitemradio', { name: '画笔' })
  );
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(8);
  expect(screen.queryByRole('menuitemradio', { name: '选择' })).toBeNull();
  expect(screen.queryByRole('menuitemradio', { name: '橡皮擦' })).toBeNull();
  dismiss();
  for (const [name, tool] of [
    ['选择', 'selection'],
    ['橡皮擦', 'eraser'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(controller.getSnapshot('tools').activeTool).toBe(tool);
    expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '工具菜单' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  }
});

test('slider preserves the measured viewport center after pan and resize', () => {
  const controller = makeLayeredController();
  render(
    <div data-painting-board>
      <div data-drawing-viewport data-testid="viewport" />
      <Toolbar controller={controller} />
    </div>
  );
  const surface = screen.getByTestId('viewport');
  const measure = jest.spyOn(surface, 'getBoundingClientRect');
  act(() => {
    controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale: 1.5, tx: 140, ty: -45 },
    });
  });
  fireEvent.click(screen.getByRole('button', { name: '缩放比例' }));
  const zoom = screen.getByLabelText('缩放');
  const document = controller.getSnapshot('document'),
    history = controller.getSnapshot('history');
  for (const [width, height, percent] of [
    [800, 600, 200],
    [600, 400, 75],
  ]) {
    measure.mockReturnValue({
      left: 100,
      top: 80,
      right: 100 + width,
      bottom: 80 + height,
      width,
      height,
      x: 100,
      y: 80,
      toJSON: () => ({}),
    });
    const before = controller.getSnapshot('viewport').viewport;
    const world = {
      x: (width / 2 - before.tx) / before.scale,
      y: (height / 2 - before.ty) / before.scale,
    };
    fireEvent.change(zoom, { target: { value: String(percent) } });
    const after = controller.getSnapshot('viewport').viewport;
    expect(after.scale).toBe(percent / 100);
    expect(world.x * after.scale + after.tx).toBeCloseTo(width / 2);
    expect(world.y * after.scale + after.ty).toBeCloseTo(height / 2);
  }
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  measure.mockRestore();
});

test('stroke entry owns the palette, previews authoritative parameters and isolates invalid drafts', () => {
  const controller = createEditor();
  render(<Toolbar controller={controller} />);
  const trigger = screen.getByRole('button', { name: '笔触设置' });
  const preview = () => trigger.querySelector('path')!;
  expect(screen.getByRole('toolbar').querySelector('input,.hn-painting-palette')).toBeNull();
  stroke();
  const panel = screen.getByRole('dialog', { name: '笔触设置' });
  expect(within(panel).getByRole('group', { name: '颜色' })).toBeTruthy();
  expect(within(panel).queryByText('自定义颜色')).toBeNull();
  expect(panel.querySelectorAll('input[type="color"]')).toHaveLength(1);
  expect(
    within(panel)
      .getAllByRole('button')
      .slice(0, 6)
      .map((b) => b.getAttribute('aria-label'))
  ).toEqual(['黑', '蓝', '绿', '黄', '粉', '紫']);
  const number = screen.getByLabelText<HTMLInputElement>('笔宽');
  const slider = screen.getByRole('slider', { name: '笔宽滑条' });
  const document = controller.getSnapshot('document'),
    history = controller.getSnapshot('history');
  let previous = 0;
  for (const width of [0.5, 3.5, 12, 200]) {
    fireEvent.change(number, { target: { value: String(width) } });
    const displayed = Number(preview().getAttribute('stroke-width'));
    expect(displayed).toBeGreaterThan(previous);
    expect(displayed).toBeGreaterThanOrEqual(1);
    expect(displayed).toBeLessThanOrEqual(6);
    previous = displayed;
    expect(slider).toHaveProperty('value', String(width));
  }
  fireEvent.change(slider, { target: { value: '12' } });
  expect(number.value).toBe('12');
  fireEvent.change(number, { target: { value: '3.55' } });
  expect(controller.getSnapshot('tools').settings.freehand.nominalSize).toBe(3.55);
  for (const value of ['', '0', '201']) {
    fireEvent.change(number, { target: { value } });
    expect(controller.getSnapshot('tools').settings.freehand.nominalSize).toBe(3.55);
    fireEvent.blur(number);
    expect(number.value).toBe('3.55');
  }
  const reject = jest
    .spyOn(controller, 'setFreehandSettings')
    .mockImplementation(() => ({ ok: false, error: { code: 'test' } }) as never);
  fireEvent.change(number, { target: { value: '8' } });
  expect(number.value).toBe('3.55');
  fireEvent.change(slider, { target: { value: '24' } });
  expect(slider).toHaveProperty('value', '3.55');
  reject.mockRestore();
  act(() =>
    controller.setFreehandSettings({
      ...controller.getSnapshot('tools').settings.freehand,
      nominalSize: 8,
      color: '#123456',
      opacity: 0.5,
    })
  );
  expect(number.value).toBe('8');
  expect(preview().getAttribute('stroke')).toBe('#123456');
  expect(preview().getAttribute('opacity')).toBe('0.5');
  fireEvent.change(number, { target: { value: '' } });
  act(() => controller.setTool('rect'));
  expect(screen.getByLabelText('笔宽')).toHaveProperty('value', '2');
  act(() => controller.setTool('freehand'));
  expect(screen.getByLabelText('笔宽')).toHaveProperty('value', '8');
  act(() => controller.setTool('text'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveProperty('disabled', true);
  settings();
  expect(screen.getByRole('dialog', { name: '绘图设置' })).toBeTruthy();
  for (const label of ['笔宽', '压力模式', '颜色', '不透明度'])
    expect(screen.queryByLabelText(label)).toBeNull();
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
});

test('S7 each pressure mode is frozen in new ink and survives undo, redo and saved reload', () => {
  const controller = createEditor();
  render(<Toolbar controller={controller} />);
  const modes = ['auto', 'real', 'simulated', 'constant'] as const;
  for (const [index, pressureMode] of modes.entries()) {
    stroke();
    const oldObjects = controller.getSnapshot('document').objects;
    const history = controller.getSnapshot('history');
    fireEvent.change(screen.getByLabelText('压力模式'), { target: { value: pressureMode } });
    fireEvent.change(screen.getByLabelText('笔宽'), { target: { value: String(4 + index * 4) } });
    fireEvent.click(screen.getByRole('button', { name: index % 2 ? '蓝' : '黑', exact: true }));
    expect(controller.getSnapshot('history')).toBe(history);
    expect(controller.getSnapshot('document').objects).toEqual(oldObjects);
    act(() => commitLayeredStroke(controller, `pressure-${index}`));
    const objects = controller.getSnapshot('document').objects;
    expect(objects[index]).toMatchObject({
      kind: 'freehand',
      brushSnapshot: {
        pressureMode,
        nominalSize: 4 + index * 4,
        color: index % 2 ? '#7FA3C3' : '#2D2D2D',
      },
    });
    act(() => controller.undo());
    expect(controller.getSnapshot('document').objects).toEqual(oldObjects);
    act(() => controller.redo());
    expect(controller.getSnapshot('document').objects).toEqual(objects);
  }
  const before = controller.getSnapshot('document').objects;
  const saved = serializeLayeredDocument(controller.getSnapshot('document'));
  if (!saved.ok) throw new Error(saved.error.code);
  const parsed = parseLayeredDocument(saved.value);
  if (!parsed.ok) throw new Error(parsed.error.code);
  expect(createEditor(parsed.value).getSnapshot('document').objects).toEqual(before);
});
