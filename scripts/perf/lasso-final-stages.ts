import {
  lassoFixture,
  lassoTrajectory,
} from '../../apps/playground/src/layered-editor/lassoPerformanceFixture';
import {
  prepareLayeredObjectQuery,
  createControllerObjectQuery,
  createLayeredLassoQuery,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';
import { createEditor } from '../../packages/painting/src/layered/createEditor';
import { layeredGeometryCache } from '../../packages/painting/src/core/layeredGeometryCache';

export function cell(count: number, scenario: string, rendered = false) {
  const document = lassoFixture(count, scenario);
  const path = lassoTrajectory(scenario);
  const controller = rendered ? createEditor(document) : undefined;
  const cache = controller ? layeredGeometryCache(controller) : new FreehandGeometryCache();
  // Reproduce the geometry already owned by Display/Navigation before release.
  // This probe measures allocation only; UI acceptance uses the actual renderer.
  if (controller)
    for (const object of controller.getSnapshot('document').objects) {
      if (object.kind === 'freehand') cache.getPresentation(object, 'final');
    }
  let prepared: ReturnType<typeof prepareLayeredObjectQuery>;
  return {
    run() {
      const cold = !prepared;
      const begin = performance.now();
      performance.mark('stages:start');
      if (!prepared)
        prepared = controller
          ? createControllerObjectQuery(controller, cache).step(() => 0, Infinity)!
          : prepareLayeredObjectQuery(document, cache);
      const preparedAt = performance.now();
      if (!prepared.ok) throw new Error(prepared.error.code);
      const phases: Record<string, number> = {};
      const objects: { id: string; ms: number }[] = [];
      const fallbacks: { id: string; ms: number; reason: string }[] = [];
      const query = createLayeredLassoQuery(prepared.value, path, {
        now: () => performance.now(),
        onPhase: (name, ms) => {
          phases[name] = ms;
        },
        onObject: (id, ms) => objects.push({ id, ms }),
        onFallback: (id, ms, reason) => fallbacks.push({ id, ms, reason }),
      });
      const setupAt = performance.now();
      const result = query.ok ? query.value.step(() => 0, Infinity)! : query;
      const end = performance.now();
      performance.mark('stages:end');
      if (!result.ok) throw new Error(result.error.code);
      return {
        cold,
        rendered,
        count,
        scenario,
        begin,
        end,
        prepareMs: preparedAt - begin,
        setupMs: setupAt - preparedAt,
        phases,
        exactMs: end - setupAt,
        totalMs: end - begin,
        candidateCount: query.ok ? query.value.candidateCount : 0,
        objects,
        fallbacks,
        selected: result.value.map((h) => h.objectId),
      };
    },
  };
}
