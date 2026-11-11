export const paneToolbarStyles = `
.hn-pane-toolbar { box-sizing:border-box; color:#526174; font:14px/20px system-ui,sans-serif; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
.hn-pane-toolbar * { box-sizing:border-box; }
.hn-pane-toolbar button { appearance:none; border:0; background:transparent; color:inherit; font:inherit; font-weight:600; border-radius:12px; min-width:44px; min-height:44px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0 12px; cursor:pointer; white-space:nowrap; }
.hn-pane-toolbar button:hover:enabled { background:#E8EBF1; }
.hn-pane-toolbar button:active:enabled { background:#DEE2EA; }
.hn-pane-toolbar button[aria-checked="true"] { background:#7163D9; color:#FFF; }
.hn-pane-toolbar button:disabled { color:#9AA5B5; cursor:default; }
.hn-pane-toolbar :is(button,input,select):focus-visible { outline:2px solid #7163D9; outline-offset:2px; }
.hn-pane-toolbar svg { width:18px; height:18px; flex-shrink:0; }
.hn-pane-panel { padding:8px; border:1px solid #E2E5EA; border-radius:16px; background:#FFF; box-shadow:0 6px 24px rgba(15,23,42,.12); overscroll-behavior:contain; }
.hn-pane-panel button { display:flex; width:100%; justify-content:flex-start; }
.hn-toolbar-file-row { display:flex; align-items:stretch; gap:4px; }
.hn-toolbar-file-row > button:first-child { flex:1; min-width:0; white-space:normal; text-align:left; overflow-wrap:anywhere; }
.hn-toolbar-file-row > button:last-child:not(:first-child) { width:44px; flex:0 0 44px; padding:0; justify-content:center; }
.hn-toolbar-file-row small { display:block; font-size:12px; font-weight:400; }
`;
