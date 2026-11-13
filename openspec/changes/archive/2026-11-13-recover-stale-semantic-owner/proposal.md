## Why

HAM-245 review found that a missing pointer terminal event leaves semantic ownership permanently occupied. Removing capture-loss cancellation fixed valid releases but requires a bounded recovery rule for the next genuine primary gesture.

## What Changes

- Cancel a stale single owner before accepting a new primary down of the same device type.
- Require explicit primary identity for pen/touch; retain palm suppression and touch-pair arbitration.
- Cover direct semantic dispatch and production layered arbitration, including cancellation acknowledgement.
- Keep capture loss and zero-buttons movement non-terminal. Preserve final-query/version guards.

## Capabilities

### Modified Capabilities

- `document-object-interaction`: specify bounded stale-owner recovery alongside capture routing semantics.

## Impact

Semantic Web adapter, normalized pointer metadata, layered arbitration, regression tests and specifications. No geometry/performance changes. PR #53 head f4a8b75 stays frozen; repair is reviewed on a separate branch.
