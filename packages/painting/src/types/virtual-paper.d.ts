/**
 * Type declarations for @hamster-note/virtual-paper.
 *
 * The package currently publishes an empty dist/index.d.ts, so this ambient
 * module mirrors the installed runtime exports used by the painting package.
 */
declare module '@hamster-note/virtual-paper' {
  import type * as React from 'react';

  export const VirtualPaperInteractionMode: {
    readonly MouseWheelZoom: 'MouseWheelZoom';
    readonly MouseDragPan: 'MouseDragPan';
    readonly TrackpadScrollPan: 'TrackpadScrollPan';
    readonly MouseWheelCtrlZoom: 'MouseWheelCtrlZoom';
    readonly TouchSingleFingerPan: 'TouchSingleFingerPan';
    readonly TouchTwoFingerPan: 'TouchTwoFingerPan';
    readonly TouchTwoFingerZoom: 'TouchTwoFingerZoom';
    readonly PenPan: 'PenPan';
  };

  export type VirtualPaperInteractionMode =
    (typeof VirtualPaperInteractionMode)[keyof typeof VirtualPaperInteractionMode];

  export const VirtualPaperInitialPlacement: {
    readonly TopLeft: 'TopLeft';
    readonly Center: 'Center';
  };

  export type VirtualPaperInitialPlacement =
    (typeof VirtualPaperInitialPlacement)[keyof typeof VirtualPaperInitialPlacement];

  export const VirtualPaperRenderMode: {
    readonly Transform: 'Transform';
    readonly Scroll: 'Scroll';
  };

  export type VirtualPaperRenderMode = (typeof VirtualPaperRenderMode)[keyof typeof VirtualPaperRenderMode];

  export interface VirtualPaperTransform {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
  }

  export interface VirtualPaperProps {
    readonly children?: React.ReactNode;
    readonly enabledInteractions?: readonly VirtualPaperInteractionMode[];
    readonly initialPlacement?: VirtualPaperInitialPlacement;
    readonly renderMode?: VirtualPaperRenderMode;
    readonly transform?: VirtualPaperTransform;
    readonly defaultTransform?: VirtualPaperTransform;
    readonly minScale?: number;
    readonly maxScale?: number;
    readonly onTransformChange?: (transform: VirtualPaperTransform) => void;
    readonly onTransformChangeEnd?: (transform: VirtualPaperTransform) => void;
    readonly className?: string;
    readonly style?: React.CSSProperties;
    readonly containerClassName?: string;
    readonly containerStyle?: React.CSSProperties;
    readonly wrapperProps?: Record<string, unknown>;
    readonly containerProps?: Record<string, unknown>;
  }

  export const DEFAULT_ENABLED_INTERACTIONS: VirtualPaperInteractionMode[];
  export const VirtualPaper: React.ComponentType<VirtualPaperProps>;
}
