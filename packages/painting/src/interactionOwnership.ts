import {
  type DrawingSurfaceVirtualPaperInteraction,
  SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS,
} from './virtualPaperOptions';

export type InteractionOwner = 'ruler' | 'virtual-paper' | 'drawing' | 'none';

export type InteractionInputMethod = 'touch' | 'mouse' | 'pen';

export type PointerInteractionInput = {
  readonly kind: 'pointer';
  readonly target: EventTarget | null;
  /** Pointer coordinates hit the screen-space ruler, even when its visual overlay is pointer-inert. */
  readonly hitsRuler?: boolean;
  readonly pointerType?: string;
  readonly button?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly pointerId?: number;
};

export type WheelInteractionInput = {
  readonly kind: 'wheel';
  readonly target: EventTarget | null;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
};

export type InteractionInput = PointerInteractionInput | WheelInteractionInput;

export type PointerInteractionEvent = Event & {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType?: string;
  readonly button?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly pointerId?: number;
};

export type ClassifyInteractionOptions = {
  readonly input: InteractionInput;
  readonly isDrawingEnabled: boolean;
  readonly isRulerEnabled: boolean;
  readonly virtualPaperEnabled: boolean;
  readonly allowedDrawingInputMethods: readonly InteractionInputMethod[];
  readonly virtualPaperInteractions?: readonly DrawingSurfaceVirtualPaperInteraction[];
  readonly activeTouchPointers?: number;
};

const SAFE_INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a[href], [role="button"], [role="link"], [contenteditable="true"], [data-interactive]';

export function buildPointerInteractionInput(
  event: PointerInteractionEvent,
  buttonOverride?: number
): PointerInteractionInput {
  return {
    kind: 'pointer',
    target: event.target,
    pointerType: event.pointerType ?? (event.type === 'dblclick' ? 'mouse' : undefined),
    button: buttonOverride ?? event.button,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    pointerId: event.pointerId,
  };
}

export function classifyInteraction(options: ClassifyInteractionOptions): InteractionOwner {
  if (isRulerInteraction(options.input, options.isRulerEnabled)) {
    return 'ruler';
  }

  if (isSafeInteractiveTarget(options.input.target)) {
    return 'none';
  }

  if (isVirtualPaperInteraction(options)) {
    return 'virtual-paper';
  }

  if (options.input.kind === 'wheel') {
    return 'none';
  }

  if (!options.isDrawingEnabled) {
    return 'none';
  }

  return isAllowedDrawingPointer(options.input, options.allowedDrawingInputMethods)
    ? 'drawing'
    : 'none';
}

export type GestureOwner = {
  readonly startPointer: (options: ClassifyInteractionOptions) => InteractionOwner;
  readonly getPointerOwner: (pointerId: number) => InteractionOwner;
  readonly endPointer: (pointerId: number) => InteractionOwner;
  readonly reset: () => void;
};

export function createGestureOwner(): GestureOwner {
  const ownersByPointer = new Map<number, InteractionOwner>();

  return {
    startPointer(options) {
      if (options.input.kind !== 'pointer') {
        return classifyInteraction(options);
      }
      const pointerId = options.input.pointerId ?? 1;
      const existingOwner = ownersByPointer.get(pointerId);
      if (existingOwner !== undefined) {
        return existingOwner;
      }
      const owner = classifyInteraction(options);
      ownersByPointer.set(pointerId, owner);
      return owner;
    },
    getPointerOwner(pointerId) {
      return ownersByPointer.get(pointerId) ?? 'none';
    },
    endPointer(pointerId) {
      const owner = ownersByPointer.get(pointerId) ?? 'none';
      ownersByPointer.delete(pointerId);
      return owner;
    },
    reset() {
      ownersByPointer.clear();
    },
  };
}

export function getResolvedVirtualPaperInteractions(
  interactions: readonly DrawingSurfaceVirtualPaperInteraction[] | undefined
): readonly DrawingSurfaceVirtualPaperInteraction[] {
  return interactions ?? SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS;
}

export function isSafeInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SAFE_INTERACTIVE_SELECTOR) !== null;
}

function isRulerInteraction(input: InteractionInput, isRulerEnabled: boolean): boolean {
  if (!isRulerEnabled || input.kind !== 'pointer') {
    return false;
  }
  const targetHitsRuler =
    input.target instanceof Element &&
    input.target.closest('[data-testid="drawing-ruler"]') !== null;
  if (input.hitsRuler !== true && !targetHitsRuler) {
    return false;
  }

  if (input.pointerType === 'touch' || input.pointerType === 'pen') {
    return true;
  }

  return (input.pointerType === 'mouse' || input.pointerType === undefined) && input.button === 0;
}

function isVirtualPaperInteraction(options: ClassifyInteractionOptions): boolean {
  if (!options.virtualPaperEnabled) {
    return false;
  }

  const interactions = getResolvedVirtualPaperInteractions(options.virtualPaperInteractions);

  switch (options.input.kind) {
    case 'wheel':
      return isVirtualPaperWheel(options.input, interactions);
    case 'pointer':
      return isVirtualPaperPointer(options.input, interactions, options.activeTouchPointers ?? 1);
  }
}

function isVirtualPaperWheel(
  input: WheelInteractionInput,
  interactions: readonly DrawingSurfaceVirtualPaperInteraction[]
): boolean {
  const hasZoomModifier = input.ctrlKey === true || input.metaKey === true;
  if (hasZoomModifier) {
    return interactions.includes('mouseWheelCtrlZoom') || interactions.includes('mouseWheelZoom');
  }
  return interactions.includes('trackpadScrollPan') || interactions.includes('mouseWheelZoom');
}

function isVirtualPaperPointer(
  input: PointerInteractionInput,
  interactions: readonly DrawingSurfaceVirtualPaperInteraction[],
  activeTouchPointers: number
): boolean {
  if (input.pointerType === 'touch') {
    if (activeTouchPointers === 1) {
      return interactions.includes('touchSingleFingerPan');
    }

    return (
      activeTouchPointers >= 2 &&
      (interactions.includes('touchTwoFingerPan') || interactions.includes('touchTwoFingerZoom'))
    );
  }

  if (input.pointerType === 'pen') {
    return interactions.includes('penPan');
  }

  if (input.pointerType === 'mouse' || input.pointerType === undefined) {
    return interactions.includes('mouseDragPan') && input.button === 0;
  }

  return false;
}

function isAllowedDrawingPointer(
  input: PointerInteractionInput,
  allowedMethods: readonly InteractionInputMethod[]
): boolean {
  if (input.button !== undefined && input.button !== 0) {
    return false;
  }

  if (input.pointerType === 'pen') {
    return allowedMethods.includes('pen');
  }

  if (input.pointerType === undefined || input.pointerType === 'touch') {
    return allowedMethods.includes('touch');
  }

  if (input.pointerType === 'mouse') {
    return allowedMethods.includes('mouse') && input.button === 0;
  }

  return false;
}
