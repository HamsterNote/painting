import type {
  LayeredEditorController,
  LayeredPresentationIdentity,
} from '../core/layeredEditorController';
import type { DocumentObject, FreehandObject } from '../model/document';
import { traceGesture, type GestureTraceObserver } from '../input/web/gestureTrace';

export interface HistoryPresentationNode {
  setVisible(visible: boolean): void;
  matches?(identity: LayeredPresentationIdentity): boolean;
}

type PendingEntry = {
  object: FreehandObject;
  identity: LayeredPresentationIdentity;
  ready: boolean;
};

function matches(a: LayeredPresentationIdentity, b: LayeredPresentationIdentity): boolean {
  return (
    a.objectId === b.objectId &&
    a.commitId === b.commitId &&
    a.documentRevision === b.documentRevision &&
    a.geometryRevision === b.geometryRevision
  );
}

/** Web-internal ownership only. An ACK proves mounted content, never physical paint. */
export class PresentationCoordinator {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly nodes = new Map<
    string,
    { node: HistoryPresentationNode; documentObject: boolean }
  >();
  private objects: readonly DocumentObject[];
  private repaint: () => void = () => {};
  private readonly unsubscribe: () => void;

  constructor(
    private readonly controller: LayeredEditorController,
    private readonly onTrace?: GestureTraceObserver
  ) {
    this.objects = controller.getSnapshot('document').objects;
    this.unsubscribe = controller.subscribe('document', () => this.syncDocument());
  }

  setRepaint(repaint: () => void): () => void {
    this.repaint = repaint;
    return () => {
      if (this.repaint === repaint) this.repaint = () => {};
    };
  }

  private syncDocument(): void {
    const next = this.controller.getSnapshot('document').objects;
    const previousIds = new Set(this.objects.map((object) => object.objectId));
    const live = new Set(next.map((object) => object.objectId));
    for (const id of this.pending.keys()) if (!live.has(id)) this.pending.delete(id);
    for (const object of next) {
      if (object.kind !== 'freehand') continue;
      if (!previousIds.has(object.objectId) || this.pending.has(object.objectId)) {
        const result = this.controller.getPresentationIdentity(object.commitId);
        if (!result.ok) throw new Error(`Cannot prepare presentation: ${result.error.code}`);
        if (result.value) {
          this.pending.set(object.objectId, { object, identity: result.value, ready: false });
          if (this.onTrace)
            traceGesture(this.onTrace, {
              scope: 'presentation',
              action: 'pending',
              ...result.value,
            });
        }
      }
    }
    this.objects = next;
    this.updateVisibility();
    this.repaint();
  }

  getPending(): readonly FreehandObject[] {
    return this.objects.flatMap((object) => {
      const entry = this.pending.get(object.objectId);
      return entry ? [entry.object] : [];
    });
  }

  getIdentity(objectId: string): LayeredPresentationIdentity | undefined {
    return this.pending.get(objectId)?.identity;
  }

  isHidden(objectId: string): boolean {
    const firstPending = this.objects.findIndex((object) => this.pending.has(object.objectId));
    return (
      firstPending >= 0 &&
      this.objects.findIndex((object) => object.objectId === objectId) >= firstPending
    );
  }

  mount(objectId: string, node: HistoryPresentationNode): () => void {
    const registration = {
      node,
      documentObject: this.objects.some((object) => object.objectId === objectId),
    };
    this.nodes.set(objectId, registration);
    node.setVisible(!this.isHidden(objectId));
    return () => {
      if (this.nodes.get(objectId) === registration) {
        this.nodes.delete(objectId);
        const entry = this.pending.get(objectId);
        if (entry) entry.ready = false;
      }
    };
  }

  confirmMounted(): boolean {
    for (const object of this.objects) {
      const entry = this.pending.get(object.objectId);
      if (entry && this.nodes.get(object.objectId)?.node.matches?.(entry.identity))
        this.acknowledge(entry.identity);
    }
    return this.pending.size === 0;
  }

  acknowledge(identity: LayeredPresentationIdentity): boolean {
    const entry = this.pending.get(identity.objectId);
    if (!entry || !this.nodes.has(identity.objectId) || !matches(entry.identity, identity))
      return false;
    entry.ready = true;
    // A later ACK cannot move a newer SVG object below older Canvas ink.
    for (const object of this.objects) {
      const pending = this.pending.get(object.objectId);
      if (!pending) continue;
      if (!pending.ready) break;
      this.pending.delete(object.objectId);
      if (this.onTrace)
        traceGesture(this.onTrace, {
          scope: 'presentation',
          action: 'visible',
          ...pending.identity,
        });
    }
    // Both operations run synchronously in one JS task before yielding to paint.
    this.updateVisibility();
    this.repaint();
    return true;
  }

  private updateVisibility(): void {
    const live = new Set(this.objects.map((object) => object.objectId));
    for (const [id, registration] of this.nodes)
      registration.node.setVisible(
        (!registration.documentObject || live.has(id)) && !this.isHidden(id)
      );
  }

  destroy(): void {
    this.unsubscribe();
    this.pending.clear();
    this.nodes.clear();
    this.repaint = () => {};
  }
}
