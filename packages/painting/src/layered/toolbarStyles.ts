// Scoped to this component, including its portal. No consumer theme overrides.
export const toolbarStyles = `
.hn-painting-toolbar { box-sizing:border-box; color:#526174; font:14px/20px system-ui,sans-serif; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.hn-painting-toolbar * { box-sizing:border-box; }
.hn-painting-toolbar button, .hn-painting-collapse { appearance:none; border:0; background:transparent; color:inherit; font:inherit; font-weight:600; border-radius:12px; min-width:44px; height:44px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0 12px; cursor:pointer; white-space:nowrap; }
.hn-painting-toolbar button:hover:enabled { background:#E8EBF1; }
.hn-painting-toolbar button:active:enabled { background:#DEE2EA; }
.hn-painting-toolbar button[aria-pressed="true"], .hn-painting-toolbar button[aria-checked="true"] { background:#7163D9; color:#FFF; }
.hn-painting-toolbar button[aria-pressed="true"]:hover, .hn-painting-toolbar button[aria-checked="true"]:hover { background:#6557C8; }
.hn-painting-toolbar button:disabled { color:#9AA5B5; cursor:default; }
.hn-painting-toolbar :is(button,input,select):focus-visible { outline:2px solid #7163D9; outline-offset:2px; }
.hn-painting-toolbar svg { width:18px; height:18px; flex-shrink:0; }
.hn-painting-toolbar .hn-painting-zoom { width:72px; min-width:72px; max-width:72px; flex:0 0 72px; font-variant-numeric:tabular-nums; }
.hn-painting-width label { display:flex; align-items:center; gap:8px; white-space:nowrap; }
.hn-painting-width input[type="number"] { box-sizing:border-box; width:64px; min-width:64px; height:44px; border:1px solid #D9DEE5; border-radius:8px; background:#FFF; color:inherit; font:inherit; padding:0 6px; }
.hn-painting-width input:disabled { color:#9AA5B5; background:transparent; }
.hn-painting-group { display:flex; align-items:center; flex:0 0 auto; gap:4px; }
.hn-painting-divider { flex:0 0 1px; width:1px; height:24px; background:#D9DEE5; margin:0 8px; }
.hn-painting-palette { gap:0; }
.hn-painting-toolbar .hn-painting-color { width:30.6667px; min-width:30.6667px; padding:0; background:transparent !important; }
.hn-painting-color span { display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; color:white; text-shadow:0 1px 2px #000; }
.hn-painting-color[aria-pressed="true"] span { outline:2px solid var(--swatch-color); outline-offset:2px; }
.hn-painting-color:disabled span { opacity:0.45; }
.hn-painting-custom-color { position:relative; flex:0 0 30.6667px; height:44px; display:flex; align-items:center; justify-content:center; }
.hn-painting-custom-color span { width:24px; height:24px; border-radius:50%; background:conic-gradient(#ef4444,#facc15,#22c55e,#06b6d4,#6366f1,#ec4899,#ef4444); outline:none; }
.hn-painting-custom-color[data-active="true"] span { outline:2px solid var(--current-color); outline-offset:2px; }
.hn-painting-custom-color input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.hn-painting-custom-color:has(input:focus-visible) { outline:2px solid #7163D9; outline-offset:0; border-radius:8px; }
.hn-painting-custom-color:has(input:disabled) { opacity:0.45; }
.hn-painting-custom-color input:disabled { cursor:default; }
.hn-painting-collapse { pointer-events:auto; width:44px; padding:0; border-radius:50%; border:1px solid #E2E5EA; background:#F5F6F8; color:#526174; box-shadow:0 3px 12px rgba(15,23,42,.12); }
.hn-painting-collapse svg { width:18px; height:18px; }
.hn-painting-collapse:focus-visible { outline:2px solid #7163D9; outline-offset:2px; }
.hn-painting-collapse:hover { background:#E8EBF1; }
.hn-painting-panel { padding:8px; border:1px solid #E2E5EA; border-radius:16px; background:#FFF; box-shadow:0 6px 24px rgba(15,23,42,.12); overscroll-behavior:contain; }
.hn-painting-panel button { display:flex; width:100%; justify-content:flex-start; }
.hn-painting-panel label { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:44px; padding:4px; }
.hn-painting-panel input:not([type="checkbox"]), .hn-painting-panel select { min-height:44px; min-width:44px; max-width:180px; font:inherit; color:inherit; }
.hn-painting-panel input[type="checkbox"] { width:20px; height:20px; }
.hn-painting-panel input[type="color"] { width:56px; }
.hn-painting-panel .hn-painting-custom-color { padding:0; min-height:44px; gap:0; }
.hn-painting-panel .hn-painting-custom-color input { width:100%; max-width:none; }
.hn-painting-choices { margin:0; padding:4px; border:0; min-width:0; }
.hn-painting-choices legend { padding:0; font-weight:600; }
.hn-painting-choices label { justify-content:flex-start; }
.hn-painting-choices input[type="radio"] { min-width:20px; min-height:20px; width:20px; height:20px; margin:0; }

.hn-painting-toolbar .hn-painting-stroke-preview { width:40px; height:24px; overflow:hidden; }
.hn-painting-panel .hn-painting-color { width:30.6667px; min-width:30.6667px; flex:0 0 30.6667px; justify-content:center; }
.hn-painting-palette { padding:4px; }
.hn-painting-panel .hn-painting-stroke-row { display:flex; align-items:center; justify-content:flex-start; gap:12px; min-width:0; padding:4px; }
.hn-painting-stroke-label { display:flex; align-items:center; flex:0 0 auto; min-height:44px; white-space:nowrap; }
.hn-painting-width-row { display:flex; align-items:center; flex:1 1 auto; gap:12px; min-width:0; }
.hn-painting-width-row input[type="number"] { flex:0 0 64px; }
.hn-painting-color-controls { display:flex; align-items:center; flex:1 1 auto; flex-wrap:wrap; min-width:0; }
.hn-painting-color-controls .hn-painting-palette { flex:0 0 auto; }
.hn-painting-panel .hn-painting-hex-color { flex:1 1 88px; width:100%; min-width:88px; padding:0 8px; border:1px solid #D9DEE5; border-radius:8px; background:#FFF; }
.hn-painting-stroke-choice > label { justify-content:flex-start; }
.hn-painting-stroke-choice > label > select { margin-left:auto; }
.hn-painting-toolbar input.hn-painting-range { appearance:none; -webkit-appearance:none; height:44px; min-height:44px; min-width:0; max-width:none; width:100%; flex:1 1 0; margin:0; padding:0; border:0; border-radius:8px; background:transparent; cursor:pointer; }
.hn-painting-range::-webkit-slider-runnable-track { height:6px; border-radius:3px; background:linear-gradient(to right,#7163D9 0 var(--range-fill),#E2E5EA var(--range-fill) 100%); }
.hn-painting-range::-moz-range-track { height:6px; border-radius:3px; background:linear-gradient(to right,#7163D9 0 var(--range-fill),#E2E5EA var(--range-fill) 100%); }
.hn-painting-range::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; box-sizing:border-box; width:18px; height:18px; margin-top:-6px; border:2px solid #7163D9; border-radius:50%; background:#FFF; }
.hn-painting-range::-moz-range-thumb { box-sizing:border-box; width:18px; height:18px; border:2px solid #7163D9; border-radius:50%; background:#FFF; }
.hn-painting-range:hover::-webkit-slider-thumb { box-shadow:0 0 0 4px #7163D922; }
.hn-painting-range:hover::-moz-range-thumb { box-shadow:0 0 0 4px #7163D922; }
.hn-painting-range:active::-webkit-slider-thumb { box-shadow:0 0 0 6px #7163D933; }
.hn-painting-range:active::-moz-range-thumb { box-shadow:0 0 0 6px #7163D933; }
.hn-painting-range:disabled { opacity:.45; cursor:default; }
`;
