// Panel UI — rewritten with clean AMOLED design and reliable JS.
// Uses string concatenation inside the client script to avoid
// template-literal interpolation conflicts with the server.

function iconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><radialGradient id="g" cx="50%" cy="40%" r="60%">
    <stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#0369a1"/>
  </radialGradient></defs>
  <rect width="512" height="512" rx="112" fill="#020617"/>
  <rect x="48" y="48" width="416" height="416" rx="88" fill="url(#g)" opacity="0.18"/>
  <g transform="translate(128,96) scale(16)" fill="none" stroke="#67e8f9" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M4 22 L14 2 L14 12 L22 12 L10 30 L10 20 L4 20 Z"/></g>
</svg>`;
}

export function loginHtml(): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>KALFETELA — ورود</title>
<link rel="icon" href="/icon.svg"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body{font-family:Vazirmatn,system-ui;background:#000;color:#e5e7eb;min-height:100vh}
  .bg-grid{background:radial-gradient(ellipse at top right,rgba(34,211,238,.15),transparent 60%),radial-gradient(ellipse at bottom left,rgba(139,92,246,.12),transparent 60%),#000}
  .glass{background:rgba(10,12,20,.72);backdrop-filter:blur(18px);border:1px solid rgba(148,163,184,.1)}
  .input{background:#0a0c14;border:1px solid rgba(148,163,184,.18);border-radius:12px;padding:12px 14px;color:#e5e7eb;width:1px;min-width:100%;transition:.15s}
  .input:focus{outline:none;border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.15)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;padding:10px 16px;font-weight:600;transition:.15s;cursor:pointer;border:none}
  .btn-primary{background:linear-gradient(135deg,#22d3ee,#0ea5e9);color:#00131c}
  .btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px)}
  .logo-pulse{animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{filter:drop-shadow(0 0 12px rgba(34,211,238,.4))}50%{filter:drop-shadow(0 0 24px rgba(34,211,238,.7))}}
  .float{animation:float 6s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
</style></head>
<body class="bg-grid grid place-items-center p-4">
<div class="w-full max-w-md">
  <div class="text-center mb-8 float">
    <div class="inline-block logo-pulse">
      <img src="/icon.svg" class="w-20 h-20 mx-auto" alt="KALFETELA"/>
    </div>
    <h1 class="text-3xl font-black mt-4 bg-gradient-to-l from-cyan-300 via-indigo-400 to-violet-400 bg-clip-text text-transparent">KALFETELA</h1>
    <p class="text-slate-400 text-sm mt-1">Cloudflare Worker · D1 · Durable Objects</p>
  </div>
  <div class="glass rounded-3xl p-8 shadow-2xl shadow-cyan-500/5">
    <h2 class="text-lg font-bold mb-1">ورود به پنل</h2>
    <p class="text-xs text-slate-400 mb-6">رمز عبور ادمین را وارد کنید</p>
    <form id="f" class="space-y-4">
      <div>
        <label class="text-xs text-slate-400 mb-1.5 block">نام کاربری</label>
        <input id="u" class="input" autocomplete="username" placeholder="admin" required>
      </div>
      <div>
        <label class="text-xs text-slate-400 mb-1.5 block">رمز عبور</label>
        <input id="p" type="password" class="input" autocomplete="current-password" placeholder="••••••••" required>
      </div>
      <button class="btn btn-primary w-full py-3 text-base">ورود به پنل →</button>
      <p id="err" class="text-rose-400 text-sm text-center min-h-[1.25rem]"></p>
    </form>
  </div>
  <p class="text-center text-slate-600 text-xs mt-6">KALFETELA v1.0 · MIT licensed</p>
</div>
<script>
f.addEventListener('submit', async function(e){
  e.preventDefault();
  err.textContent = '';
  var btn = f.querySelector('button');
  btn.disabled = true; btn.textContent = 'در حال ورود...';
  try {
    var r = await fetch('/api/auth/login', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:u.value, password:p.value})});
    if (r.ok) location.href = '/panel';
    else { var j = await r.json().catch(function(){return {}}); err.textContent = j.error || 'ورود ناموفق'; }
  } catch(ex) { err.textContent = 'خطای شبکه'; }
  btn.disabled = false; btn.textContent = 'ورود به پنل →';
});
</script></body></html>`;
}

export function panelHtml(version: string, bootstrap = false): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>KALFETELA</title>
<link rel="icon" href="/icon.svg"/>
<link rel="manifest" href="/manifest.json"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
<style>
  :root {
    --bg: #000000;
    --panel: #0a0c14;
    --panel-2: #0f1320;
    --border: rgba(148,163,184,.12);
    --border-strong: rgba(148,163,184,.22);
    --text: #e5e7eb;
    --muted: #64748b;
    --cyan: #22d3ee;
    --sky: #0ea5e9;
    --emerald: #10b981;
    --rose: #f43f5e;
    --amber: #f59e0b;
    --violet: #8b5cf6;
  }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; font-family:Vazirmatn,system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  body { background:
    radial-gradient(ellipse 80% 50% at 100% -10%, rgba(34,211,238,.10), transparent 60%),
    radial-gradient(ellipse 60% 50% at 0% 100%, rgba(139,92,246,.08), transparent 60%),
    #000;
  }
  .glass { background:rgba(10,12,20,.72); backdrop-filter:blur(20px); border:1px solid var(--border); }
  .app-topbar { position:sticky; top:0; z-index:40; background:rgba(5,7,14,.82); backdrop-filter:blur(18px); border-bottom:1px solid var(--border); }
  .app-topbar .inner { max-width:1100px; margin:0 auto; padding:12px 16px; display:flex; align-items:center; gap:12px; }
  .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:inherit; flex-shrink:0; }
  .brand img { width:34px; height:34px; }
  .brand b { font-size:15px; letter-spacing:.5px; background:linear-gradient(135deg,#67e8f9,#0ea5e9); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .brand small { display:block; font-size:9.5px; color:var(--muted); font-family:ui-monospace,monospace; margin-top:-2px; }
  .topnav { display:flex; gap:4px; margin:0 8px; flex:1; min-width:0; overflow-x:auto; scrollbar-width:none; }
  .topnav::-webkit-scrollbar { display:none; }
  .nav-item { display:inline-flex; align-items:center; gap:7px; padding:8px 12px; border-radius:10px; color:#94a3b8; cursor:pointer; transition:.15s; font-size:13px; font-weight:600; white-space:nowrap; flex-shrink:0; min-width:0; }
  /* On narrower desktop widths, show only icons in the top nav so the
     settings tab never disappears under the action buttons. */
  @media (max-width: 1100px) {
    .topnav .nav-item { padding:8px 10px; gap:0; font-size:0; }
    .topnav .nav-item svg { width:18px; height:18px; }
    .topnav .nav-item.active { font-size:12px; gap:6px; }
  }
  .nav-item svg { width:16px; height:16px; }
  .nav-item:hover { background:rgba(34,211,238,.06); color:#e5e7eb; }
  .nav-item.active { background:linear-gradient(135deg,rgba(34,211,238,.18),rgba(14,165,233,.08)); color:#67e8f9; box-shadow:inset 0 0 0 1px rgba(34,211,238,.25); }
  .top-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .me-chip { display:flex; align-items:center; gap:8px; background:rgba(148,163,184,.06); border:1px solid var(--border); border-radius:999px; padding:4px 10px 4px 4px; }
  .me-chip .avatar { width:28px; height:28px; border-radius:999px; display:grid; place-items:center; font-weight:700; font-size:12px; color:#00131c; }
  .me-chip .name { font-size:12px; font-weight:600; max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* mobile bottom nav */
  .bottomnav { display:none; }
  .mobile-toolbar { display:none; }
  @media (max-width:768px) {
    .topnav { display:none; }
    .me-chip .name { display:none; }
    .search-top { display:none !important; }
    .mobile-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:14px; }
    .mobile-toolbar .search-box { flex:1; min-width:0; }
    .mobile-toolbar .search-box input { width:100%; padding:10px 14px 10px 36px; font-size:13px; }
    .app-topbar .inner { padding:10px 12px; gap:8px; }
    .brand b { font-size:14px; }
    .brand small { font-size:8.5px; }
    .brand img { width:30px; height:30px; }
    .bottomnav { position:fixed; left:8px; right:8px; bottom:8px; z-index:45; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:2px; padding:6px; background:rgba(8,10,18,.94); backdrop-filter:blur(18px); border:1px solid var(--border-strong); border-radius:18px; box-shadow:0 10px 30px -10px rgba(0,0,0,.7); }
    .bottomnav .nav-item { flex-direction:column; gap:3px; padding:7px 2px; font-size:10px; border-radius:12px; justify-content:center; min-width:0; overflow:hidden; }
    .bottomnav .nav-item span, .bottomnav .nav-item { white-space:nowrap; }
    .bottomnav .nav-item svg { width:19px; height:19px; flex-shrink:0; }
    main.app-main { padding:14px 12px 96px !important; }
    .users-table-desktop { display:none !important; }
    .users-grid-mobile { display:grid !important; grid-template-columns:1fr; gap:10px; }
    .user-card { background:linear-gradient(135deg,var(--panel),var(--panel-2)); border:1px solid var(--border); border-radius:14px; padding:14px; }
    .user-card .row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .user-card .name { font-weight:700; font-size:14px; display:flex; align-items:center; gap:8px; min-width:0; }
    .user-card .uuid { font-size:10px; color:var(--muted); font-family:ui-monospace,monospace; }
    .user-card .meta { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; font-size:11px; }
    .user-card .meta > div { background:rgba(148,163,184,.05); border-radius:8px; padding:7px 9px; }
    .user-card .meta .lbl { display:block; color:var(--muted); font-size:9.5px; margin-bottom:2px; }
    .user-card .actions { display:flex; gap:6px; margin-top:10px; }
    .user-card .actions .btn { flex:1; padding:8px 6px; font-size:11px; }
    .user-card .progress { flex:1; min-width:0; }
  }
  .users-grid-mobile { display:none; }
  .stat-card { position:relative; overflow:hidden; border-radius:18px; padding:18px; border:1px solid var(--border); background:linear-gradient(135deg,var(--panel),var(--panel-2)); transition:.2s; }
  .stat-card:hover { transform:translateY(-2px); border-color:var(--border-strong); }
  .stat-card .ic { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; }
  .stat-card .val { font-size:26px; font-weight:800; margin-top:10px; letter-spacing:-.5px; }
  .stat-card .lbl { font-size:12px; color:var(--muted); margin-top:2px; }
  .stat-card::after { content:''; position:absolute; inset:-40% -40% auto auto; width:140px; height:140px; border-radius:50%; opacity:.25; filter:blur(40px); }
  .stat-card.cyan::after { background:#22d3ee; }
  .stat-card.emerald::after { background:#10b981; }
  .stat-card.violet::after { background:#8b5cf6; }
  .stat-card.amber::after { background:#f59e0b; }

  .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 14px; border-radius:11px; font-weight:600; font-size:13px; cursor:pointer; border:1px solid transparent; transition:.15s; white-space:nowrap; font-family:inherit; }
  .btn:hover { transform:translateY(-1px); }
  .btn:active { transform:translateY(0); }
  .btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
  .btn-primary { background:linear-gradient(135deg,#22d3ee,#0ea5e9); color:#00131c; box-shadow:0 4px 20px -6px rgba(34,211,238,.5); }
  .btn-violet { background:linear-gradient(135deg,#8b5cf6,#6d28d9); color:#fff; }
  .btn-emerald { background:linear-gradient(135deg,#10b981,#059669); color:#fff; }
  .btn-rose { background:linear-gradient(135deg,#f43f5e,#be123c); color:#fff; }
  .btn-amber { background:linear-gradient(135deg,#f59e0b,#d97706); color:#1a1200; }
  .btn-ghost { background:rgba(148,163,184,.06); color:#cbd5e1; border-color:var(--border); }
  .btn-ghost:hover { background:rgba(148,163,184,.12); }
  .btn-icon { padding:8px; width:34px; height:34px; }

  .input, select, textarea { background:#070911; border:1px solid var(--border); border-radius:11px; padding:10px 12px; color:var(--text); font-family:inherit; font-size:13px; width:100%; transition:.15s; }
  .input:focus, select:focus, textarea:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
  .input::placeholder { color:#475569; }
  label.field { display:block; margin-bottom:12px; }
  label.field > span { display:block; font-size:11px; color:var(--muted); margin-bottom:5px; font-weight:500; }

  table { width:100%; border-collapse:separate; border-spacing:0; }
  th { text-align:right; padding:12px 14px; font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; background:rgba(148,163,184,.03); border-bottom:1px solid var(--border); }
  td { padding:13px 14px; font-size:13px; border-bottom:1px solid rgba(148,163,184,.06); vertical-align:middle; }
  tr:hover td { background:rgba(34,211,238,.025); }
  .user-cell { display:flex; align-items:center; gap:10px; }
  .avatar { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; font-weight:700; font-size:13px; color:#00131c; flex-shrink:0; }
  .mono { font-family:ui-monospace,'SF Mono',Menlo,monospace; direction:ltr; text-align:left; display:inline-block; }
  .chip { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:999px; font-size:10.5px; font-weight:600; }
  .chip-green { background:rgba(16,185,129,.12); color:#34d399; }
  .chip-red { background:rgba(244,63,94,.12); color:#fb7185; }
  .chip-cyan { background:rgba(34,211,238,.1); color:#67e8f9; }
  .chip-violet { background:rgba(139,92,246,.12); color:#a78bfa; }
  .chip-amber { background:rgba(245,158,11,.12); color:#fbbf24; }
  .chip-slate { background:rgba(148,163,184,.1); color:#94a3b8; }
  .progress { height:6px; background:rgba(148,163,184,.1); border-radius:999px; overflow:hidden; min-width:90px; }
  .progress > i { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#22d3ee,#0ea5e9); transition:width .3s; }
  .progress.warn > i { background:linear-gradient(90deg,#f59e0b,#d97706); }
  .progress.danger > i { background:linear-gradient(90deg,#f43f5e,#be123c); }

  .switch { position:relative; display:inline-block; width:40px; height:22px; }
  .switch input { opacity:0; width:0; height:0; }
  .switch .slider { position:absolute; cursor:pointer; inset:0; background:#1e293b; border-radius:999px; transition:.2s; }
  .switch .slider::before { content:''; position:absolute; width:16px; height:16px; right:3px; top:3px; background:#fff; border-radius:50%; transition:.2s; }
  .switch input:checked + .slider { background:linear-gradient(135deg,#22d3ee,#0ea5e9); }
  .switch input:checked + .slider::before { transform:translateX(-18px); }

  .modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.7); backdrop-filter:blur(6px); display:none; align-items:flex-start; justify-content:center; padding:40px 16px; z-index:50; overflow-y:auto; }
  .modal-backdrop.open { display:flex; }
  .modal { background:linear-gradient(180deg,#0c1020,#070a13); border:1px solid var(--border-strong); border-radius:20px; width:100%; max-width:680px; box-shadow:0 30px 80px -20px rgba(0,0,0,.8); animation:pop .2s ease; }
  @keyframes pop { from { opacity:0; transform:translateY(8px) scale(.98);} to {opacity:1; transform:none;} }
  .modal-head { padding:20px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
  .modal-body { padding:22px 24px; max-height:70vh; overflow-y:auto; }
  .modal-foot { padding:16px 24px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; }

  .toast-wrap { position:fixed; left:20px; bottom:20px; z-index:100; display:flex; flex-direction:column; gap:8px; }
  .toast { padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; box-shadow:0 10px 30px -8px rgba(0,0,0,.6); animation:slidein .25s ease; display:flex; align-items:center; gap:8px; max-width:360px; }
  @keyframes slidein { from { opacity:0; transform:translateY(10px) translateX(-20px);} to {opacity:1; transform:none;} }
  .toast.success { background:linear-gradient(135deg,#10b981,#059669); color:#fff; }
  .toast.error { background:linear-gradient(135deg,#f43f5e,#be123c); color:#fff; }
  .toast.info { background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; }

  .section-title { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; margin:18px 0 10px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width: 768px) {
    main.app-main { padding: 14px 12px 96px !important; }
    .stat-card { padding: 14px; border-radius: 14px; }
    .stat-card .val { font-size: 20px; }
    .stat-card .ic { width: 36px; height: 36px; }
    th, td { padding: 10px 8px; font-size: 12px; }
    td .avatar { width: 28px; height: 28px; font-size: 11px; }
    .modal { margin: 10px; border-radius: 16px; }
    .modal-body { padding: 16px; max-height: 75vh; }
    .modal-head { padding: 14px 16px; }
    .modal-foot { padding: 12px 16px; }
    .grid2 { grid-template-columns: 1fr; }
    .copy-link { font-size: 10px; }
    header { gap: 8px !important; margin-bottom: 16px !important; }
    .search-box { max-width: none !important; }
    #btn-new span { display: none; }
    .btn { padding: 8px 12px; font-size: 12px; }
    h1 { font-size: 18px !important; }
    .toast-wrap { left: 12px; right: 12px; bottom: 12px; }
    .toast { max-width: none; font-size: 12px; }
    .progress { min-width: 60px; }
  }
  @media (min-width: 769px) {
    .mobile-show { display: none !important; }
  }
  .mobile-show { display:none; }
  .search-box { position:relative; }
  .search-box input { padding-right:38px; }
  .search-box svg { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none; }
  .qr-box { background:#fff; padding:14px; border-radius:14px; display:inline-block; }
  .qr-box img, .qr-box canvas { display:block; }
  .copy-link { font-family:ui-monospace,monospace; font-size:11px; direction:ltr; text-align:left; background:#070911; border:1px solid var(--border); padding:10px; border-radius:9px; word-break:break-all; max-height:80px; overflow-y:auto; }
  .tab { padding:8px 14px; border-radius:9px; font-size:12px; font-weight:600; color:var(--muted); cursor:pointer; border:1px solid transparent; }
  .tab.active { background:rgba(34,211,238,.1); color:#67e8f9; border-color:rgba(34,211,238,.25); }
  .pulse-dot { width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 0 0 rgba(16,185,129,.6); animation:pulseD 2s infinite; }
  @keyframes pulseD { 0%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)} }
  .scrollbar::-webkit-scrollbar { width:8px; height:8px; }
  .scrollbar::-webkit-scrollbar-thumb { background:rgba(148,163,184,.2); border-radius:99px; }
  .scrollbar::-webkit-scrollbar-track { background:transparent; }
  .empty { text-align:center; padding:50px 20px; color:var(--muted); }
  .empty svg { margin:0 auto 12px; opacity:.4; }
  .kbd { font-family:ui-monospace,monospace; font-size:10px; background:rgba(148,163,184,.1); padding:2px 6px; border-radius:5px; border:1px solid var(--border); }

  /* Update banner */
  .update-banner { display:none; align-items:center; gap:12px; padding:10px 16px;
    background:linear-gradient(135deg,rgba(245,158,11,.16),rgba(239,68,68,.14));
    border-bottom:1px solid rgba(245,158,11,.35); color:#fde68a; font-size:13px; }
  .update-banner.show { display:flex; animation:slideDown .3s ease; }
  @keyframes slideDown { from { transform:translateY(-100%); } to { transform:none; } }
  .update-banner .ic { width:30px; height:30px; border-radius:10px; display:grid; place-items:center;
    background:rgba(245,158,11,.2); color:#fbbf24; flex-shrink:0; }
  .update-banner .spinner { width:14px; height:14px; border:2px solid rgba(251,191,36,.25); border-top-color:#fbbf24;
    border-radius:50%; animation:spin .8s linear infinite; display:none; }
  .update-banner.busy .spinner { display:inline-block; }
  .update-banner.busy .btn { opacity:.6; pointer-events:none; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .update-banner .msg { flex:1; min-width:0; }
  .update-banner .msg b { color:#fcd34d; }

  /* Country flag chips */
  .flag { font-size:16px; line-height:1; margin-left:6px; }

  /* Proxy row ping */
  .ping-cell { display:inline-flex; align-items:center; gap:6px; font-weight:700; font-family:ui-monospace,monospace; font-size:12px; }
  .ping-dot { width:8px; height:8px; border-radius:50%; }
  .ping-good { color:#34d399; } .ping-good .ping-dot { background:#10b981; box-shadow:0 0 8px #10b981; }
  .ping-mid  { color:#fbbf24; } .ping-mid  .ping-dot { background:#f59e0b; box-shadow:0 0 8px #f59e0b; }
  .ping-bad  { color:#fb7185; } .ping-bad  .ping-dot { background:#f43f5e; }
  .ping-idle { color:#64748b; } .ping-idle .ping-dot { background:#475569; }
  .ping-probing { color:#67e8f9; }
  .ping-probing .ping-dot { background:#22d3ee; animation:pulsePing 1s ease-in-out infinite; }
  @keyframes pulsePing { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.4)} }

  /* Smart scanner */
  .scan-step { display:flex; align-items:center; gap:10px; padding:14px 16px; border-radius:14px;
    background:rgba(148,163,184,.04); border:1px solid var(--border); margin-bottom:10px; transition:.2s; cursor:pointer; }
  .scan-step:hover { background:rgba(34,211,238,.05); border-color:rgba(34,211,238,.2); }
  .scan-step.active { background:linear-gradient(135deg,rgba(34,211,238,.1),rgba(14,165,233,.05));
    border-color:rgba(34,211,238,.4); box-shadow:0 0 0 3px rgba(34,211,238,.08); }
  .scan-step .num { width:32px; height:32px; border-radius:10px; display:grid; place-items:center;
    font-weight:800; font-size:14px; background:rgba(148,163,184,.1); color:#94a3b8; flex-shrink:0; }
  .scan-step.active .num { background:linear-gradient(135deg,#22d3ee,#0ea5e9); color:#00131c; }
  .scan-step .body { flex:1; min-width:0; }
  .scan-step .title { font-weight:700; font-size:14px; }
  .scan-step .desc { font-size:11px; color:var(--muted); margin-top:2px; }

  /* Skeleton shimmer */
  .shimmer { background:linear-gradient(90deg,rgba(148,163,184,.05) 0%,rgba(148,163,184,.15) 50%,rgba(148,163,184,.05) 100%);
    background-size:200% 100%; animation:shimmer 1.5s infinite; border-radius:6px; }
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

  /* Fade in rows */
  .row-in { animation:rowIn .35s ease both; }
  @keyframes rowIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }

  /* Glow pulse on action buttons */
  .btn-glow { position:relative; overflow:hidden; }
  .btn-glow::after { content:''; position:absolute; inset:0;
    background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,.25) 50%,transparent 70%);
    transform:translateX(-100%); animation:sheen 3s infinite; }
  @keyframes sheen { 0%,60%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }

  /* Update icon in topbar (animated when update available) */
  .update-pill { position:relative; cursor:pointer; padding:8px; border-radius:10px; transition:.15s;
    color:#94a3b8; background:transparent; border:none; }
  .update-pill:hover { background:rgba(148,163,184,.08); color:#e5e7eb; }
  .update-pill.available { color:#fbbf24; animation:wobble 2.2s ease-in-out infinite; }
  @keyframes wobble { 0%,100%{transform:rotate(0)} 15%{transform:rotate(-18deg)} 30%{transform:rotate(14deg)} 45%{transform:rotate(-8deg)} 60%{transform:rotate(4deg)} 75%{transform:rotate(0)} }
  .update-pill .badge-dot { position:absolute; top:4px; right:4px; width:8px; height:8px; border-radius:50%;
    background:#f43f5e; box-shadow:0 0 0 0 rgba(244,63,94,.6); animation:pulseDot 1.6s infinite; }
  @keyframes pulseDot { 0%{box-shadow:0 0 0 0 rgba(244,63,94,.6)} 70%{box-shadow:0 0 0 8px rgba(244,63,94,0)} 100%{box-shadow:0 0 0 0 rgba(244,63,94,0)} }
</style>
</head>
<body>

<!-- ===== BOOTSTRAP (first admin) ===== -->
<div id="bootstrap" class="min-h-screen grid place-items-center p-4" style="display:none">
  <div class="glass rounded-3xl p-8 w-full max-w-md">
    <div class="text-center mb-6">
      <img src="/icon.svg" class="w-16 h-16 mx-auto mb-3" alt=""/>
      <h1 class="text-2xl font-black bg-gradient-to-l from-cyan-300 via-indigo-400 to-violet-400 bg-clip-text text-transparent">راه‌اندازی KALFETELA</h1>
      <p class="text-sm text-slate-400 mt-1">اولین ادمین را بساز</p>
    </div>
    <div class="space-y-3">
      <input id="setup-user" class="input" placeholder="نام کاربری مدیر"/>
      <input id="setup-pass" type="password" class="input" placeholder="رمز عبور (حداقل ۸ کاراکتر)"/>
      <button id="setup-btn" class="btn btn-primary w-full py-3">ایجاد مدیر و ورود</button>
    </div>
  </div>
</div>

<!-- ===== APP SHELL ===== -->
<div id="app" style="display:none;min-height:100vh">
  <header class="app-topbar">
    <div class="inner">
      <a class="brand" href="/panel">
        <img src="/icon.svg" alt=""/>
        <span><b>KALFETELA</b><small>v${version}</small></span>
      </a>
      <nav class="topnav">
        <div class="nav-item active" data-view="dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          داشبورد
        </div>
        <div class="nav-item" data-view="users">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          کاربران
        </div>
        <div class="nav-item" data-view="proxies">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          استخر پروکسی
        </div>
        <div class="nav-item" data-view="scanner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/><circle cx="12" cy="12" r="9" opacity="0.25"/></svg>
          اسکنر
        </div>
        <div class="nav-item" data-view="settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          تنظیمات
        </div>
      </nav>
      <div class="top-actions">
        <div class="search-box search-top" style="width:200px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="search" class="input" placeholder="جستجو..." style="padding:8px 12px 8px 12px;font-size:12px"/>
        </div>
        <button id="btn-new" class="btn btn-primary" title="کاربر جدید">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span class="hidden sm:inline">کاربر جدید</span>
        </button>
        <div class="me-chip" title="خروج">
          <div class="avatar" id="me-avatar" style="background:linear-gradient(135deg,#22d3ee,#0ea5e9)">A</div>
          <span class="name" id="me-name">—</span>
          <button id="btn-logout" class="btn btn-icon btn-ghost" style="width:28px;height:28px" title="خروج">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
    </div>
  </header>

  <main class="app-main" style="max-width:1100px;margin:0 auto;padding:20px 16px 40px">

    <div class="mobile-toolbar">
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="search-mobile" class="input" placeholder="جستجوی کاربر یا UUID..."/>
      </div>
    </div>

    <!-- DASHBOARD -->
    <section data-page="dashboard">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="stat-card cyan">
          <div class="ic" style="background:rgba(34,211,238,.15);color:#67e8f9">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="val" id="stat-users">—</div>
          <div class="lbl">کل کاربران</div>
        </div>
        <div class="stat-card emerald">
          <div class="ic" style="background:rgba(16,185,129,.15);color:#34d399">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="val" id="stat-active">—</div>
          <div class="lbl">کاربران فعال</div>
        </div>
        <div class="stat-card violet">
          <div class="ic" style="background:rgba(139,92,246,.15);color:#a78bfa">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          </div>
          <div class="val" id="stat-gb">—</div>
          <div class="lbl">مصرف کل</div>
        </div>
        <div class="stat-card amber">
          <div class="ic" style="background:rgba(245,158,11,.15);color:#fbbf24">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div class="val" id="stat-req">—</div>
          <div class="lbl">درخواست‌ها</div>
        </div>
      </div>

      <div class="glass rounded-2xl overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b" style="border-color:var(--border)">
          <div>
            <h2 class="font-bold">آخرین کاربران</h2>
            <p class="text-xs text-slate-400 mt-0.5">برای مدیریت همه به تب «کاربران» بروید</p>
          </div>
          <button class="btn btn-ghost" onclick="go('users')">همه کاربران ←</button>
        </div>
        <div class="overflow-x-auto" id="recent-users"></div>
      </div>
    </section>

    <!-- USERS -->
    <section data-page="users" style="display:none">
      <div class="glass rounded-2xl overflow-hidden">
        <div class="flex flex-wrap items-center gap-2 p-4 border-b" style="border-color:var(--border)">
          <div class="flex gap-2 flex-wrap" id="bulk-bar" style="display:none">
            <button class="btn btn-emerald" data-bulk="enable">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              فعال‌سازی
            </button>
            <button class="btn btn-amber" data-bulk="disable">غیرفعال</button>
            <button class="btn btn-ghost" data-bulk="resetVol">ریست حجم</button>
            <button class="btn btn-rose" data-bulk="delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              حذف
            </button>
            <span class="text-xs text-slate-400 self-center" id="sel-count"></span>
          </div>
          <div class="mr-auto flex items-center gap-2">
            <span class="text-xs text-slate-400" id="users-count">۰ کاربر</span>
            <button id="btn-refresh" class="btn btn-ghost btn-icon" title="به‌روزرسانی">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          </div>
        </div>
        <div class="overflow-x-auto scrollbar" id="users-table"></div>
      </div>
    </section>

    <!-- PROXIES -->
    <section data-page="proxies" style="display:none">
      <div class="glass rounded-2xl p-5 mb-4">
        <h2 class="font-bold mb-1">استخر پروکسی</h2>
        <p class="text-xs text-slate-400 mb-4">یک URL فایل متنی لیست پروکسی وارد کن (هر خط socks5://user:pass@host:port یا host:port)</p>
        <div class="flex flex-wrap gap-2">
          <input id="proxy-url" class="input flex-1 min-w-[200px]" placeholder="https://example.com/proxy/US.txt"/>
          <input id="proxy-cc" class="input" style="max-width:120px" placeholder="کد کشور (US)"/>
          <button id="proxy-import" class="btn btn-primary">ایمپورت</button>
          <button id="proxy-browser-ping" class="btn btn-violet btn-glow">📡 پینگ از مرورگر</button>
          <button id="proxy-reload" class="btn btn-ghost">همگام‌سازی DO</button>
        </div>
        <p class="text-xs text-slate-500 mt-2">دکمه «پینگ از مرورگر» از همین اینترنت تو به همه پروکسی‌ها وصل می‌شه و تأخیر واقعی را نشون می‌ده. در ویرایش کاربر می‌تونی پروکسی اختصاصی بدی یا کد کشور استخر را ست کنی.</p>
      </div>
      <div class="glass rounded-2xl overflow-hidden">
        <div class="p-4 border-b flex items-center justify-between" style="border-color:var(--border)">
          <h3 class="font-bold">پروکسی‌ها</h3>
          <span id="proxy-count" class="text-xs text-slate-400">—</span>
        </div>
        <div class="overflow-x-auto scrollbar" id="proxies-table"></div>
      </div>
    </section>

    <!-- SCANNER -->
    <section data-page="scanner" style="display:none">
      <div class="glass rounded-2xl p-4 mb-4">
        <h2 class="font-bold flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M12 7v5l3 2"/></svg>
          اسکنر هوشمند
        </h2>
        <p class="text-xs text-slate-400 mt-1">IPهای کلودفلر و پروکسی‌ها را مستقیم از همین مرورگر تست کن — پینگ واقعی اینترنت تو.</p>
      </div>
      <div class="flex gap-2 mb-4 flex-wrap">
        <div class="tab active" data-scantab="ip">🌐 اسکن IP تمیز</div>
        <div class="tab" data-scantab="finder">✨ یابنده پروکسی</div>
        <div class="tab" data-scantab="proxy">🛡 تست دستی پروکسی</div>
      </div>

      <div data-scanpane="ip">
        <div class="glass rounded-2xl p-5 mb-4">
          <h2 class="font-bold mb-1">پیدا کردن سریع‌ترین IP کلودفلر</h2>
          <p class="text-xs text-slate-400 mb-3">برای دقیق‌ترین نتیجه، اسکن را <b class="text-cyan-300">روی همین مرورگر</b> اجرا کن تا پینگ واقعی اینترنت خودت را ببینی. اسکن از سرور هم برای مواقعی که می‌خوای از دید کلودفلر تست کنی موجوده.</p>
          <div class="flex flex-wrap gap-2 mb-3">
            <select id="ipscan-port" class="input" style="max-width:140px">
              <option value="443">پورت 443</option>
              <option value="2053">2053</option>
              <option value="2083">2083</option>
              <option value="2087">2087</option>
              <option value="2096">2096</option>
              <option value="8443">8443</option>
              <option value="80">80 (HTTP)</option>
              <option value="8080">8080</option>
            </select>
            <select id="ipscan-mode" class="input" style="max-width:170px">
              <option value="browser">🌐 اسکن از مرورگر من</option>
              <option value="server">☁️ اسکن از سرور</option>
            </select>
            <button id="ipscan-preset" class="btn btn-ghost">بارگذاری IPهای پیش‌فرض</button>
            <button id="ipscan-run" class="btn btn-primary">شروع اسکن</button>
            <button id="ipscan-save" class="btn btn-violet" disabled>ذخیره IPهای برتر</button>
          </div>
          <textarea id="ipscan-list" class="input mono" rows="6" dir="ltr" style="text-align:left;font-size:11px" placeholder="هر IP در یک خط..."></textarea>
          <div id="ipscan-progress" class="text-xs text-slate-400 mt-3"></div>
        </div>
        <div class="glass rounded-2xl overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between" style="border-color:var(--border)">
            <h3 class="font-bold">نتایج</h3>
            <span id="ipscan-count" class="text-xs text-slate-400">—</span>
          </div>
          <div id="ipscan-results" style="max-height:460px;overflow:auto"></div>
        </div>
      </div>

      <div data-scanpane="proxy" style="display:none">
        <div class="glass rounded-2xl p-5 mb-4">
          <h2 class="font-bold mb-1">تست پروکسی‌ها</h2>
          <p class="text-xs text-slate-400 mb-4">پروتکل‌های SOCKS4، SOCKS5 و HTTP پشتیبانی می‌شوند. فرمت: <span class="mono text-cyan-300">socks5://user:pass@host:port</span></p>
          <div class="flex flex-wrap gap-2 mb-3">
            <input id="pscan-test" class="input" placeholder="تست از طریق: example.com:443" value="example.com:443" style="max-width:220px"/>
            <button id="pscan-run" class="btn btn-primary">شروع اسکن</button>
            <button id="pscan-import" class="btn btn-emerald">افزودن سالم‌ها به استخر</button>
          </div>
          <textarea id="pscan-list" class="input mono" rows="6" dir="ltr" style="text-align:left;font-size:11px" placeholder="socks5://1.2.3.4:1080&#10;socks5://user:pass@host:1080&#10;http://user:pass@host:8080"></textarea>
          <div id="pscan-progress" class="text-xs text-slate-400 mt-3"></div>
        </div>
        <div class="glass rounded-2xl overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between" style="border-color:var(--border)">
            <h3 class="font-bold">نتایج</h3>
            <span id="pscan-count" class="text-xs text-slate-400">—</span>
          </div>
          <div id="pscan-results" style="max-height:460px;overflow:auto"></div>
        </div>
      </div>

      <div data-scanpane="finder" style="display:none">
        <div class="glass rounded-2xl p-5 mb-4">
          <h2 class="font-bold mb-1 flex items-center gap-2">✨ یابنده خودکار پروکسی</h2>
          <p class="text-xs text-slate-400 mb-4">لیست‌های پروکسی عمومی از چند منبع معتبر دانلود می‌شن، یکتا می‌شن و در یک کلیک به استخر پنل اضافه می‌شن. بعد از ایمپورت می‌تونی از همین صفحه «بررسی سلامت» بزنی تا ورکر پروکسی‌های مرده را غیرفعال کنه. (توجه: پروکسی‌های عمومی معمولاً کند و بی‌ثبات هستن.)</p>
          <div class="flex flex-wrap gap-2 mb-3">
            <select id="finder-scheme" class="input" style="max-width:200px">
              <option value="both">SOCKS5 + HTTP</option>
              <option value="socks5">فقط SOCKS5</option>
              <option value="http">فقط HTTP</option>
            </select>
            <input id="finder-max" class="input" type="number" min="20" max="400" value="120" style="max-width:140px" placeholder="حداکثر"/>
            <button id="finder-run" class="btn btn-primary">🔍 جستجو</button>
            <button id="finder-ping" class="btn btn-violet btn-glow" disabled>📡 پینگ از مرورگر</button>
            <button id="finder-import" class="btn btn-emerald" disabled>➕ افزودن به استخر</button>
          </div>
          <div id="finder-progress" class="text-xs text-slate-400"></div>
        </div>
        <div class="glass rounded-2xl overflow-hidden">
          <div class="p-4 border-b flex items-center justify-between" style="border-color:var(--border)">
            <h3 class="font-bold">کاندیداها</h3>
            <span id="finder-count" class="text-xs text-slate-400">—</span>
          </div>
          <div id="finder-results" style="max-height:500px;overflow:auto"></div>
        </div>
      </div>
    </section>

    <!-- SETTINGS -->
    <section data-page="settings" style="display:none">
      <div class="grid md:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5">
          <h3 class="font-bold mb-1">حساب کاربری</h3>
          <p class="text-xs text-slate-400 mb-4">تغییر رمز عبور</p>
          <label class="field"><span>رمز فعلی</span><input id="cur-pass" type="password" class="input"/></label>
          <label class="field"><span>رمز جدید (حداقل ۸ کاراکتر)</span><input id="new-pass" type="password" class="input"/></label>
          <button id="btn-change-pass" class="btn btn-primary w-full">تغییر رمز</button>
        </div>
        <div class="glass rounded-2xl p-5">
          <h3 class="font-bold mb-1">پشتیبان‌گیری</h3>
          <p class="text-xs text-slate-400 mb-4">دریافت یا بازیابی کامل پایگاه داده</p>
          <div class="flex gap-2 flex-wrap">
            <a href="/api/system/backup" class="btn btn-violet" id="btn-backup">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              دانلود بکاپ
            </a>
            <label class="btn btn-ghost cursor-pointer">
              بازیابی از فایل
              <input type="file" id="restore-file" accept=".json" style="display:none"/>
            </label>
          </div>
        </div>
        <div class="glass rounded-2xl p-5 md:col-span-2">
          <h3 class="font-bold mb-1">اطلاعات سیستم</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
            <div class="p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><div class="text-xs text-slate-400">نسخه</div><div class="font-mono mt-1">${version}</div></div>
            <div class="p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><div class="text-xs text-slate-400">محل اجرا</div><div class="font-mono mt-1">Cloudflare</div></div>
            <div class="p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><div class="text-xs text-slate-400">پایگاه داده</div><div class="font-mono mt-1">D1 + DO</div></div>
            <div class="p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><div class="text-xs text-slate-400">پروتکل‌ها</div><div class="font-mono mt-1">VLESS/Trojan/VMess</div></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <nav class="bottomnav">
    <div class="nav-item active" data-view="dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
      داشبورد
    </div>
    <div class="nav-item" data-view="users">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      کاربران
    </div>
    <div class="nav-item" data-view="proxies">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      پروکسی
    </div>
    <div class="nav-item" data-view="scanner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
      اسکنر
    </div>
    <div class="nav-item" data-view="settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      تنظیمات
    </div>
  </nav>
</div>

<!-- ===== User Modal ===== -->
<div id="modal-user" class="modal-backdrop">
  <div class="modal">
    <div class="modal-head">
      <div>
        <h3 id="mu-title" class="font-bold text-lg">کاربر جدید</h3>
        <p class="text-xs text-slate-400 mt-0.5" id="mu-sub">اطلاعات کاربر را وارد کنید</p>
      </div>
      <button class="btn btn-ghost btn-icon" data-close-modal>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body scrollbar">
      <div class="section-title" style="margin-top:0">اطلاعات پایه</div>
      <div class="grid2">
        <label class="field"><span>نام کاربری *</span><input id="f-username" class="input" placeholder="my-user"/></label>
        <label class="field"><span>UUID (خالی = تصادفی)</span><input id="f-uuid" class="input mono" placeholder="auto"/></label>
      </div>
      <div class="section-title">محدودیت‌ها</div>
      <div class="grid2">
        <label class="field"><span>حجم (GB)</span><input id="f-limitGb" type="number" step="0.1" class="input" placeholder="مثلاً 10"/></label>
        <label class="field"><span>انقضا (روز)</span><input id="f-expiryDays" type="number" class="input" placeholder="30"/></label>
        <label class="field"><span>محدودیت درخواست</span><input id="f-limitReq" type="number" class="input" placeholder="اختیاری"/></label>
        <label class="field"><span>حداکثر دستگاه همزمان</span><input id="f-ipLimit" type="number" class="input" placeholder="اختیاری"/></label>
      </div>
      <div class="section-title">اتصال</div>
      <div class="grid2">
        <label class="field"><span>پروتکل</span>
          <select id="f-connectionType" class="input">
            <option value="vless+trojan">VLESS + Trojan (پیشنهادی — سریع و پایدار)</option>
            <option value="vless+trojan+vmess+all">همه پروتکل‌ها + حالت نفوذ (بیشترین شانس اتصال)</option>
            <option value="vless">فقط VLESS</option>
            <option value="trojan">فقط Trojan</option>
            <option value="vmess">VMess (قدیمی‌تر، سازگار با کلاینت‌های قدیمی)</option>
            <option value="vless+trojan+vmess">VLESS + Trojan + VMess</option>
          </select>
        </label>
        <label class="field"><span>پورت</span>
          <select id="f-port" class="input">
            <option value="443">443</option>
            <option value="8443">8443</option>
            <option value="2053">2053</option>
            <option value="2083">2083</option>
            <option value="2087">2087</option>
            <option value="2096">2096</option>
            <option value="80">80 (بدون TLS)</option>
            <option value="8080">8080 (بدون TLS)</option>
          </select>
        </label>
        <label class="field"><span>مسیر (Path)</span><input id="f-path" class="input mono" placeholder="/" value="/"/></label>
        <label class="field"><span>Fingerprint</span>
          <select id="f-fingerprint" class="input">
            <option value="chrome">chrome</option>
            <option value="firefox">firefox</option>
            <option value="safari">safari</option>
            <option value="ios">ios</option>
            <option value="android">android</option>
            <option value="edge">edge</option>
            <option value="random">random</option>
            <option value="unsafe">unsafe</option>
          </select>
        </label>
        <label class="field" style="grid-column:1/-1"><span>SNI / Host (خالی = هاست ورکر)</span><input id="f-sniHost" class="input" placeholder="example.com"/></label>
        <label class="field" style="grid-column:1/-1"><span>Fragment مثل 200-3000,1-2,tlshello</span><input id="f-fragment" class="input mono" placeholder="اختیاری"/></label>
      </div>
      <div class="section-title">پروکسی بالادست</div>
      <div class="glass rounded-xl p-3 mb-3" style="background:rgba(34,211,238,.04);border:1px dashed rgba(34,211,238,.25)">
        <div class="flex items-center gap-2 flex-wrap">
          <label class="flex items-center gap-2 text-xs cursor-pointer mb-0">
            <span class="switch" style="width:36px;height:20px"><input type="checkbox" id="f-useProxy"><span class="slider" style="height:20px;width:36px"></span></span>
            <b>استفاده از پروکسی برای این کاربر</b>
          </label>
          <button type="button" id="f-proxyFinder" class="btn btn-ghost" style="padding:6px 12px;font-size:11px;margin-right:auto">✨ یافتن پروکسی</button>
        </div>
        <div id="f-proxyPicker" style="display:none;margin-top:12px">
          <div class="flex gap-2 flex-wrap mb-2">
            <select id="f-finder-scheme" class="input" style="max-width:160px;padding:8px 10px;font-size:12px">
              <option value="both">SOCKS5 + HTTP</option>
              <option value="socks5">فقط SOCKS5</option>
              <option value="http">فقط HTTP</option>
            </select>
            <button type="button" id="f-finder-scan" class="btn btn-primary" style="padding:7px 14px;font-size:12px">🔍 جستجو و پینگ</button>
            <button type="button" id="f-finder-pool" class="btn btn-ghost" style="padding:7px 14px;font-size:12px">از استخر</button>
            <span id="f-finder-progress" class="text-xs text-slate-400 self-center"></span>
          </div>
          <div id="f-finder-results" style="max-height:240px;overflow:auto;border-radius:10px;border:1px solid var(--border)"></div>
        </div>
      </div>
      <div class="grid2">
        <label class="field"><span>کد کشور استخر (مثل US — اگر پروکسی دستی ست نکنی)</span><input id="f-userProxyIata" class="input mono" placeholder="اختیاری"/></label>
        <label class="field"><span>پروکسی بالادست دستی</span><input id="f-userSocks5" class="input mono" placeholder="socks5://u:p@host:port"/></label>
        <label class="field" style="grid-column:1/-1"><span>دامنه‌های مستقیم (با کاما)</span><input id="f-routeDirect" class="input" placeholder="example.ir, domain.com"/></label>
        <label class="field" style="grid-column:1/-1"><span>دامنه‌های مسدود (با کاما)</span><input id="f-routeBlock" class="input" placeholder="ads.example.com"/></label>
        <label class="field" style="grid-column:1/-1"><span>DoH سفارشی</span><input id="f-dohUrl" class="input mono" placeholder="https://cloudflare-dns.com/dns-query"/></label>
      </div>
      <div class="flex flex-wrap gap-5 mt-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer"><span class="switch"><input type="checkbox" id="f-blockPorn"><span class="slider"></span></span>مسدودسازی NSFW</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><span class="switch"><input type="checkbox" id="f-blockAds"><span class="slider"></span></span>مسدودسازی تبلیغ</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><span class="switch"><input type="checkbox" id="f-blockMalware"><span class="slider"></span></span>بدافزار</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><span class="switch"><input type="checkbox" id="f-isActive" checked><span class="slider"></span></span>کاربر فعال</label>
      </div>
      <label class="field mt-4"><span>یادداشت</span><textarea id="f-note" rows="2" class="input" placeholder="یادداشت داخلی..."></textarea></label>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close-modal>انصراف</button>
      <button class="btn btn-primary" id="mu-save">ذخیره کاربر</button>
    </div>
  </div>
</div>

<!-- ===== Sub Modal (QR + links) ===== -->
<div id="modal-sub" class="modal-backdrop">
  <div class="modal" style="max-width:520px">
    <div class="modal-head">
      <h3 class="font-bold text-lg">اشتراک کاربر</h3>
      <button class="btn btn-ghost btn-icon" data-close-modal>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div id="sub-qr" class="flex justify-center mb-4"></div>
      <div class="text-xs text-slate-400 mb-1.5">لینک اشتراک (کپی کن و در اپلیکیشن وارد کن):</div>
      <div class="flex gap-2 mb-3">
        <div class="copy-link flex-1" id="sub-url"></div>
        <button class="btn btn-primary" id="sub-copy">کپی</button>
      </div>
      <div class="text-xs text-slate-400 mb-1.5">فرمت‌های دیگر:</div>
      <div class="flex gap-2 flex-wrap mb-3" id="sub-formats"></div>
      <div class="text-xs text-slate-400 mb-1.5">لینک‌های مستقیم:</div>
      <div class="copy-link" id="sub-raw"></div>
    </div>
  </div>
</div>

<!-- ===== Confirm Modal ===== -->
<div id="modal-confirm" class="modal-backdrop">
  <div class="modal" style="max-width:400px">
    <div class="modal-body text-center py-7">
      <div class="w-14 h-14 mx-auto rounded-full grid place-items-center mb-3" style="background:rgba(244,63,94,.12);color:#fb7185">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <h3 class="font-bold text-lg mb-1" id="cf-title">مطمئنی؟</h3>
      <p class="text-sm text-slate-400 mb-5" id="cf-msg"></p>
      <div class="flex gap-2 justify-center">
        <button class="btn btn-ghost" data-close-modal>انصراف</button>
        <button class="btn btn-rose" id="cf-ok">تأیید</button>
      </div>
    </div>
  </div>
</div>

<div class="toast-wrap" id="toasts"></div>

<script>
/* ============================================================
   KALFETELA client logic (string concat only — safe inside
   the outer server template literal).
   ============================================================ */
var API = {
  req: function(method, path, body){
    var opt = { method: method, credentials: 'include', headers: {} };
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function(r){
      if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
      var ct = r.headers.get('content-type') || '';
      var p = ct.indexOf('json') >= 0 ? r.json() : r.text();
      if (!r.ok) return p.then(function(e){ throw new Error((e && e.error) || r.statusText); });
      return p;
    });
  },
  get: function(p){ return API.req('GET', p); },
  post: function(p,b){ return API.req('POST', p, b); },
  patch: function(p,b){ return API.req('PATCH', p, b); },
  del: function(p){ return API.req('DELETE', p); }
};

function toast(msg, type){
  var t = document.createElement('div');
  t.className = 'toast ' + (type || 'success');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(function(){ t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(function(){ t.remove(); }, 250); }, 2800);
}

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function fmtGB(n){ if (n == null) return '—'; return (Number(n)||0).toFixed(2) + ' GB'; }
function fmtNum(n){ return (Number(n)||0).toLocaleString('fa-IR'); }
function fmtDate(ts){ if (!ts) return '—'; try { return new Date(ts*1000).toLocaleString('fa-IR', {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e){ return '—'; } }
function pct(used, limit){ if (!limit) return 0; return Math.min(100, Math.round((Number(used||0)/Number(limit))*100)); }
function progressClass(p){ if (p >= 90) return 'danger'; if (p >= 70) return 'warn'; return ''; }
function avatarColor(name){
  var colors = ['#22d3ee','#8b5cf6','#f59e0b','#10b981','#f43f5e','#0ea5e9','#ec4899'];
  var h = 0; for (var i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}
function protoChips(ct){
  var map = { vless:'cyan', trojan:'violet', vmess:'amber' };
  return (ct || 'vless').split('+').map(function(p){
    var cls = map[p] || 'slate';
    return '<span class="chip chip-' + cls + '">' + esc(p.toUpperCase()) + '</span>';
  }).join(' ');
}

var state = { users: [], selected: new Set(), editing: null, view: 'dashboard' };

/* ---------- navigation ---------- */
function go(view){
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.toggle('active', n.dataset.view === view); });
  document.querySelectorAll('[data-page]').forEach(function(s){ s.style.display = s.dataset.page === view ? '' : 'none'; });
  if (view === 'dashboard') loadDashboard();
  if (view === 'users') loadUsers();
  if (view === 'proxies') loadProxies();
  if (view === 'scanner') initScanner();
}
document.querySelectorAll('.nav-item').forEach(function(n){ n.addEventListener('click', function(){
  go(n.dataset.view);
}); });

/* ---------- bootstrap / auth ---------- */
async function boot(){
  try {
    var me = await API.get('/api/auth/me');
    document.getElementById('app').style.display = '';
    document.getElementById('me-name').textContent = me.actor;
    var roleEl = document.getElementById('me-role');
    if (roleEl) roleEl.textContent = me.role || me.kind;
    document.getElementById('me-avatar').textContent = String(me.actor||'A').charAt(0).toUpperCase();
    var chip = document.querySelector('.me-chip');
    if (chip) chip.title = me.actor + (me.role ? ' · ' + me.role : '');
    await loadDashboard();
  } catch(e){
    document.getElementById('bootstrap').style.display = '';
  }
}
document.getElementById('setup-btn').addEventListener('click', async function(){
  var u = document.getElementById('setup-user').value.trim();
  var p = document.getElementById('setup-pass').value;
  if (!u || p.length < 8) return toast('رمز حداقل ۸ کاراکتر', 'error');
  try {
    await API.post('/api/auth/setup', { username: u, password: p });
    await API.post('/api/auth/login', { username: u, password: p });
    toast('خوش آمدی!');
    location.reload();
  } catch(e){ toast(e.message, 'error'); }
});
document.getElementById('btn-logout').addEventListener('click', async function(){
  await API.post('/api/auth/logout', {}).catch(function(){});
  location.href = '/login';
});
document.getElementById('btn-change-pass').addEventListener('click', async function(){
  var cur = document.getElementById('cur-pass').value;
  var next = document.getElementById('new-pass').value;
  if (next.length < 8) return toast('رمز جدید حداقل ۸ کاراکتر', 'error');
  try {
    await API.post('/api/auth/change-password', { current: cur, next: next });
    toast('رمز عوض شد');
    document.getElementById('cur-pass').value = '';
    document.getElementById('new-pass').value = '';
  } catch(e){ toast(e.message, 'error'); }
});
document.getElementById('restore-file').addEventListener('change', async function(e){
  var f = e.target.files[0]; if (!f) return;
  confirmDial('بازیابی بکاپ', 'این عمل همه‌ی کاربران فعلی را بازنویسی می‌کند. مطمئنی؟', async function(){
    var text = await f.text();
    var data = JSON.parse(text);
    try {
      var r = await API.post('/api/system/restore', data);
      toast(r.users + ' کاربر و ' + r.proxies + ' پروکسی بازیابی شد');
      loadDashboard(); loadUsers();
    } catch(ex){ toast(ex.message, 'error'); }
  });
});

/* ---------- data loaders ---------- */
async function loadStats(){
  try {
    var s = await API.get('/api/stats');
    document.getElementById('stat-users').textContent = fmtNum(s.users);
    document.getElementById('stat-active').textContent = fmtNum(s.active);
    document.getElementById('stat-gb').textContent = (Number(s.usedGb)||0).toFixed(2);
    document.getElementById('stat-req').textContent = fmtNum(s.usedReq);
  } catch(e){}
}
async function loadDashboard(){
  await loadStats();
  try {
    var r = await API.get('/api/users?pageSize=8');
    document.getElementById('recent-users').innerHTML = renderUsersTable(r.users, true);
    wireRows();
  } catch(e){}
}
async function loadUsers(){
  var q = document.getElementById('search').value.trim();
  var r = await API.get('/api/users?pageSize=200' + (q ? '&q=' + encodeURIComponent(q) : ''));
  state.users = r.users || [];
  document.getElementById('users-count').textContent = fmtNum(r.total) + ' کاربر';
  document.getElementById('users-table').innerHTML = renderUsersTable(state.users, false);
  document.getElementById('chk-all')?.remove();
  wireRows();
  updateBulkBar();
}
function renderUsersTable(users, compact){
  if (!users || !users.length) {
    return '<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><div>کاربری یافت نشد</div></div>';
  }
  var head = '';
  if (!compact) {
    head = '<thead><tr>' +
      '<th style="width:36px"><input type="checkbox" id="chk-all"/></th>' +
      '<th>کاربر</th><th>پروتکل</th><th>حجم</th><th>انقضا</th>' +
      '<th>درخواست</th><th>وضعیت</th><th>آخرین اتصال</th><th></th></tr></thead>';
  } else {
    head = '<thead><tr><th>کاربر</th><th>پروتکل</th><th>حجم</th><th>وضعیت</th><th></th></tr></thead>';
  }
  var rows = users.map(function(u){
    var p = pct(u.used_gb, u.limit_gb);
    var color = avatarColor(u.username);
    var actions =
      '<button class="btn btn-ghost btn-icon" data-act="sub" data-u="' + esc(u.username) + '" title="اشتراک/QR">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' +
      '</button>' +
      '<button class="btn btn-ghost btn-icon" data-act="edit" data-u="' + esc(u.username) + '" title="ویرایش">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      '</button>' +
      '<button class="btn btn-ghost btn-icon" style="color:#fb7185" data-act="del" data-u="' + esc(u.username) + '" title="حذف">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
      '</button>';
    var activeChip = u.is_active
      ? '<span class="chip chip-green"><span class="pulse-dot" style="width:6px;height:6px"></span> فعال</span>'
      : '<span class="chip chip-red">غیرفعال</span>';
    var userCell =
      '<div class="user-cell">' +
        '<div class="avatar" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + esc(String(u.username).charAt(0).toUpperCase()) + '</div>' +
        '<div style="min-width:0">' +
          '<div class="font-semibold truncate">' + esc(u.username) + '</div>' +
          '<div class="text-[10px] text-slate-500 mono truncate">' + esc((u.uuid||'').slice(0,8)) + '…</div>' +
        '</div>' +
      '</div>';
    if (compact) {
      return '<tr><td>' + userCell + '</td><td>' + protoChips(u.connection_type) + '</td>' +
        '<td><div class="flex items-center gap-2"><div class="progress ' + progressClass(p) + '"><i style="width:' + p + '%"></i></div><span class="text-[11px] text-slate-400 whitespace-nowrap">' + fmtGB(u.used_gb) + '/' + (u.limit_gb == null ? '∞' : fmtGB(u.limit_gb)) + '</span></div></td>' +
        '<td>' + activeChip + '</td><td><div class="flex gap-1">' + actions + '</div></td></tr>';
    }
    var cb = '<input type="checkbox" data-sel="' + esc(u.username) + '"' + (state.selected.has(u.username) ? ' checked' : '') + '/>';
    return '<tr>' +
      '<td>' + cb + '</td>' +
      '<td>' + userCell + '</td>' +
      '<td>' + protoChips(u.connection_type) + '</td>' +
      '<td><div class="flex items-center gap-2"><div class="progress ' + progressClass(p) + '"><i style="width:' + p + '%"></i></div><span class="text-[11px] text-slate-400 whitespace-nowrap">' + fmtGB(u.used_gb) + '/' + (u.limit_gb == null ? '∞' : fmtGB(u.limit_gb)) + '</span></div></td>' +
      '<td>' + (u.expiry_days != null ? u.expiry_days + ' روز' : '<span class="text-slate-500">∞</span>') + '</td>' +
      '<td>' + fmtNum(u.used_req) + (u.limit_req != null ? ' <span class="text-slate-500">/ ' + fmtNum(u.limit_req) + '</span>' : '') + '</td>' +
      '<td>' + activeChip + '</td>' +
      '<td class="text-slate-400 text-xs whitespace-nowrap">' + fmtDate(u.last_active) + '</td>' +
      '<td><div class="flex gap-1">' + actions + '</div></td>' +
    '</tr>';
  }).join('');
  var table = '<table class="users-table-desktop">' + head + '<tbody>' + rows + '</tbody></table>';
  var cards = '<div class="users-grid-mobile">' + users.map(function(u){
    var p = pct(u.used_gb, u.limit_gb);
    var color = avatarColor(u.username);
    var activeChip = u.is_active
      ? '<span class="chip chip-green"><span class="pulse-dot" style="width:6px;height:6px"></span> فعال</span>'
      : '<span class="chip chip-red">غیرفعال</span>';
    var initial = esc(String(u.username).charAt(0).toUpperCase());
    return '<div class="user-card">' +
      '<div class="row">' +
        '<div class="name"><span class="avatar" style="width:32px;height:32px;border-radius:10px;background:'+color+'22;color:'+color+';border:1px solid '+color+'44;display:grid;place-items:center;font-weight:700">'+initial+'</span>' +
          '<div style="min-width:0"><div class="truncate">'+esc(u.username)+'</div><div class="uuid">'+esc((u.uuid||'').slice(0,13))+'…</div></div>' +
        '</div>' +
        activeChip +
      '</div>' +
      '<div class="meta">' +
        '<div><span class="lbl">پروتکل</span>'+protoChips(u.connection_type)+'</div>' +
        '<div><span class="lbl">حجم</span><div class="flex items-center gap-2" style="display:flex;align-items:center;gap:6px"><div class="progress '+progressClass(p)+'"><i style="width:'+p+'%"></i></div><span class="text-[10px] text-slate-400 whitespace-nowrap">'+fmtGB(u.used_gb).replace(' GB','')+'/'+(u.limit_gb==null?'∞':fmtGB(u.limit_gb).replace(' GB',''))+'</span></div></div>' +
        '<div><span class="lbl">انقضا</span>'+(u.expiry_days != null ? u.expiry_days+' روز' : '<span class="text-slate-500">∞</span>')+'</div>' +
        '<div><span class="lbl">آخرین اتصال</span><span class="text-[10px] text-slate-400">'+fmtDate(u.last_active)+'</span></div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-ghost" data-act="sub" data-u="'+esc(u.username)+'">📱 اشتراک</button>' +
        '<button class="btn btn-ghost" data-act="edit" data-u="'+esc(u.username)+'">✏️ ویرایش</button>' +
        '<button class="btn btn-ghost" style="color:#fb7185" data-act="del" data-u="'+esc(u.username)+'">حذف</button>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';
  return table + cards;
}

function wireRows(){
  document.querySelectorAll('[data-act]').forEach(function(b){
    b.addEventListener('click', function(){
      var act = b.dataset.act, u = b.dataset.u;
      if (act === 'edit') openUserModal(u);
      else if (act === 'del') {
        confirmDial('حذف کاربر', 'کاربر «' + u + '» برای همیشه حذف می‌شود. مطمئنی؟', function(){
          API.del('/api/users/' + encodeURIComponent(u)).then(function(){ toast('حذف شد'); loadUsers(); loadStats(); }).catch(function(e){ toast(e.message,'error'); });
        });
      } else if (act === 'sub') openSubModal(u);
    });
  });
  var chkAll = document.getElementById('chk-all');
  if (chkAll) chkAll.onchange = function(){
    state.users.forEach(function(u){ if (chkAll.checked) state.selected.add(u.username); else state.selected.delete(u.username); });
    loadUsers();
  };
  document.querySelectorAll('[data-sel]').forEach(function(c){
    c.onchange = function(){
      if (c.checked) state.selected.add(c.dataset.sel); else state.selected.delete(c.dataset.sel);
      updateBulkBar();
    };
  });
}
function updateBulkBar(){
  var bar = document.getElementById('bulk-bar');
  if (!bar) return;
  bar.style.display = state.selected.size ? '' : 'none';
  document.getElementById('sel-count').textContent = state.selected.size + ' انتخاب شده';
}
document.querySelectorAll('[data-bulk]').forEach(function(b){
  b.addEventListener('click', function(){
    if (!state.selected.size) return;
    var act = b.dataset.bulk;
    var labels = { enable:'فعال‌سازی', disable:'غیرفعال‌سازی', resetVol:'ریست حجم', delete:'حذف' };
    confirmDial(labels[act] + ' گروهی', state.selected.size + ' کاربر اعمال می‌شود. ادامه می‌دهی؟', function(){
      API.post('/api/users/bulk', { usernames: Array.from(state.selected), action: act }).then(function(){
        toast('انجام شد'); state.selected.clear(); loadUsers(); loadStats();
      }).catch(function(e){ toast(e.message,'error'); });
    });
  });
});

document.getElementById('btn-new').addEventListener('click', function(){ openUserModal(null); });
document.getElementById('btn-refresh').addEventListener('click', function(){ loadUsers(); loadStats(); toast('به‌روز شد'); });
document.getElementById('search').addEventListener('input', debounce(loadUsers, 250));
(function syncSearches(){
  var a = document.getElementById('search');
  var b = document.getElementById('search-mobile');
  if (b) {
    b.addEventListener('input', function(){ a.value = b.value; a.dispatchEvent(new Event('input')); });
    a.addEventListener('input', function(){ if (b.value !== a.value) b.value = a.value; });
  }
})();
function debounce(fn, ms){ var t; return function(){ clearTimeout(t); t = setTimeout(fn, ms); }; }

/* ---------- user modal ---------- */
function openUserModal(username){
  state.editing = username;
  var u = null;
  if (username) {
    u = state.users.find(function(x){ return x.username === username; });
    document.getElementById('mu-title').textContent = 'ویرایش کاربر';
    document.getElementById('mu-sub').textContent = username;
  } else {
    document.getElementById('mu-title').textContent = 'کاربر جدید';
    document.getElementById('mu-sub').textContent = 'اطلاعات کاربر را وارد کنید';
  }
  document.getElementById('f-username').value = u ? u.username : '';
  document.getElementById('f-uuid').value = u ? u.uuid : '';
  document.getElementById('f-limitGb').value = u && u.limit_gb != null ? u.limit_gb : '';
  document.getElementById('f-expiryDays').value = u && u.expiry_days != null ? u.expiry_days : '';
  document.getElementById('f-limitReq').value = u && u.limit_req != null ? u.limit_req : '';
  document.getElementById('f-ipLimit').value = u && u.ip_limit != null ? u.ip_limit : '';
  document.getElementById('f-connectionType').value = u ? (u.connection_type || 'vless+trojan') : 'vless+trojan';
  document.getElementById('f-port').value = u ? String(u.port || 443) : '443';
  document.getElementById('f-path').value = u ? (u.path || '/') : '/';
  document.getElementById('f-fingerprint').value = u ? (u.fingerprint || 'chrome') : 'chrome';
  document.getElementById('f-sniHost').value = u ? (u.sni_host || '') : '';
  document.getElementById('f-fragment').value = u ? (u.fragment || '') : '';
  document.getElementById('f-userProxyIata').value = u ? (u.user_proxy_iata || '') : '';
  var socksVal = u ? (u.user_socks5 || '') : '';
  document.getElementById('f-userSocks5').value = socksVal;
  var useProxy = document.getElementById('f-useProxy');
  useProxy.checked = !!socksVal;
  document.getElementById('f-proxyPicker').style.display = socksVal ? '' : 'none';
  document.getElementById('f-finder-results').innerHTML = '';
  document.getElementById('f-finder-progress').textContent = '';
  document.getElementById('f-routeDirect').value = u ? parseList(u.route_direct) : '';
  document.getElementById('f-routeBlock').value = u ? parseList(u.route_block) : '';
  document.getElementById('f-dohUrl').value = u ? (u.doh_url || '') : '';
  document.getElementById('f-blockPorn').checked = !!(u && u.block_porn);
  document.getElementById('f-blockAds').checked = !!(u && u.block_ads);
  document.getElementById('f-blockMalware').checked = !!(u && u.block_malware);
  document.getElementById('f-isActive').checked = u ? !!u.is_active : true;
  document.getElementById('f-note').value = u ? (u.note || '') : '';
  openModal('modal-user');
}
function parseList(s){ if (!s) return ''; try { return (JSON.parse(s)||[]).join(', '); } catch(e){ return s; } }
function csvList(s){ var v = (s||'').split(',').map(function(x){return x.trim().split(String.fromCharCode(10)).join('').trim();}).filter(Boolean); return v.length ? JSON.stringify(v) : null; }

document.getElementById('mu-save').addEventListener('click', async function(){
  var body = {
    username: document.getElementById('f-username').value.trim(),
    uuid: document.getElementById('f-uuid').value.trim() || undefined,
    limitGb: parseFloat(document.getElementById('f-limitGb').value) || null,
    expiryDays: parseInt(document.getElementById('f-expiryDays').value) || null,
    limitReq: parseInt(document.getElementById('f-limitReq').value) || null,
    ipLimit: parseInt(document.getElementById('f-ipLimit').value) || null,
    connectionType: document.getElementById('f-connectionType').value,
    port: parseInt(document.getElementById('f-port').value) || 443,
    path: document.getElementById('f-path').value || '/',
    fingerprint: document.getElementById('f-fingerprint').value,
    sniHost: document.getElementById('f-sniHost').value.trim() || null,
    fragment: document.getElementById('f-fragment').value.trim() || null,
    userProxyIata: document.getElementById('f-userProxyIata').value.trim().toUpperCase() || null,
    userSocks5: document.getElementById('f-useProxy').checked ? (document.getElementById('f-userSocks5').value.trim() || null) : null,
    routeDirect: csvList(document.getElementById('f-routeDirect').value),
    routeBlock: csvList(document.getElementById('f-routeBlock').value),
    dohUrl: document.getElementById('f-dohUrl').value.trim() || null,
    blockPorn: document.getElementById('f-blockPorn').checked,
    blockAds: document.getElementById('f-blockAds').checked,
    blockMalware: document.getElementById('f-blockMalware').checked,
    isActive: document.getElementById('f-isActive').checked,
    note: document.getElementById('f-note').value || null
  };
  if (!body.username) return toast('نام کاربری لازم است', 'error');
  var btn = this; btn.disabled = true; btn.textContent = 'در حال ذخیره...';
  try {
    if (state.editing) {
      await API.patch('/api/users/' + encodeURIComponent(state.editing), body);
      toast('کاربر ویرایش شد');
    } else {
      await API.post('/api/users', body);
      toast('کاربر ساخته شد');
    }
    closeModal('modal-user');
    loadUsers(); loadStats();
  } catch(e){ toast(e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'ذخیره کاربر';
});

/* ---------- in-modal proxy finder ---------- */
var _modalFinderCandidates = [];
document.getElementById('f-useProxy').addEventListener('change', function(){
  document.getElementById('f-proxyPicker').style.display = this.checked ? '' : 'none';
  if (!this.checked) document.getElementById('f-userSocks5').value = '';
});
document.getElementById('f-proxyFinder').addEventListener('click', function(){
  var cb = document.getElementById('f-useProxy');
  cb.checked = true;
  cb.dispatchEvent(new Event('change'));
});
function setModalProxy(uri){
  document.getElementById('f-userSocks5').value = uri;
  toast('پروکسی انتخاب شد: ' + uri.slice(0, 40) + (uri.length > 40 ? '…' : ''));
  // highlight selected row
  document.querySelectorAll('[data-modal-uri]').forEach(function(el){
    el.style.background = el.dataset.modalUri === uri ? 'rgba(16,185,129,.12)' : '';
  });
}
async function modalFinderScan(){
  var scheme = document.getElementById('f-finder-scheme').value;
  var btn = document.getElementById('f-finder-scan');
  var prog = document.getElementById('f-finder-progress');
  var out = document.getElementById('f-finder-results');
  btn.disabled = true; btn.textContent = '🔍 جستجو...';
  prog.textContent = 'دانلود لیست‌ها...';
  try {
    var body = { maxTotal: 60, maxPerSource: 15 };
    if (scheme === 'socks5') body.schemes = ['socks5'];
    if (scheme === 'http') body.schemes = ['http'];
    var r = await API.post('/api/scanner/finder/run', body);
    prog.textContent = r.totalCandidates + ' کاندید — در حال پینگ از مرورگر شما...';
    _modalFinderCandidates = r.candidates || [];
    // Render with probing state
    renderModalFinderRows(_modalFinderCandidates.map(function(c){return {uri:c.uri,source:c.source,scheme:c.scheme,state:'probing'};}));
    var hosts = _modalFinderCandidates.map(function(c){ try { return new URL(c.uri).hostname; } catch(e){ return ''; } }).filter(Boolean);
    var geo = {};
    try { var g = await API.post('/api/proxies/geoip',{hosts:hosts}); geo = g.results||{}; } catch(e){}
    var items = _modalFinderCandidates.map(function(c){
      var cc = '';
      try { var h = new URL(c.uri).hostname; if (geo[h]&&geo[h].countryCode) cc = geo[h].countryCode; } catch(e){}
      return { uri: c.uri, source: c.source, scheme: c.scheme, country: cc, state: 'probing' };
    });
    var done = 0;
    await browserPingProxies(items, 8, 3000, function(_d, res){
      done++;
      var item = items.find(function(x){return x.uri === res.uri;});
      if (item) { item.state = res.ok ? 'ok' : 'dead'; item.latencyMs = res.latencyMs; }
      if (done % 3 === 0 || done === items.length) renderModalFinderRows(items);
      prog.textContent = done + '/' + items.length + ' تست شد';
    });
    var ok = items.filter(function(x){return x.state==='ok';}).sort(function(a,b){return (a.latencyMs||9999)-(b.latencyMs||9999);});
    prog.innerHTML = '<span class="text-emerald-400">✅ ' + ok.length + ' سالم</span> از ' + items.length;
    btn.disabled = false; btn.textContent = '🔍 جستجو و پینگ';
  } catch(e){
    prog.innerHTML = '<span class="text-rose-400">خطا: ' + esc(e.message) + '</span>';
    btn.disabled = false; btn.textContent = '🔍 جستجو و پینگ';
  }
}
function renderModalFinderRows(items){
  var out = document.getElementById('f-finder-results');
  if (!items.length) { out.innerHTML = '<div class="empty" style="padding:20px">چیزی نیست</div>'; return; }
  var html = '<table style="width:100%"><tbody>';
  items.forEach(function(it, i){
    var flag = it.country ? '<span class="flag">' + flagEmoji(it.country) + '</span>' : '';
    var p;
    if (it.state === 'probing') p = pingCell(null,'probing');
    else if (it.state === 'dead') p = pingCell(null,'dead');
    else p = pingCell(it.latencyMs, null);
    var schemeChip = it.scheme === 'socks5' ? '<span class="chip chip-violet">S5</span>' : '<span class="chip chip-cyan">H</span>';
    var ccChip = it.country ? '<span class="chip chip-slate">' + flag + esc(it.country) + '</span>' : '';
    html += '<tr data-modal-uri="' + esc(it.uri) + '" style="opacity:' + (it.state==='dead'?0.45:1) + '">' +
      '<td style="padding:8px 10px"><div class="mono text-[11px]" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.uri) + '">' + esc(it.uri) + '</div>' +
      '<div class="text-[10px] text-slate-500">' + esc(it.source||'') + '</div></td>' +
      '<td style="padding:8px 6px;white-space:nowrap">' + schemeChip + ccChip + '</td>' +
      '<td style="padding:8px 10px;white-space:nowrap">' + p + '</td>' +
      '<td style="padding:8px 10px"><button type="button" class="btn btn-emerald" style="padding:5px 10px;font-size:11px" data-set-uri="' + esc(it.uri) + '"' + (it.state==='dead'?' disabled':'') + '>ست</button></td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  out.innerHTML = html;
  out.querySelectorAll('[data-set-uri]').forEach(function(b){
    b.addEventListener('click', function(){ setModalProxy(b.dataset.setUri); });
  });
}
document.getElementById('f-finder-scan').addEventListener('click', modalFinderScan);
document.getElementById('f-finder-pool').addEventListener('click', async function(){
  var btn = this; btn.disabled = true;
  try {
    var r = await API.get('/api/proxies?pageSize=80');
    var items = (r.proxies||[]).filter(function(p){return p.is_active;}).map(function(p){
      return { uri: p.uri, source: 'pool', scheme: p.uri.indexOf('socks')===0?'socks5':'http', country: (p.country||'').toUpperCase(), state:'ok', latencyMs: p.latency_ms };
    });
    renderModalFinderRows(items);
    document.getElementById('f-finder-progress').textContent = items.length + ' پروکسی از استخر';
  } catch(e){ toast(e.message,'error'); }
  btn.disabled = false;
});

/* ---------- sub modal ---------- */
function openSubModal(username){
  var origin = location.origin;
  var subUrl = origin + '/sub/' + encodeURIComponent(username);
  document.getElementById('sub-url').textContent = subUrl;
  var qrBox = document.getElementById('sub-qr');
  qrBox.innerHTML = '';
  try {
    var qr = qrcode(0, 'M');
    qr.addData(subUrl); qr.make();
    var img = qr.createDataURL(6, 8);
    qrBox.innerHTML = '<div class="qr-box"><img src="' + img + '" alt="QR"/></div>';
  } catch(e){
    qrBox.innerHTML = '<div class="text-xs text-slate-400">QR در دسترس نیست</div>';
  }
  var formats = [
    { label: 'Base64 (عمومی)', url: subUrl },
    { label: 'Clash', url: subUrl + '?format=clash' },
    { label: 'sing-box', url: subUrl + '?format=singbox' },
    { label: 'Xray Fragment (ایران)', url: subUrl + '?format=xray' },
    { label: 'Raw (v2rayNG)', url: subUrl + '?format=raw' }
  ];
  document.getElementById('sub-formats').innerHTML = formats.map(function(f){
    return '<a href="' + f.url + '" target="_blank" class="btn btn-ghost" style="font-size:12px">' + f.label + '</a>';
  }).join('');
  API.get('/sub/' + encodeURIComponent(username) + '?format=raw').then(function(text){
    document.getElementById('sub-raw').textContent = text;
  }).catch(function(){});
  openModal('modal-sub');
}
document.getElementById('sub-copy').addEventListener('click', function(){
  var t = document.getElementById('sub-url').textContent;
  navigator.clipboard.writeText(t).then(function(){ toast('کپی شد'); }).catch(function(){ toast('کپی ناموفق', 'error'); });
});

/* ---------- proxies ---------- */
var _proxiesCache = [];
async function loadProxies(){
  try {
    var r = await API.get('/api/proxies?pageSize=200');
    _proxiesCache = r.proxies || [];
    document.getElementById('proxy-count').textContent = fmtNum(r.total) + ' پروکسی';
    if (!_proxiesCache.length) {
      document.getElementById('proxies-table').innerHTML = '<div class="empty">هنوز پروکسی‌ای اضافه نشده</div>';
      return;
    }
    renderProxiesTable();
  } catch(e){ document.getElementById('proxies-table').innerHTML = '<div class="empty text-rose-400">' + esc(e.message) + '</div>'; }
}
function renderProxiesTable(probeState){
  // probeState: map uri -> 'probing'|'dead'|{latencyMs}
  probeState = probeState || {};
  var ps = _proxiesCache.slice().sort(function(a,b){
    // Sort alive (with latency) first, then by latency ascending, dead last
    var la = a.latency_ms || 99999, lb = b.latency_ms || 99999;
    if (a.is_active !== b.is_active) return b.is_active - a.is_active;
    return la - lb;
  });
  var html = '<table><thead><tr><th style="width:32px"></th><th>پروکسی</th><th>کشور</th><th>پینگ</th><th>سلامت</th><th></th></tr></thead><tbody>';
  ps.forEach(function(p, idx){
    var cc = (p.country||'').toUpperCase();
    var flag = cc && cc !== 'XX' ? '<span class="flag">' + flagEmoji(cc) + '</span>' : '';
    var host; try { host = new URL(p.uri).hostname; } catch(e){ host = p.uri; }
    var st = probeState[p.uri];
    var pingHtml;
    if (st === 'probing') pingHtml = pingCell(null, 'probing');
    else if (st === 'dead') pingHtml = pingCell(null, 'dead');
    else if (st && st.latencyMs != null) pingHtml = pingCell(st.latencyMs, null);
    else pingHtml = pingCell(p.latency_ms, null);
    var rate = p.success_rate == null ? 100 : p.success_rate;
    var rateChip = rate >= 80 ? 'chip-green' : rate >= 40 ? 'chip-amber' : 'chip-red';
    var checked = p.last_checked ? new Date(p.last_checked*1000).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}) : '—';
    html += '<tr class="row-in" style="animation-delay:' + Math.min(idx*10, 400) + 'ms">' +
      '<td><button class="btn btn-icon btn-ghost" data-toggle="' + p.id + '" title="فعال/غیرفعال" style="width:28px;height:28px;padding:0">' +
        (p.is_active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
                    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>') +
      '</button></td>' +
      '<td><div class="mono text-[11px]" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.uri) + '">' + esc(p.uri) + '</div>' +
          '<div class="text-[10px] text-slate-500 mono">' + esc(host) + ' · ' + esc(checked) + '</div></td>' +
      '<td>' + (cc ? '<span class="chip chip-cyan">' + flag + esc(cc) + '</span>' : '<span class="chip chip-slate">—</span>') + '</td>' +
      '<td>' + pingHtml + '</td>' +
      '<td><span class="chip ' + rateChip + '">' + rate + '%</span></td>' +
      '<td><button class="btn btn-ghost btn-icon" data-pid="' + p.id + '" title="حذف" style="width:28px;height:28px;padding:0;color:#fb7185"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('proxies-table').innerHTML = html;
  document.querySelectorAll('[data-pid]').forEach(function(b){
    b.addEventListener('click', function(){
      API.del('/api/proxies/' + b.dataset.pid).then(function(){ toast('حذف شد'); loadProxies(); }).catch(function(e){ toast(e.message,'error'); });
    });
  });
  document.querySelectorAll('[data-toggle]').forEach(function(b){
    b.addEventListener('click', function(){
      API.post('/api/proxies/' + b.dataset.toggle + '/toggle', {}).then(function(){ loadProxies(); }).catch(function(e){ toast(e.message,'error'); });
    });
  });
}
async function browserPingAllProxies(){
  if (!_proxiesCache.length) return toast('پروکسی‌ای برای تست نیست', 'error');
  var btn = document.getElementById('proxy-browser-ping');
  btn.disabled = true; btn.textContent = '📡 در حال پینگ...';
  var probeState = {};
  _proxiesCache.forEach(function(p){ probeState[p.uri] = 'probing'; });
  renderProxiesTable(probeState);
  var results = [];
  var hostList = _proxiesCache.map(function(p){
    try { return new URL(p.uri).hostname; } catch(e){ return ''; }
  }).filter(Boolean);
  var geo = {};
  try {
    var g = await API.post('/api/proxies/geoip', { hosts: hostList });
    geo = g.results || {};
  } catch(e){}
  var t0 = Date.now();
  await browserPingProxies(_proxiesCache, 8, 3500, function(done, res){
    probeState[res.uri] = res.ok ? { latencyMs: res.latencyMs } : 'dead';
    if (done % 5 === 0 || done === _proxiesCache.length) renderProxiesTable(probeState);
    var prog = document.getElementById('proxy-count');
    if (prog) prog.textContent = 'پینگ... ' + done + '/' + _proxiesCache.length;
    results.push(res);
  });
  // Save pings + country back to server
  var ccByUri = {};
  _proxiesCache.forEach(function(p){
    try {
      var h = new URL(p.uri).hostname;
      var g = geo[h];
      if (g && g.countryCode) ccByUri[p.uri] = g.countryCode;
    } catch(e){}
  });
  try {
    await API.post('/api/proxies/bulk-ping', {
      results: results.map(function(r){
        return { uri: r.uri, ok: r.ok, latencyMs: r.ok ? r.latencyMs : null, country: ccByUri[r.uri] || null };
      })
    });
  } catch(e){ console.warn('bulk-ping save failed', e); }
  toast('پینگ تمام شد در ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  btn.disabled = false; btn.textContent = '📡 پینگ از مرورگر';
  loadProxies();
}
document.getElementById('proxy-import').addEventListener('click', async function(){
  var url = document.getElementById('proxy-url').value.trim();
  var cc = document.getElementById('proxy-cc').value.trim().toUpperCase();
  if (!url) return toast('URL را وارد کن', 'error');
  var b = this; b.disabled = true; b.textContent = 'در حال ایمپورت...';
  try {
    var r = await API.post('/api/proxies/import', { url: url, country: cc });
    toast(r.imported + ' پروکسی ایمپورت شد');
    loadProxies();
  } catch(e){ toast(e.message, 'error'); }
  b.disabled = false; b.textContent = 'ایمپورت';
});
document.getElementById('proxy-browser-ping').addEventListener('click', browserPingAllProxies);
document.getElementById('proxy-reload').addEventListener('click', function(){
  API.post('/api/proxies/pool/reload', {}).then(function(r){ toast(r.active + ' پروکسی همگام‌سازی شد'); }).catch(function(e){ toast(e.message,'error'); });
});

/* ---------- scanner ---------- */
var _scanInit = false;
function initScanner(){
  if (_scanInit) return;
  _scanInit = true;
  document.querySelectorAll('[data-scantab]').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('[data-scantab]').forEach(function(x){ x.classList.toggle('active', x === t); });
      var which = t.dataset.scantab;
      document.querySelectorAll('[data-scanpane]').forEach(function(p){
        p.style.display = p.dataset.scanpane === which ? '' : 'none';
      });
    });
  });
  function loadPresetIps(cb){
    API.get('/api/scanner/preset').then(function(r){
      document.getElementById('ipscan-list').value = r.ips.join(String.fromCharCode(10));
      if (cb) cb(r.ips);
    });
  }
  document.getElementById('ipscan-preset').addEventListener('click', function(){ loadPresetIps(); });
  // Auto-load preset on first visit if empty
  if (!document.getElementById('ipscan-list').value) loadPresetIps();
  document.getElementById('ipscan-run').addEventListener('click', runIpScan);
  document.getElementById('ipscan-save').addEventListener('click', saveCleanIps);
  document.getElementById('pscan-run').addEventListener('click', runProxyScan);
  document.getElementById('pscan-import').addEventListener('click', importAliveProxies);
  document.getElementById('finder-run').addEventListener('click', runFinder);
  document.getElementById('finder-import').addEventListener('click', importFoundProxies);
  document.getElementById('finder-ping').addEventListener('click', pingFoundProxies);
}
var _finderCandidates = [];
var _finderState = {};   // uri -> {state, latencyMs, country}
async function runFinder(){
  var scheme = document.getElementById('finder-scheme').value;
  var max = parseInt(document.getElementById('finder-max').value,10) || 120;
  var btn = document.getElementById('finder-run');
  btn.disabled = true; btn.textContent = '🔍 در حال جستجو...';
  var prog = document.getElementById('finder-progress');
  prog.textContent = 'در حال دانلود لیست‌های عمومی...';
  var t0 = Date.now();
  try {
    var body = { maxTotal: max };
    if (scheme === 'socks5') body.schemes = ['socks5'];
    if (scheme === 'http') body.schemes = ['http'];
    var r = await API.post('/api/scanner/finder/run', body);
    var elapsed = ((Date.now()-t0)/1000).toFixed(1);
    _finderCandidates = r.candidates || [];
    _finderState = {};
    _finderCandidates.forEach(function(c){ _finderState[c.uri] = { state:'idle' }; });
    var lines = ['✅ ' + r.totalCandidates + ' کاندید از ' + r.sourcesFetched + ' منبع در ' + elapsed + 's — برای دیدن پینگ روی «پینگ از مرورگر» بزن.'];
    if (r.sourcesFailed && r.sourcesFailed.length) lines.push('⚠️ ' + r.sourcesFailed.length + ' منبع ناموفق');
    prog.innerHTML = lines.join('<br>');
    document.getElementById('finder-count').textContent = r.totalCandidates + ' کاندید';
    renderFinderRows();
    document.getElementById('finder-import').disabled = _finderCandidates.length === 0;
    document.getElementById('finder-ping').disabled = _finderCandidates.length === 0;
    toast(_finderCandidates.length + ' پروکسی پیدا شد');
  } catch(e){ toast(e.message, 'error'); prog.textContent = 'خطا: ' + e.message; }
  btn.disabled = false; btn.textContent = '🔍 جستجو';
}
function renderFinderRows(){
  var list = _finderCandidates.slice(0, 200);
  var rows = list.map(function(p, i){
    var st = _finderState[p.uri] || { state:'idle' };
    var flag = st.country ? '<span class="flag">' + flagEmoji(st.country) + '</span>' : '';
    var pingHtml;
    if (st.state === 'probing') pingHtml = pingCell(null,'probing');
    else if (st.state === 'dead') pingHtml = pingCell(null,'dead');
    else if (st.state === 'ok') pingHtml = pingCell(st.latencyMs, null);
    else pingHtml = pingCell(null, null);
    var schemeChip = p.scheme === 'socks5' ? 'chip-violet' : 'chip-cyan';
    return '<tr class="row-in" style="animation-delay:' + Math.min(i*8,400) + 'ms;opacity:' + (st.state==='dead'?0.45:1) + '">' +
      '<td class="text-slate-500 text-xs w-8">' + (i+1) + '</td>' +
      '<td class="mono text-[11px]" dir="ltr" style="text-align:left;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.uri) + '">' + esc(p.uri) + '</td>' +
      '<td><span class="chip ' + schemeChip + '">' + esc(p.scheme.toUpperCase()) + '</span>' +
          (st.country ? ' <span class="chip chip-slate">' + flag + esc(st.country) + '</span>' : '') + '</td>' +
      '<td style="white-space:nowrap">' + pingHtml + '</td>' +
      '<td><button class="btn btn-emerald" style="padding:5px 10px;font-size:11px" data-finder-set="' + esc(p.uri) + '"' + (st.state!=='ok'?' disabled':'') + '>ست برای کاربر</button></td>' +
    '</tr>';
  }).join('');
  document.getElementById('finder-results').innerHTML =
    '<table><thead><tr><th>#</th><th>پروکسی</th><th>نوع/کشور</th><th>پینگ</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  document.querySelectorAll('[data-finder-set]').forEach(function(b){
    b.addEventListener('click', function(){
      var uri = b.dataset.finderSet;
      // Open new-user modal pre-filled with this proxy
      openUserModal(null);
      document.getElementById('f-useProxy').checked = true;
      document.getElementById('f-useProxy').dispatchEvent(new Event('change'));
      document.getElementById('f-userSocks5').value = uri;
      toast('پروکسی در فرم کاربر جدید ست شد');
    });
  });
}
async function pingFoundProxies(){
  if (!_finderCandidates.length) return;
  var btn = document.getElementById('finder-ping');
  btn.disabled = true; btn.textContent = '📡 در حال پینگ...';
  var prog = document.getElementById('finder-progress');
  // GeoIP
  var hosts = _finderCandidates.map(function(c){ try { return new URL(c.uri).hostname; } catch(e){ return ''; } }).filter(Boolean);
  var geo = {};
  try { var g = await API.post('/api/proxies/geoip', {hosts:hosts.slice(0,100)}); geo = g.results||{}; } catch(e){}
  _finderCandidates.forEach(function(c){
    _finderState[c.uri] = { state:'probing' };
    try { var h = new URL(c.uri).hostname; if (geo[h]&&geo[h].countryCode) _finderState[c.uri].country = geo[h].countryCode; } catch(e){}
  });
  renderFinderRows();
  var done = 0;
  await browserPingProxies(_finderCandidates, 10, 3000, function(_d, res){
    done++;
    _finderState[res.uri] = { state: res.ok ? 'ok' : 'dead', latencyMs: res.ok ? res.latencyMs : null,
      country: (_finderState[res.uri]||{}).country };
    if (done % 6 === 0 || done === _finderCandidates.length) renderFinderRows();
    prog.textContent = 'پینگ از مرورگر: ' + done + '/' + _finderCandidates.length;
  });
  var ok = _finderCandidates.filter(function(c){ return _finderState[c.uri] && _finderState[c.uri].state === 'ok'; });
  prog.innerHTML = '<span class="text-emerald-400">✅ ' + ok.length + ' سالم</span> از ' + _finderCandidates.length + ' — می‌تونی با دکمه «ست برای کاربر» مستقیم به یک کاربر اختصاص بدی.';
  btn.disabled = false; btn.textContent = '📡 پینگ از مرورگر';
}
async function importFoundProxies(){
  if (!_finderCandidates.length) return;
  var list = _finderCandidates.slice(0,30).map(function(x){return x.uri;});
  try {
    var r = await API.post('/api/scanner/finder/import', { uris: list });
    toast(r.imported + ' پروکسی به استخر اضافه شد');
    loadProxies();
  } catch(e){ toast(e.message, 'error'); }
}
var _scanAliveIps = [];
async function runIpScan(){
  var raw = document.getElementById('ipscan-list').value;
  var ips = raw.split(',').join(String.fromCharCode(10)).split(String.fromCharCode(10)).map(function(x){return x.trim();}).filter(Boolean);
  var port = parseInt(document.getElementById('ipscan-port').value, 10) || 443;
  var mode = document.getElementById('ipscan-mode').value;
  if (!ips.length) return toast('لیست IP خالی است', 'error');
  var btn = document.getElementById('ipscan-run');
  btn.disabled = true; btn.textContent = 'در حال اسکن...';
  var prog = document.getElementById('ipscan-progress');
  var t0 = Date.now();
  try {
    var results;
    if (mode === 'browser') {
      prog.textContent = '🌐 اسکن از مرورگر شما (' + ips.length + ' IP روی پورت ' + port + ')...';
      results = await browserScanIps(ips, port, 4000, 12, function(done){
        prog.textContent = '🌐 اسکن از مرورگر شما... ' + done + '/' + ips.length;
      });
    } else {
      prog.textContent = '☁️ اسکن از سرور (' + ips.length + ' IP روی پورت ' + port + ')...';
      var r = await API.post('/api/scanner/ips', { ips: ips, port: port, concurrency: 20, timeoutMs: 4000 });
      results = r.results;
    }
    var elapsed = ((Date.now()-t0)/1000).toFixed(1);
    var alive = results.filter(function(x){return x.ok;});
    var sorted = results.slice().sort(function(a,b){
      if (a.ok && b.ok) return a.latencyMs - b.latencyMs;
      return a.ok ? -1 : 1;
    });
    document.getElementById('ipscan-count').textContent = alive.length + ' سالم از ' + results.length + ' در ' + elapsed + 's';
    prog.textContent = '✅ ' + alive.length + ' پاسخ دادند، ' + (results.length-alive.length) + ' خطا داشتند.' + (mode==='browser' ? ' (نتایج از اینترنت شما)' : ' (نتایج از سرور کلودفلر)');
    _scanAliveIps = sorted.filter(function(x){return x.ok;}).slice(0, 30).map(function(x){return {target:x.target, latencyMs:x.latencyMs};});
    var rows = sorted.map(function(x, i){
      var ms;
      if (x.ok) {
        var cls = x.latencyMs < 120 ? 'ping-good' : x.latencyMs < 300 ? 'ping-mid' : 'ping-bad';
        ms = '<span class="ping-cell ' + cls + '"><span class="ping-dot"></span>' + x.latencyMs + 'ms</span>';
      } else {
        ms = '<span class="ping-cell ping-bad"><span class="ping-dot"></span>' + esc(x.error||'fail') + '</span>';
      }
      var medal = i < 3 && x.ok ? [' 🥇',' 🥈',' 🥉'][i] : '';
      return '<tr class="row-in" style="animation-delay:' + Math.min(i*15, 500) + 'ms"><td class="mono" dir="ltr" style="text-align:left">' + esc(x.target) + medal + '</td><td>' + ms + '</td></tr>';
    }).join('');
    document.getElementById('ipscan-results').innerHTML =
      '<table><thead><tr><th>IP</th><th>تأخیر</th></tr></thead><tbody>' + rows + '</tbody></table>';
    document.getElementById('ipscan-save').disabled = alive.length === 0;
    if (alive.length) toast(alive.length + ' IP سالم پیدا شد');
  } catch(e){ toast(e.message, 'error'); prog.textContent = 'خطا: ' + e.message; }
  btn.disabled = false; btn.textContent = 'شروع اسکن';
}

// Browser-side scan: loads a tiny resource from each edge IP directly.
// The TLS cert won't match a raw IP, so the request rejects on cert
// grounds — but that rejection fires AFTER the TCP+TLS round trip, so
// elapsed time still measures real RTT. A timeout means dead/blocked.
function browserScanIps(ips, port, timeoutMs, concurrency, onProgress){
  var isTls = [443,2053,2083,2087,2096,8443].indexOf(port) >= 0;
  var proto = isTls ? 'https' : 'http';
  var results = new Array(ips.length);
  var cursor = 0;
  var active = 0;
  var done = 0;
  return new Promise(function(resolve){
    function pump(){
      while (active < concurrency && cursor < ips.length){
        var i = cursor++;
        active++;
        probe(i);
      }
      if (done === ips.length) resolve(results);
    }
    function finish(i, rec){
      if (results[i]) return;  // already finalized
      results[i] = rec;
      done++;
      active--;
      if (onProgress) onProgress(done);
      pump();
    }
    function probe(i){
      var addr = ips[i];
      var start = Date.now();
      var img = new Image();
      var timer = setTimeout(function(){
        finish(i, { target:addr, ok:false, latencyMs:-1, error:'timeout' });
      }, timeoutMs);
      img.onload = function(){
        clearTimeout(timer);
        finish(i, { target:addr, ok:true, latencyMs: Date.now()-start });
      };
      img.onerror = function(){
        clearTimeout(timer);
        // Any onerror that beats the timeout means the edge responded.
        finish(i, { target:addr, ok:true, latencyMs: Date.now()-start });
      };
      img.src = proto + '://' + addr + ':' + port + '/cdn-cgi/trace?_=' + Math.random() + '&r=' + start;
    }
    pump();
  });
}
async function saveCleanIps(){
  if (!_scanAliveIps.length) return;
  var ips = _scanAliveIps.slice(0, 20).map(function(x){return x.target;});
  try {
    await API.put('/api/scanner/clean', { ips: ips });
    toast(ips.length + ' IP به‌عنوان IP تمیز پیش‌فرض ذخیره شد');
  } catch(e){ toast(e.message, 'error'); }
}
var _scanAliveProxies = [];
async function runProxyScan(){
  var raw = document.getElementById('pscan-list').value;
  var proxies = raw.split('\\n').map(function(x){return x.trim();}).filter(Boolean);
  var target = document.getElementById('pscan-test').value.trim() || 'example.com:443';
  var parts = target.split(':');
  if (!proxies.length) return toast('لیست پروکسی خالی است', 'error');
  var btn = document.getElementById('pscan-run');
  btn.disabled = true; btn.textContent = 'در حال اسکن...';
  var prog = document.getElementById('pscan-progress');
  prog.textContent = 'تست ' + proxies.length + ' پروکسی...';
  var t0 = Date.now();
  try {
    var r = await API.post('/api/scanner/proxies', {
      proxies: proxies, testHost: parts[0], testPort: parseInt(parts[1],10)||443
    });
    var elapsed = ((Date.now()-t0)/1000).toFixed(1);
    document.getElementById('pscan-count').textContent = r.alive + ' سالم از ' + r.total + ' در ' + elapsed + 's';
    prog.textContent = '✅ ' + r.alive + ' سالم، ' + r.dead + ' ناموفق.';
    _scanAliveProxies = r.top;
    var sorted = r.results.slice().sort(function(a,b){
      if (a.ok && b.ok) return a.latencyMs - b.latencyMs;
      return a.ok ? -1 : 1;
    });
    var rows = sorted.map(function(x){
      var ms = x.ok ? '<span class="text-emerald-400 font-bold mono">' + x.latencyMs + 'ms</span>'
                    : '<span class="text-rose-400 text-xs">' + esc(x.error||'fail') + '</span>';
      return '<tr><td class="mono text-[11px]" dir="ltr" style="text-align:left;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.target) + '</td><td>' + ms + '</td></tr>';
    }).join('');
    document.getElementById('pscan-results').innerHTML =
      '<table><thead><tr><th>پروکسی</th><th>تأخیر</th></tr></thead><tbody>' + rows + '</tbody></table>';
    document.getElementById('pscan-import').disabled = r.alive === 0;
  } catch(e){ toast(e.message, 'error'); prog.textContent = 'خطا: ' + e.message; }
  btn.disabled = false; btn.textContent = 'شروع اسکن';
}
async function importAliveProxies(){
  if (!_scanAliveProxies.length) return;
  var list = _scanAliveProxies.map(function(x){return x.target;});
  try {
    var r = await API.post('/api/proxies/import', { list: list, source: 'scanner' });
    toast(r.imported + ' پروکسی به استخر اضافه شد');
    loadProxies();
  } catch(e){ toast(e.message, 'error'); }
}

/* ---------- modal helpers ---------- */
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close-modal]').forEach(function(b){
  b.addEventListener('click', function(){
    b.closest('.modal-backdrop').classList.remove('open');
  });
});
document.querySelectorAll('.modal-backdrop').forEach(function(m){
  m.addEventListener('click', function(e){ if (e.target === m) m.classList.remove('open'); });
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(function(m){ m.classList.remove('open'); });
});

/* ---------- confirm dialog ---------- */
var _cfCb = null;
function confirmDial(title, msg, cb){
  document.getElementById('cf-title').textContent = title;
  document.getElementById('cf-msg').textContent = msg;
  _cfCb = cb;
  openModal('modal-confirm');
}
document.getElementById('cf-ok').addEventListener('click', function(){
  closeModal('modal-confirm');
  if (_cfCb) { var f = _cfCb; _cfCb = null; f(); }
});

/* ---------- start ---------- */

/* ---------- in-panel self-update ---------- */
function flagEmoji(cc){
  if (!cc || cc.length !== 2) return '';
  var A = 0x1F1E6, Z = 0x1F1FF;
  var base = 'A'.charCodeAt(0);
  function ch(c){ return String.fromCodePoint(A + (c.toUpperCase().charCodeAt(0) - base)); }
  try { return ch(cc[0]) + ch(cc[1]); } catch(e){ return ''; }
}
function pingClass(ms){
  if (ms == null) return 'ping-idle';
  if (ms < 200) return 'ping-good';
  if (ms < 500) return 'ping-mid';
  return 'ping-bad';
}
function pingCell(ms, state){
  if (state === 'probing') return '<span class="ping-cell ping-probing"><span class="ping-dot"></span>در حال تست…</span>';
  if (state === 'dead') return '<span class="ping-cell ping-bad"><span class="ping-dot"></span>رد شد</span>';
  if (ms == null || ms < 0) return '<span class="ping-cell ping-idle"><span class="ping-dot"></span>—</span>';
  return '<span class="ping-cell ' + pingClass(ms) + '"><span class="ping-dot"></span>' + ms + 'ms</span>';
}

/* ---------- browser-side proxy TCP ping ----------
   Mirrors browserScanIps: tries to load a 1px image from the proxy
   host:port. Any fast onerror means the TCP stack reached the host
   (port open or rejected — both mean the host is alive); a timeout
   means filtered/dead. Returns RTT in ms. Browsers cannot speak SOCKS,
   so this is a reachability + RTT test only — it does NOT verify the
   proxy can relay traffic.
*/
function browserPingProxy(uri, timeoutMs){
  return new Promise(function(resolve){
    var u;
    try { u = new URL(uri); } catch(e){ return resolve({ok:false, latencyMs:-1, error:'bad-uri'}); }
    var host = u.hostname;
    var port = parseInt(u.port || (u.protocol === 'http:' ? '80' : '1080'), 10);
    // Always probe over HTTPS to avoid mixed-content blocking from the
    // HTTPS panel. Non-TLS ports (80, 1080, 8080...) will reject the TLS
    // handshake, but that rejection still arrives after a real TCP round
    // trip — which is the RTT we want.
    var start = Date.now();
    var img = new Image();
    var finished = false;
    var timer = setTimeout(function(){
      if (finished) return; finished = true;
      resolve({ok:false, latencyMs:-1, error:'timeout'});
    }, timeoutMs);
  img.onload = function(){ if (finished) return; finished = true; clearTimeout(timer); resolve({ok:true, latencyMs: Date.now()-start}); };
  img.onerror = function(){ if (finished) return; finished = true; clearTimeout(timer); resolve({ok:true, latencyMs: Date.now()-start}); };
  try {
    img.src = 'https://' + host + ':' + port + '/favicon.ico?_=' + Math.random();
  } catch(e){
    if (finished) return; finished = true; clearTimeout(timer);
    resolve({ok:true, latencyMs: Date.now()-start});
  }
  });
}
async function browserPingProxies(items, concurrency, timeoutMs, onProgress){
  var results = new Array(items.length);
  var cursor = 0, active = 0, done = 0;
  return new Promise(function(resolve){
    function pump(){
      while (active < concurrency && cursor < items.length){
        var i = cursor++; active++; probe(i);
      }
      if (done === items.length) resolve(results);
    }
    function probe(i){
      var item = items[i];
      browserPingProxy(item.uri || item, timeoutMs).then(function(r){
        results[i] = { uri: item.uri || item, ok: r.ok, latencyMs: r.latencyMs, error: r.error };
        done++; active--;
        if (onProgress) onProgress(done, results[i]);
        pump();
      });
    }
    pump();
  });
}

boot();
// Check for update a few seconds after the panel loads (non-blocking).
</script>
</body></html>`;
}

export function notFoundHtml(): string {
  return '<!doctype html><html><head><title>404</title><style>body{font-family:monospace;background:#0b1220;color:#94a3b8;text-align:center;padding:3rem}</style></head><body><h1>404 Not Found</h1><p>nginx/1.25.3</p></body></html>';
}

function escServer(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] as string));
}

export function statusHtml(user: Record<string, unknown>, subLinks: string): string {
  const esc = escServer;
  const usedGb = Number(user.used_gb || 0);
  const limitGb = user.limit_gb as number | null;
  const pct = limitGb ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>' + esc(String(user.username || 'user')) + ' — وضعیت</title>' +
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>' +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<style>body{font-family:Vazirmatn;background:#000;color:#e5e7eb;min-height:100vh;background:radial-gradient(ellipse at top,rgba(34,211,238,.12),transparent 60%),#000}.glass{background:rgba(10,12,20,.72);backdrop-filter:blur(18px);border:1px solid rgba(148,163,184,.12)}</style></head><body class="grid place-items-center p-4">' +
    '<div class="w-full max-w-md glass rounded-3xl p-7">' +
    '<div class="flex items-center gap-3 mb-5"><img src="/icon.svg" class="w-12 h-12"/><div><h1 class="text-xl font-black">' + esc(String(user.username || '')) + '</h1><p class="text-xs text-slate-400">صفحه وضعیت کاربر</p></div></div>' +
    '<div class="space-y-3 text-sm">' +
      '<div class="flex justify-between p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><span class="text-slate-400">حجم مصرف‌شده</span><span class="font-bold text-cyan-400">' + usedGb.toFixed(2) + ' GB</span></div>' +
      '<div class="flex justify-between p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><span class="text-slate-400">سقف</span><span class="font-bold">' + (limitGb == null ? '∞' : limitGb.toFixed(2) + ' GB') + '</span></div>' +
      '<div class="h-2 rounded-full overflow-hidden" style="background:rgba(148,163,184,.1)"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#22d3ee,#0ea5e9)"></div></div>' +
      '<div class="flex justify-between p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><span class="text-slate-400">انقضا</span><span class="font-bold">' + (user.expiry_days == null ? '∞' : esc(String(user.expiry_days)) + ' روز') + '</span></div>' +
      '<div class="flex justify-between p-3 rounded-xl" style="background:rgba(148,163,184,.05)"><span class="text-slate-400">درخواست‌ها</span><span class="font-bold">' + esc(String(user.used_req || 0)) + '</span></div>' +
    '</div>' +
    '<a class="mt-5 inline-flex w-full justify-center items-center gap-2 py-3 rounded-xl font-bold" style="background:linear-gradient(135deg,#22d3ee,#0ea5e9);color:#00131c" href="/sub/' + encodeURIComponent(String(user.username || '')) + '">دریافت لینک اشتراک</a>' +
    '<pre style="display:none" id="cfg">' + esc(subLinks) + '</pre></div></body></html>';
}
