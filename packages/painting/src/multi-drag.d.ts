declare module '@system-ui-js/multi-drag' {
  export type DragInputEvent = {
    pointerType?: string;
    button?: number;
    clientX?: number;
    clientY?: number;
    timeStamp?: number;
  };

  export type FingerPathItem = {
    point: { x: number; y: number };
    timestamp?: number;
    pressure?: number;
    event?: DragInputEvent;
  };

  export type Finger = {
    getPath: () => FingerPathItem[];
  };

  export type DragPose = {
    position: { x: number; y: number };
    width: number;
    height: number;
  };

  export type DragOptions = {
    maxFingerCount?: number;
    getPose?: () => DragPose;
    setPose?: (pose: DragPose) => void;
  };

  export const DragOperationType: {
    Move: 'Move';
    AllEnd: 'AllEnd';
  };

  export class Drag {
    constructor(element: Element, options: DragOptions);
    addEventListener(type: (typeof DragOperationType)[keyof typeof DragOperationType], listener: (fingers: Finger[]) => void): void;
    destroy(): void;
  }
}
