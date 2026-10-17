import { useMemo, useRef } from 'react';

type LifecycleField =
  | 'layout-events'
  | 'layout-changes'
  | 'frame-builds'
  | 'canvas-mounts'
  | 'canvas-unmounts'
  | 'font-effects-created'
  | 'font-effects-cancelled'
  | 'font-effects-published';

/**
 * 诊断只写入专用 DOM 节点的属性。它不参与 React state，避免为了观测生命周期反过来触发 frame
 * 或 Canvas 更新。该节点仅在 ?diagnostics=1 时挂载。
 */
export type CandidateLifecycleDiagnostics = Readonly<{
  enabled: boolean;
  attach: (node: HTMLDivElement | null) => void;
  increment: (field: LifecycleField) => void;
  set: (
    field: 'resource-revision' | 'provider-identity' | 'route-phase' | 'layout-status',
    value: string
  ) => void;
}>;

const INITIAL_VALUES: Readonly<Record<LifecycleField, number>> = {
  'layout-events': 0,
  'layout-changes': 0,
  'frame-builds': 0,
  'canvas-mounts': 0,
  'canvas-unmounts': 0,
  'font-effects-created': 0,
  'font-effects-cancelled': 0,
  'font-effects-published': 0,
};

function diagnosticsEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('diagnostics') === '1'
  );
}

export function useCandidateLifecycleDiagnostics(): CandidateLifecycleDiagnostics {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const valuesRef = useRef<Record<LifecycleField, number>>({ ...INITIAL_VALUES });
  const detailRef = useRef({
    'resource-revision': '0',
    'provider-identity': 'none',
    'route-phase': 'surface-mounting',
    'layout-status': 'awaiting-layout',
  });

  return useMemo(() => {
    const flush = () => {
      const node = nodeRef.current;
      if (!node) return;
      for (const [field, value] of Object.entries(valuesRef.current)) {
        node.setAttribute(`data-${field}`, String(value));
      }
      for (const [field, value] of Object.entries(detailRef.current)) {
        node.setAttribute(`data-${field}`, value);
      }
    };
    return {
      enabled: diagnosticsEnabled(),
      attach: (node) => {
        nodeRef.current = node;
        flush();
      },
      increment: (field) => {
        valuesRef.current[field] += 1;
        flush();
      },
      set: (field, value) => {
        detailRef.current[field] = value;
        flush();
      },
    };
  }, []);
}
