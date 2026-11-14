# HAM-247: current baseline and measurement blockers

2026-11-14. **Performance acceptance is blocked, not passed.** No product algorithm,
threshold, host integration or interaction behavior changed in this delivery.
The changes are a frozen-revision measurement runner, structural fallback probes,
and three regression tests. They establish what can be verified before another
single-point optimization is attempted.

## Baseline and contract

- Default branch checkout: `521aada3fb330ce632d22c1385ead6cab5b23770`.
- PR #52 is merged, checks passed; `8e89871` is an ancestor of this checkout.
- PR #53 is also merged, checks passed; merge `892f461` is an ancestor. Its later
  query optimizations, geometry reuse, warmup and release-only behavior are present.
- Both sides of this baseline verification use the same SHA above (A/A). There is
  no optimization delta and no speedup claim.
- HAM-245's integration closeout explicitly replaced live selection with zero
  geometry work during dragging and one final query on release. HAM-247's current
  live-input <=100ms requirement conflicts with that accepted behavior. No live
  query was restored and no release result was substituted for missing live input.
- Keep the old seven prefixes as kernel fixtures. Product interaction acceptance
  needs alignment with the accepted release-only decision: the transferred 6x
  cold release-to-selection targets are 150ms/500 strokes and 400ms/1000 strokes,
  with zero >200ms main-thread tasks. None is declared satisfied here.
- The original OpenSpec change is already archived with these explicit deferrals.
  This delivery does not retroactively mark its 4.1/4.3/4.4 as measured passes.

## Commands and raw evidence

Run in the painting repository after `pnpm install --frozen-lockfile`:

```sh
node scripts/perf/lasso-prefix-paired.mjs artifacts/research/ham247/main-baseline-1 521aada 521aada
node scripts/perf/lasso-prefix-paired.mjs artifacts/research/ham247/main-functional 521aada 521aada --verify-only
node scripts/perf/lasso-fallback-geometry.mjs artifacts/research/ham247/main-functional artifacts/research/ham247/fallback-geometry
pnpm exec jest --runInBand packages/painting/src/__tests__/core/layered-lasso-compatibility.test.ts packages/painting/src/__tests__/core/layered-lasso-query.test.ts packages/painting/src/__tests__/core/layered-lasso-scheduling.test.ts
node --test scripts/perf/lasso-host-gate.test.mjs scripts/perf/lasso-query-timing.test.mjs
pnpm --filter @hamster-note/painting typecheck
```

Use a fresh output directory for each invocation. For a later isolated product
change, replace the two SHAs with its parent and the candidate commit. The runner
loads all bundled painting/fixture sources from those git objects, rejects lockfile
drift, saves bundles/maps/hashes, alternates adjacent A/B order, and retains invalid
attempts. Normal mode keeps HAM-245's **2 warmup + 5 formal + 1 diagnostic** rounds;
p95 is nearest rank (the maximum of five). Diagnostic oracle/operation runs never
enter that percentile. Any rejected side invalidates the whole round. Three failed
preflights stop with exit code 2; the algorithm is not marked failed by that exit.

`--verify-only` is a separate correctness mode, with one diagnostic round and an
oracle/operation pass. It records host load, sets all p95/fallback-share verdicts
to null, and cannot satisfy any latency target. The first verification artifact's
`method` text still contains the normal-mode description; `verificationOnly: true`,
the nine r7 attempts, and null verdicts record what actually ran. The current runner
now writes distinct mode descriptions and saves its own source/hash as well.

The issue attachment contains the full commands/logs, all per-prefix raw JSON,
frozen bundles/maps, fallback geometry, and integrity results. The failed initial
test and exploratory CPU profile are retained separately; their timings are not
acceptance data. A comment/source-level suspicion that bounds were being repeatedly
scanned was rejected: `multiBoundsCache` already caches them. Instrumented counts
confirm this (local/1000/p600: 20,233 point tests, only 600 uncached bounds vertices).

## Performance gate result

The existing HAM-245 gate requires load <= half the available CPUs and idle CPU

> =50%. This host exposes six CPUs, so the load limit is 3.

| Preflight UTC | Load before / after | Idle CPU | Result   |
| ------------- | ------------------: | -------: | -------- |
| 09:20:00      |         4.16 / 4.16 |   38.64% | rejected |
| 09:20:31      |         5.28 / 5.28 |   62.66% | rejected |
| 09:21:01      |         4.04 / 3.87 |   63.07% | rejected |

Exit code 2, **zero accepted performance pairs**, no formal browser matrix launched.
Later correctness work saw load around 18; it is not a substitute performance run.
All 63 per-prefix p95 entries remain **unmeasured**, listed in `prefixes.md`. No
threshold or gate was relaxed. There is also no iPad-side Timeline: this Linux run
does not have the required unlocked, connected iPad/Mac measurement setup.

## Correctness and fallback evidence

Nine cells: local 0/100/500/1000, dense 100/500/1000, mixed 500/1000. Each uses
prefixes 3/30/150/300/450/599/600. Mixed fixtures add 50 text/shape/image objects to
the stroke count (the mixed/1000 document therefore has 1050 objects).

All **63 A/A comparisons**, **126 ordered oracle checks**, and **63 operation-count
comparisons** passed. Both plain bundles' 13 bundled product/fixture sources were
independently matched to git and all four bundle hashes verified. These are
correctness checks only.

The diagnostic run retains eight fallback events across seven cells/prefixes,
involving four distinct freehand objects. All use margin 0; all reference results
are false. Both directed line/box separation proofs fail on the recorded edge pairs.
These are small self-intersecting outlines, not vertex-budget overflow or failed
normalization. Each normalizes successfully. Removing the fallback without a stronger
proof would repeat the floating-boundary/complex-component compatibility risk.

| Object / contexts                          | Vertices | Nonadjacent edge contacts | Canonical components / vertices | Nearest distance | Ambiguous object / lasso edges |
| ------------------------------------------ | -------: | ------------------------: | ------------------------------: | ---------------: | ------------------------------ |
| dense/1000/p150 ink-513                    |       69 |                        22 |                          2 / 86 |         0.173359 | 21/149, 40/149                 |
| mixed/1000/p150 ink-943                    |       68 |                        22 |                          2 / 85 |         0.138289 | 45/149, 46/149, 47/149         |
| mixed/1000/p300,p450,p599,p600 ink-762     |       70 |                        20 |                          2 / 81 |         1.361420 | 12/249                         |
| mixed/500,p450 and mixed/1000,p450 ink-436 |       70 |                        21 |                          1 / 82 |         0.549341 | 51/449                         |

The raw B-side diagnostic readings below include host contention. Their ratios
are observations, **not valid 20% acceptance verdicts**.

| Scene / prefix  | Object  | Fallback ms | Query ms | Observed share |
| --------------- | ------- | ----------: | -------: | -------------: |
| dense/1000/p150 | ink-513 |       105.0 |    250.1 |         41.98% |
| mixed/1000/p150 | ink-943 |        60.4 |    153.1 |         39.45% |
| mixed/1000/p300 | ink-762 |        34.7 |     49.4 |         70.24% |
| mixed/1000/p450 | ink-436 |        79.0 |    264.3 |         29.89% |
| mixed/1000/p450 | ink-762 |        61.2 |    264.3 |         23.16% |
| mixed/1000/p599 | ink-762 |        63.0 |     89.3 |         70.55% |
| mixed/1000/p600 | ink-762 |        68.7 |    114.0 |         60.26% |
| mixed/500/p450  | ink-436 |        82.0 |    203.8 |         40.24% |

Geometry evidence identifies the retained work; it does not prove that
the target is impossible or that WebBase must change. Painting remains the only
repository in scope.

## Regression verification

- Relevant query/compatibility/scheduling Jest: **3 suites, 47 tests passed**.
- New full index9180 fallback diagnostic assertion: passed.
- New independent prefix cursors with reverse completion: passed, including the
  exact trajectory's invalid collinear first prefix.
- New tool-level scenario: an old query is already partially evaluated; new batched
  input and an unpainted final batch arrive while old callbacks are replayed; only
  the new full-path selection is published, ordered IDs match the oracle.
- Host gate/input timing helpers: **9 passed**; missing live completions stay in the
  denominator and cannot borrow a final result.
- Painting typecheck and changed-file ESLint/Prettier: passed.
- First new prefix test incorrectly assumed index9180's first three points were
  noncollinear; fixed to assert the same invalid-input result as the oracle. Its
  original failed log is retained. An initial conditional-expect lint error is
  likewise fixed, with the original log retained.

No product runtime code changed, so no new full UI/build/device pass is claimed.
The next performance change must wait for a quiet measurement environment and
retain paired, single-point attribution. The live-selection acceptance conflict
and the actual device requirement remain open.
