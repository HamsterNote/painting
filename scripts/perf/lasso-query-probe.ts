import {
  lassoFixture,
  lassoTrajectory,
} from '../../apps/playground/src/layered-editor/lassoPerformanceFixture';
import {
  prepareLayeredObjectQuery,
  createLayeredLassoQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';
import { createEditor } from '../../packages/painting/src/layered/createEditor';

// Separate diagnostic harness: no scheduling or query algorithm is changed.
// It measures the current atomic units; its timings are not UI SLA evidence.
export function createProbeCell(count: number, scenario: string) {
  const document = lassoFixture(count, scenario);
  const cache = new FreehandGeometryCache();
  const begin = performance.now();
  const prepared = prepareLayeredObjectQuery(document, cache);
  const prepareMs = performance.now() - begin;
  if (!prepared.ok) throw new Error(prepared.error.code);
  const controller = createEditor(document, { inputMode: 'pen' });
  const positions = new Map(document.objects.map((object, index) => [object.objectId, index]));
  const points = lassoTrajectory(scenario);
  return {
    prepareMs,
    run(prefix: number, round: number) {
      const path = points.slice(0, prefix);
      const tag = `${scenario}-${count}-p${prefix}-r${round}`;
      performance.mark(`${tag}:setup-start`);
      const start = performance.now();
      const query = createLayeredLassoQuery(prepared.value, path);
      const setupEnd = performance.now();
      performance.mark(`${tag}:setup-end`);
      performance.measure(`${tag}:setup`, `${tag}:setup-start`, `${tag}:setup-end`);
      if (!query.ok) return { prefix, round, invalid: query.error.code, setupMs: setupEnd - start };
      const bounds = {
        minX: Math.min(...path.map((p) => p.x)),
        minY: Math.min(...path.map((p) => p.y)),
        maxX: Math.max(...path.map((p) => p.x)),
        maxY: Math.max(...path.map((p) => p.y)),
      };
      const candidates = prepared.value.entries.filter(
        (e) =>
          e.broadphase.minX - e.margin <= bounds.maxX &&
          e.broadphase.maxX + e.margin >= bounds.minX &&
          e.broadphase.minY - e.margin <= bounds.maxY &&
          e.broadphase.maxY + e.margin >= bounds.minY
      );
      if (candidates.length !== query.value.candidateCount)
        throw new Error('Probe candidate mapping mismatch');
      const geometry = candidates.map((e) => ({
        objectId: e.objectId,
        kind: e.kind,
        pieces: e.pieces.length,
        vertices: e.pieces.reduce(
          (n, p) =>
            n +
            p.polygons.reduce(
              (a, poly) => a + poly.outer.length + poly.holes.reduce((b, r) => b + r.length, 0),
              0
            ),
          0
        ),
      }));
      const atomic: { index: number; start: number; end: number; ms: number }[] = [];
      performance.mark(`${tag}:work-start`);
      const workStart = performance.now();
      let result;
      do {
        const index = query.value.processedCount;
        const t = performance.now();
        // Budget zero advances exactly one candidate, without a scheduler yield.
        result = query.value.step(() => 0, 0);
        const end = performance.now();
        atomic.push({ index, start: t, end, ms: end - t });
      } while (!result);
      const workEnd = performance.now();
      performance.mark(`${tag}:work-end`);
      performance.measure(`${tag}:work`, `${tag}:work-start`, `${tag}:work-end`);
      if (!result.ok) throw new Error(result.error.code);
      const workMs = atomic.reduce((sum, row) => sum + row.ms, 0);
      const ids = result.value.map((hit) => hit.objectId);
      const selectionStart = performance.now();
      const outcome = controller.setSelection(ids);
      const selectionEnd = performance.now();
      const selectionFirstCallMs = selectionEnd - selectionStart;
      if (!outcome.ok) throw new Error(outcome.error.code);
      const equalStart = performance.now();
      controller.setSelection(ids);
      const equalEnd = performance.now();
      const selectionEqualMs = equalEnd - equalStart;
      // A comparison-only membership validation using one document ID set. It
      // does not replace production setSelection or remove any validation.
      const membershipStart = performance.now();
      const existing = new Set(document.objects.map((o) => o.objectId));
      const membershipOK = ids.every((id) => existing.has(id));
      const membershipSetMs = performance.now() - membershipStart;
      if (!membershipOK) throw new Error('Missing probe object');
      let oracle;
      if (prefix === 600 && round === 7) {
        const oracleStart = performance.now();
        const expected = queryObjectLasso(prepared.value, path, 'intersects');
        oracle = {
          ms: performance.now() - oracleStart,
          orderedMatch:
            expected.ok &&
            JSON.stringify(expected.value.map((hit) => hit.objectId)) === JSON.stringify(ids),
        };
        if (!oracle.orderedMatch) throw new Error('Oracle mismatch');
      }
      performance.clearMarks();
      performance.clearMeasures();
      return {
        prefix,
        round,
        warmup: round < 2,
        diagnostic: round === 7,
        prepareMs,
        setupMs: setupEnd - start,
        workMs,
        workWallMs: workEnd - workStart,
        measuredQueryMs: setupEnd - start + workEnd - workStart,
        timestamps: {
          setupStart: start,
          setupEnd,
          workStart,
          workEnd,
          selectionStart,
          selectionEnd,
          equalStart,
          equalEnd,
        },
        candidateCount: query.value.candidateCount,
        referenceBoundaryPairUpperBound:
          geometry.reduce((sum, g) => sum + g.vertices, 0) * path.length,
        atomic,
        geometry,
        hits: ids.length,
        selectionFirstCallMs,
        selectionEqualMs,
        membershipSetMs,
        referenceMembershipVisits: ids.reduce((sum, id) => sum + positions.get(id)! + 1, 0),
        setMembershipVisits: document.objects.length + ids.length,
        oracle,
      };
    },
  };
}
