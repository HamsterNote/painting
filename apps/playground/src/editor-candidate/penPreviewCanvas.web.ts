/**
 * Pen 预览的独立 Canvas2D 增量后端（Web-only）。
 *
 * 目标很小且独立：它不是泛化 renderer，只负责把 core `session.points`（绝对全球 world DIP）
 * 以「增量尾部」的方式投影成 screen DIP 并画在专用 2D canvas 上，供 Surface 在绘制手势中
 * 高频复用；不写 document / core / React commit，也不采集任何时间戳。
 *
 * 关键不变量：
 *  - 坐标换算：先用 frame.frameOrigin 把 world 重定基为 local（保留 ±1e9 附近精度），
 *    再应用 frame.localToScreen 仿射得到 screen DIP；所有中间值必须有限且在安全界内。
 *  - 正常 append 只消费「新增尾部」并按 O(新增点) 绘制；绝不对全部 points 全量 map/rebase。
 *    只有显式失效（前缀破坏 / viewport reproject / resize）才允许全量回放。
 *  - DPR / CSS DIP / backing pixels 以及 alpha、pointerEvents 全部由本后端配置，应用侧不传 DPR。
 *  - healthy 绝不伪装：context 缺失、DPR 非法、帧缺失或投影不安全都会显式降级为不健康。
 */
import type { DrawingFrame, DrawingPointV2 } from '@hamster-note/painting/core';

/** 与现有 Skia pen 预览保持一致的视觉语义：蓝色 2 DIP、dash [5,4]（screen 空间）。 */
export const PEN_PREVIEW_COLOR = '#2563EB';
export const PEN_PREVIEW_STROKE_WIDTH_DIP = 2;
export const PEN_PREVIEW_DASH_DIP: readonly [number, number] = [5, 4];
/** 安全 screen DIP 上限：投影结果绝对值超出即视为不可安全绘制，绝不静默裁剪成「健康」。 */
export const PEN_PREVIEW_MAX_SCREEN_DIP = 1e7;
/**
 * backing pixel 单边上限：绝大多数浏览器 canvas 尺寸硬上限在 32767 附近，
 * 超过即拒绝配置并标记不健康，绝不用「未配置 backing」冒充成功。
 */
export const PEN_PREVIEW_MAX_BACKING_DIMENSION = 32767;

/** 投影后的 screen（CSS DIP）点；只读以避免后端状态被外部改写。 */
type ScreenPoint = Readonly<{ x: number; y: number }>;

export type PenPreviewCanvasOptions = Readonly<{
  /** 专用预览 canvas；本后端负责为其配置 alpha/DPR/pointerEvents/尺寸。 */
  canvas: HTMLCanvasElement;
  /** 惰性获取当前帧；只在 begin/append/reproject/resize 读取，绝不缓存跨帧仿射。 */
  getFrame: () => DrawingFrame | null;
  /** 仅测试注入 DPR；生产缺省读 globalThis.devicePixelRatio，应用侧不应传。 */
  dpr?: number;
}>;

/** 低成本运行计数；Surface 可直接读取做诊断，不做时间测量。 */
export type PenPreviewCounters = Readonly<{
  /** 正常增量路径累计绘制的 segment 数（全量回放不计入）。 */
  segmentDrawCount: number;
  /** 显式失效导致的全量回放次数。 */
  fullReplayCount: number;
  /** 是否处于可正常工作状态；任何降级都会为 false。 */
  healthy: boolean;
}>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** 解析 DPR：非法值回退 1，但明确标记为不健康，避免「回退却声称健康」。 */
function resolveDpr(injected: number | undefined): Readonly<{ dpr: number; sane: boolean }> {
  const raw =
    injected ?? (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
  return finite(raw) && raw > 0 ? { dpr: raw, sane: true } : { dpr: 1, sane: false };
}

export class PenPreviewCanvasBackend {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly getFrame: () => DrawingFrame | null;
  private readonly injectedDpr: number | undefined;

  private dpr: number;
  private dprSane: boolean;
  private widthDip = 0;
  private heightDip = 0;
  /** backing 是否已按有效 CSS 尺寸/DPR 成功配置；尺寸非法或越界时为 false。 */
  private backingSane = false;

  private disposed = false;
  private failed = false;

  private active = false;
  /** 当前手势 epoch；新 epoch 必须严格更大，用于阻止旧笔「复活」。 */
  private epoch = Number.NEGATIVE_INFINITY;

  /** 已消费的 world 点（仅用于显式全量回放；append 不遍历它做投影）。 */
  private worldPoints: DrawingPointV2[] = [];
  /** 与 worldPoints 一一对应的 screen 投影。 */
  private screenPoints: ScreenPoint[] = [];
  /** 累计已绘制的 screen 路径长；作为下一段 stroke 的 lineDashOffset 起点，保证 dash 跨段连续。 */
  private dashPhase = 0;

  private segmentDrawCount = 0;
  private fullReplayCount = 0;

  constructor(options: PenPreviewCanvasOptions) {
    this.canvas = options.canvas;
    this.getFrame = options.getFrame;
    this.injectedDpr = options.dpr;
    const resolved = resolveDpr(options.dpr);
    this.dpr = resolved.dpr;
    this.dprSane = resolved.sane;
    // alpha:true 保证透明预览层；由后端统一配置，应用侧不再声明 DPR 或透明度。
    this.ctx = this.canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D | null;
    // 构造时上下文已丢失则直接不健康，避免恢复路径把已失效的 2D 状态标成可用。
    if (this.isContextLost()) this.failed = true;
    // 先配 backing（会重置 2D 状态），再重设样式，顺序不可颠倒。
    this.configureBacking();
    this.applyStyle();
    if (this.canvas.style) this.canvas.style.pointerEvents = 'none';
  }

  /** 是否已 dispose。 */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** 是否有一笔正在预览。 */
  get isActive(): boolean {
    return this.active;
  }

  get healthy(): boolean {
    return !this.disposed && !this.failed && this.ctx !== null && this.dprSane && this.backingSane;
  }

  getCounters(): PenPreviewCounters {
    return Object.freeze({
      segmentDrawCount: this.segmentDrawCount,
      fullReplayCount: this.fullReplayCount,
      healthy: this.healthy,
    });
  }

  /**
   * 开始新一笔预览。epoch 必须严格大于上一次（单调递增），重复/更旧 epoch 一律忽略，
   * 防止已结束的旧笔在乱序回调里被重新激活。若直接带多个点，begin 会一次性画出首段。
   */
  begin(epoch: number, points: readonly DrawingPointV2[]): boolean {
    if (this.disposed || !this.contextUsable()) return false;
    if (!finite(epoch) || epoch <= this.epoch) return false;
    // 布局尚未给出有效尺寸时先补配 backing；仍无效则拒绝开始，绝不假装能画。
    this.ensureBacking();
    if (!this.backingSane) return false;
    const frame = this.getFrame();
    if (!frame) {
      this.failed = true;
      return false;
    }
    const projected = this.project(points, frame);
    if (!projected) {
      this.failed = true;
      return false;
    }
    // 新 epoch：清掉上一笔的可见状态与换算进度。
    this.active = true;
    this.epoch = epoch;
    this.worldPoints = [...points];
    this.screenPoints = projected;
    this.dashPhase = 0;
    this.clearSurface();
    this.strokeNewSegments(0, true);
    return true;
  }

  /**
   * 增量消费 session.points 的新增尾部。O(新增点)，不做全量重投影。
   * 重复长度（core 已去重）为 no-op；epoch 不匹配或未开始则忽略。
   */
  append(epoch: number, points: readonly DrawingPointV2[]): boolean {
    if (this.disposed || !this.contextUsable()) return false;
    if (!this.active || epoch !== this.epoch || !this.backingSane) return false;
    const consumed = this.worldPoints.length;
    if (points.length <= consumed) return false;
    // O(1) 前缀稳定性检查：已消费的最后一个点必须仍具相同值。
    const lastConsumed = this.worldPoints[consumed - 1];
    const candidate = points[consumed - 1];
    const prefixStable =
      lastConsumed === undefined ||
      (candidate !== undefined && candidate.x === lastConsumed.x && candidate.y === lastConsumed.y);
    if (!prefixStable) {
      // 前缀不匹配说明调用方给了不同快照：安全替换整条 points 后再全量重投影，
      // 既不遗漏新增点，也不沿用旧 worldPoints 造成「返回 true 但画的是旧数据」。
      this.worldPoints = [...points];
      return this.replay();
    }
    const frame = this.getFrame();
    if (!frame) {
      this.failed = true;
      return false;
    }
    const tail = points.slice(consumed);
    const projected = this.project(tail, frame);
    if (!projected) {
      this.failed = true;
      return false;
    }
    const newStart = this.worldPoints.length;
    for (let index = 0; index < tail.length; index += 1) {
      this.worldPoints.push(tail[index]);
      this.screenPoints.push(projected[index]);
    }
    this.strokeNewSegments(newStart, true);
    return true;
  }

  /** 显式失效（viewport 变化等）时的全量回放；按当前帧重新投影全部已存 world 点。 */
  reproject(): boolean {
    if (this.disposed || !this.contextUsable()) return false;
    return this.replay();
  }

  /** 尺寸/DPR 变化：重配 backing 与样式，再做一次全量回放。DPR 变化必须经此显式刷新。 */
  resize(): boolean {
    if (this.disposed || !this.contextUsable()) return false;
    const resolved = resolveDpr(this.injectedDpr);
    this.dpr = resolved.dpr;
    this.dprSane = resolved.sane;
    this.configureBacking();
    this.applyStyle();
    if (this.canvas.style) this.canvas.style.pointerEvents = 'none';
    return this.replay();
  }

  /** 无条件清理当前预览（提交或显式清空）。保留 epoch 水位，旧笔仍不可复活。 */
  clear(): void {
    this.clearSurface();
    this.active = false;
    this.worldPoints = [];
    this.screenPoints = [];
    this.dashPhase = 0;
  }

  /** 语义化取消：只清理与给定 epoch 匹配的当前笔，避免误清下一笔。 */
  cancel(epoch: number): boolean {
    if (!this.active || epoch !== this.epoch) return false;
    this.clear();
    return true;
  }

  /** 释放资源；之后所有写操作 no-op 且 healthy 为 false。 */
  dispose(): void {
    if (this.disposed) return;
    this.clearSurface();
    this.disposed = true;
    this.active = false;
    this.worldPoints = [];
    this.screenPoints = [];
  }

  // ---- 内部实现 ----

  /**
   * 配置 CSS DIP 与 backing pixels：canvas.width/height = CSS尺寸 * DPR，并用 setTransform
   * 让后续绘制坐标保持 CSS DIP。应用侧因此完全不需要处理 DPR。
   */
  private configureBacking(): boolean {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // 尺寸非法：不配置 backing，明确标记不健康（绝不因「未配置」而被当成成功）。
    if (!finite(width) || !finite(height) || width <= 0 || height <= 0) {
      this.backingSane = false;
      return false;
    }
    const backingWidth = Math.round(width * this.dpr);
    const backingHeight = Math.round(height * this.dpr);
    // DPR 乘法越界同样拒绝配置，不用 clamp 假装成功。
    if (
      !finite(backingWidth) ||
      !finite(backingHeight) ||
      backingWidth <= 0 ||
      backingHeight <= 0 ||
      backingWidth > PEN_PREVIEW_MAX_BACKING_DIMENSION ||
      backingHeight > PEN_PREVIEW_MAX_BACKING_DIMENSION
    ) {
      this.backingSane = false;
      return false;
    }
    this.widthDip = width;
    this.heightDip = height;
    if (this.canvas.style) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.canvas.width = Math.max(1, backingWidth);
    this.canvas.height = Math.max(1, backingHeight);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.backingSane = true;
    return true;
  }

  /** 尺寸尚无效时（如首帧布局前）在 begin 前补配一次 backing。 */
  private ensureBacking(): void {
    if (!this.backingSane) this.configureBacking();
  }

  /** 2D 上下文是否处于丢失态；丢失即不可安全绘制。 */
  private isContextLost(): boolean {
    const ctx = this.ctx as (CanvasRenderingContext2D & { isContextLost?: () => boolean }) | null;
    if (ctx === null || typeof ctx.isContextLost !== 'function') return false;
    return ctx.isContextLost();
  }

  /** 统一的可绘制性检查：上下文存在且未丢失；丢失会显式标记 failed。 */
  private contextUsable(): boolean {
    if (this.ctx === null) return false;
    if (this.isContextLost()) {
      this.failed = true;
      return false;
    }
    return true;
  }

  /** 与现有 Skia pen 预览一致的描边样式：round cap/join + dash [5,4]。 */
  private applyStyle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = PEN_PREVIEW_STROKE_WIDTH_DIP;
    ctx.strokeStyle = PEN_PREVIEW_COLOR;
    ctx.setLineDash([PEN_PREVIEW_DASH_DIP[0], PEN_PREVIEW_DASH_DIP[1]]);
    ctx.lineDashOffset = 0;
  }

  /**
   * 把 world 点投影为 screen DIP。
   * 先 local = world - frameOrigin（高精度重定基），再 screen = localToScreen ∘ local；
   * 任一点非有限或超出安全界即整体返回 null，绝不部分成功。
   */
  private project(points: readonly DrawingPointV2[], frame: DrawingFrame): ScreenPoint[] | null {
    const origin = frame.frameOrigin;
    const affine = frame.localToScreen;
    if (!origin || !affine) return null;
    if (!finite(origin.x) || !finite(origin.y)) return null;
    if (
      !finite(affine.a) ||
      !finite(affine.b) ||
      !finite(affine.c) ||
      !finite(affine.d) ||
      !finite(affine.tx) ||
      !finite(affine.ty)
    ) {
      return null;
    }
    const projected: ScreenPoint[] = [];
    for (const point of points) {
      const localX = point.x - origin.x;
      const localY = point.y - origin.y;
      if (!finite(localX) || !finite(localY)) return null;
      const screenX = affine.a * localX + affine.c * localY + affine.tx;
      const screenY = affine.b * localX + affine.d * localY + affine.ty;
      if (
        !finite(screenX) ||
        !finite(screenY) ||
        Math.abs(screenX) > PEN_PREVIEW_MAX_SCREEN_DIP ||
        Math.abs(screenY) > PEN_PREVIEW_MAX_SCREEN_DIP
      ) {
        return null;
      }
      projected.push({ x: screenX, y: screenY });
    }
    return projected;
  }

  /** 显式全量回放：重投影全部已存点、清屏并重画；计入 fullReplayCount。 */
  private replay(): boolean {
    // 无任何已绘制状态可回放（未激活且无点）时，仍算一次成功的配置刷新，
    // 但不抬高 fullReplayCount，避免用「空回放」伪装成发生过全量回放。
    if (!this.active && this.worldPoints.length === 0) return true;
    const frame = this.getFrame();
    if (!frame) {
      this.failed = true;
      return false;
    }
    const projected = this.project(this.worldPoints, frame);
    if (!projected) {
      this.failed = true;
      return false;
    }
    this.screenPoints = projected;
    this.dashPhase = 0;
    this.clearSurface();
    this.strokeNewSegments(0, false);
    this.fullReplayCount += 1;
    return true;
  }

  /**
   * 从 screenPoints[newStart] 起画到末尾的连接段，并从 newStart-1 连出第一段。
   *
   * dash 连续性：Canvas2D `lineDashOffset` 是「进入 dash pattern 的相位/深度」
   * （MDN: line dash offset / phase），正值表示路径起点处已深入 pattern 多少。
   * 因此每批起点相位应等于此前累计绘制的 screen 路径长：把 `lineDashOffset` 设为
   * 正累计 `dashPhase` 即可让相邻 append 的 dash 无缝接续，无需反向取负。
   * 每批只 stroke 一次（避免每段重启 dash）；countSegments=false 用于全量回放，
   * 不计入增量 segmentDrawCount。
   */
  private strokeNewSegments(newStart: number, countSegments: boolean): void {
    const ctx = this.ctx;
    const points = this.screenPoints;
    if (!ctx || points.length < 2) return;
    const from = Math.max(newStart, 1);
    if (from >= points.length) return;
    ctx.beginPath();
    let previous = points[from - 1];
    ctx.moveTo(previous.x, previous.y);
    let pathLength = 0;
    for (let index = from; index < points.length; index += 1) {
      const current = points[index];
      ctx.lineTo(current.x, current.y);
      pathLength += Math.hypot(current.x - previous.x, current.y - previous.y);
      previous = current;
    }
    ctx.lineDashOffset = this.dashPhase;
    ctx.stroke();
    this.dashPhase += pathLength;
    if (countSegments) this.segmentDrawCount += points.length - from;
  }

  private clearSurface(): void {
    this.ctx?.clearRect(0, 0, this.widthDip, this.heightDip);
  }
}
