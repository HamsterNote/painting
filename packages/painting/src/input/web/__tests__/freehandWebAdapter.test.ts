/** @jest-environment jsdom */

/**
 * DOM 集成测试：`input/web/freehandWebAdapter.ts`（仅新增本测试文件）。
 *
 * 范围与真实性：
 * - 使用**真实** `createLayeredEditorController` + 真实 freehand session + 真实 PF 派生；
 *   仅对 DOM/PointerEvent 做 shim（jsdom 通常无 PointerEvent）。
 * - 不 mock/伪造 controller，不 assert 内部实现细节。
 * - 统一 afterEach 销毁 adapter/host、恢复 mocks 与 visibility descriptor。
 */

import {
  createFreehandWebAdapter,
  type CreateFreehandWebAdapterOptions,
  type FreehandWebAdapterNotice,
  type WebFreehandPolicy,
} from '../freehandWebAdapter';
import {
  createLayeredEditorController,
  type LayeredCommitReceipt,
  type LayeredEditorController,
  type LayeredEditorControllerOptions,
  type LayeredEditorResult,
} from '../../../core/layeredEditorController';
import type { FreehandCandidate } from '../../../core/freehandSession';
import { type BrushSnapshot, type EditorDocument, type FreehandObject } from '../../../model/document';
import type { DrawingViewport } from '../../../viewport';

// ---------------------------------------------------------------------------
// PointerEvent / DOM shims
// ---------------------------------------------------------------------------

type PointerInit = {
  pointerId?: number;
  pointerType?: string;
  pressure?: number;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  coalescedEvents?: PointerEvent[];
  timeStamp?: number;
};

/** jsdom 无 PointerEvent：用 MouseEvent 派生一个最小实现。 */
class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly pressure: number;
  readonly isPrimary: boolean;
  readonly pointerButton: number;
  private readonly coalesced: PointerEvent[];

  constructor(type: string, init: PointerInit = {}) {
    super(type, {
      bubbles: true,
      cancelable: true,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      button: init.button ?? 0,
      buttons: init.buttons ?? 1,
    });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'pen';
    this.pressure = init.pressure ?? 0.5;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerButton = init.button ?? 0;
    this.coalesced = init.coalescedEvents ?? [];
    // jsdom MouseEvent.timeStamp 只读且忽略构造参数：显式覆盖以支持严格时间 fixture。
    Object.defineProperty(this, 'timeStamp', {
      value: init.timeStamp ?? 0,
      configurable: true,
    });
  }

  getCoalescedEvents(): PointerEvent[] {
    return this.coalesced;
  }

  getPredictedEvents(): PointerEvent[] {
    return [];
  }
}

const pointer = (type: string, init: PointerInit = {}): PointerEvent =>
  new MockPointerEvent(type, init) as unknown as PointerEvent;

/** 安装 pointer capture shim；返回 spies 供断言。 */
function installCapture(host: HTMLElement, behavior: 'ok' | 'throw' | 'absent' = 'ok') {
  const set = jest.fn();
  const release = jest.fn();
  const has = jest.fn(() => behavior === 'ok');
  if (behavior === 'absent') {
    // 删除能力，模拟不支持 pointer capture 的环境。
    delete (host as unknown as Record<string, unknown>).setPointerCapture;
    delete (host as unknown as Record<string, unknown>).releasePointerCapture;
    delete (host as unknown as Record<string, unknown>).hasPointerCapture;
  } else {
    (host as unknown as Record<string, unknown>).setPointerCapture = behavior === 'throw'
      ? jest.fn(() => { throw new Error('capture unsupported'); })
      : set;
    (host as unknown as Record<string, unknown>).releasePointerCapture = release;
    (host as unknown as Record<string, unknown>).hasPointerCapture = has;
  }
  return { set, release, has };
}

// ---------------------------------------------------------------------------
// 统一清理：所有 harness / standalone adapter 都在 afterEach 销毁并移除 host，
// 恢复 mocks 与 visibility 相关 descriptor，避免 window listener 泄漏跨测试。
// ---------------------------------------------------------------------------

type Destroyable = { destroy(): void };

const liveAdapters: Destroyable[] = [];
const liveHosts: HTMLElement[] = [];
const liveRestores: Array<() => void> = [];

const visibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

function register(host: HTMLElement, adapter: Destroyable): void {
  liveHosts.push(host);
  liveAdapters.push(adapter);
}

function restoreVisibility(): void {
  if (visibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
  } else {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  }
}

function mockVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

afterEach(() => {
  for (const adapter of liveAdapters.splice(0)) {
    try {
      adapter.destroy();
    } catch {
      // 清理不得影响测试结果。
    }
  }
  for (const host of liveHosts.splice(0)) {
    host.remove();
  }
  for (const restore of liveRestores.splice(0)) {
    try {
      restore();
    } catch {
      // ignore
    }
  }
  restoreVisibility();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// controller / adapter fixtures（真实 controller）
// ---------------------------------------------------------------------------

function makeBrush(overrides: Partial<BrushSnapshot> = {}): BrushSnapshot {
  return {
    color: '#123456',
    nominalSize: 8,
    opacity: 1,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  };
}

function makeShapeStyle() {
  return { color: '#000000', width: 2, opacity: 1 as const, dash: [4, 2] };
}

function makeDocument(): EditorDocument {
  return { schemaVersion: 3, documentRevision: 1, objects: [] };
}

const VIEWPORT: DrawingViewport = { scale: 2, tx: 10, ty: -5 };

function createController(overrides: Partial<LayeredEditorControllerOptions> = {}): LayeredEditorController {
  const result = createLayeredEditorController({
    document: makeDocument(),
    viewport: { revision: 1, viewport: VIEWPORT },
    activeTool: 'freehand',
    settings: { freehand: makeBrush({ pressureMode: 'auto' }), shape: makeShapeStyle() },
    allocateObjectId: (commitId: string) => `obj-${commitId}`,
    ...overrides,
  } as LayeredEditorControllerOptions) as LayeredEditorResult<LayeredEditorController>;
  if (!result.ok) {
    throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

type Harness = {
  host: HTMLElement;
  controller: LayeredEditorController;
  adapter: ReturnType<typeof createFreehandWebAdapter>;
  notices: FreehandWebAdapterNotice[];
  sessionIds: string[];
  commitIds: string[];
};

function setup(
  adapterOverrides: Partial<CreateFreehandWebAdapterOptions> = {},
  controllerOverrides: Partial<LayeredEditorControllerOptions> = {}
): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  installCapture(host);

  const notices: FreehandWebAdapterNotice[] = [];
  const sessionIds: string[] = [];
  const commitIds: string[] = [];
  let sessionCounter = 0;
  let commitCounter = 0;

  const controller = createController(controllerOverrides);
  const adapter = createFreehandWebAdapter({
    host,
    controller,
    createSessionId: () => {
      const id = `s${(sessionCounter += 1)}`;
      sessionIds.push(id);
      return id;
    },
    createCommitId: () => {
      const id = `c${(commitCounter += 1)}`;
      commitIds.push(id);
      return id;
    },
    onResult: (notice) => notices.push(notice),
    ...adapterOverrides,
  });
  register(host, adapter);

  return { host, controller, adapter, notices, sessionIds, commitIds };
}

/** 派发到 host（down）或 window（move/up/cancel 等）。 */
const fireHost = (host: HTMLElement, event: Event) => host.dispatchEvent(event);
const fireWindow = (event: Event) => window.dispatchEvent(event);

/** 走完一笔：host down → window moves → window up。 */
function drawStroke(
  h: Harness,
  init: PointerInit = {},
  moves: readonly PointerInit[] = [{ clientX: 4, clientY: 3 }]
): void {
  const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1, ...init };
  fireHost(h.host, pointer('pointerdown', { pressure: 0.5, ...base, buttons: 1 }));
  moves.forEach((m, index) =>
    fireWindow(pointer('pointermove', { pressure: 0.5, ...base, ...m, buttons: 1, clientX: m.clientX ?? index + 2 }))
  );
  fireWindow(pointer('pointerup', { pressure: 0, ...base, button: 0, buttons: 0 }));
}

const noticesOf = (h: Harness, phase: FreehandWebAdapterNotice['phase']) =>
  h.notices.filter((notice) => notice.phase === phase);

const lastNotice = (h: Harness) => h.notices[h.notices.length - 1];

// ---------------------------------------------------------------------------
// A. 默认策略 / pressure 解析
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: 默认策略与 pressure 解析', () => {
  it('默认三来源 draw；mouse/touch/pen 各完成完整 stroke 并产生 begin/update/end/commit 通知', () => {
    for (const pointerType of ['mouse', 'touch', 'pen'] as const) {
      const h = setup();
      const pressure = pointerType === 'pen' ? 0.7 : 0.5;
      const base = { pointerId: 1, pointerType, isPrimary: true, buttons: 1, pressure };
      fireHost(h.host, pointer('pointerdown', base));
      fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
      fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));

      expect(noticesOf(h, 'begin').length).toBe(1);
      expect(noticesOf(h, 'update').length).toBeGreaterThanOrEqual(1);
      expect(noticesOf(h, 'end').length).toBe(1);
      expect(noticesOf(h, 'commit').length).toBe(1);
      const commit = lastNotice(h);
      expect(commit.phase).toBe('commit');
      expect(commit.result.ok).toBe(true);
      if (commit.result.ok) {
        expect((commit.result.value as LayeredCommitReceipt).status).toBe('created');
      }
      const document = h.controller.getSnapshot('document');
      expect(document.objects).toHaveLength(1);
      h.adapter.destroy();
      h.host.remove();
    }
  });

  it('pen auto + 恒 0.5 压力仍解析 real（resolver 一次锁定）', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen', pressure: 0.5 });
    const commit = lastNotice(h);
    const object = h.controller.getSnapshot('document').objects[0];
    expect(object?.kind).toBe('freehand');
    if (object?.kind === 'freehand') {
      expect(object.resolvedPressureMode).toBe('real');
    }
    expect(commit.phase).toBe('commit');
  });

  it('显式 unavailable + pen → simulated', () => {
    const h = setup({ pressureCapabilityForSource: () => 'unavailable' });
    drawStroke(h, { pointerType: 'pen', pressure: 0.5 });
    const object = h.controller.getSnapshot('document').objects[0];
    if (object?.kind === 'freehand') {
      expect(object.resolvedPressureMode).toBe('simulated');
    }
  });

  it('mouse/touch 正压力仍 simulated', () => {
    for (const pointerType of ['mouse', 'touch'] as const) {
      const h = setup();
      drawStroke(h, { pointerType, pressure: 0.9 });
      const object = h.controller.getSnapshot('document').objects[0];
      if (object?.kind === 'freehand') {
        expect(object.resolvedPressureMode).toBe('simulated');
      }
      h.adapter.destroy();
      h.host.remove();
    }
  });

  it('policy none 的来源不开始会话、不 preventDefault；draw 来源正常', () => {
    const policy: WebFreehandPolicy = { mouse: 'none', touch: 'draw', pen: 'draw' };
    const h = setup({ policy });
    const down = pointer('pointerdown', { pointerId: 1, pointerType: 'mouse', pressure: 0.5 });
    const preventSpy = jest.spyOn(down, 'preventDefault');
    fireHost(h.host, down);
    expect(noticesOf(h, 'begin')).toHaveLength(0);
    expect(preventSpy).not.toHaveBeenCalled();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    h.adapter.destroy();
    h.host.remove();
  });
});

// ---------------------------------------------------------------------------
// B. 事件合并 / predicted / raw 保真 / 序号
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: coalesced / predicted / raw', () => {
  it('bubbling pointermove 不双 append（host 与 window 不重复计数）', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const before = h.controller.getSnapshot('interaction').activeFreehand;
    const beforeCount = before && before.status === 'collecting' ? before.samples.length : 0;

    fireHost(h.host, pointer('pointermove', { ...base, clientX: 5, clientY: 5 }));
    const after = h.controller.getSnapshot('interaction').activeFreehand;
    const afterCount = after && after.status === 'collecting' ? after.samples.length : 0;

    expect(afterCount - beforeCount).toBe(1);
    h.adapter.destroy();
    h.host.remove();
  });

  it('window outside host 的 move/up 仍能更新与结束', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen' }, [{ clientX: 1000, clientY: 1000 }]);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    h.adapter.destroy();
    h.host.remove();
  });

  it('setPointerCapture 抛错仍可由 window up 收尾', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    installCapture(host, 'throw');
    const notices: FreehandWebAdapterNotice[] = [];
    const controller = createController();
    const adapter = createFreehandWebAdapter({
      host,
      controller,
      createSessionId: () => 's',
      createCommitId: () => 'c',
      onResult: (n) => notices.push(n),
    });
    register(host, adapter);
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    host.dispatchEvent(pointer('pointerdown', { ...base, pressure: 0.5 }));
    window.dispatchEvent(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    window.dispatchEvent(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(notices.some((n) => n.phase === 'commit' || n.phase === 'end')).toBe(true);
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    adapter.destroy();
    host.remove();
  });

  it('nonempty coalesced 只用列表事件；parent 值不同也不 append parent', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const before = h.controller.getSnapshot('interaction').activeFreehand;
    const beforeCount = before && before.status === 'collecting' ? before.samples.length : 0;

    const coalesced = [
      pointer('pointermove', { ...base, clientX: 1, clientY: 1 }),
      pointer('pointermove', { ...base, clientX: 2, clientY: 2 }),
    ];
    fireWindow(
      pointer('pointermove', { ...base, clientX: 999, clientY: 999, coalescedEvents: coalesced })
    );
    const after = h.controller.getSnapshot('interaction').activeFreehand;
    const afterCount = after && after.status === 'collecting' ? after.samples.length : 0;
    // 只有 coalesced 列表的 2 个事件进入；parent 999 不进入。
    expect(afterCount - beforeCount).toBe(2);
    h.adapter.destroy();
    h.host.remove();
  });

  it('coalesced 空 / 无 API / throw 均回退 parent（精确样本数与坐标）', () => {
    const worldX = (screen: number) => (screen - VIEWPORT.tx) / VIEWPORT.scale;
    const worldY = (screen: number) => (screen - VIEWPORT.ty) / VIEWPORT.scale;

    for (const mode of ['empty', 'no-api', 'throw'] as const) {
      const h = setup();
      const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
      fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
      const moveEvent = new MockPointerEvent('pointermove', {
        ...base,
        clientX: 3,
        clientY: 5,
        coalescedEvents: [],
      }) as unknown as PointerEvent;
      if (mode === 'no-api') {
        Object.defineProperty(moveEvent, 'getCoalescedEvents', { value: undefined });
      } else if (mode === 'throw') {
        Object.defineProperty(moveEvent, 'getCoalescedEvents', {
          value: () => {
            throw new Error('coalesced boom');
          },
        });
      }
      fireWindow(moveEvent);

      const snap = h.controller.getSnapshot('interaction').activeFreehand;
      if (!snap || snap.status !== 'collecting') {
        throw new Error(`expected collecting for ${mode}`);
      }
      expect(snap.samples).toHaveLength(2); // down + parent fallback
      expect(snap.samples[1].x).toBeCloseTo(worldX(3), 6);
      expect(snap.samples[1].y).toBeCloseTo(worldY(5), 6);
    }
  });

  it('predicted 非空未来点：函数不被调用且未来点绝不 persist', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));

    const futureWorldX = (500 - VIEWPORT.tx) / VIEWPORT.scale;
    const futureWorldY = (500 - VIEWPORT.ty) / VIEWPORT.scale;
    const future = [pointer('pointermove', { ...base, clientX: 500, clientY: 500 })];
    const moveEvent = new MockPointerEvent('pointermove', {
      ...base,
      clientX: 6,
      clientY: 5,
    }) as unknown as PointerEvent;
    const predictedSpy = jest.spyOn(moveEvent, 'getPredictedEvents').mockReturnValue(future);
    fireWindow(moveEvent);
    expect(predictedSpy).not.toHaveBeenCalled();

    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    const candidate = noticesOf(h, 'end')[0]?.result;
    expect(candidate?.ok).toBe(true);
    if (candidate?.ok) {
      const samples = (candidate.value as FreehandCandidate).samples;
      expect(samples).toHaveLength(4); // down + 2 moves + up，未来点不进
      expect(samples.some((sample) => sample.x === futureWorldX && sample.y === futureWorldY)).toBe(false);
    }
  });

  it('相同 xy/time/pressure 的独立真实样本仍全部保留', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const a = pointer('pointermove', { ...base, clientX: 4, clientY: 3 });
    const b = pointer('pointermove', { ...base, clientX: 4, clientY: 3 });
    fireWindow(a);
    fireWindow(b);
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap && snap.status === 'collecting' ? snap.samples.length : 0).toBe(3);
    h.adapter.destroy();
    h.host.remove();
  });

  it('raw 保真：up=0 / 有限越界保留 / 缺 pressure 不补字段', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    // 越界 pressure 原值保留。
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 1.5 }));
    // 缺 pressure：显式 undefined。
    const moveEvent = pointer('pointermove', { ...base, clientX: 4, clientY: 3 });
    Object.defineProperty(moveEvent, 'pressure', { value: undefined });
    fireWindow(moveEvent);
    // up = 0。
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));

    const candidate = noticesOf(h, 'end')[0]?.result;
    expect(candidate?.ok).toBe(true);
    if (candidate?.ok) {
      const samples = (candidate.value as FreehandCandidate).samples;
      expect(samples[0].pressure).toBe(1.5);
      expect(samples[samples.length - 1].pressure).toBe(0);
      const middle = samples.slice(1, -1);
      expect(middle.length).toBeGreaterThanOrEqual(1);
      expect(Object.prototype.hasOwnProperty.call(middle[0], 'pressure')).toBe(false);
    }
    h.adapter.destroy();
    h.host.remove();
  });

  it('序号有序且 batch 成功后推进；invalid 批次原子拒绝可 retry', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen' });
    const candidate = noticesOf(h, 'end')[0]?.result;
    if (candidate?.ok) {
      const samples = (candidate.value as FreehandCandidate).samples;
      expect(samples.map((sample) => sample.sequence)).toEqual(
        samples.map((_, index) => index)
      );
    }
    h.adapter.destroy();
    h.host.remove();
  });

  it('第二 pointer / 不同 source 不抢 owner、不污染当前笔', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireHost(h.host, pointer('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false, buttons: 1 }));
    fireWindow(pointer('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: false, buttons: 1, clientX: 50, clientY: 50 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    if (snap && snap.status === 'collecting') {
      expect(snap.samples.every((sample) => sample.source === 'pen')).toBe(true);
    }
    h.adapter.destroy();
    h.host.remove();
  });
});

// ---------------------------------------------------------------------------
// C. 坐标 / viewport / brush 隔离
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: 坐标与 viewport', () => {
  it('begin 非单位 viewport：contentbox 转换到 world 精确', () => {
    const h = setup();
    Object.defineProperty(h.host, 'clientLeft', { value: 1, configurable: true });
    Object.defineProperty(h.host, 'clientTop', { value: 2, configurable: true });
    h.host.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 0, bottom: 0, width: 0, height: 0, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect;

    fireHost(h.host, pointer('pointerdown', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.5, clientX: 30, clientY: 40 }));
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    if (snap && snap.status === 'collecting') {
      // localX = 30 - 10 - 1 = 19; localY = 40 - 20 - 2 = 18
      // worldX = (19 - 10)/2 = 4.5; worldY = (18 - (-5))/2 = 11.5
      expect(snap.samples[0].x).toBeCloseTo(4.5, 6);
      expect(snap.samples[0].y).toBeCloseTo(11.5, 6);
    }
    h.adapter.destroy();
    h.host.remove();
  });

  it('途中 brush 变化只影响下一笔', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    h.controller.setFreehandSettings(makeBrush({ color: '#ffffff' }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    const first = h.controller.getSnapshot('document').objects[0];
    if (first?.kind === 'freehand') {
      expect(first.brushSnapshot.color).toBe('#123456');
    }
    h.adapter.destroy();
    h.host.remove();
  });

  it('viewport pan/zoom 在 collecting 被丢弃，up 后不补跳', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const revisionBefore = h.controller.getSnapshot('viewport').revision;

    h.controller.updateViewport({
      type: 'replace',
      expectedRevision: revisionBefore,
      viewport: { scale: 3, tx: 0, ty: 0 },
    });
    expect(h.controller.getSnapshot('viewport').revision).toBe(revisionBefore);

    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('viewport').revision).toBe(revisionBefore);
    h.adapter.destroy();
    h.host.remove();
  });

  it('同 owner 中途 source 变化：move/up 拒绝，snapshot/owner/source 不变，随后正常 pen up 成功', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));

    const before = h.controller.getSnapshot('interaction').activeFreehand;
    expect(before && before.status === 'collecting' ? before.samples.length : -1).toBe(1);
    expect(before && before.status === 'collecting' ? before.source : undefined).toBe('pen');

    fireWindow(pointer('pointermove', { ...base, pointerType: 'touch', clientX: 4, clientY: 3 }));
    const after = h.controller.getSnapshot('interaction').activeFreehand;
    expect(after && after.status === 'collecting' ? after.samples.length : -1).toBe(1);
    expect(after && after.status === 'collecting' ? after.source : undefined).toBe('pen');
    expect(noticesOf(h, 'update')).toHaveLength(0);

    fireWindow(pointer('pointerup', { ...base, pointerType: 'touch', pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('safe DOM target 左键：不 begin、不 preventDefault、focus 保持', () => {
    const h = setup();
    const input = document.createElement('input');
    h.host.appendChild(input);
    input.focus();
    const event = pointer('pointerdown', { pointerId: 1, pointerType: 'pen', pressure: 0.5, button: 0 });
    const preventSpy = jest.spyOn(event, 'preventDefault');
    input.dispatchEvent(event);
    expect(preventSpy).not.toHaveBeenCalled();
    expect(noticesOf(h, 'begin')).toHaveLength(0);
    expect(document.activeElement).toBe(input);
  });

  it('裸 paper 右键 mouse / unknown source：不 begin、不 preventDefault', () => {
    for (const init of [
      { pointerId: 1, pointerType: 'mouse', pressure: 0.5, button: 2 },
      { pointerId: 2, pointerType: 'unknown', pressure: 0.5, button: 0 },
    ]) {
      const h = setup();
      const event = pointer('pointerdown', init);
      const preventSpy = jest.spyOn(event, 'preventDefault');
      fireHost(h.host, event);
      expect(preventSpy).not.toHaveBeenCalled();
      expect(noticesOf(h, 'begin')).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// D. 取消路径 / 收尾
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: 取消与收尾', () => {
  const startCollecting = (h: Harness) => {
    fireHost(
      h.host,
      pointer('pointerdown', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.5 })
    );
    fireWindow(pointer('pointermove', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1, clientX: 4, clientY: 3 }));
  };

  it('pointercancel 取消：活动会话消失、无对象/history、迟到 up 忽略', () => {
    const h = setup();
    startCollecting(h);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeDefined();
    fireWindow(pointer('pointercancel', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 0 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    const cancel = noticesOf(h, 'cancel');
    expect(cancel).toHaveLength(1);
    expect(cancel[0].result.ok).toBe(true);
    fireWindow(pointer('pointerup', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 0, pressure: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  });

  it('lostpointercapture（host 事件）取消：即时断言 owner/cancel/no history', () => {
    const h = setup();
    startCollecting(h);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeDefined();
    h.host.dispatchEvent(
      pointer('lostpointercapture', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 0 })
    );
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    const cancel = noticesOf(h, 'cancel');
    expect(cancel).toHaveLength(1);
    expect(cancel[0].result.ok).toBe(true);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  });

  it('visibilityState hidden 即时取消；visible 不取消；blur/pagehide 各取消', () => {
    const hidden = setup();
    startCollecting(hidden);
    mockVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(hidden.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(hidden.adapter.getActivePointerIds()).toEqual([]);
    expect(noticesOf(hidden, 'cancel')).toHaveLength(1);
    expect(hidden.controller.getSnapshot('document').objects).toHaveLength(0);

    const visible = setup();
    startCollecting(visible);
    mockVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(visible.controller.getSnapshot('interaction').activeFreehand).toBeDefined();
    expect(noticesOf(visible, 'cancel')).toHaveLength(0);

    const blurred = setup();
    startCollecting(blurred);
    window.dispatchEvent(new Event('blur'));
    expect(blurred.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(blurred.adapter.getActivePointerIds()).toEqual([]);
    expect(noticesOf(blurred, 'cancel')).toHaveLength(1);

    const pageHidden = setup();
    startCollecting(pageHidden);
    window.dispatchEvent(new Event('pagehide'));
    expect(pageHidden.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(pageHidden.adapter.getActivePointerIds()).toEqual([]);
    expect(noticesOf(pageHidden, 'cancel')).toHaveLength(1);
  });

  it('正常 up 先清 owner；release 同步派发 host lostpointercapture 不误 cancel', () => {
    const h = setup();
    // releasePointerCapture 同步派发 host lostpointercapture（模拟真实调度）。
    (h.host as unknown as Record<string, unknown>).releasePointerCapture = jest.fn((pointerId: number) => {
      h.host.dispatchEvent(
        pointer('lostpointercapture', { pointerId, pointerType: 'pen', isPrimary: true, buttons: 0 })
      );
    });
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(noticesOf(h, 'cancel')).toHaveLength(0);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('已提交笔不因随后 background 被 undo', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen' });
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    expect(h.controller.getSnapshot('history').canUndo).toBe(true);
    h.adapter.destroy();
    h.host.remove();
  });

  it('tool 切换取消并 release；设置变化不断笔', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    h.controller.setFreehandSettings(makeBrush({ color: '#eeeeee' }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    h.controller.setTool('line');
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    h.adapter.destroy();
    h.host.remove();
  });

  it('capture 不支持（absent）仍由 window up 收尾', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    installCapture(host, 'absent');
    const notices: FreehandWebAdapterNotice[] = [];
    const controller = createController();
    const adapter = createFreehandWebAdapter({
      host,
      controller,
      createSessionId: () => 's',
      createCommitId: () => 'c',
      onResult: (n) => notices.push(n),
    });
    register(host, adapter);
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    host.dispatchEvent(pointer('pointerdown', { ...base, pressure: 0.5 }));
    window.dispatchEvent(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    window.dispatchEvent(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    adapter.destroy();
    host.remove();
  });

  it('destroy 取消活动笔、幂等、移除 listeners（不再产生新笔）', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    expect(h.adapter.getActivePointerIds().length).toBeGreaterThan(0);
    h.adapter.destroy();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(() => h.adapter.destroy()).not.toThrow();

    const before = h.notices.length;
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(h.notices.length).toBe(before);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    h.host.remove();
  });

  it('非 cancelable down 不调用 preventDefault', () => {
    const h = setup();
    const event = pointer('pointerdown', { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.5 });
    Object.defineProperty(event, 'cancelable', { value: false });
    const preventSpy = jest.spyOn(event, 'preventDefault');
    fireHost(h.host, event);
    expect(preventSpy).not.toHaveBeenCalled();
    h.adapter.destroy();
    h.host.remove();
  });
});

// ---------------------------------------------------------------------------
// E. commit 失败 / retry / 通知
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: commit 失败与 retry', () => {
  it('allocator 失败：commit 通知可观测失败、owner 清空、candidate 保留、retry 1 对象 1 undo', () => {
    let allocatorCalls = 0;
    const h = setup({}, {
      allocateObjectId: () => {
        allocatorCalls += 1;
        if (allocatorCalls === 1) {
          throw new Error('alloc fail');
        }
        return 'obj-retry';
      },
    });
    drawStroke(h, { pointerType: 'pen' });

    const failed = noticesOf(h, 'commit').find((notice) => !notice.result.ok);
    expect(failed).toBeDefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').pendingCandidates).toHaveLength(1);

    const commitId = failed?.commitId ?? 'c1';
    const retry = h.adapter.retryCommit(commitId);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.status).toBe('created');
    }
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    expect(h.controller.getSnapshot('history').canUndo).toBe(true);
    h.adapter.destroy();
    h.host.remove();
  });

  it('cache 首次派生失败：失败可观测、candidate 保留、retry 成功', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../../geometry/freehandCache');
    const real = new FreehandGeometryCache();
    let calls = 0;
    const flaky = Object.create(real);
    flaky.getGeometry = (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('cache fail');
      }
      return real.getGeometry(...(args as [never, never]));
    };

    const h = setup({}, { geometryCache: flaky });
    drawStroke(h, { pointerType: 'pen' });

    const failed = noticesOf(h, 'commit').find((notice) => !notice.result.ok);
    expect(failed).toBeDefined();
    expect(h.controller.getSnapshot('interaction').pendingCandidates).toHaveLength(1);

    const retry = h.adapter.retryCommit(failed?.commitId ?? 'c1');
    expect(retry.ok).toBe(true);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    h.adapter.destroy();
    h.host.remove();
  });

  it('head commit 失败时，连续后笔不得越过 head', () => {
    let allocatorCalls = 0;
    const h = setup({}, {
      allocateObjectId: () => {
        allocatorCalls += 1;
        if (allocatorCalls === 1) {
          throw new Error('head alloc fail');
        }
        return `obj-${allocatorCalls}`;
      },
    });
    drawStroke(h, { pointerType: 'pen' });
    const headFail = noticesOf(h, 'commit').find((notice) => !notice.result.ok);
    expect(headFail).toBeDefined();

    drawStroke(h, { pointerType: 'pen' });
    const secondNotices = noticesOf(h, 'commit');
    const secondFailed = secondNotices[secondNotices.length - 1];
    expect(secondFailed.result.ok).toBe(false);
    // 仍只有 head candidate 可 retry，且 retry 后仅 1 对象。
    const retry = h.adapter.retryCommit(headFail?.commitId ?? 'c1');
    expect(retry.ok).toBe(true);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    h.adapter.destroy();
    h.host.remove();
  });

  it('onResult 抛错不破坏 commit', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    installCapture(host);
    const controller = createController();
    const adapter = createFreehandWebAdapter({
      host,
      controller,
      createSessionId: () => 's',
      createCommitId: () => 'c',
      onResult: () => {
        throw new Error('onResult boom');
      },
    });
    register(host, adapter);
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    expect(() => {
      host.dispatchEvent(pointer('pointerdown', { ...base, pressure: 0.5 }));
      window.dispatchEvent(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
      window.dispatchEvent(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    }).not.toThrow();
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    adapter.destroy();
    host.remove();
  });

  it('onResult 中重入 toolChange 不复活本地 owner', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    installCapture(host);
    const controller = createController();
    const adapter = createFreehandWebAdapter({
      host,
      controller,
      createSessionId: () => 's',
      createCommitId: () => 'c',
      onResult: (notice) => {
        if (notice.phase === 'begin') {
          controller.setTool('line');
        }
      },
    });
    register(host, adapter);
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    host.dispatchEvent(pointer('pointerdown', { ...base, pressure: 0.5 }));
    // begin notice 触发 tool change → controller 取消；本地 owner 不应复活。
    expect(adapter.getActivePointerIds()).toEqual([]);
    window.dispatchEvent(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    adapter.destroy();
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// F. 严格时间 / 原子拒绝 / 顺序 / 反例
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: 时间、原子拒绝与顺序', () => {
  it('相同 timestamp 的两个真实独立样本仍全部保留', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5, timeStamp: 10 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3, timeStamp: 20 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3, timeStamp: 20 }));
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap && snap.status === 'collecting' ? snap.samples.length : 0).toBe(3);
    if (snap && snap.status === 'collecting') {
      expect(snap.samples[1].time).toBe(20);
      expect(snap.samples[2].time).toBe(20);
    }
  });

  it('coalesced 后项 NaN 整批原子拒绝，valid retry 无 gap', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const before = h.controller.getSnapshot('interaction').activeFreehand;
    const beforeSamples = before && before.status === 'collecting' ? before.samples.length : -1;
    const beforeBatch = before && before.status === 'collecting' ? before.nextBatchSequence : -1;

    const invalid = new MockPointerEvent('pointermove', { ...base, clientX: 0, clientY: 0 }) as unknown as PointerEvent;
    Object.defineProperty(invalid, 'clientX', { value: Number.NaN });
    fireWindow(
      pointer('pointermove', {
        ...base,
        clientX: 9,
        clientY: 9,
        coalescedEvents: [pointer('pointermove', { ...base, clientX: 4, clientY: 3 }), invalid],
      })
    );

    const after = h.controller.getSnapshot('interaction').activeFreehand;
    expect(after && after.status === 'collecting' ? after.samples.length : -1).toBe(beforeSamples);
    expect(after && after.status === 'collecting' ? after.nextBatchSequence : -1).toBe(beforeBatch);
    expect(h.notices.filter((n) => n.phase === 'update')).toHaveLength(0);

    fireWindow(pointer('pointermove', { ...base, clientX: 12, clientY: 12 }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    const candidate = noticesOf(h, 'end')[0]?.result;
    expect(candidate?.ok).toBe(true);
    if (candidate?.ok) {
      const seq = (candidate.value as FreehandCandidate).samples.map((sample) => sample.sequence);
      expect(seq).toEqual(seq.map((_, index) => index));
    }
  });

  it('invalid up（NaN）保 owner，可 valid up retry', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const badUp = pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 });
    Object.defineProperty(badUp, 'clientX', { value: Number.NaN });
    fireWindow(badUp);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeDefined();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('成功一笔后 undo 一次成功、第二次 nothing-to-undo', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen' });
    const undo = h.controller.undo();
    expect(undo.ok).toBe(true);
    if (undo.ok) {
      expect(undo.value.objects).toHaveLength(0);
    }
    const again = h.controller.undo();
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('nothing-to-undo');
    }
  });

  it('head 失败 pending=2；retry head 后 retry second，顺序有序', () => {
    let allocatorCalls = 0;
    const h = setup({}, {
      allocateObjectId: () => {
        allocatorCalls += 1;
        if (allocatorCalls === 1) {
          throw new Error('head fail');
        }
        return `obj-${allocatorCalls}`;
      },
    });
    drawStroke(h, { pointerType: 'pen' });
    drawStroke(h, { pointerType: 'pen' });
    expect(h.controller.getSnapshot('interaction').pendingCandidates).toHaveLength(2);

    const failed = noticesOf(h, 'commit').find((notice) => !notice.result.ok);
    expect(failed).toBeDefined();
    const headId = failed?.commitId ?? 'c1';

    expect(h.adapter.retryCommit(headId).ok).toBe(true);
    const pendingAfterHead = h.controller.getSnapshot('interaction').pendingCandidates;
    expect(pendingAfterHead).toHaveLength(1);
    const secondId = pendingAfterHead[0].commitId;
    expect(h.adapter.retryCommit(secondId).ok).toBe(true);

    const order = h.controller
      .getSnapshot('document')
      .objects.filter((object): object is FreehandObject => object.kind === 'freehand')
      .map((object) => object.commitId);
    expect(order).toEqual([headId, secondId]);
  });

  it('brush 变化真正作用于下一笔', () => {
    const h = setup();
    drawStroke(h, { pointerType: 'pen' });
    h.controller.setFreehandSettings(makeBrush({ color: '#ffffff', nominalSize: 20 }));
    drawStroke(h, { pointerType: 'pen' });
    const objects = h.controller
      .getSnapshot('document')
      .objects.filter((object): object is FreehandObject => object.kind === 'freehand');
    expect(objects).toHaveLength(2);
    expect(objects[0].brushSnapshot.color).toBe('#123456');
    expect(objects[1].brushSnapshot.color).toBe('#ffffff');
    expect(objects[1].brushSnapshot.nominalSize).toBe(20);
  });

  it('capability 回调仅 down 调用一次；begin 后改设置不改变已锁定 mode', () => {
    const calls: string[] = [];
    const h = setup({
      pressureCapabilityForSource: (source) => {
        calls.push(source);
        return 'unknown';
      },
    });
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { ...base, clientX: 4, clientY: 3 }));
    h.controller.setFreehandSettings(makeBrush({ pressureMode: 'simulated' }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(calls).toEqual(['pen']);
    const object = h.controller.getSnapshot('document').objects[0];
    if (object?.kind === 'freehand') {
      expect(object.resolvedPressureMode).toBe('real');
    }
  });

  it('dot：down/up 无 move 也完成一笔', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    fireWindow(pointer('pointerup', { ...base, pressure: 0, button: 0, buttons: 0 }));
    expect(noticesOf(h, 'end')).toHaveLength(1);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('coalesced 混入不同 pointerId/source 子事件：整批拒绝', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5 }));
    const before = h.controller.getSnapshot('interaction').activeFreehand;
    const beforeCount = before && before.status === 'collecting' ? before.samples.length : -1;

    const mixed = [
      pointer('pointermove', { ...base, clientX: 4, clientY: 3 }),
      pointer('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 50, clientY: 50 }),
    ];
    fireWindow(pointer('pointermove', { ...base, clientX: 9, clientY: 9, coalescedEvents: mixed }));
    const after = h.controller.getSnapshot('interaction').activeFreehand;
    expect(after && after.status === 'collecting' ? after.samples.length : -1).toBe(beforeCount);
  });

  it('host rect 书写中变化：按新 origin 转换', () => {
    const h = setup();
    const base = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 };
    h.host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireHost(h.host, pointer('pointerdown', { ...base, pressure: 0.5, clientX: 10, clientY: 0 }));

    h.host.getBoundingClientRect = () =>
      ({ left: 100, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireWindow(pointer('pointermove', { ...base, clientX: 110, clientY: 0, timeStamp: 20 }));

    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap).toBeDefined();
    if (snap && snap.status === 'collecting') {
      // 期望 local = 110 - 100 = 10 → world = (10 - 10)/2 = 0；固定 origin 会得到 50。
      expect(snap.samples[1].x).toBeCloseTo(0, 6);
    } else {
      throw new Error('expected collecting');
    }
  });
});

// ---------------------------------------------------------------------------
// G. 通知回调重入 / destroy 恢复 / 只读热路径
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: 通知重入与 destroy 恢复', () => {
  const BASE = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 } as const;

  it('begin notice 内 destroy：无遗留 owner/collecting/doc', () => {
    const box: { h?: Harness } = {};
    const h = setup({
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'begin') {
          box.h?.adapter.destroy();
        }
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { ...BASE, clientX: 4, clientY: 3 }));
    fireWindow(pointer('pointerup', { ...BASE, pressure: 0, button: 0, buttons: 0 }));
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  });

  it('update notice 内 destroy / blur 各自取消无泄漏', () => {
    for (const action of ['destroy', 'blur'] as const) {
      const box: { h?: Harness } = {};
      const h = setup({
        onResult: (notice) => {
          box.h?.notices.push(notice);
          if (notice.phase === 'update' && action === 'destroy') {
            box.h?.adapter.destroy();
          }
        },
      });
      box.h = h;
      fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
      fireWindow(pointer('pointermove', { ...BASE, clientX: 4, clientY: 3 }));
      if (action === 'blur') {
        window.dispatchEvent(new Event('blur'));
      }
      expect(h.adapter.getActivePointerIds()).toEqual([]);
      expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
      expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    }
  });

  it('interaction 订阅 begin 同步 setTool(line)→freehand：guard 一次，无 owner/collecting', () => {
    const h = setup();
    let notifications = 0;
    let guardRuns = 0;
    h.controller.subscribe('interaction', () => {
      notifications += 1;
      if (notifications === 1) {
        guardRuns += 1;
        h.controller.setTool('line');
        h.controller.setTool('freehand');
      }
    });
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    expect(guardRuns).toBe(1);
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    fireWindow(pointer('pointerup', { ...BASE, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('end notice 内新 down/up 被忽略；返回后外部 down/up 可绘下一笔', () => {
    const box: { h?: Harness } = {};
    const sessionSpy = jest.fn(() => 's');
    const h = setup({
      createSessionId: sessionSpy,
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'end') {
          // callback 内完整新笔 down + up：均被 barrier 忽略。
          box.h?.host.dispatchEvent(
            pointer('pointerdown', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 })
          );
          window.dispatchEvent(
            pointer('pointerup', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 0, pressure: 0 })
          );
        }
      },
    });
    box.h = h;
    drawStroke(h, { pointerType: 'pen' });

    expect(sessionSpy.mock.calls.length).toBe(1); // 仅外层
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.notices.filter((notice) => notice.phase === 'commit')).toHaveLength(1);

    // 返回后外部独立 down/up 可绘下一笔。
    fireHost(h.host, pointer('pointerdown', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, clientX: 20, clientY: 20 }));
    fireWindow(pointer('pointerup', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 0, pressure: 0 }));

    const objects = h.controller
      .getSnapshot('document')
      .objects.filter((object): object is FreehandObject => object.kind === 'freehand');
    expect(objects).toHaveLength(2);
    expect(objects[0].commitId).toBe('c1');
    expect(objects[1].commitId).toBe('c2');
  });

  it('cancel notice 内完整 down/up 被忽略；返回后外部可绘下一笔', () => {
    const box: { h?: Harness } = {};
    const sessionSpy = jest.fn(() => 's');
    let cancelCallbacks = 0;
    const h = setup({
      createSessionId: sessionSpy,
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'cancel') {
          cancelCallbacks += 1;
          box.h?.host.dispatchEvent(
            pointer('pointerdown', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 })
          );
          window.dispatchEvent(
            pointer('pointerup', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 0, pressure: 0 })
          );
        }
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    fireWindow(pointer('pointercancel', { ...BASE, buttons: 0 }));

    expect(cancelCallbacks).toBeGreaterThanOrEqual(1);
    expect(sessionSpy.mock.calls.length).toBe(1); // nested 新笔未建 session
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);

    // 返回后外部独立 down/up 新建一笔。
    fireHost(h.host, pointer('pointerdown', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 1, clientX: 20, clientY: 20 }));
    fireWindow(pointer('pointerup', { pointerId: 9, pointerType: 'pen', isPrimary: false, buttons: 0, pressure: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('update 订阅内 nested move + blur：样本未增、取消且无对象', () => {
    const h = setup();
    let fired = 0;
    h.controller.subscribe('interaction', () => {
      fired += 1;
      if (fired === 2) {
        // 真的 dispatch 一个 nested synthetic move，再触发 blur。
        window.dispatchEvent(pointer('pointermove', { ...BASE, clientX: 8, clientY: 8 }));
        window.dispatchEvent(new Event('blur'));
      }
    });
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    fireWindow(pointer('pointermove', { ...BASE, clientX: 4, clientY: 3 }));
    // nested move 不得再产生第二个成功的 update batch。
    expect(h.notices.filter((notice) => notice.phase === 'update' && notice.result.ok)).toHaveLength(1);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('destroy 遇 adapter 计数落后：用真实 snapshot sequence 重试取消成功', () => {
    const h = setup();
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    // 外部直接推进 controller session，令 adapter 本地计数落后。
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap?.status).toBe('collecting');
    if (snap && snap.status === 'collecting') {
      h.controller.updateFreehand({
        type: 'update',
        batch: {
          sessionId: snap.sessionId,
          pointerId: snap.pointerId,
          source: snap.source,
          batchSequence: snap.nextBatchSequence,
          coordinateSpace: snap.coordinateSpace,
          viewportRevision: snap.lockedViewportRevision,
          samples: [{ sequence: snap.nextSampleSequence, x: 4, y: 3, time: 16, phase: 'move' }],
        },
      });
    }
    h.adapter.destroy();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('non-freehand（裸 host、工具非 freehand）：createSessionId/capability 回调 0 次', () => {
    const sessionSpy = jest.fn(() => 's');
    const capabilitySpy = jest.fn(() => 'unknown' as const);
    const h = setup({ createSessionId: sessionSpy, pressureCapabilityForSource: capabilitySpy });
    h.controller.setTool('line');
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(capabilitySpy).not.toHaveBeenCalled();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
  });

  it('overlay child：createSessionId/capability 回调 0 次', () => {
    const sessionSpy = jest.fn(() => 's');
    const capabilitySpy = jest.fn(() => 'unknown' as const);
    const h = setup({ createSessionId: sessionSpy, pressureCapabilityForSource: capabilitySpy });
    const overlay = document.createElement('button');
    h.host.appendChild(overlay);
    overlay.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'pen', pressure: 0.5 }));
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(capabilitySpy).not.toHaveBeenCalled();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
  });

  it('safe target（input）：createSessionId/capability 回调 0 次', () => {
    const sessionSpy = jest.fn(() => 's');
    const capabilitySpy = jest.fn(() => 'unknown' as const);
    const h = setup({ createSessionId: sessionSpy, pressureCapabilityForSource: capabilitySpy });
    const input = document.createElement('input');
    h.host.appendChild(input);
    input.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'pen', pressure: 0.5 }));
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(capabilitySpy).not.toHaveBeenCalled();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
  });

  it('非字符串 sessionId 回调：不 throw、不 half owner', () => {
    const h = setup({ createSessionId: (() => undefined) as unknown as () => string });
    expect(() => {
      fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    }).not.toThrow();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  });

  it('rect origin 非有限：down 原子拒绝不建 owner', () => {
    const h = setup();
    h.host.getBoundingClientRect = () =>
      ({ left: Number.NaN, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5, clientX: 10, clientY: 0 }));
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  });

  it('每 batch 最多一次 rect read；coalesced 不逐项 layout read', () => {
    const h = setup();
    let rectReads = 0;
    h.host.getBoundingClientRect = () => {
      rectReads += 1;
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    const afterDown = rectReads;
    const coalesced = [
      pointer('pointermove', { ...BASE, clientX: 1, clientY: 1 }),
      pointer('pointermove', { ...BASE, clientX: 2, clientY: 2 }),
      pointer('pointermove', { ...BASE, clientX: 3, clientY: 3 }),
    ];
    fireWindow(pointer('pointermove', { ...BASE, clientX: 9, clientY: 9, coalescedEvents: coalesced }));
    expect(rectReads - afterDown).toBeLessThanOrEqual(1);
    // 真实非空 batch：down + 3 coalesced = 4 采样。
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap && snap.status === 'collecting' ? snap.samples.length : 0).toBe(4);
  });

  it('正常 update 不调用 getSnapshot(interaction)（热路径）', () => {
    const h = setup();
    fireHost(h.host, pointer('pointerdown', { ...BASE, pressure: 0.5 }));
    const spy = jest.spyOn(h.controller, 'getSnapshot');
    fireWindow(pointer('pointermove', { ...BASE, clientX: 4, clientY: 3 }));
    const interactionCalls = spy.mock.calls.filter(([channel]) => channel === 'interaction').length;
    expect(interactionCalls).toBe(0);
  });

  it('destroy 后 retryCommit 仍可恢复 pending', () => {
    let allocatorCalls = 0;
    const h = setup({}, {
      allocateObjectId: () => {
        allocatorCalls += 1;
        if (allocatorCalls === 1) {
          throw new Error('fail');
        }
        return 'obj-retry';
      },
    });
    drawStroke(h, { pointerType: 'pen' });
    const failed = h.notices.find((notice) => notice.phase === 'commit' && !notice.result.ok);
    h.adapter.destroy();
    const retry = h.adapter.retryCommit(failed?.commitId ?? 'c1');
    expect(retry.ok).toBe(true);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H. ora2 mustfix 反例（ID 回调重入 / capability destroy / cancel 重入 / deferred blur）
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: mustfix 反例', () => {
  const B = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 } as const;

  it('createSessionId 内 nested down：仅外层一次 begin，owner/session 精确', () => {
    const box: { h?: Harness } = {};
    const calls = { n: 0 };
    const h = setup({
      createSessionId: () => {
        calls.n += 1;
        if (calls.n === 1) {
          box.h?.host.dispatchEvent(
            pointer('pointerdown', { pointerId: 2, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 })
          );
        }
        return `s${calls.n}`;
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));

    const begins = noticesOf(h, 'begin');
    expect(begins).toHaveLength(1);
    expect(begins[0].sessionId).toBe('s1');
    expect(calls.n).toBe(1);
    expect(h.adapter.getActivePointerIds()).toEqual([1]);
    const snap = h.controller.getSnapshot('interaction').activeFreehand;
    expect(snap && snap.status === 'collecting' ? snap.sessionId : undefined).toBe('s1');
  });

  it('createCommitId 内 nested down：仅外层一次 begin', () => {
    const box: { h?: Harness } = {};
    const calls = { n: 0 };
    const h = setup({
      createCommitId: () => {
        calls.n += 1;
        if (calls.n === 1) {
          box.h?.host.dispatchEvent(
            pointer('pointerdown', { pointerId: 2, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 })
          );
        }
        return `c${calls.n}`;
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(noticesOf(h, 'begin')).toHaveLength(1);
    expect(calls.n).toBe(1);
    expect(h.adapter.getActivePointerIds()).toEqual([1]);
  });

  it('capability 回调内 destroy：不 owner/不 collecting/不 doc，后事件不响应', () => {
    const box: { h?: Harness } = {};
    let destroyed = false;
    const h = setup({
      pressureCapabilityForSource: () => {
        if (!destroyed) {
          destroyed = true;
          box.h?.adapter.destroy();
        }
        return 'unknown';
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(noticesOf(h, 'begin')).toHaveLength(0);
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();

    fireWindow(pointer('pointermove', { ...B, clientX: 4, clientY: 3 }));
    fireWindow(pointer('pointerup', { ...B, pressure: 0, button: 0, buttons: 0 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  });

  it('destroy 内部 cancel notice 重入 destroy：bounded 通知无递归，后 down 无 ID callback', () => {
    const box: { h?: Harness } = {};
    const sessionSpy = jest.fn(() => 's');
    let cancelNoticeCount = 0;
    let reentered = false;
    const h = setup({
      createSessionId: sessionSpy,
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'cancel') {
          cancelNoticeCount += 1;
          if (!reentered) {
            reentered = true;
            box.h?.adapter.destroy();
          }
        }
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));

    // 主动 destroy：内部 cancel 通知内再 destroy（bounded）。
    h.adapter.destroy();
    expect(cancelNoticeCount).toBeGreaterThan(0);
    expect(cancelNoticeCount).toBeLessThanOrEqual(2);
    expect(reentered).toBe(true);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);

    const callsBefore = sessionSpy.mock.calls.length;
    fireHost(h.host, pointer('pointerdown', { ...B, pointerId: 5, pressure: 0.5 }));
    expect(sessionSpy.mock.calls.length).toBe(callsBefore);
  });

  it('begin 订阅先 blur，onResult begin 同步 up：0 objects/无 history/无 collecting', () => {
    const box: { h?: Harness } = {};
    const h = setup({
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'begin') {
          window.dispatchEvent(pointer('pointerup', { ...B, pressure: 0, button: 0, buttons: 0 }));
        }
      },
    });
    box.h = h;
    let once = false;
    h.controller.subscribe('interaction', () => {
      if (!once) {
        once = true;
        window.dispatchEvent(new Event('blur'));
      }
    });
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
  });

  it('update 订阅先 blur，onResult update 同步 up：0 objects/无 collecting', () => {
    const box: { h?: Harness } = {};
    const h = setup({
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'update') {
          window.dispatchEvent(pointer('pointerup', { ...B, pressure: 0, button: 0, buttons: 0 }));
        }
      },
    });
    box.h = h;

    // 先成功 down。
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');
    expect(h.adapter.getActivePointerIds()).toEqual([1]);

    // down 之后注册 one-shot subscriber，再发 move。
    let triggered = 0;
    h.controller.subscribe('interaction', () => {
      triggered += 1;
      if (triggered === 1) {
        window.dispatchEvent(new Event('blur'));
      }
    });
    fireWindow(pointer('pointermove', { ...B, clientX: 4, clientY: 3 }));

    expect(triggered).toBeGreaterThanOrEqual(1);
    expect(h.notices.filter((notice) => notice.phase === 'update')).toHaveLength(1);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
  });

  it('pointercancel 引发真实 cancel notification 内 destroy：teardown 成功，后 down 无 callback', () => {
    const sessionSpy = jest.fn(() => 's');
    const h = setup({ createSessionId: sessionSpy });

    // 先成功 down。
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');

    // down 后注册 subscriber；外部 pointercancel 触发真实 controller cancel 通知。
    let triggered = 0;
    h.controller.subscribe('interaction', () => {
      triggered += 1;
      if (triggered === 1) {
        h.adapter.destroy();
      }
    });
    fireWindow(pointer('pointercancel', { ...B, buttons: 0 }));

    expect(triggered).toBeGreaterThanOrEqual(1);
    expect(h.notices.some((notice) => notice.phase === 'cancel')).toBe(true);
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();

    const callsBefore = sessionSpy.mock.calls.length;
    fireHost(h.host, pointer('pointerdown', { ...B, pointerId: 5, pressure: 0.5 }));
    expect(sessionSpy.mock.calls.length).toBe(callsBefore);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('destroy cancel 失败显式保留 owner 无递归；mockRestore 后 destroy 真实取消成功', () => {
    const box: { h?: Harness } = {};
    let reentered = false;
    const h = setup({
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'cancel' && !reentered) {
          reentered = true;
          box.h?.adapter.destroy(); // 重入 destroy，必须 bounded 不递归
        }
      },
    });
    box.h = h;
    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');

    // 真实 controller.cancelFreehand 前两次 mock 为合法 Result error（internal-invariant）。
    const cancelSpy = jest.spyOn(h.controller, 'cancelFreehand').mockReturnValue({
      ok: false,
      error: { code: 'internal-invariant' },
    } as never);

    h.adapter.destroy();
    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cancelSpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(h.notices.some((notice) => notice.phase === 'cancel' && !notice.result.ok)).toBe(true);
    expect(h.controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');
    expect(h.adapter.getActivePointerIds()).toEqual([1]);

    cancelSpy.mockRestore();
    h.adapter.destroy();
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();

    // teardown 后 down 不响应（无半 owner）。
    fireHost(h.host, pointer('pointerdown', { ...B, pointerId: 5, pressure: 0.5 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// I. callback barrier：phase onResult 内完整新笔被忽略（外部队列返回后恢复）
// ---------------------------------------------------------------------------

describe('freehandWebAdapter: callback barrier', () => {
  const B = { pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1 } as const;
  const nestedDown = (host: HTMLElement, pointerId: number) =>
    host.dispatchEvent(
      pointer('pointerdown', { pointerId, pointerType: 'pen', isPrimary: false, buttons: 1, pressure: 0.5 })
    );
  const nestedUp = (pointerId: number) =>
    window.dispatchEvent(
      pointer('pointerup', { pointerId, pointerType: 'pen', isPrimary: false, buttons: 0, pressure: 0 })
    );

  it('begin：订阅先 blur，onResult begin 内完整 down/up 均忽略，仅外层 session', () => {
    const box: { h?: Harness } = {};
    const sessionSpy = jest.fn(() => 's');
    const h = setup({
      createSessionId: sessionSpy,
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'begin') {
          nestedDown(box.h!.host, 9);
          nestedUp(9);
        }
      },
    });
    box.h = h;
    let once = false;
    h.controller.subscribe('interaction', () => {
      if (!once) {
        once = true;
        window.dispatchEvent(new Event('blur'));
      }
    });

    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(sessionSpy.mock.calls.length).toBe(1);
    expect(h.notices.filter((notice) => notice.phase === 'begin')).toHaveLength(1);
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  });

  it('update：down 后注册订阅，onResult update 内完整 down/up 忽略且 update callback 发生', () => {
    const box: { h?: Harness } = {};
    const sessionSpy = jest.fn(() => 's');
    const h = setup({
      createSessionId: sessionSpy,
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'update') {
          nestedDown(box.h!.host, 9);
          nestedUp(9);
        }
      },
    });
    box.h = h;

    fireHost(h.host, pointer('pointerdown', { ...B, pressure: 0.5 }));
    expect(h.controller.getSnapshot('interaction').activeFreehand?.status).toBe('collecting');

    let triggered = 0;
    h.controller.subscribe('interaction', () => {
      triggered += 1;
      if (triggered === 1) {
        window.dispatchEvent(new Event('blur'));
      }
    });
    fireWindow(pointer('pointermove', { ...B, clientX: 4, clientY: 3 }));

    expect(triggered).toBeGreaterThanOrEqual(1);
    expect(h.notices.filter((notice) => notice.phase === 'update')).toHaveLength(1);
    expect(sessionSpy.mock.calls.length).toBe(1);
    expect(h.adapter.getActivePointerIds()).toEqual([]);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('history').canUndo).toBe(false);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  });

  it('commit：onResult 内 retryCommit 立即 internal-invariant 且不再通知', () => {
    const box: { h?: Harness } = {};
    let attempts = 0;
    const results: LayeredEditorResult<LayeredCommitReceipt>[] = [];
    const h = setup({
      onResult: (notice) => {
        box.h?.notices.push(notice);
        if (notice.phase === 'commit') {
          attempts += 1;
          // callback / finalizing 中 retryCommit 必须拒绝；只捕获真实返回，不在 callback 内断言。
          results.push(box.h!.adapter.retryCommit(notice.commitId));
        }
      },
    });
    box.h = h;
    drawStroke(h, { pointerType: 'pen' });

    expect(attempts).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: false, error: { code: 'internal-invariant' } });
    expect(h.notices.filter((notice) => notice.phase === 'commit')).toHaveLength(1);
    expect(h.controller.getSnapshot('interaction').pendingCandidates).toHaveLength(0);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  });
});
