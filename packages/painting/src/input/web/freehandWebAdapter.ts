/**
 * Web 自由笔输入 adapter（Task 4.1 / 4.2 / 4.3 集成边界）。
 *
 * 职责：把宿主 `HTMLElement` 上的 pointer 生命周期归一化为 begin/update/end/cancel，
 * 转换为 screen 坐标 batch 后交给 `LayeredEditorController`。**controller 是唯一真源**：
 * 本 adapter 不持有第二份 document/history/viewport，只保留一个本地 transport owner 与计数器。
 *
 * 边界：
 * - 只监听 window 的 move/up/cancel（down 在 host），不重复注册；只用父 move/up 与非空
 *   coalesced 列表（按提供顺序消费，不追加父 event、不排序、不按值去重）。
 * - 不读 predicted events，不监听 rawupdate，不读旧 normalizePointerInput（它会滤掉越界 pressure）。
 * - 不实现 pan / 非笔过程反馈；不改 host 样式（touch-action 由 surface 后续负责）。
 * - DOM mock 不等于真机 / 像素验证。
 */

import type {
  LayeredBeginInput,
  LayeredCommitReceipt,
  LayeredEditorController,
  LayeredEditorResult,
  LayeredEditorTool,
} from '../../core/layeredEditorController';
import type {
  FreehandCandidate,
  FreehandSessionCancel,
  FreehandSessionEnd,
  FreehandSessionUpdate,
} from '../../core/freehandSession';
import type { PressureCapability } from '../../model/document';
import { traceGesture, type GestureTraceObserver, type GestureTraceEntry } from './gestureTrace';

/** 本 adapter 支持的指针来源；未知来源一律拒绝。 */
export type WebFreehandSource = 'mouse' | 'touch' | 'pen';

/** 每来源绘图政策；默认三者皆 draw，none 不启笔。 */
export type WebFreehandPolicy = Readonly<Record<WebFreehandSource, 'draw' | 'none'>>;

/** 端到端可观测通知；result 对应 controller 返回（commit 阶段为 commit receipt）。 */
export type FreehandWebAdapterNotice = Readonly<{
  phase: 'begin' | 'update' | 'end' | 'cancel' | 'commit';
  sessionId: string;
  commitId: string;
  result: LayeredEditorResult<void | FreehandCandidate | LayeredCommitReceipt>;
}>;

/** 创建选项。 */
export type CreateFreehandWebAdapterOptions = Readonly<{
  host: HTMLElement;
  controller: LayeredEditorController;
  createSessionId: () => string;
  createCommitId: () => string;
  policy?: WebFreehandPolicy;
  pressureCapabilityForSource?: (
    source: WebFreehandSource,
    event: PointerEvent
  ) => PressureCapability;
  onResult?: (notice: FreehandWebAdapterNotice) => void;
  onTrace?: GestureTraceObserver;
}>;

/** 适配器接口。 */
export interface FreehandWebAdapter {
  destroy(): void;
  getActivePointerIds(): readonly number[];
  retryCommit(commitId: string): LayeredEditorResult<LayeredCommitReceipt>;
}

/** 默认政策：全部来源可绘制。 */
const DEFAULT_POLICY: WebFreehandPolicy = Object.freeze({
  mouse: 'draw',
  touch: 'draw',
  pen: 'draw',
});

const SAFE_CONTROL_SELECTOR =
  'button,input,textarea,select,a[href],[contenteditable],[data-interactive]';

const PRESSURE_CAPABILITIES: readonly PressureCapability[] = [
  'available',
  'unavailable',
  'unknown',
];

/** screen 坐标原点：host 边界矩形左上 + border 偏移。 */
type ScreenOrigin = Readonly<{
  rectLeft: number;
  rectTop: number;
  offsetX: number;
  offsetY: number;
}>;

/** 解析 pointerType → 支持来源；未知返回 null。 */
function resolveSource(event: PointerEvent): WebFreehandSource | null {
  const pointerType = event.pointerType;
  return pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen'
    ? pointerType
    : null;
}

/** 安全控件（按钮/输入/链接/contenteditable/data-interactive）不得抢夺自由笔。 */
function isSafeControlTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') {
    return false;
  }
  try {
    return element.closest(SAFE_CONTROL_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/**
 * 生成单条 screen 空间样本；xy/time 必须有限，pressure 存在时必须有限（越界原值保留），
 * pressure 缺失保持缺失（不补 undefined 字段）。
 */
function toSample(
  origin: ScreenOrigin,
  sequence: number,
  event: PointerEvent,
  phase: 'down' | 'move' | 'up'
): {
  sequence: number;
  x: number;
  y: number;
  pressure?: number;
  time: number;
  phase: 'down' | 'move' | 'up';
} | null {
  if (
    !Number.isFinite(event.clientX) ||
    !Number.isFinite(event.clientY) ||
    !Number.isFinite(event.timeStamp)
  ) {
    return null;
  }
  const pressure = event.pressure;
  if (pressure !== undefined && !Number.isFinite(pressure)) {
    return null;
  }
  // 本地坐标：屏幕 - host 边界 - border；减法可能溢出为 ±Infinity，必须再查 finite。
  const localX = event.clientX - origin.rectLeft - origin.offsetX;
  const localY = event.clientY - origin.rectTop - origin.offsetY;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
    return null;
  }
  const sample: {
    sequence: number;
    x: number;
    y: number;
    pressure?: number;
    time: number;
    phase: 'down' | 'move' | 'up';
  } = {
    sequence,
    x: localX,
    y: localY,
    time: event.timeStamp,
    phase,
  };
  if (typeof pressure === 'number') {
    sample.pressure = pressure;
  }
  return sample;
}

/**
 * 收集 move 的 coalesced events（W3C PE3：仅 move 有 coalesced）。
 * 非空列表按提供顺序消费且不追加父 event；无方法 / 空 / 抛异常回退父 move。
 */
function collectMoveEvents(event: PointerEvent): readonly PointerEvent[] {
  const getter = (event as { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents;
  if (typeof getter === 'function') {
    try {
      const list = getter.call(event);
      if (list && list.length > 0) {
        return Object.freeze(Array.from(list));
      }
    } catch {
      // 回退父 event。
    }
  }
  return Object.freeze([event]);
}

function isPressureCapability(value: unknown): value is PressureCapability {
  return typeof value === 'string' && PRESSURE_CAPABILITIES.includes(value as PressureCapability);
}

/** 本地可发起的取消原因（tool-change/explicit 不在此 adapter 内发起）。 */
type LocalCancelReason = 'pointercancel' | 'unmount' | 'background';

/** 单个本地 transport owner 与计数器；不保存整笔样本，也不保存固定 rect（每 batch 读取）。 */
type TransportOwner = {
  pointerId: number;
  source: WebFreehandSource;
  sessionId: string;
  commitId: string;
  viewportRevision: number;
  nextBatchSequence: number;
  nextSampleSequence: number;
};

/**
 * 创建 Web 自由笔 adapter。controller 是唯一真源；本函数只做事件归一化、坐标转换与生命周期。
 */
export function createFreehandWebAdapter(
  options: CreateFreehandWebAdapterOptions
): FreehandWebAdapter {
  const { host, controller, createSessionId, createCommitId, onResult } = options;
  const policy = options.policy ?? DEFAULT_POLICY;
  const capabilityForSource = options.pressureCapabilityForSource;

  const doc = host.ownerDocument;
  const view = doc?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);

  // ---- 本地 transport 状态 ----
  // destroyed：teardown 完成且不可再用；destroyRequested：destroy 已请求，阻止新数据。
  // finalizingDestroy：destroy 收尾中，防 notify→destroy 递归。
  // owner：单个 owner；epoch：每次 owner 被清/失效递增，供 operation 后对账。
  // operating：controller/onResult 调用期间忽略 nested pointer 数据。
  // deferredCancel：operation 退出后统一取消（destroy/unmount 优先）。
  // queuedNotices：drain 期间的待发 notice，避免 drain 内部提前触发外部回调。
  // settlingCallbacks：callback barrier 触发的有界 drain 中，防递归/无界 notice 循环。
  let destroyed = false;
  let destroyRequested = false;
  let finalizingDestroy = false;
  let teardownDone = false;
  let owner: TransportOwner | undefined;
  let epoch = 0;
  let operating = false;
  let deferredCancel: LocalCancelReason | undefined;
  let lastDestroyFailure: LayeredEditorResult<void> | undefined;
  let queuedNotices: FreehandWebAdapterNotice[] | undefined;
  let settlingCallbacks = false;
  let lastActiveTool: LayeredEditorTool = controller.getSnapshot('tools').activeTool;

  function trace(
    action: string,
    reason?: string,
    event?: PointerEvent,
    details: Partial<GestureTraceEntry> = {}
  ) {
    if (!options.onTrace) return;
    traceGesture(options.onTrace, {
      scope: 'freehand',
      action,
      reason,
      pointerId: event?.pointerId,
      source: event?.pointerType,
      ownerPointerId: owner?.pointerId,
      sessionId: owner?.sessionId,
      commitId: owner?.commitId,
      batchSequence: owner?.nextBatchSequence,
      viewportRevision: owner?.viewportRevision,
      tool: controller.getSnapshot('tools').activeTool,
      ...details,
    });
  }

  /** callback barrier 触发的有界 drain：处理 callback 内 deferred 的 destroy/background。 */
  function settleDeferredFromCallbacks(): void {
    if (settlingCallbacks) {
      return;
    }
    settlingCallbacks = true;
    try {
      let guard = 0;
      while (
        queuedNotices === undefined &&
        !destroyed &&
        guard < 4 &&
        (deferredCancel !== undefined || destroyRequested)
      ) {
        guard += 1;
        const queued = drainDeferred();
        flushNotices(queued);
      }
    } finally {
      settlingCallbacks = false;
    }
  }

  /**
   * 直接发出 notice，并作为 **callback barrier**：期间 operating=true，nested pointer 数据被忽略，
   * callback 内 destroy/background 只 deferred；退出后（先前非 operating）安全有界 drain。
   * 收紧“onResult 可同步启下一笔”的契约，避免 begin/update 的 phase 回调同步 dispatch 新 down/up。
   */
  function emitNotice(notice: FreehandWebAdapterNotice): void {
    if (!onResult) {
      return;
    }
    const previousOperating = operating;
    operating = true;
    try {
      onResult(notice);
    } catch {
      // 隔离回调异常。
    } finally {
      operating = previousOperating;
    }
    if (!previousOperating) {
      settleDeferredFromCallbacks();
    }
  }

  /** onResult 队列化：drain 期间仅入队，随后按序 flush。 */
  function notify(
    phase: FreehandWebAdapterNotice['phase'],
    sessionId: string,
    commitId: string,
    result: LayeredEditorResult<void | FreehandCandidate | LayeredCommitReceipt>
  ): void {
    trace(
      phase,
      result.ok ? 'accepted' : `${result.error.code}:${result.error.sessionCode ?? ''}`,
      undefined,
      {
        sessionId,
        commitId,
        ok: result.ok,
        ...(result.ok && result.value && 'samples' in result.value
          ? { sampleCount: result.value.samples.length }
          : {}),
        ...(result.ok && result.value && 'objectId' in result.value
          ? {
              objectId: result.value.objectId,
              documentRevision: result.value.documentRevision,
            }
          : {}),
      }
    );
    const notice: FreehandWebAdapterNotice = Object.freeze({ phase, sessionId, commitId, result });
    if (queuedNotices) {
      queuedNotices.push(notice);
      return;
    }
    emitNotice(notice);
  }

  function flushNotices(notices: readonly FreehandWebAdapterNotice[]): void {
    for (const notice of notices) {
      emitNotice(notice);
    }
  }

  /** 每 batch 读取一次当前 host 边界与 border 偏移；coalesced 共享此 origin，不逐 entry 读 layout。 */
  function readOrigin(): ScreenOrigin {
    const rect = host.getBoundingClientRect();
    return {
      rectLeft: rect.left,
      rectTop: rect.top,
      offsetX: host.clientLeft,
      offsetY: host.clientTop,
    };
  }

  function releaseCapture(pointerId: number): void {
    try {
      if (host.hasPointerCapture?.(pointerId)) {
        host.releasePointerCapture(pointerId);
      }
    } catch {
      // 浏览器可能已自动释放。
    }
  }

  /** 清除 owner 并递增 epoch；不自动 release（由调用方决定）。 */
  function clearOwner(): void {
    if (owner === undefined) {
      return;
    }
    owner = undefined;
    epoch += 1;
  }

  function clearOwnerAndRelease(): void {
    const current = owner;
    if (!current) {
      return;
    }
    clearOwner();
    releaseCapture(current.pointerId);
  }

  /** 执行一次 controller/notify 调用；期间 nested pointer 数据被忽略。 */
  function withOperation<T>(fn: () => T): T {
    operating = true;
    try {
      return fn();
    } finally {
      operating = false;
    }
  }

  function buildCancelInput(
    current: TransportOwner,
    reason: LocalCancelReason,
    batchSequence: number
  ): FreehandSessionCancel {
    return {
      type: 'cancel',
      sessionId: current.sessionId,
      pointerId: current.pointerId,
      source: current.source,
      batchSequence,
      reason,
    };
  }

  /**
   * 普通取消：controller 调用包在 operation；成功后先 clear/release 再 notify（notify 后不再碰旧 owner）。
   * 若 cancel 期间同步订阅者请求 destroy，退出后自行 drain（已处于 drain 时不重复 drain）。
   */
  function cancelActive(reason: LocalCancelReason): void {
    const current = owner;
    if (!current) {
      return;
    }
    const result = withOperation(() =>
      controller.cancelFreehand(buildCancelInput(current, reason, current.nextBatchSequence))
    );
    if (result.ok && owner === current) {
      clearOwner();
      releaseCapture(current.pointerId);
    }
    notify('cancel', current.sessionId, current.commitId, result);
    if (queuedNotices === undefined) {
      postOperation();
    }
  }

  /**
   * 执行 operation 退出收尾，并把期间产生的 notice 暂存到队列，避免 drain 内部提前触发外部回调。
   * 已处于 drain 中则返回空（由最外层统一 flush）。
   */
  function drainDeferred(): FreehandWebAdapterNotice[] {
    if (queuedNotices !== undefined) {
      return [];
    }
    const queue: FreehandWebAdapterNotice[] = [];
    queuedNotices = queue;
    try {
      postOperation();
    } finally {
      queuedNotices = undefined;
    }
    return queue;
  }

  /** operation 退出后的统一收尾：处理 deferred cancel / destroy（有界循环防重入）。 */
  function postOperation(): void {
    let guard = 0;
    while (!destroyed && guard < 8) {
      guard += 1;
      if (deferredCancel === undefined && !destroyRequested) {
        return;
      }
      const reason = deferredCancel;
      deferredCancel = undefined;
      if (reason === 'unmount' || (reason === undefined && destroyRequested)) {
        finalizeDestroy();
        return;
      }
      if (reason !== undefined) {
        cancelActive(reason);
      } else {
        return;
      }
    }
  }

  /** 请求取消；operation 期间 deferred（destroy/unmount 优先）。 */
  function requestCancel(reason: LocalCancelReason): void {
    trace('cancel-request', reason);
    if (operating) {
      if (reason === 'unmount' || deferredCancel === undefined) {
        deferredCancel = reason;
      }
      return;
    }
    if (reason === 'unmount') {
      finalizeDestroy();
      return;
    }
    cancelActive(reason);
  }

  /** tools 变化：仅 activeTool 变化时处理；settings-only 保留 owner；切走清 owner/epoch，切回不复活。 */
  function handleToolsChange(): void {
    const snapshot = controller.getSnapshot('tools');
    if (snapshot.activeTool === lastActiveTool) {
      return;
    }
    lastActiveTool = snapshot.activeTool;
    if (snapshot.activeTool !== 'freehand') {
      trace('discard', 'tool-change');
      clearOwnerAndRelease();
      deferredCancel = undefined;
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    trace('pointerdown', 'received', event);
    // 新数据门：destroy 请求 / 已有 owner / operation 中一律忽略。
    if (destroyed || destroyRequested || operating || owner) {
      trace('ignore', owner ? 'owned' : 'unavailable', event);
      return;
    }
    // Ordered document nodes are also drawable; interactive overlays retain ownership.
    if (
      event.target !== host &&
      !(event.target instanceof Element && event.target.closest('[data-object-id]'))
    ) {
      trace('ignore', 'target', event);
      return;
    }
    if (isSafeControlTarget(event.target)) {
      trace('ignore', 'control', event);
      return; // 安全控件仍 exclude。
    }
    // activeTool 必须在任何 ID/capability callback 之前检查。
    if (controller.getSnapshot('tools').activeTool !== 'freehand') {
      trace('ignore', 'tool', event);
      return;
    }
    const source = resolveSource(event);
    if (!source || policy[source] !== 'draw') {
      trace('ignore', 'source-policy', event);
      return;
    }
    if (source === 'mouse' && event.button !== 0) {
      return;
    }

    // ID/capability callbacks 一并放入 operation：期间 nested pointer 数据被忽略，
    // 同步 destroy/blur 只 deferred；退出后先 drain deferred destroy 再决定是否安装。
    let sessionId = '';
    let commitId = '';
    let capability: PressureCapability = 'unknown';
    const callsOk = withOperation(() => {
      try {
        sessionId = createSessionId();
        commitId = createCommitId();
      } catch {
        return false; // callback 异常直接 reject，不留半 owner。
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return false;
      }
      if (typeof commitId !== 'string' || commitId.length === 0) {
        return false;
      }
      if (capabilityForSource) {
        try {
          const value = capabilityForSource(source, event);
          if (isPressureCapability(value)) {
            capability = value;
          }
        } catch {
          capability = 'unknown'; // capability 回调异常默认 unknown。
        }
      }
      return true;
    });

    // callback 组返回：先 drain deferred destroy（会清 owner/置 destroyed），再检查失效。
    const callbackNotices = drainDeferred();
    if (
      !callsOk ||
      destroyed ||
      destroyRequested ||
      operating ||
      owner ||
      controller.getSnapshot('tools').activeTool !== 'freehand'
    ) {
      flushNotices(callbackNotices);
      return; // 任何失效都不安装 provisional。
    }
    flushNotices(callbackNotices);

    const origin = readOrigin();
    const downSample = toSample(origin, 0, event, 'down');
    if (!downSample) {
      trace('reject', 'invalid-down-sample', event);
      return; // invalid xy/time/pressure 整 batch 拒绝，不计数。
    }

    const viewportRevision = controller.getSnapshot('viewport').revision;
    const beginInput: LayeredBeginInput = {
      type: 'begin',
      commitId,
      pressureCapability: capability,
      batch: {
        sessionId,
        pointerId: event.pointerId,
        source,
        batchSequence: 0,
        coordinateSpace: 'screen',
        viewportRevision,
        samples: [downSample],
      },
    };

    // 在 controller 之前安装 provisional owner（计数=begin 后的 next1），使 onResult.destroy
    // 等同步 reentry 能取消 collecting 笔；成功不复活式重写。
    const provisional: TransportOwner = {
      pointerId: event.pointerId,
      source,
      sessionId,
      commitId,
      viewportRevision,
      nextBatchSequence: 1,
      nextSampleSequence: 1,
    };
    const startEpoch = epoch;
    owner = provisional;
    const result = withOperation(() => controller.beginFreehand(beginInput));
    if (!result.ok) {
      // 失败：仅同 owner/epoch 清理，避免清掉 callback 期间建立的新 owner。
      if (owner === provisional && epoch === startEpoch) {
        clearOwner();
      }
    } else if (owner === provisional) {
      // begin 成功后再尝试 capture；不可用/throw 仍由 window move/up 收尾。
      try {
        host.setPointerCapture?.(event.pointerId);
      } catch {
        trace('capture', 'failed-window-fallback', event);
      }
    }
    const stillOwned = result.ok && owner === provisional;
    // 统一顺序：drain deferred（先清 owner）→ 原 phase notice → cancel notices。
    const deferredNotices = drainDeferred();
    notify('begin', sessionId, commitId, result);
    flushNotices(deferredNotices);
    if (stillOwned && owner === provisional && event.cancelable) {
      event.preventDefault();
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (owner) trace('pointermove', 'received', event);
    if (destroyed || destroyRequested || operating) {
      return;
    }
    const current = owner;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }
    if (resolveSource(event) !== current.source) {
      trace('ignore', 'source-mismatch', event);
      return; // source 锁定，不能被其它来源接管。
    }

    // 每 batch 读取一次 origin；coalesced 共享，不逐 entry layout read。
    const origin = readOrigin();
    const moveEvents = collectMoveEvents(event);
    trace('batch', 'move-samples', event, { sampleCount: moveEvents.length });
    const samples: NonNullable<ReturnType<typeof toSample>>[] = [];
    let expectedSequence = current.nextSampleSequence;
    for (const moveEvent of moveEvents) {
      // 每个 coalesced entry 在 toSample 前校验 pointerId/source；不符整 batch 拒绝
      // （不过滤、不 fallback、不推进）。
      if (
        moveEvent.pointerId !== current.pointerId ||
        resolveSource(moveEvent) !== current.source
      ) {
        trace('reject', 'coalesced-identity-mismatch', event);
        return;
      }
      const sample = toSample(origin, expectedSequence, moveEvent, 'move');
      if (!sample) {
        trace('reject', 'invalid-move-sample', event);
        return; // 整 batch 拒绝，不计数。
      }
      samples.push(sample);
      expectedSequence += 1;
    }

    const stagedBatchSequence = current.nextBatchSequence;
    const stagedSampleSequence = expectedSequence;
    const input: FreehandSessionUpdate = {
      type: 'update',
      batch: {
        sessionId: current.sessionId,
        pointerId: current.pointerId,
        source: current.source,
        batchSequence: stagedBatchSequence,
        coordinateSpace: 'screen',
        viewportRevision: current.viewportRevision,
        samples,
      },
    };

    // update 调用前先 staged 推进计数器，使同步通知 / deferred cancel 使用正确值。
    current.nextBatchSequence = stagedBatchSequence + 1;
    current.nextSampleSequence = stagedSampleSequence;
    const result = withOperation(() => controller.updateFreehand(input));
    if (!result.ok && owner === current) {
      // 失败且同 owner 才回滚 staged。
      current.nextBatchSequence = stagedBatchSequence;
      current.nextSampleSequence = stagedSampleSequence - samples.length;
    }
    // 统一顺序：drain deferred（先清 owner）→ 原 phase notice → cancel notices。
    const deferredNotices = drainDeferred();
    notify('update', current.sessionId, current.commitId, result);
    flushNotices(deferredNotices);
    if (result.ok && owner === current && event.cancelable) {
      event.preventDefault();
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    trace('pointerup', 'received', event);
    if (destroyed || destroyRequested || operating) {
      return;
    }
    const current = owner;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }
    if (resolveSource(event) !== current.source) {
      return;
    }

    const origin = readOrigin();
    const upSample = toSample(origin, current.nextSampleSequence, event, 'up');
    if (!upSample) {
      trace('reject', 'invalid-up-sample', event);
      return; // invalid up 不丢 owner/计数，可重试或 cancel。
    }

    const input: FreehandSessionEnd = {
      type: 'end',
      batch: {
        sessionId: current.sessionId,
        pointerId: current.pointerId,
        source: current.source,
        batchSequence: current.nextBatchSequence,
        coordinateSpace: 'screen',
        viewportRevision: current.viewportRevision,
        samples: [upSample],
      },
    };

    // end 调用前摘旧 owner：结束笔不再被同步 lostcapture 误取消；nested down 在 operation 中忽略。
    clearOwner();
    const result = withOperation(() => controller.endFreehand(input));
    if (!result.ok) {
      // 失败：tool 仍 freehand 才恢复 owner（含 destroy/deferred cancel 时，让收尾能取消此笔）。
      if (controller.getSnapshot('tools').activeTool === 'freehand') {
        owner = current;
      }
      const deferredNotices = drainDeferred();
      notify('end', current.sessionId, current.commitId, result);
      flushNotices(deferredNotices);
      return;
    }
    const candidate = result.value;
    releaseCapture(current.pointerId);
    // 正常 end 自动提交；background/destroy 不撤已 end 候选。
    const commitResult = withOperation(() => controller.commitFreehand(candidate.commitId));
    // 统一顺序：drain deferred（先清 owner）→ end notice → commit notice → cancel notices。
    const deferredNotices = drainDeferred();
    notify('end', current.sessionId, current.commitId, result);
    notify('commit', candidate.sessionId, candidate.commitId, commitResult);
    flushNotices(deferredNotices);
  }

  function handleLostPointerCapture(event: PointerEvent): void {
    // Implicit pen capture can move from a child path to our host. Its bubbling
    // loss notification does not mean the host lost ownership of this stroke.
    if (destroyed || event.target !== host) {
      return;
    }
    const current = owner;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }
    // Capture routes events; it is not the stroke's lifetime. A live pointer can
    // lose/transfer capture and still end normally outside the host. Window
    // capture listeners retain the owner until up, cancel, blur or unmount.
    trace('lostpointercapture', 'retained-window-owner', event);
  }

  function handleWindowPointerCancel(event: PointerEvent): void {
    trace('pointercancel', 'received', event);
    if (destroyed) {
      return;
    }
    const current = owner;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }
    requestCancel('pointercancel');
  }

  function handleBackground(): void {
    if (destroyed || !owner) {
      return;
    }
    requestCancel('background');
  }

  function handleVisibilityChange(): void {
    if (destroyed || !owner) {
      return;
    }
    if (doc?.visibilityState === 'hidden') {
      requestCancel('background');
    }
  }

  /**
   * 显式重试提交：sessionId 从 pending candidate 取（不无限积存本地映射），结果也通知。
   * operation / onResult callback barrier（operating）/ destroy 收尾期间**立即返回**
   * internal-invariant 且不 notify，避免 commit onResult 内 retry 自身造成无界通知。
   * 正常外部显式 retry（含 destroy 后恢复 controller pending）仍允许。
   */
  function retryCommit(commitId: string): LayeredEditorResult<LayeredCommitReceipt> {
    if (operating || finalizingDestroy || settlingCallbacks) {
      return { ok: false, error: { code: 'internal-invariant' } };
    }
    const pending = controller.getSnapshot('interaction').pendingCandidates;
    const candidate = pending.find((entry) => entry.commitId === commitId);
    const result = controller.commitFreehand(commitId);
    notify('commit', candidate?.sessionId ?? '', commitId, result);
    return result;
  }

  function getActivePointerIds(): readonly number[] {
    return Object.freeze(owner ? [owner.pointerId] : []);
  }

  const unsubscribeTools = controller.subscribe('tools', handleToolsChange);

  /** 注销全部 listeners 与 subscribe（幂等）。 */
  function teardown(): void {
    if (teardownDone) {
      return;
    }
    teardownDone = true;
    host.removeEventListener('pointerdown', handlePointerDown);
    host.removeEventListener('lostpointercapture', handleLostPointerCapture);
    view?.removeEventListener('pointermove', handlePointerMove, true);
    view?.removeEventListener('pointerup', handlePointerUp, true);
    view?.removeEventListener('pointercancel', handleWindowPointerCancel, true);
    view?.removeEventListener('blur', handleBackground);
    view?.removeEventListener('pagehide', handleBackground);
    doc?.removeEventListener('visibilitychange', handleVisibilityChange);
    unsubscribeTools();
  }

  /**
   * destroy 的 owner 收尾（先完成对账再统一 notify）：
   * - 正常用 owner.nextBatchSequence 取消一次。
   * - 失败时只读一次 interaction.activeFreehand；仅同 session collecting 时用其真实
   *   nextBatchSequence 重试一次（绝不改别人的 session）。
   * - 无 active / owner 不同：清本地即可。
   * - 成功 clearOwner→releaseCapture→notify；二次失败保留 owner 并 notify 真实失败，不假成功。
   */
  function cancelOwnerForDestroy(): boolean {
    const current = owner;
    if (!current) {
      return true;
    }
    const first = withOperation(() =>
      controller.cancelFreehand(buildCancelInput(current, 'unmount', current.nextBatchSequence))
    );
    let outcome = first;
    let finished = first.ok;
    if (!first.ok) {
      const active = controller.getSnapshot('interaction').activeFreehand;
      if (active && active.status === 'collecting' && active.sessionId === current.sessionId) {
        const retry = withOperation(() =>
          controller.cancelFreehand(buildCancelInput(current, 'unmount', active.nextBatchSequence))
        );
        outcome = retry;
        finished = retry.ok;
      } else {
        // 无 active 或非同一 session：清本地即可。
        finished = true;
      }
    }
    if (finished) {
      if (owner === current) {
        clearOwner();
        releaseCapture(current.pointerId);
      }
    } else {
      lastDestroyFailure = outcome;
    }
    // 对账完成后再统一 notify；成功时 owner 已清，失败时保留以便再次 destroy。
    notify('cancel', current.sessionId, current.commitId, outcome);
    return finished;
  }

  function finalizeDestroy(): void {
    if (destroyed || finalizingDestroy) {
      return; // 已收尾或收尾中重入直接返回。
    }
    finalizingDestroy = true;
    try {
      destroyRequested = true;
      const finished = cancelOwnerForDestroy();
      teardown();
      if (finished) {
        destroyed = true;
        return;
      }
      // 二次失败：明确 diagnostic 通知且不假称取消；保持 owner/destroyed=false 以便再次 destroy。
      notify(
        'cancel',
        owner?.sessionId ?? '',
        owner?.commitId ?? '',
        lastDestroyFailure ?? { ok: false, error: { code: 'session-rejected' } }
      );
    } finally {
      finalizingDestroy = false;
    }
  }

  /** destroy：幂等、重入安全；operation 中 deferred（unmount 优先）；收尾中重入直接返回。 */
  function destroy(): void {
    if (destroyed || finalizingDestroy) {
      return;
    }
    trace('discard', 'unmount');
    destroyRequested = true;
    if (operating) {
      deferredCancel = 'unmount';
      return;
    }
    finalizeDestroy();
  }

  host.addEventListener('pointerdown', handlePointerDown);
  host.addEventListener('lostpointercapture', handleLostPointerCapture);
  view?.addEventListener('pointermove', handlePointerMove, true);
  // Finish the accepted owner before descendant navigation/capture handlers run.
  view?.addEventListener('pointerup', handlePointerUp, true);
  view?.addEventListener('pointercancel', handleWindowPointerCancel, true);
  view?.addEventListener('blur', handleBackground);
  view?.addEventListener('pagehide', handleBackground);
  doc?.addEventListener('visibilitychange', handleVisibilityChange);

  return Object.freeze({ destroy, getActivePointerIds, retryCommit });
}
