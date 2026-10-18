import type { LayeredViewportCommand } from '../../core/layeredEditorController';
import type {
  AcceptedSample,
  BrushSnapshot,
  Point,
  ResolvedPressureMode,
} from '../../model/document';

/** Future adapter protocol only; there is no native ink renderer or bridge implementation. */
export type NativeRawCommit = Readonly<{
  type: 'raw-commit';
  commitId: string;
  sessionId: string;
  lockedViewportRevision: number;
  brushSnapshot: BrushSnapshot;
  resolvedPressureMode: ResolvedPressureMode;
  coordinateSpace: 'world';
  acceptedSamples: readonly AcceptedSample[];
}>;

export type NativeSemanticMessage =
  | NativeRawCommit
  | Readonly<{ type: 'viewport-intent'; command: LayeredViewportCommand }>
  | Readonly<{
      type: 'tool-trajectory';
      sessionId: string;
      phase: 'begin' | 'update' | 'end' | 'cancel';
      viewportRevision: number;
      points: readonly Point[];
      tool: 'selection' | 'lasso' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'bezier';
    }>
  | Readonly<{ type: 'text-focus'; action: 'enter' | 'exit'; objectId?: string }>
  | Readonly<{ type: 'keyboard'; owner: 'web-text'; action: 'show' | 'hide' }>;

export type WebSemanticReply =
  | Readonly<{
      type: 'commit-result';
      commitId: string;
      status: 'committed' | 'duplicate' | 'rejected';
    }>
  | Readonly<{ type: 'viewport'; revision: number; scale: number; tx: number; ty: number }>
  | Readonly<{ type: 'text-focus'; owner: 'web-text' | 'none' }>;
