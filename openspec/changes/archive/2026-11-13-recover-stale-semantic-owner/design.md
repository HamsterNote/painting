## Context

Both semanticWebAdapter and production layeredInputArbiter retain ownership after capture loss. Production dispatch must also retire the stale arbitration contact, not just fix the leaf adapter.

## Decisions

A fresh valid down supersedes a single owner only when device types match and either both are mouse or both explicitly identify as primary pen/touch. Pointer Events allows at most one primary pointer per type; a secondary finger cannot satisfy this predicate. Store primary identity from down, not from subsequent movement. Missing metadata is unknown, not primary. The reviewer synthetic pen repro must supply isPrimary=true, as real primary PointerEvents do.

Reuse the cancellation ACK boundary: keep the old state until cancellation succeeds, retire its contact and ownership, then process the fresh down. A failed ACK does not route new input or complete the old trajectory. Other live contacts remain suppressed as before. Capture and buttons-zero are never terminal evidence.

Production DrawingSurface uses layeredInputArbiter + navigationWebAdapter, not viewportGestureController. Pen + touch keeps the pen tool; two paper touches keep existing cancel-then-pair navigation. Do not reset the entire arbiter or alter native pencil guards.

## Risks / Trade-offs

Unknown primary metadata cannot safely recover pen/touch; genuine browser events provide it. An active pair is not eligible for single-owner recovery. This bounded fix is not a timeout or universal lost-contact reconstruction mechanism. No geometry algorithms or HAM-247 performance gates change.
