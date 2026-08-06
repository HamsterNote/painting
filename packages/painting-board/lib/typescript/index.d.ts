import { type DrawingSurfaceHandle, type DrawingSurfaceProps, type DrawingSurfaceVirtualPaperOptions } from '@hamster-note/painting';
/** ref 句柄与 DrawingSurface 完全一致 */
export type PaintingBoardHandle = DrawingSurfaceHandle;
/**
 * 默认 virtual-paper 配置（抄自 hamster-note webview 的 PaintingCanvas）。
 * 刻意不包含 mouseDragPan / touchSingleFingerPan：
 * 鼠标左键与单指触摸仍然用于“画画”，平移/缩放交给触控板与双指手势。
 */
export declare const DEFAULT_VIRTUAL_PAPER_OPTIONS: DrawingSurfaceVirtualPaperOptions;
export interface PaintingBoardProps extends Omit<DrawingSurfaceProps, 'virtualPaper'> {
    /**
     * virtual-paper 开关与配置：
     * - 省略 / true：使用 DEFAULT_VIRTUAL_PAPER_OPTIONS 开启画布漫游；
     * - false：完全关闭（行为等同裸 DrawingSurface 的默认状态）；
     * - 对象：在默认配置基础上浅合并覆盖（如 { enabled: false } 可临时关闭）。
     */
    virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions;
}
/**
 * 画板组件：全尺寸 wrapper + DrawingSurface（默认开启 virtual-paper 画布漫游）。
 */
export declare const PaintingBoard: import("react").ForwardRefExoticComponent<PaintingBoardProps & import("react").RefAttributes<DrawingSurfaceHandle>>;
export type { DrawingSurfaceHandle, DrawingSurfaceProps, DrawingSurfaceVirtualPaperInteraction, DrawingSurfaceVirtualPaperOptions, DrawingPoint, DrawingStroke, DrawingTool, DrawingValue, } from '@hamster-note/painting';
//# sourceMappingURL=index.d.ts.map