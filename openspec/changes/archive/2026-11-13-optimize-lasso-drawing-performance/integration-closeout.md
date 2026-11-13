# HAM-245 integration closeout

2026-11-13：修勾已在原 Mac / Edge / 鼠标上回复“这次好了”（issue comment `01a1d3d1-7985-72ce-b37d-df3300d6be71`）；小助手授权整合 main、同步并归档规格、PR #53 转 ready，审核后另行决定合入。本轮不合 PR。

## Conflict decisions

Integration base: PR head `d32f768`; incoming main `73c41da` includes HAM-249 `d7e0802`.

- `layeredSelectionGeometry.ts` imports: retain main's affine mapping/type imports. PR's cache/bounds imports belong to the superseded axis-aligned derivation and are unused by the session frame model.
- `layeredSelectionGeometry.ts` bounds: retain main's frozen session frame, accumulated transform and screen-size handles. Do not reinstate PR's per-render document/preview AABB traversal: it loses rotation and duplicates the frame model. The resolved file equals main, as a result of these two hunk decisions.
- `layeredToolSession.ts` imports: combine main's `LayeredSelectionFrame` / `applyAffine` with PR's controller-owned `layeredGeometryCache`. Remove the obsolete private cache and bounds imports. Keep main's angle unwrapping, frame snapshot, preview and commit adoption, selection-session invalidation.
- `layeredToolSession.ts` destroy: retain main's `resetSelectionFrame`; retain PR's pause/cancel/unsubscribe lifecycle. Do not restore private `cache.clear()` because the PR now shares this cache with the display layer; the weak controller owner controls its lifetime.
- Automatically merged `semanticWebAdapter.ts`: preserve removal of lostpointercapture cancellation, window owner up/cancel handling, own-commit guard from main, genuine cancellation/lifecycle/version protection.

## Integration test assumptions

HAM-249's old capture-as-cancel case now asserts that loss preserves the 60° preview and unchanged document, followed by genuine pointercancel restoring the committed 30° frame. All other cancellation cases remain. The UI lasso capture case explicitly verifies retained trajectory, full ordered final IDs, unchanged document/history and cleared final preview after up. The legacy oracle is unchanged.

HAM-241 eraser tests count all fake timers. PR idle preparation adds an independent timer, so these tests explicitly disable that existing test hook while preserving their strict zero-timer assertions. Lasso scheduler tests continue to cover warmup separately. No product algorithm or threshold is changed during integration.

The full production suite also exposed the existing LAN test's hardcoded dev port 5266. It now derives the port from Playwright's actual baseURL; the production-only runner binds its temporary static server to 0.0.0.0. Root-route rendering and successful LAN HTTP response assertions remain unchanged. This fixes the harness target, not the product or its acceptance threshold.

## Acceptance disposition (not performance completion)

Human acceptance closes drag feel and P0 missing-selection behavior. It does not establish iPad performance, WebKit coverage or the original numerical matrix. The lead explicitly permits archival with these residuals tracked under HAM-247. Pending tasks are recorded as transferred rather than silently checked as successful measurements.

- Old 4.1 WebKit/device coverage, 4.3 full valid baseline/performance matrix and 4.4 iPad Safari/WKWebView/Pencil measurements remain unverified; original uncovered cells remain uncovered, not failures or passes.
- 6× CPU cold local 500-stroke release→frame approximately **523ms**, above **150ms**; local 1000-stroke cold approximately 559ms, above 400ms in that earlier run. These are historical reported readings, not new integration performance measurements. Later high-load data was withdrawn as contaminated. No end-to-end speedup claim is made here.
- 6.4, 7.3 numerical acceptance, 7.4 further object candidate reduction and 8.2 clean CPU-paired matrix are transferred to HAM-247, not completed by this integration.
- The old real-time-selection requirement was deliberately replaced by release-only selection. Its old latency target is not marked passed. Gap/silence are supplemental; historical maximum silence 111–182ms remains disclosed.
- Follow-up coverage gaps remain there: overlapping prefix queries and the explicit index9180 fallback-diagnostic assertion. Do not start that work during this integration.

Main specs retain the numerical gates as future acceptance requirements; synchronizing and archiving records the accepted implementation and explicit deferrals, not numerical compliance. Validation commands, raw logs and actual results are delivered with this integration's evidence index.
