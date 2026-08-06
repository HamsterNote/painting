/**
 * @hamster-note/painting-board
 *
 * PaintingBoard 是基于 @hamster-note/painting 的 DrawingSurface 封装的
 * “开箱即用”画板组件：
 *   1. 默认开启 virtual-paper，支持触控板滚动平移、Ctrl+滚轮缩放、
 *      双指平移/缩放等画布漫游交互（参考 hamster-note webview 的用法）；
 *   2. 通过全尺寸 wrapper 保证画板撑满父组件（父组件需有确定尺寸或 flex 布局）。
 *
 * 所有 DrawingSurface 的 props / ref handle 均原样透传。
 */
import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  DrawingSurface,
  type DrawingSurfaceHandle,
  type DrawingSurfaceProps,
  type DrawingSurfaceVirtualPaperOptions,
} from '@hamster-note/painting';

/** ref 句柄与 DrawingSurface 完全一致 */
export type PaintingBoardHandle = DrawingSurfaceHandle;

/**
 * 默认 virtual-paper 配置（抄自 hamster-note webview 的 PaintingCanvas）。
 * 刻意不包含 mouseDragPan / touchSingleFingerPan：
 * 鼠标左键与单指触摸仍然用于“画画”，平移/缩放交给触控板与双指手势。
 */
export const DEFAULT_VIRTUAL_PAPER_OPTIONS: DrawingSurfaceVirtualPaperOptions = {
  minScale: 0.25,
  maxScale: 8,
  enabledInteractions: [
    'trackpadScrollPan',
    'mouseWheelCtrlZoom',
    'touchTwoFingerZoom',
    'touchTwoFingerPan',
  ],
};

export interface PaintingBoardProps extends Omit<DrawingSurfaceProps, 'virtualPaper'> {
  /**
   * virtual-paper 开关与配置：
   * - 省略 / true：使用 DEFAULT_VIRTUAL_PAPER_OPTIONS 开启画布漫游；
   * - false：完全关闭（行为等同裸 DrawingSurface 的默认状态）；
   * - 对象：在默认配置基础上浅合并覆盖（如 { enabled: false } 可临时关闭）。
   */
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions;
}

/** 计算最终传给 DrawingSurface 的 virtualPaper 值 */
function resolveVirtualPaper(
  virtualPaper: PaintingBoardProps['virtualPaper']
): boolean | DrawingSurfaceVirtualPaperOptions {
  if (virtualPaper === undefined || virtualPaper === true) {
    return DEFAULT_VIRTUAL_PAPER_OPTIONS;
  }
  if (virtualPaper === false) {
    return false;
  }
  // 对象：浅合并，调用方可覆盖 minScale/maxScale/enabledInteractions/enabled 等
  return { ...DEFAULT_VIRTUAL_PAPER_OPTIONS, ...virtualPaper };
}

const styles = StyleSheet.create({
  // wrapper 撑满父组件；minHeight: 0 允许在 flex 布局中小于内容高度收缩
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: 0,
    alignSelf: 'stretch',
  },
});

/**
 * 画板组件：全尺寸 wrapper + DrawingSurface（默认开启 virtual-paper 画布漫游）。
 */
export const PaintingBoard = forwardRef<PaintingBoardHandle, PaintingBoardProps>(
  function PaintingBoard(props, ref) {
    const { virtualPaper, ...rest } = props;
    return (
      <View style={styles.root}>
        <DrawingSurface {...rest} virtualPaper={resolveVirtualPaper(virtualPaper)} ref={ref} />
      </View>
    );
  }
);

// 常用类型 re-export，消费方只需依赖本包即可获得完整类型
export type {
  DrawingSurfaceHandle,
  DrawingSurfaceProps,
  DrawingSurfaceVirtualPaperInteraction,
  DrawingSurfaceVirtualPaperOptions,
  DrawingPoint,
  DrawingStroke,
  DrawingTool,
  DrawingValue,
} from '@hamster-note/painting';
