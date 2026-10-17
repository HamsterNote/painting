/// <reference types="jest" />
/**
 * canvas2d-pen 金丝雀（`perfRenderer=canvas2d-pen`）的聚焦单测（纯逻辑，不渲染组件）。
 *
 * 覆盖：
 *  - 模式读取器：`canvas2d-pen` 仅在 `perf=1` 时启用；既有四个变体语义不变；非法/缺失取值一律 null。
 *  - pulse 标记：canvas2d-pen 为 'off'（pen 预览本身即真实视觉负载，不注入 pulse）。
 *  - world overlays 解析：只排除活动 pen 草稿，其余 overlay 原样保留；不可用时 fail closed。
 *  - 提交清除策略：已提交保留至 world 可见、未提交立即清除；保留清除门槛的纯函数判定。
 *
 * 增量 Canvas2D 后端的投影/epoch/健康模型由 penPreviewCanvas.unit.test.ts 覆盖；
 * 组件层的挂载、2-rAF 延迟清除与 DOM 诊断由浏览器端金丝雀验证，本目录没有该组件的
 * 渲染单测夹具（模块图依赖 react-native / Skia）。
 *
 * 说明：Surface 模块会导入 react-native 与 Skia，故此处 mock 掉非纯依赖，只验证纯读取逻辑。
 */
jest.mock('react-native', () => {
  const React = require('react');
  const component = (name: string) => {
    const Mock = ({ children }: { children?: unknown }) =>
      React.createElement(name, null, children);
    Mock.displayName = `RNMock(${name})`;
    return Mock;
  };
  return {
    Pressable: component('rn-pressable'),
    Text: component('rn-text'),
    View: component('rn-view'),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

jest.mock(
  '@shopify/react-native-skia',
  () => ({
    Skia: {
      Color: (value: string) => value,
      Path: {
        Make: () => ({ moveTo() {}, lineTo() {}, close() {}, setFillType() {} }),
      },
      ParagraphBuilder: {
        Make: () => ({ pushStyle() {}, addText() {}, build: () => ({ layout() {} }) }),
      },
      Image: { MakeImageFromEncoded: () => null },
      Data: { fromBase64: () => ({}) },
    },
  }),
  { virtual: true }
);

jest.mock('@hamster-note/painting/skia', () => ({ WebShapedRunProvider: class {} }));

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SkiaOverlay } from '@hamster-note/painting/skia';
import { rebaseOverlaysToFrame } from './frameOverlays.web';
import {
  CANVAS2D_PEN_DRAFT_OVERLAY_ID,
  canClearRetainedPenPreview,
  Canvas2dPenWorldLayer,
  clearRetainedCanvas2dPenPreview,
  readPerfRendererMode,
  resolveCanvas2dPenCommitClear,
  resolveCanvas2dPenWorldOverlays,
  resolvePerfRendererPulseMarker,
} from './EditorCandidateSurface.web';

function withSearch(search: string): void {
  (globalThis as { window?: unknown }).window = { location: { search } };
}

const penDraftOverlay: SkiaOverlay = {
  id: CANVAS2D_PEN_DRAFT_OVERLAY_ID,
  space: 'screen',
  kind: 'line',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
};
const rulerOverlay: SkiaOverlay = {
  id: 'editor-candidate-ruler-preview',
  space: 'world',
  kind: 'line',
  from: { x: 2, y: 2 },
  to: { x: 3, y: 3 },
};
const selectionOverlay: SkiaOverlay = {
  id: 'editor-candidate-selection',
  space: 'screen',
  kind: 'line',
  from: { x: 4, y: 4 },
  to: { x: 5, y: 5 },
};

describe('readPerfRendererMode', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('enables canvas2d-pen only when perf=1 is present', () => {
    withSearch('?perf=1&perfRenderer=canvas2d-pen');
    expect(readPerfRendererMode()).toBe('canvas2d-pen');

    withSearch('?perfRenderer=canvas2d-pen');
    expect(readPerfRendererMode()).toBeNull();
  });

  it('keeps the four existing diagnostic variants unchanged', () => {
    for (const mode of ['empty-pulse', 'overlay-only', 'world-pulse', 'split-canvas'] as const) {
      withSearch(`?perf=1&perfRenderer=${mode}`);
      expect(readPerfRendererMode()).toBe(mode);
    }
  });

  it('rejects unknown, partial or missing renderer values', () => {
    withSearch('?perf=1');
    expect(readPerfRendererMode()).toBeNull();

    withSearch('?perf=1&perfRenderer=canvas2d');
    expect(readPerfRendererMode()).toBeNull();

    withSearch('?perf=1&perfRenderer=');
    expect(readPerfRendererMode()).toBeNull();
  });
});

describe('resolvePerfRendererPulseMarker', () => {
  it('marks canvas2d-pen as off: the pen preview itself is the real visual load', () => {
    expect(resolvePerfRendererPulseMarker('canvas2d-pen')).toBe('off');
  });

  it('keeps the existing marker semantics unchanged', () => {
    expect(resolvePerfRendererPulseMarker('split-canvas')).toBe('off');
    for (const mode of ['empty-pulse', 'overlay-only', 'world-pulse'] as const) {
      expect(resolvePerfRendererPulseMarker(mode)).toBe('on');
    }
    expect(resolvePerfRendererPulseMarker(null)).toBeNull();
  });
});

describe('CANVAS2D_PEN_DRAFT_OVERLAY_ID', () => {
  it('matches the continuous pen draft overlay id used by draftOverlay', () => {
    // 与 Surface 中 draftOverlay 的 continuous pen 分支 id 严格一致；
    // 其余 overlay（尺子/选框/文本等）绝不被排除。
    expect(CANVAS2D_PEN_DRAFT_OVERLAY_ID).toBe('editor-candidate-pen-draft');
  });
});

describe('resolveCanvas2dPenWorldOverlays', () => {
  it('excludes only the active pen draft and keeps every other overlay in order', () => {
    const frameOverlays: readonly SkiaOverlay[] = Object.freeze([
      rulerOverlay,
      penDraftOverlay,
      selectionOverlay,
    ]);
    const resolved = resolveCanvas2dPenWorldOverlays('canvas2d-pen', frameOverlays, true);

    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(rulerOverlay);
    expect(resolved[1]).toBe(selectionOverlay);
    expect(resolved.some((overlay) => overlay.id === CANVAS2D_PEN_DRAFT_OVERLAY_ID)).toBe(false);
  });

  it('returns a shared frozen empty reference when the pen draft was the only overlay', () => {
    const first = resolveCanvas2dPenWorldOverlays('canvas2d-pen', [penDraftOverlay], true);
    const second = resolveCanvas2dPenWorldOverlays('canvas2d-pen', [penDraftOverlay], true);

    // world 层 React.memo 依赖引用稳定：空结果必须是同一冻结引用。
    expect(first).toHaveLength(0);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('returns the original reference when there is no pen draft to exclude', () => {
    const frameOverlays: readonly SkiaOverlay[] = Object.freeze([rulerOverlay, selectionOverlay]);
    // 不制造新数组，避免打扰 world 层 memo。
    expect(resolveCanvas2dPenWorldOverlays('canvas2d-pen', frameOverlays, true)).toBe(
      frameOverlays
    );
  });

  it('fails closed when the Canvas2D preview is not usable', () => {
    const frameOverlays: readonly SkiaOverlay[] = Object.freeze([penDraftOverlay, rulerOverlay]);
    // 预览不可用（backend 未挂载/不健康/未激活）时 pen 草稿必须回到 Skia overlay，
    // 绝不出现「两边都不画」的隐形预览。
    expect(resolveCanvas2dPenWorldOverlays('canvas2d-pen', frameOverlays, false)).toBe(
      frameOverlays
    );
  });

  it('leaves overlays untouched outside canvas2d-pen mode', () => {
    const frameOverlays: readonly SkiaOverlay[] = Object.freeze([penDraftOverlay, rulerOverlay]);
    for (const mode of [
      null,
      'split-canvas',
      'overlay-only',
      'world-pulse',
      'empty-pulse',
    ] as const) {
      expect(resolveCanvas2dPenWorldOverlays(mode, frameOverlays, true)).toBe(frameOverlays);
    }
  });
});

describe('resolveCanvas2dPenCommitClear', () => {
  it('retains the preview after a real commit until the world draw is visible', () => {
    expect(resolveCanvas2dPenCommitClear(true)).toBe('retain-until-world-present');
  });

  it('clears immediately when nothing was committed', () => {
    // 退化候选/预览未激活：绝不保留陈旧预览。
    expect(resolveCanvas2dPenCommitClear(false)).toBe('clear-immediately');
  });
});

describe('canClearRetainedPenPreview', () => {
  it('clears only after a world frame with the new revision has committed to React', () => {
    expect(canClearRetainedPenPreview(3, 3, true)).toBe(true);
    expect(canClearRetainedPenPreview(3, 4, true)).toBe(true);
  });

  it('refuses to clear without a pending commit identity', () => {
    expect(canClearRetainedPenPreview(null, 9, true)).toBe(false);
  });

  it('refuses to clear before the frame is ready or the revision has landed', () => {
    // 绝不按普通 React render 清除：frame 未 ready 或 revision 未到位都继续保留。
    expect(canClearRetainedPenPreview(3, 3, false)).toBe(false);
    expect(canClearRetainedPenPreview(3, 2, true)).toBe(false);
    expect(canClearRetainedPenPreview(3, 2, false)).toBe(false);
  });
});

describe('clearRetainedCanvas2dPenPreview', () => {
  it('actually clears a still-active retained backend (the exact post-commit state)', () => {
    // P0 回归：pen 提交后 backend 仍是 active（只有 clear 才复位）；旧逻辑「仅 !isActive 才
    // clear」会让保留预览永久残留、marker 谎称 cleared。helper 必须无视 active 实际调用 clear。
    const backend = { isDisposed: false, isActive: true, healthy: true, clear: jest.fn() };
    expect(clearRetainedCanvas2dPenPreview(backend)).toBe(true);
    expect(backend.clear).toHaveBeenCalledTimes(1);
  });

  it('clears an inactive retained backend as well (unconditional by design)', () => {
    const backend = { isDisposed: false, isActive: false, healthy: true, clear: jest.fn() };
    expect(clearRetainedCanvas2dPenPreview(backend)).toBe(true);
    expect(backend.clear).toHaveBeenCalledTimes(1);
  });

  it('refuses disposed or missing backends so the marker never lies about cleared', () => {
    // canvas 重挂载会 dispose 旧实例：不算已清除，调用方不得上报 'cleared'。
    const disposed = { isDisposed: true, isActive: false, healthy: false, clear: jest.fn() };
    expect(clearRetainedCanvas2dPenPreview(disposed)).toBe(false);
    expect(disposed.clear).not.toHaveBeenCalled();
    expect(clearRetainedCanvas2dPenPreview(null)).toBe(false);
  });
});

describe('Canvas2dPenWorldLayer', () => {
  interface CapturedLayerProps {
    overlays: readonly unknown[];
  }

  /** 极简 canvas stub：SSR 下记录传入的 overlays，并输出单个 <canvas>。 */
  function makeStubCanvas(captured: CapturedLayerProps[]) {
    const Stub = (props: { overlays?: readonly unknown[] }) => {
      captured.push({ overlays: props.overlays ?? [] });
      return createElement('canvas', { 'data-stub-canvas': 'true' });
    };
    return Stub as ComponentType<Record<string, unknown>>;
  }

  const baseLayerProps: Record<string, unknown> = {
    frame: Object.freeze({}),
    resolveImage: undefined,
    fontManager: undefined,
    fontFamily: undefined,
    canvasProps: { style: { width: 120, height: 80 } },
    width: 120,
    height: 80,
  };

  function renderLayer(props: Record<string, unknown>): string {
    return renderToStaticMarkup(
      createElement(
        Canvas2dPenWorldLayer as unknown as ComponentType<Record<string, unknown>>,
        props
      )
    );
  }

  it('is wrapped in React.memo so stable props skip re-render during pen gestures', () => {
    expect((Canvas2dPenWorldLayer as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for('react.memo')
    );
  });

  it('passes the given overlays through: only the pen draft is excluded upstream', () => {
    // split-canvas 的 world 层按自身契约硬编码空 overlays；canvas2d-pen 绝不能复用它，
    // 否则尺子/选框/形状草稿等非 pen overlay 会被静默丢弃。
    const captured: CapturedLayerProps[] = [];
    const overlays = Object.freeze([rulerOverlay, selectionOverlay]);
    const html = renderLayer({
      ...baseLayerProps,
      canvasComponent: makeStubCanvas(captured),
      overlays,
    });

    expect(html).toContain('data-perf-canvas-layer="world"');
    expect(html).toContain('pointer-events:none');
    expect((html.match(/<canvas/g) ?? []).length).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].overlays).toBe(overlays);
  });
});

describe('canvas2d-pen rebase pre-filter premise', () => {
  it('rebaseOverlaysToFrame preserves id set and order per overlay', () => {
    // 优化前提：rebase 逐 overlay 映射且不改 id/顺序，故「rebase 前按 id 剔除 pen 草稿」
    // 与「rebase 后过滤」输出严格等价。若 rebase 未来合并/重排 overlay，此测试先失败。
    const worldPenDraft: SkiaOverlay = {
      id: CANVAS2D_PEN_DRAFT_OVERLAY_ID,
      kind: 'polyline',
      space: 'world',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    };
    const frame = { frameOrigin: { x: 10, y: 20 } } as never;
    const source: readonly SkiaOverlay[] = [worldPenDraft, rulerOverlay];
    const rebased = rebaseOverlaysToFrame(source, frame);

    expect(rebased.map((overlay) => overlay.id)).toEqual(source.map((overlay) => overlay.id));
    // world polyline 确实按 frameOrigin 逐点重定基（这正是健康路径要省掉的 O(全部点) 工作）。
    const rebasedDraft = rebased[0] as Extract<SkiaOverlay, { kind: 'polyline' }>;
    expect(rebasedDraft.points[0]).toEqual({ x: -10, y: -20 });
  });
});
