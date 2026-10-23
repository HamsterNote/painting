import type { LayeredEditorController } from '../../core/layeredEditorController';
import type { FreehandInputBatch } from '../../core/freehandSession';
import type { PresentationCoordinator } from '../../layered/PresentationCoordinator';
import type { createLayeredInputArbiter } from '../web/layeredInputArbiter';
import {
  isPencilkitDemoSample,
  isPencilkitDemoStroke,
  type PencilkitDemoMessage,
  type PencilkitDemoReply,
  type PencilkitDemoSample,
  type PencilkitDemoState,
} from './pencilkitDemoContract';

export type PencilkitDemoConnection = {
  onState: (state: PencilkitDemoState) => void;
  onReply: (reply: PencilkitDemoReply) => void;
  register: (receiver: ((message: PencilkitDemoMessage) => void) | undefined) => void;
};

/** Bounded feasibility bridge. The controller remains the only document/history owner. */
export function connectPencilkitDemo(options: {
  host: HTMLElement;
  controller: LayeredEditorController;
  presentation: PresentationCoordinator;
  arbiter: ReturnType<typeof createLayeredInputArbiter>;
  connection: PencilkitDemoConnection;
}) {
  const { host, controller, presentation, arbiter, connection } = options;
  // LAN Metro uses HTTP; randomUUID is secure-context-only in WKWebView.
  const epoch = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  let revision = 0;
  let contextKey = '';
  let contextFingerprint = '';
  let destroyed = false;
  let faulted = false;
  let active:
    | {
        id: number;
        key: string;
        commitId: string;
        first: PencilkitDemoSample;
        viewportRevision: number;
      }
    | undefined;
  const pending = new Map<
    number,
    { key: string; commitId: string; committed: boolean; timer: ReturnType<typeof setTimeout> }
  >();
  const responses = new Map<number, { reply: PencilkitDemoReply; fingerprint: string }>();
  const completed = new Map<number, { key: string; fingerprint: string }>();
  const cancelled = new Map<number, string>();
  let enabled = false;

  function reply(value: PencilkitDemoReply) {
    if (!destroyed) connection.onReply(value);
  }
  function retire(id: number, key: string, reason?: string) {
    reply({ id, contextKey: key, status: 'retire', ...(reason ? { reason } : {}) });
  }
  function cancel(reason: string): boolean {
    const lease = active;
    if (!lease) return true;
    active = undefined;
    cancelled.set(lease.id, lease.key);
    if (cancelled.size > 32) cancelled.delete(cancelled.keys().next().value!);
    const snapshot = controller.getSnapshot('interaction').activeFreehand;
    if (snapshot?.status === 'collecting' && snapshot.commitId === lease.commitId) {
      const result = controller.cancelFreehand({
        type: 'cancel',
        sessionId: lease.commitId,
        pointerId: lease.commitId,
        source: 'native',
        batchSequence: 1,
        reason: 'explicit',
      });
      if (!result.ok) return false;
    }
    presentation.retireNative(lease.commitId);
    retire(lease.id, lease.key, reason);
    arbiter.releaseNativePencil();
    return true;
  }
  function publish() {
    if (destroyed) return;
    const rect = host.getBoundingClientRect();
    const frame = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    const exclusions = Array.from(
      host.querySelectorAll(
        'button,input,textarea,select,[contenteditable],[data-interactive],[data-selection-operation]'
      )
    )
      .map((element) => element.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 && bounds.height > 0)
      .map((bounds) => ({
        x: bounds.left - rect.left,
        y: bounds.top - rect.top,
        width: bounds.width,
        height: bounds.height,
      }));
    const tools = controller.getSnapshot('tools');
    const input = controller.getSnapshot('input');
    const navigation = controller.getSnapshot('navigation');
    const viewport = controller.getSnapshot('viewport');
    const fingerprint = JSON.stringify([
      frame,
      exclusions,
      tools.activeTool,
      tools.settings.freehand,
      input.mode,
      navigation.ruler.visible,
      viewport,
    ]);
    if (fingerprint !== contextFingerprint) {
      const old = contextFingerprint;
      contextFingerprint = fingerprint;
      contextKey = `${epoch}:${++revision}`;
      // Settings changes are allowed mid-stroke; controller owns its frozen brush.
      if (
        active &&
        old &&
        (tools.activeTool !== 'freehand' ||
          navigation.ruler.visible ||
          viewport.revision !== active.viewportRevision)
      ) {
        cancel('context-invalidated');
        arbiter.releaseNativePencil();
      }
    }
    enabled =
      !faulted &&
      tools.activeTool === 'freehand' &&
      !navigation.ruler.visible &&
      rect.width > 0 &&
      rect.height > 0 &&
      pending.size < 4 &&
      host.dataset.inputReady === 'true';
    connection.onState({
      protocolVersion: 1,
      contextKey,
      enabled,
      frame,
      exclusions,
      brush: tools.settings.freehand,
      scale: viewport.viewport.scale,
    });
  }
  function batch(
    lease: NonNullable<typeof active>,
    samples: readonly PencilkitDemoSample[],
    sequence: number
  ): FreehandInputBatch {
    return {
      sessionId: lease.commitId,
      pointerId: lease.commitId,
      source: 'native',
      batchSequence: sequence,
      coordinateSpace: 'screen',
      viewportRevision: lease.viewportRevision,
      samples: samples.map((sample) => ({
        sequence: sample.seq,
        x: sample.x,
        y: sample.y,
        time: sample.tabs,
        phase: sample.phase === 'cancel' ? 'up' : sample.phase,
        ...(sample.p === null ? {} : { pressure: sample.p }),
      })),
    };
  }
  function receive(message: PencilkitDemoMessage) {
    if (
      destroyed ||
      !message ||
      message.protocolVersion !== 1 ||
      !Number.isSafeInteger(message.messageId)
    )
      return;
    const previous = responses.get(message.messageId);
    const fingerprint = JSON.stringify(message);
    if (previous) {
      reply(
        previous.fingerprint === fingerprint
          ? previous.reply
          : {
              messageId: message.messageId,
              id: message.id,
              contextKey: message.contextKey,
              status: 'rejected',
              reason: 'message-id-conflict',
            }
      );
      return;
    }
    let status: PencilkitDemoReply['status'] = 'rejected';
    let reason: string | undefined;
    if (message.type === 'reset') {
      cancel('host-reset');
      arbiter.releaseNativePencil();
      faulted = false;
      for (const [id, entry] of pending) {
        const result = controller.commitFreehand(entry.commitId);
        if (result.ok) {
          entry.committed = true;
          if (!result.value.presentInDocument) retire(id, entry.key);
          else presentation.confirmMounted();
        } else {
          faulted = true;
          reason = result.error.code;
        }
      }
      status = 'reset';
    } else if (message.type === 'retired') {
      const entry = pending.get(message.id);
      if (entry && entry.key === message.contextKey) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        presentation.retireNative(entry.commitId);
      }
      status = 'visible';
    } else if (message.type === 'begin') {
      publish();
      if (
        !enabled ||
        active ||
        pending.has(message.id) ||
        completed.has(message.id) ||
        message.contextKey !== contextKey ||
        !isPencilkitDemoSample(message.sample) ||
        message.sample.phase !== 'down' ||
        message.sample.seq !== 0
      )
        reason = 'invalid-or-stale-begin';
      else {
        const commitId = `${epoch}:pencil:${message.id}`;
        const lease = {
          id: message.id,
          key: message.contextKey,
          commitId,
          first: message.sample,
          viewportRevision: controller.getSnapshot('viewport').revision,
        };
        const claimed = arbiter.claimNativePencil(
          {
            phase: 'down',
            pointerId: commitId,
            device: 'pen',
            targetRole: 'paper',
            screen: { x: message.sample.x, y: message.sample.y },
            timestamp: message.sample.tabs,
            modifiers: { alt: false, ctrl: false, meta: false, shift: false },
          },
          () => cancel('input-cancelled')
        );
        if (claimed) {
          presentation.holdNative(commitId, () => retire(lease.id, lease.key));
          const result = controller.beginFreehand({
            type: 'begin',
            commitId,
            pressureCapability: message.sample.mf > 0 ? 'available' : 'unavailable',
            batch: batch(lease, [message.sample], 0),
          });
          if (result.ok) {
            active = lease;
            status = 'accepted';
          } else {
            presentation.retireNative(commitId);
            reason = result.error.code;
          }
        } else reason = 'input-owner-conflict';
        if (status !== 'accepted') arbiter.releaseNativePencil();
      }
      if (status === 'rejected') retire(message.id, message.contextKey, reason);
    } else if (message.type === 'stroke') {
      const lease = active;
      const stroke = message.stroke;
      const receipt = completed.get(message.id);
      if (receipt) {
        if (receipt.key === message.contextKey && receipt.fingerprint === JSON.stringify(stroke))
          status = 'committed';
        else reason = 'commit-id-conflict';
      } else if (!lease || lease.id !== message.id || lease.key !== message.contextKey)
        reason =
          cancelled.get(message.id) === message.contextKey ? 'cancelled-session' : 'no-begin-lease';
      else if (
        !isPencilkitDemoStroke(stroke) ||
        stroke.id !== message.id ||
        stroke.overflow ||
        stroke.cancelled ||
        !sameSample(stroke.samples[0], lease.first)
      ) {
        reason = 'invalid-or-incomplete-stroke';
        cancel(reason);
      } else {
        // Full validation precedes end; the first down was already accepted at begin.
        active = undefined;
        const result = controller.endFreehand({
          type: 'end',
          batch: batch(lease, stroke.samples.slice(1), 1),
        });
        if (result.ok) {
          const timer = setTimeout(() => {
            faulted = true;
            reply({
              id: lease.id,
              contextKey: lease.key,
              status: 'rejected',
              reason: 'handoff-stalled',
            });
            publish();
          }, 5000);
          const entry = { key: lease.key, commitId: lease.commitId, committed: false, timer };
          pending.set(lease.id, entry);
          const commit = controller.commitFreehand(lease.commitId);
          if (commit.ok) {
            status = 'committed';
            entry.committed = true;
            completed.set(lease.id, { key: lease.key, fingerprint: JSON.stringify(stroke) });
            if (completed.size > 32) completed.delete(completed.keys().next().value!);
          } else {
            reason = commit.error.code;
            faulted = true;
          }
        } else {
          active = lease;
          reason = result.error.code;
          cancel(reason);
        }
      }
      arbiter.releaseNativePencil();
      if (status === 'rejected' && !pending.has(message.id) && !receipt)
        retire(message.id, message.contextKey, reason);
    }
    const response = {
      messageId: message.messageId,
      id: message.id,
      contextKey: message.contextKey,
      status,
      ...(reason ? { reason } : {}),
    };
    responses.set(message.messageId, { reply: response, fingerprint });
    if (responses.size > 32) responses.delete(responses.keys().next().value!);
    reply(response);
    publish();
  }
  const channels = [
    'tools',
    'input',
    'viewport',
    'navigation',
    'history',
    'interaction',
    'document',
  ] as const;
  const stops = channels.map((channel) =>
    controller.subscribe(channel, () => {
      const snapshot = controller.getSnapshot('interaction').activeFreehand;
      if (active && (snapshot?.status !== 'collecting' || snapshot.commitId !== active.commitId)) {
        cancel('controller-cancelled');
        arbiter.releaseNativePencil();
      }
      for (const [id, entry] of pending) {
        if (
          entry.committed &&
          !controller
            .getSnapshot('document')
            .objects.some(
              (object) => object.kind === 'freehand' && object.commitId === entry.commitId
            )
        )
          retire(id, entry.key, 'document-removed');
      }
      publish();
    })
  );
  const resize = () => {
    cancel('layout-changed');
    arbiter.releaseNativePencil();
    publish();
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  observer?.observe(host);
  window.addEventListener('resize', resize);
  const mutations = new MutationObserver(publish);
  mutations.observe(host, { childList: true, subtree: true });
  arbiter.setNativePencilGuard(() => {
    faulted = true;
    cancel('dom-pencil-fallback');
    reply({ id: 0, contextKey, status: 'rejected', reason: 'dom-pencil-fallback' });
    publish();
  });
  connection.register(receive);
  publish();
  return () => {
    arbiter.setNativePencilGuard(undefined);
    cancel('unmount');
    arbiter.releaseNativePencil();
    destroyed = true;
    stops.forEach((stop) => stop());
    observer?.disconnect();
    mutations.disconnect();
    window.removeEventListener('resize', resize);
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      presentation.retireNative(entry.commitId);
    });
    connection.register(undefined);
  };
}

function sameSample(a: PencilkitDemoSample, b: PencilkitDemoSample): boolean {
  return (
    a.seq === b.seq &&
    a.phase === b.phase &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.y === b.y &&
    a.tabs === b.tabs &&
    a.f === b.f &&
    a.mf === b.mf &&
    a.p === b.p
  );
}
