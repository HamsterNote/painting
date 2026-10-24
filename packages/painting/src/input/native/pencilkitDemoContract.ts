import type { BrushSnapshot } from '../../model/document';

/** Opt-in G2/G3 experiment, not the production semantic protocol. */
export type PencilkitDemoSample = Readonly<{
  seq: number;
  phase: 'down' | 'move' | 'up' | 'cancel';
  kind: 'main' | 'coalesced';
  x: number;
  y: number;
  tabs: number;
  f: number;
  mf: number;
  p: number | null;
}>;
export type PencilkitDemoStroke = Readonly<{
  id: number;
  cancelled: boolean;
  overflow: boolean;
  samples: readonly PencilkitDemoSample[];
}>;
type Envelope = Readonly<{ protocolVersion: 1; messageId: number; contextKey: string; id: number }>;
export type PencilkitDemoMessage = Envelope &
  (
    | { type: 'begin'; sample: PencilkitDemoSample }
    | { type: 'stroke'; stroke: PencilkitDemoStroke }
    | { type: 'retired' }
    | { type: 'reset' }
  );
export type PencilkitDemoReply = Readonly<{
  messageId?: number;
  id: number;
  contextKey: string;
  status: 'accepted' | 'committed' | 'retire' | 'visible' | 'rejected' | 'reset';
  reason?: string;
}>;
export type PencilkitDemoState = Readonly<{
  protocolVersion: 1;
  contextKey: string;
  enabled: boolean;
  frame: { x: number; y: number; width: number; height: number };
  exclusions: readonly { x: number; y: number; width: number; height: number }[];
  brush: BrushSnapshot;
  scale: number;
}>;

export function isPencilkitDemoSample(value: unknown): value is PencilkitDemoSample {
  if (!value || typeof value !== 'object') return false;
  const v = value as PencilkitDemoSample;
  return (
    Number.isSafeInteger(v.seq) &&
    v.seq >= 0 &&
    ['main', 'coalesced'].includes(v.kind) &&
    ['down', 'move', 'up', 'cancel'].includes(v.phase) &&
    [v.x, v.y, v.tabs, v.f, v.mf].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (v.p === null || (typeof v.p === 'number' && Number.isFinite(v.p))) &&
    (v.mf > 0 ? v.p === v.f / v.mf : v.p === null)
  );
}

export function isPencilkitDemoStroke(value: unknown): value is PencilkitDemoStroke {
  if (!value || typeof value !== 'object') return false;
  const v = value as PencilkitDemoStroke;
  return (
    Number.isSafeInteger(v.id) &&
    v.id > 0 &&
    typeof v.cancelled === 'boolean' &&
    typeof v.overflow === 'boolean' &&
    Array.isArray(v.samples) &&
    v.samples.length >= 2 &&
    v.samples.length <= 50_000 &&
    v.samples.every(
      (sample, index) =>
        isPencilkitDemoSample(sample) &&
        sample.seq === index &&
        sample.phase ===
          (index === 0
            ? 'down'
            : index === v.samples.length - 1
              ? v.cancelled
                ? 'cancel'
                : 'up'
              : 'move')
    )
  );
}
