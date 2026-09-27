export const CSS = `
:host { all: initial; }
.vx { --ink:#1C2B3A; --muted:#5B6775; --rule:#D9DEE4; --wash:#F3F5F7; --go:#1E7B4F; --go-wash:#E7F3EC; --wait:#A86A12; --wait-wash:#FBF3E4; --no:#8A94A0; --stop:#B3261E; --stop-wash:#FBEAE8;
  font: 14px/1.5 "Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif; color: var(--ink); background:#fff; box-sizing:border-box; }
.vx *, .vx *::before, .vx *::after { box-sizing: inherit; }
.vx-floating { position: fixed; top: 12px; right: 12px; bottom: 12px; width: min(420px, calc(100vw - 24px)); z-index: 2147483646;
  border: 1px solid var(--rule); border-radius: 6px; box-shadow: 0 8px 28px rgba(28,43,58,.18); overflow: auto; }
.vx-head { display:flex; align-items:center; justify-content:space-between; padding: 12px 16px; background: var(--wash); border-bottom:1px solid var(--rule); position: sticky; top: 0; z-index: 1; }
.vx-who strong { font-size: 18px; margin-right: 10px; }
.vx-who span { color: var(--muted); }
.vx-x { border:0; background:none; font-size: 24px; line-height:1; color: var(--muted); cursor:pointer; padding: 4px 8px; }
.vx-sources { list-style:none; margin:0; padding: 8px 16px; display:flex; flex-wrap:wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); border-bottom:1px solid var(--rule); }
.vx-sources li::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; background: var(--no); vertical-align: 1px; }
.vx-sources .s-ok::before, .vx-sources .s-nodata::before { background: var(--go); }
.vx-sources .s-not_queried::before { background: var(--wait); }
.vx-sources .s-error::before, .vx-sources .s-unknown_shape::before { background: var(--stop); }
.vx-list { list-style:none; margin:0; padding:0; }
.vx-grp { margin:14px 16px 2px; font-size:13px; font-weight:700; color:var(--muted); letter-spacing:.02em; border-bottom:1px solid var(--rule); padding-bottom:4px; }
.vx-grp-go { color:var(--go); } .vx-grp-check { color:var(--wait); }
.vx-grp-n { display:inline-block; min-width:1.6em; margin-left:4px; padding:0 6px; border-radius:9px; background:var(--wash); color:var(--ink); font-weight:600; text-align:center; }
.vx-v { display:grid; grid-template-columns: 88px 1fr; border-bottom: 1px solid var(--rule); }
.vx-verdict { padding: 14px 6px 14px 12px; font-weight: 700; font-size: 16px; line-height: 1.25; border-left: 6px solid var(--no); color: var(--no); }
.t-go .vx-verdict { border-color: var(--go); color: var(--go); background: var(--go-wash); }
.t-wait .vx-verdict { border-color: var(--wait); color: var(--wait); background: var(--wait-wash); }
.t-stop .vx-verdict { border-color: var(--stop); color: var(--stop); background: var(--stop-wash); }
.t-done .vx-verdict { border-color: var(--ink); color: var(--ink); }
.vx-body { padding: 12px 16px 12px 12px; min-width: 0; }
.vx-name { font-weight: 700; display:flex; flex-wrap:wrap; align-items:center; gap: 6px; }
.vx-badge { font-weight: 500; font-size: 12px; padding: 0 6px; border: 1px solid currentColor; border-radius: 3px; color: var(--muted); }
.vx-line { margin: 4px 0 0; }
.vx-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.vx-warn { color: var(--wait); }
.vx-evid { display:flex; flex-wrap: wrap; gap: 4px 8px; justify-content: space-between; align-items: baseline; margin-top: 8px; padding: 6px 8px; background: var(--wash); font-size: 13px; }
.vx-link { border:0; background:none; color: var(--stop); cursor:pointer; font: inherit; white-space: nowrap; text-decoration: underline; padding: 0; }
.vx-ask { margin: 10px 0 0; padding: 8px 10px; border: 1px dashed var(--wait); border-radius: 4px; }
.vx-ask legend { font-size: 12px; color: var(--wait); padding: 0 4px; }
.vx-check, .vx-remind { display:flex; gap: 8px; align-items: flex-start; padding: 4px 0; cursor: pointer; }
.vx-check input, .vx-remind input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--go); flex: none; }
.vx-check small { display:block; color: var(--muted); font-size: 12px; }
.vx-remind { font-size: 13px; color: var(--muted); margin-top: 6px; }
.vx-why { margin-top: 8px; font-size: 13px; }
.vx-why summary { cursor: pointer; color: var(--muted); }
.vx-why ul { list-style:none; margin: 6px 0 0; padding: 0; }
.vx-why li { padding: 3px 0; border-top: 1px dotted var(--rule); }
.vx-why li b { display:inline-block; min-width: 3.5em; }
.vx-why .g-y b { color: var(--go); } .vx-why .g-n b { color: var(--no); } .vx-why .g-u b { color: var(--wait); }
.vx-why small { display:block; color: var(--muted); }
.vx-actions { display:flex; flex-wrap: wrap; gap: 8px; padding: 14px 16px; }
.vx-btn { font: inherit; padding: 8px 12px; border: 1px solid var(--rule); background: #fff; border-radius: 4px; cursor: pointer; color: var(--ink); }
.vx-primary { background: var(--ink); color: #fff; border-color: var(--ink); }
.vx-btn:focus-visible, .vx-link:focus-visible, .vx-x:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #2B6CB0; outline-offset: 2px; }
.vx-foot { padding: 8px 16px 14px; font-size: 12px; color: var(--muted); }
.vx-notice { margin: 10px 16px 0; padding: 8px 10px; border-radius: 4px; font-size: 13px; background: var(--wash); }
.vx-notice.vx-stop { background: var(--stop-wash); color: var(--stop); }
.vx-notice.vx-wait { background: var(--wait-wash); color: var(--wait); }
.vx-loading { padding: 24px 16px; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { .vx-floating { animation: vxin .16s ease-out; } @keyframes vxin { from { transform: translateX(12px); opacity: 0; } } }
`;
