/* KalFetela Panel — single page admin app (vanilla JS, RTL). */
"use strict";

const S = {
  me: null,
  permissions: {},
  settings: {},
  nodes: [],
  plans: [],
  admins: [],
  users: { items: [], page: 1, pages: 1, total: 0, summary: {} },
  filters: { search: "", status: "all", sort: "newest", admin_id: "" },
  selection: new Set(),
  core: null,
  dashboard: null,
  stream: null,
  route: "dashboard",
};

/* ------------------------------- helpers ------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function fa(value) {
  return String(value ?? "").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "۰ B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, index);
  return `${fa(size >= 100 ? size.toFixed(0) : size.toFixed(2))} ${units[index]}`;
}

function fmtNum(value) {
  return fa(new Intl.NumberFormat("en-US").format(Math.round(Number(value || 0))));
}

function fmtToman(value) {
  if (value === null || value === undefined) return "—";
  return `${fmtNum(value)} تومان`;
}

function jdate(ts, withTime = false) {
  if (!ts) return "—";
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - Number(ts));
  if (diff < 60) return `${fa(diff)} ثانیه پیش`;
  if (diff < 3600) return `${fa(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${fa(Math.floor(diff / 3600))} ساعت پیش`;
  return `${fa(Math.floor(diff / 86400))} روز پیش`;
}

function statusPill(status) {
  const map = {
    active: ["ok", "فعال"],
    disabled: ["danger", "غیرفعال"],
    on_hold: ["warn", "معلق"],
    limited: ["warn", "حجم تمام"],
    expired: ["danger", "منقضی"],
    online: ["ok", "آنلاین"],
    offline: ["danger", "آفلاین"],
    error: ["danger", "خطا"],
    unknown: ["info", "نامشخص"],
    pending: ["warn", "در انتظار"],
    approved: ["ok", "تایید شده"],
    rejected: ["danger", "رد شده"],
    refunded: ["info", "بازگشت"],
    open: ["warn", "باز"],
    answered: ["info", "پاسخ داده شده"],
    closed: ["ok", "بسته"],
  };
  const [kind, label] = map[status] ?? ["info", status];
  return `<span class="pill ${kind}">${esc(label)}</span>`;
}

function toast(message, kind = "") {
  const box = $("#toasts");
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  box.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

async function api(path, options = {}) {
  const init = { method: options.method ?? "GET", headers: {}, credentials: "same-origin" };
  if (options.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error((data && (data.error || data.message)) || `خطای ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function modal({ title, body, actions = [], wide = false }) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}">
      <button class="btn sm ghost close">✕</button>
      <h3>${title}</h3>
      <div class="modal-body"></div>
      <div class="actions"></div>
    </div>`;
  const bodyEl = $(".modal-body", back);
  if (typeof body === "string") bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  const actionsEl = $(".actions", back);
  const close = () => back.remove();
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = `btn ${action.kind ?? ""}`;
    button.textContent = action.label;
    button.onclick = async () => {
      if (action.onClick) {
        const result = await action.onClick({ close, body: bodyEl });
        if (result !== false) close();
      } else close();
    };
    actionsEl.appendChild(button);
  }
  if (!actions.length) actionsEl.innerHTML = `<button class="btn">بستن</button>`, $(".btn", actionsEl).onclick = close;
  $(".close", back).onclick = close;
  back.onclick = (event) => {
    if (event.target === back) close();
  };
  document.body.appendChild(back);
  return { close, body: bodyEl };
}

function confirmBox(message, onYes) {
  modal({
    title: "تایید عملیات",
    body: `<p style="font-size:14px;line-height:2">${esc(message)}</p>`,
    actions: [
      { label: "انجام بده", kind: "danger", onClick: async () => onYes() },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

function form(fields) {
  const wrap = document.createElement("div");
  wrap.innerHTML = fields.map((field) => {
    if (field.type === "checkbox") {
      return `<label class="check"><input type="checkbox" name="${field.name}" ${field.value ? "checked" : ""}/> ${esc(field.label)}</label>`;
    }
    if (field.type === "select") {
      return `<label class="f">${esc(field.label)}</label>
        <select class="input" name="${field.name}">
          ${field.options.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(field.value) ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
        </select>`;
    }
    if (field.type === "multi") {
      const picked = new Set((Array.isArray(field.value) ? field.value : [field.value ?? ""]).map(String).filter(Boolean));
      return `<label class="f">${esc(field.label)}</label><div class="chips">${field.options
        .map(
          (option) =>
            `<label class="chip"><input type="checkbox" name="${field.name}" value="${esc(option.value)}" ${
              picked.has(String(option.value)) ? "checked" : ""
            } style="margin-inline-end:6px"/>${esc(option.label)}</label>`
        )
        .join("")}</div>`;
    }
    if (field.type === "textarea") {
      return `<label class="f">${esc(field.label)}</label><textarea class="input" name="${field.name}" placeholder="${esc(field.placeholder ?? "")}">${esc(field.value ?? "")}</textarea>`;
    }
    if (field.type === "html") return field.html;
    return `<label class="f">${esc(field.label)}</label>
      <input class="input" name="${field.name}" type="${field.type ?? "text"}" value="${esc(field.value ?? "")}" placeholder="${esc(field.placeholder ?? "")}"/>`;
  }).join("");
  return wrap;
}

function formValues(root) {
  const values = {};
  for (const input of $$("input,select,textarea", root)) {
    if (!input.name) continue;
    let value;
    if (input.type === "checkbox") {
      if (input.value && input.value !== "on") {
        // chip-style multi select: only checked chips contribute their value
        if (!input.checked) continue;
        value = input.value;
      } else {
        value = input.checked;
      }
    } else if (input.multiple) {
      value = Array.from(input.selectedOptions).map((option) => option.value);
    } else {
      value = input.value;
    }
    if (input.name in values) values[input.name] = [].concat(values[input.name], value);
    else values[input.name] = value;
  }
  return values;
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("کپی شد ✓", "ok"),
    () => toast("کپی نشد — دستی کپی کنید", "err")
  );
}

function loadingBox(text = "در حال بارگذاری…") {
  return `<div class="loading"><span class="spinner"></span><div style="margin-top:8px">${esc(text)}</div></div>`;
}

/* --------------------------------- auth -------------------------------- */
async function checkAuth() {
  const status = await api("/api/auth/status");
  if (!status.data.installed) return renderInstall(status.data);
  try {
    const me = await api("/api/auth/me");
    S.me = me.data.admin;
    S.permissions = me.data.permissions;
    return renderApp();
  } catch {
    return renderLogin(status.data);
  }
}

function authShell(inner) {
  $("#view").innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="logo"><img src="/icon.svg" alt="logo"/></div>
        <h1 id="brand-title">KalFetela</h1>
        <p class="sub">پنل مدیریت کاربران و اکانت‌ها</p>
        ${inner}
      </div>
    </div>`;
}

function renderInstall(data) {
  document.body.innerHTML = `<div id="view"></div><div id="toasts"></div>`;
  authShell(`
    <h3 style="font-size:15px;margin:0 0 6px">راه‌اندازی اولیه</h3>
    <p class="sub" style="text-align:right">حساب مدیر اصلی را بسازید. این صفحه فقط یک بار نمایش داده می‌شود.</p>
    <label class="f">نام کاربری مدیر</label>
    <input class="input" id="i-user" value="admin" placeholder="admin"/>
    <label class="f">رمز عبور (حداقل ۶ کاراکتر)</label>
    <input class="input" id="i-pass" type="password" placeholder="••••••••"/>
    <label class="f">تکرار رمز عبور</label>
    <input class="input" id="i-pass2" type="password"/>
    <div class="err-text" id="i-err"></div>
    <button class="btn primary block" id="i-go" style="margin-top:12px">ساخت پنل و ورود</button>
  `);
  $("#i-go").onclick = async () => {
    const username = $("#i-user").value.trim();
    const password = $("#i-pass").value;
    if (password !== $("#i-pass2").value) return ($("#i-err").textContent = "رمزهای عبور یکسان نیستند");
    try {
      await api("/api/auth/install", { method: "POST", body: { username, password } });
      toast("پنل ساخته شد 🎉", "ok");
      await checkAuth();
    } catch (error) {
      $("#i-err").textContent = error.message;
    }
  };
  void data;
}

function renderLogin(status) {
  document.body.innerHTML = `<div id="view"></div><div id="toasts"></div>`;
  authShell(`
    ${
      status?.default_credentials
        ? `<div class="card" style="border-color:#7c5c14;background:#1b1508;margin-bottom:12px">
             <b style="font-size:13px">🔑 ورود پیش‌فرض</b>
             <div class="hint" style="margin-top:4px">نام کاربری <span class="mono">admin</span> و رمز <span class="mono">admin</span> است.
             بعد از ورود، از «حساب من» رمز را تغییر دهید.</div>
           </div>`
        : ""
    }
    <label class="f">نام کاربری</label>
    <input class="input" id="l-user" autocomplete="username" placeholder="admin"/>
    <label class="f">رمز عبور</label>
    <input class="input" id="l-pass" type="password" autocomplete="current-password" placeholder="••••••••"/>
    <div class="err-text" id="l-err"></div>
    <button class="btn primary block" id="l-go" style="margin-top:12px">ورود به پنل</button>
    <button class="btn ghost block" id="l-code" style="margin-top:8px">ورود با کد تلگرام</button>
    <label class="f" id="code-wrap" style="display:none">کد ۶ رقمی ارسال‌شده در تلگرام</label>
    <input class="input" id="l-code-input" style="display:none" inputmode="numeric"/>
    <button class="btn ok block" id="l-code-go" style="display:none;margin-top:10px">تایید کد</button>
    <p class="sub" style="margin-top:14px">دسترسی فقط برای مدیران پنل</p>
  `);
  const login = async () => {
    $("#l-err").textContent = "";
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: { username: $("#l-user").value.trim(), password: $("#l-pass").value },
      });
      if (result.data.two_factor) {
        $("#l-err").textContent = "کد تایید به تلگرام شما ارسال شد";
        $("#code-wrap").style.display = "block";
        $("#l-code-input").style.display = "block";
        $("#l-code-go").style.display = "block";
        return;
      }
      toast("خوش آمدید 👋", "ok");
      await checkAuth();
    } catch (error) {
      $("#l-err").textContent = error.message;
    }
  };
  $("#l-go").onclick = login;
  $("#l-pass").onkeydown = (event) => {
    if (event.key === "Enter") login();
  };
  $("#l-code").onclick = async () => {
    try {
      await api("/api/auth/telegram-code", { method: "POST", body: { username: $("#l-user").value.trim() } });
      $("#code-wrap").style.display = "block";
      $("#l-code-input").style.display = "block";
      $("#l-code-go").style.display = "block";
      toast("کد ورود ارسال شد", "ok");
    } catch (error) {
      $("#l-err").textContent = error.message;
    }
  };
  $("#l-code-go").onclick = async () => {
    try {
      await api("/api/auth/verify-code", {
        method: "POST",
        body: { code: $("#l-code-input").value.trim(), username: $("#l-user").value.trim() },
      });
      await checkAuth();
    } catch (error) {
      $("#l-err").textContent = error.message;
    }
  };
}

/* --------------------------------- shell ------------------------------- */
function navItems() {
  const items = [
    { group: "عمومی", links: [["dashboard", "داشبورد", "📊"], ["users", "کاربران", "👥"]] },
    {
      group: "زیرساخت",
      links: [
        ["nodes", "نودها و هسته", "🌐"],
        ["fleet", "فلیت پنل‌ها", "🚀"],
        ["panels", "پنل‌های متصل", "🔌"],
      ],
    },
    { group: "مالی و فروش", links: [["plans", "پلن‌ها", "💎"], ["finance", "پرداخت‌ها", "💰"]] },
    { group: "پشتیبانی", links: [["tickets", "تیکت‌ها", "🎫"], ["apps", "برنامه‌ها و QR", "📱"]] },
  ];
  if (S.permissions.owner) items.push({ group: "مدیریت", links: [["admins", "ادمین و نماینده", "🛡"], ["settings", "تنظیمات", "⚙️"]] });
  items.push({ group: "حساب", links: [["profile", "حساب من", "🙋"], ["logs", "سیستم", "🖥"]] });
  return items;
}

function renderApp() {
  const defaultCreds = S.me?.default_password === true;
  const brand = S.settings.panel_name || "KalFetela";
  document.body.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <img src="/icon.svg" alt=""/>
          <div><div class="name" id="brand-name">${esc(brand)}</div><div class="ver">KalFetela v2.0.0</div></div>
        </div>
        <nav class="nav" id="nav"></nav>
        <div class="card" style="margin-top:16px;padding:12px">
          <div style="font-size:12px;color:var(--muted)">وارد شده با</div>
          <div style="font-weight:700;margin-top:4px">${esc(S.me?.username ?? "")}</div>
          <div style="margin-top:6px">${S.me?.role === "owner" ? '<span class="pill violet">مدیر اصلی</span>' : S.me?.role === "reseller" ? '<span class="pill info">نماینده</span>' : '<span class="pill">مدیر</span>'}</div>
          <button class="btn sm danger block" id="logout" style="margin-top:10px">خروج</button>
        </div>
      </aside>
      <main class="main">
        ${
          defaultCreds
            ? `<div class="card" style="border-color:#7c5c14;background:#1b1508">
                 <b>⚠️ رمز عبور پیش‌فرض فعال است</b>
                 <div class="hint" style="margin-top:4px">برای امنیت پنل، همین حالا رمز را از بخش «حساب من» تغییر دهید.</div>
               </div>`
            : ""
        }
        <div class="topbar">
          <button class="btn sm burger" id="burger">☰</button>
          <div><h1 id="page-title">داشبورد</h1><div class="sub" id="page-sub"></div></div>
          <div class="spacer"></div>
          <div id="topbar-actions"></div>
        </div>
        <div id="view">${loadingBox()}</div>
      </main>
    </div>
    <div id="toasts"></div>`;

  const nav = $("#nav");
  nav.innerHTML = navItems()
    .map(
      (section) => `<div class="nav-section">${esc(section.group)}</div>` +
        section.links.map(([key, label, icon]) => `<a href="#${key}" data-route="${key}">${icon} ${esc(label)}<span class="badge" id="badge-${key}"></span></a>`).join("")
    )
    .join("");

  $("#logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  };
  $("#burger").onclick = () => $("#sidebar").classList.toggle("open");
  window.addEventListener("hashchange", route);
  loadSettings().then(() => {
    route();
    refreshBadges();
    setInterval(refreshBadges, 60_000);
  });
}

async function loadSettings() {
  try {
    const data = await api("/api/settings");
    S.settings = data.data.settings;
    if (S.settings.panel_name) {
      $("#brand-name").textContent = S.settings.panel_name;
      document.title = `${S.settings.panel_name} — پنل مدیریت`;
    }
  } catch {
    /* settings are optional for non owners */
  }
}

async function refreshBadges() {
  try {
    const payments = await api("/api/payments?status=pending&limit=50");
    const pending = payments.data.payments.length;
    const node = $("#badge-finance");
    if (node) node.innerHTML = pending ? `<span class="pill warn">${fa(pending)}</span>` : "";
    const tickets = await api("/api/tickets?status=open");
    const open = tickets.data.tickets.length;
    const t = $("#badge-tickets");
    if (t) t.innerHTML = open ? `<span class="pill warn">${fa(open)}</span>` : "";
  } catch {
    /* ignore */
  }
}

const ROUTES = {
  dashboard: renderDashboard,
  users: renderUsers,
  nodes: renderNodes,
  panels: renderPanels,
  fleet: renderFleet,
  apps: renderApps,
  plans: renderPlans,
  finance: renderFinance,
  tickets: renderTickets,
  admins: renderAdmins,
  settings: renderSettings,
  logs: renderSystem,
  profile: renderProfile,
};

function route() {
  const key = (location.hash || "#dashboard").slice(1);
  const view = ROUTES[key] ? key : "dashboard";
  S.route = view;
  $$(".nav a").forEach((link) => link.classList.toggle("active", link.dataset.route === view));
  $("#sidebar")?.classList.remove("open");
  if (S.stream) {
    S.stream.close();
    S.stream = null;
  }
  $("#view").innerHTML = loadingBox();
  ROUTES[view]().catch((error) => {
    $("#view").innerHTML = `<div class="card"><div class="empty">خطا: ${esc(error.message)}</div></div>`;
  });
}

function setTitle(title, sub = "") {
  $("#page-title").textContent = title;
  $("#page-sub").textContent = sub;
}

function setActions(html, bind) {
  $("#topbar-actions").innerHTML = html;
  if (bind) bind($("#topbar-actions"));
}

/* ------------------------------ dashboard ------------------------------ */
async function renderDashboard() {
  setTitle("داشبورد", "نمای کلی پنل و مصرف لحظه‌ای");
  setActions(`<button class="btn sm" id="refresh">↻ بروزرسانی</button>`);
  $("#refresh").onclick = () => route();
  const [stats, info] = await Promise.all([api("/api/system/info"), api("/api/users?per_page=1")]);
  S.dashboard = stats.data;
  const data = stats.data;
  const summary = info.data.summary ?? {};
  $("#view").innerHTML = `
    <div class="grid cols-4" id="stats-grid"></div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>📈 مصرف ۱۴ روز اخیر</h3>
        <div class="chart" id="chart"></div>
        <div class="chart-legend"><span><i class="dot" style="background:#22d3ee"></i>آپلود</span><span><i class="dot" style="background:#8b5cf6"></i>دانلود</span></div>
      </div>
      <div class="card">
        <h3>🖥 منابع سرور</h3>
        <div class="grid cols-2" id="res-grid"></div>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>⚡ اقدام سریع</h3>
        <div class="chips">
          <a class="btn sm primary" href="#users">➕ کاربر جدید</a>
          <a class="btn sm" href="#nodes">🌐 مدیریت نودها</a>
          <a class="btn sm" href="#finance">🧾 سفارش‌های در انتظار</a>
          <a class="btn sm" href="#settings">⚙️ تنظیمات پنل</a>
        </div>
        <div class="grid cols-3" style="margin-top:14px" id="quick-stats"></div>
      </div>
      <div class="card">
        <h3>🕒 آخرین رویدادها</h3>
        <div id="events">${loadingBox()}</div>
      </div>
    </div>`;

  renderStatCards(data, summary);
  renderChart(data.stats?.series ?? []);
  renderResources(data);
  $("#quick-stats").innerHTML = `
    <div class="stat"><div class="k">درآمد امروز</div><div class="v" style="font-size:15px">${fmtToman(data.stats?.revenue?.today ?? 0)}</div><div class="d">در انتظار: ${fmtToman(data.stats?.revenue?.pending ?? 0)}</div></div>
    <div class="stat"><div class="k">نسخه هسته</div><div class="v" style="font-size:15px">${esc(data.xray?.version ?? "—")}</div><div class="d">${esc(data.xray?.installed ? (data.xray?.running ? "در حال اجرا" : "متوقف") : "نصب نشده")}</div></div>
    <div class="stat"><div class="k">تیکت باز</div><div class="v" style="font-size:15px">${fa(data.stats?.tickets?.open ?? 0)}</div><div class="d">نمایندگان: ${fa(data.stats?.resellers?.total ?? 0)}</div></div>`;
  try {
    const audit = await api("/api/settings/audit?limit=8");
    $("#events").innerHTML = audit.data.entries.length
      ? `<div class="table-wrap"><table><thead><tr><th>رویداد</th><th>هدف</th><th>زمان</th></tr></thead><tbody>${audit.data.entries
          .map((entry) => `<tr><td>${esc(entry.action)}</td><td>${esc(entry.target ?? "—")}</td><td>${timeAgo(entry.created_at)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<div class="empty">رویدادی ثبت نشده است</div>`;
  } catch {
    $("#events").innerHTML = `<div class="empty">دسترسی به لاگ رویدادها ندارید</div>`;
  }

  try {
    const stream = new EventSource("/api/system/stream");
    stream.addEventListener("stats", (event) => {
      const payload = JSON.parse(event.data);
      renderResources(payload);
      renderChart(payload.series ?? []);
      const onlineNode = $("#stat-online");
      if (onlineNode) onlineNode.textContent = fa(payload.online);
    });
    stream.onerror = () => stream.close();
    S.stream = stream;
  } catch {
    /* SSE not available */
  }
}

function renderStatCards(info, summary) {
  const stats = info.stats ?? {};
  const users = stats.users ?? {};
  const cards = [
    { k: "کل کاربران", v: fmtNum(users.total ?? info.users ?? 0), d: `آنلاین: ${fa(summary.online ?? users.online ?? 0)}`, cls: "info", id: "stat-total" },
    { k: "کاربران آنلاین", v: fa(summary.online ?? users.online ?? 0), d: `فعال: ${fa(summary.active ?? users.active ?? 0)}`, cls: "ok", id: "stat-online" },
    { k: "مصرف امروز", v: fmtBytes(stats.traffic?.today ?? 0), d: `کل: ${fmtBytes(info.traffic_total)}`, cls: "" },
    { k: "نودهای آنلاین", v: fa(`${stats.nodes?.online ?? (info.xray?.running ? 1 : 0)}/${stats.nodes?.total ?? (info.xray?.ports ?? []).length}`), d: `${fa(info.xray?.ports?.length ?? 0)} اینباند داخلی`, cls: (stats.nodes?.online ?? 0) > 0 || info.xray?.running ? "ok" : "danger" },
  ];
  $("#stats-grid").innerHTML = cards
    .map((card) => `<div class="stat ${card.cls}"><div class="k">${esc(card.k)}</div><div class="v" id="${card.id}">${card.v}</div><div class="d">${esc(card.d)}</div></div>`)
    .join("");
}

function renderResources(info) {
  const box = $("#res-grid");
  if (!box) return;
  const memory = info.memory ?? {};
  const cpu = info.cpu ?? {};
  const disk = info.disk ?? {};
  box.innerHTML = [
    ["پردازنده", `${fa(cpu.cores ?? 0)} هسته`, `${fa(cpu.usage_percent ?? 0)}٪ مصرف (load ${fa(cpu.load1 ?? 0)})`],
    ["حافظه", fmtBytes(memory.used), `از ${fmtBytes(memory.total)} — ${fa(memory.percent ?? 0)}٪`],
    ["دیسک", disk.total ? fmtBytes(disk.used) : "—", disk.total ? `${fa(disk.percent ?? 0)}٪ از ${fmtBytes(disk.total)}` : "نامشخص"],
    ["آپ‌تایم", fa(Math.floor((info.host?.uptime_seconds ?? 0) / 3600)) + " ساعت", `${esc(info.host?.provider ?? "")} · ${esc(info.host?.region ?? "")}`],
  ]
    .map(([k, v, d]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v" style="font-size:16px">${esc(v)}</div><div class="d">${esc(d)}</div></div>`)
    .join("");
}

function renderChart(series) {
  const box = $("#chart");
  if (!box) return;
  const max = Math.max(1, ...series.map((point) => Number(point.upload_bytes) + Number(point.download_bytes)));
  box.innerHTML = series
    .map((point) => {
      const up = Math.round((Number(point.upload_bytes) / max) * 100);
      const down = Math.round((Number(point.download_bytes) / max) * 100);
      const label = jdate(new Date(`${point.day}T12:00:00Z`).getTime() / 1000);
      return `<div class="col" title="${esc(label)} — ${fmtBytes(Number(point.upload_bytes) + Number(point.download_bytes))}">
        <span class="down" style="height:${down}%"></span><span style="height:${up}%"></span>
      </div>`;
    })
    .join("");
}

/* -------------------------------- users -------------------------------- */
async function renderUsers() {
  setTitle("مدیریت کاربران", "ساخت، ویرایش و کنترل اکانت‌ها");
  setActions(`<button class="btn sm" id="bulk-user">⚡ ساخت گروهی</button>
    <button class="btn sm primary" id="new-user">➕ کاربر جدید</button>`);
  $("#new-user").onclick = () => userForm();
  $("#bulk-user").onclick = () => bulkUserForm();
  $("#view").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input class="input grow" id="f-search" placeholder="جستجو: نام کاربری، ایمیل، تلگرام، UUID"/>
        <select class="input" id="f-status" style="width:150px">
          <option value="all">همه وضعیت‌ها</option>
          <option value="active">فعال</option>
          <option value="online">آنلاین</option>
          <option value="limited">حجم تمام</option>
          <option value="expired">منقضی</option>
          <option value="disabled">غیرفعال</option>
          <option value="on_hold">معلق</option>
        </select>
        <select class="input" id="f-sort" style="width:160px">
          <option value="newest">جدیدترین</option>
          <option value="usage">بیشترین مصرف</option>
          <option value="expiry">نزدیک‌ترین انقضا</option>
          <option value="name">نام</option>
        </select>
        <input class="input" id="f-tag" style="width:150px" placeholder="برچسب…" value="${esc(S.filters.tag ?? "")}"/>
        <button class="btn" id="f-export">⬇️ خروجی CSV</button>
      </div>
      <div class="grid cols-5" id="user-summary" style="margin-bottom:14px"></div>
      <div id="bulk-bar"></div>
      <div id="users-table">${loadingBox()}</div>
      <div id="pager" style="margin-top:12px"></div>
    </div>`;

  $("#f-search").oninput = debounce((event) => {
    S.filters.search = event.target.value;
    S.users.page = 1;
    loadUsers();
  }, 350);
  $("#f-status").onchange = (event) => {
    S.filters.status = event.target.value;
    S.users.page = 1;
    loadUsers();
  };
  $("#f-sort").onchange = (event) => {
    S.filters.sort = event.target.value;
    loadUsers();
  };
  $("#f-tag").onchange = (event) => {
    S.filters.tag = event.target.value.trim();
    S.users.page = 1;
    loadUsers();
  };
  $("#f-export").onclick = () => window.open("/api/users/export?format=csv", "_blank");
  await loadUsers();
}

/* -------------------------- bulk provisioning -------------------------- */

async function bulkUserForm() {
  const [nodeList, plans] = await Promise.all([api("/api/nodes"), api("/api/plans")]);
  const nodes = nodeList.data.nodes;
  const wrap = form([
    { label: "پیش‌شماره نام کاربری", name: "prefix", value: "user", placeholder: "مثلاً kolbe" },
    { label: "تعداد", name: "count", type: "number", value: 10 },
    { label: "شماره شروع", name: "start", type: "number", value: 1 },
    { label: "صفر‌های سمت چپ (نمونه: 3 → 001)", name: "padding", type: "number", value: 0 },
    { label: "پسوند تصادفی (برای امنیت بیشتر)", name: "random_suffix", type: "select", value: "no", options: [
      { value: "no", label: "خیر" },
      { value: "yes", label: "بله" },
    ] },
    { label: "پلن", name: "plan_id", type: "select", value: "", options: [
      { value: "", label: "— بدون پلن —" },
      ...plans.data.plans.map((plan) => ({ value: String(plan.id), label: `${plan.name} — ${plan.data_gb}GB/${plan.days}روز` })),
    ] },
    { label: "حجم (GB) — اگر پلن انتخاب نشود", name: "data_gb", type: "number", value: 30 },
    { label: "روز", name: "days", type: "number", value: 30 },
    { label: "تعداد دستگاه", name: "device_limit", type: "number", value: 0 },
    { label: "محدودیت سرعت (Mbps)", name: "speed_mbps", type: "number", value: 0 },
    { label: "برچسب‌ها (با کاما)", name: "tags", value: "" , placeholder: "مشتری-A, فروش-مهر" },
    { label: "نودها (چندانتخابی)", name: "node_ids", type: "multi", value: nodes.map((node) => String(node.id)), options: nodes.map((node) => ({ value: String(node.id), label: `${node.name} (${node.protocol})` })) },
    { label: "یادداشت", name: "note", value: "" },
  ]);
  modal({
    title: "ساخت گروهی کاربران",
    wide: true,
    body: `${wrap.outerHTML}<div class="hint" style="margin-top:10px">تا ۵۰۰ اکانت در هر درخواست. نام‌های تکراری خودکار کنار گذاشته می‌شوند؛
      در پایان می‌توانید لیست لینک‌های ساب را یکجا کپی یا دانلود کنید.</div>`,
    actions: [
      {
        label: "ساخت",
        kind: "primary",
        onClick: async () => {
          const values = formValues(document.querySelector(".modal-body"));
          const body = {
            prefix: values.prefix,
            count: Number(values.count || 1),
            start: Number(values.start || 1),
            padding: Number(values.padding || 0),
            random_suffix: values.random_suffix === "yes",
            plan_id: values.plan_id ? Number(values.plan_id) : undefined,
            data_gb: Number(values.data_gb || 0),
            days: Number(values.days || 30),
            device_limit: Number(values.device_limit || 0),
            speed_mbps: Number(values.speed_mbps || 0),
            tags: values.tags,
            note: values.note,
            node_ids: values.node_ids,
          };
          const response = await api("/api/users/bulk-create", { method: "POST", body });
          const created = response.data.created;
          const base = location.origin;
          const lines = created.map((user) => `${user.username}	${base}/sub/${user.sub_token}`);
          modal({
            title: `✅ ${fa(created.length)} اکانت ساخته شد`,
            wide: true,
            body: `<div class="muted">${fa(response.data.skipped.length)} مورد رد شد.</div>
              <pre class="code" id="bulk-out">${esc(lines.join("\n"))}</pre>`,
            actions: [
              { label: "کپی همه لینک‌ها", onClick: async () => copyText(lines.join("\n")) },
              {
                label: "دانلود فایل",
                onClick: async () => {
                  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
                  const link = document.createElement("a");
                  link.href = URL.createObjectURL(blob);
                  link.download = `kalfetela-accounts-${Date.now()}.txt`;
                  link.click();
                },
              },
              { label: "بستن", kind: "primary" },
            ],
          });
          loadUsers();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function loadUsers() {
  const params = new URLSearchParams({
    page: S.users.page,
    per_page: 20,
    search: S.filters.search,
    status: S.filters.status,
    sort: S.filters.sort,
    tag: S.filters.tag ?? "",
  });
  const response = await api(`/api/users?${params}`);
  S.users.items = response.data.users;
  S.users.pages = response.data.pages;
  S.users.total = response.data.total;
  S.users.summary = response.data.summary;
  renderUserTable();
  renderPager();
}

function renderUserTable() {
  const summary = S.users.summary ?? {};
  $("#user-summary").innerHTML = [
    ["کل کاربران", fmtNum(S.users.total)],
    ["آنلاین", fa(summary.online ?? 0)],
    ["فعال", fa(summary.active ?? 0)],
    ["حجم تمام", fa(summary.limited ?? 0)],
    ["منقضی", fa(summary.expired ?? 0)],
  ]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join("");

  const rows = S.users.items
    .map((user) => {
      const percent = user.percent ?? 0;
      return `<tr>
        <td><input type="checkbox" class="row-check" data-id="${user.id}" ${S.selection.has(user.id) ? "checked" : ""}/></td>
        <td><div style="font-weight:600">${esc(user.username)}</div><div class="mono" style="font-size:10.5px;color:#7d90b3">${esc(user.uuid.slice(0, 18))}…</div></td>
        <td>${statusPill(user.status)}</td>
        <td style="min-width:150px">
          <div style="font-size:12px">${fmtBytes(user.data_used_bytes)} ${user.data_limit_bytes ? `از ${fmtBytes(user.data_limit_bytes)}` : "(نامحدود)"}</div>
          <div class="bar ${percent > 85 ? "hot" : ""}"><i style="width:${percent}%"></i></div>
        </td>
        <td>${user.expires_at ? jdate(user.expires_at) : "بدون انقضا"}</td>
        <td>${user.last_online_at ? timeAgo(user.last_online_at) : "—"}</td>
        <td>
          <div class="chips">
            <button class="btn sm" data-act="links" data-id="${user.id}">🔗 لینک</button>
            <button class="btn sm" data-act="edit" data-id="${user.id}">✏️</button>
            <button class="btn sm" data-act="more" data-id="${user.id}">⋯</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  $("#users-table").innerHTML = S.users.items.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th style="width:34px"><input type="checkbox" id="check-all"/></th><th>کاربر</th><th>وضعیت</th><th>مصرف</th><th>انقضا</th><th>آخرین اتصال</th><th>عملیات</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="empty">کاربری یافت نشد — با دکمه «کاربر جدید» شروع کنید</div>`;

  $("#check-all").onchange = (event) => {
    for (const user of S.users.items) {
      if (event.target.checked) S.selection.add(user.id);
      else S.selection.delete(user.id);
    }
    renderUserTable();
    renderBulkBar();
  };
  $$(".row-check").forEach((box) => {
    box.onchange = () => {
      const id = Number(box.dataset.id);
      if (box.checked) S.selection.add(id);
      else S.selection.delete(id);
      renderBulkBar();
    };
  });
  $$("[data-act]").forEach((button) => {
    button.onclick = () => {
      const id = Number(button.dataset.id);
      if (button.dataset.act === "links") userLinks(id);
      else if (button.dataset.act === "edit") userForm(id);
      else userActions(id);
    };
  });
  renderBulkBar();
}

function renderBulkBar() {
  const box = $("#bulk-bar");
  if (!box) return;
  if (!S.selection.size) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<div class="card" style="padding:12px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <b style="font-size:13px">${fa(S.selection.size)} کاربر انتخاب شده</b>
      <button class="btn sm ok" data-bulk="enable">✅ فعال‌سازی</button>
      <button class="btn sm danger" data-bulk="disable">⛔️ غیرفعال</button>
      <button class="btn sm" data-bulk="reset">♻️ صفر کردن مصرف</button>
      <button class="btn sm" data-bulk="extend">⏳ تمدید ۳۰ روز</button>
      <button class="btn sm" data-bulk="set_plan">💎 تغییر پلن</button>
      <button class="btn sm danger" data-bulk="delete">🗑 حذف</button>
      <button class="btn sm ghost" data-bulk="clear">لغو انتخاب</button>
    </div>`;
  $$("[data-bulk]").forEach((button) => {
    button.onclick = () => bulkAction(button.dataset.bulk);
  });
}

async function bulkAction(action) {
  if (action === "clear") {
    S.selection.clear();
    renderUserTable();
    return;
  }
  const ids = [...S.selection];
  let payload = {};
  if (action === "set_plan") {
    const plans = await api("/api/plans");
    const chosen = prompt(`شناسه پلن را وارد کنید:\n${plans.data.plans.map((plan) => `${plan.id} = ${plan.name}`).join("\n")}`);
    if (!chosen) return;
    payload = { plan_id: Number(chosen) };
  }
  if (action === "delete" && !confirm("کاربران انتخاب‌شده حذف شوند؟ این کار برگشت‌پذیر نیست.")) return;
  await api("/api/users/bulk", { method: "POST", body: { ids, action, payload } });
  toast("عملیات انجام شد", "ok");
  S.selection.clear();
  loadUsers();
}

function renderPager() {
  const box = $("#pager");
  box.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:center">
      <button class="btn sm" id="prev" ${S.users.page <= 1 ? "disabled" : ""}>قبلی</button>
      <span style="font-size:13px;color:var(--muted)">صفحه ${fa(S.users.page)} از ${fa(S.users.pages)}</span>
      <button class="btn sm" id="next" ${S.users.page >= S.users.pages ? "disabled" : ""}>بعدی</button>
    </div>`;
  $("#prev").onclick = () => {
    S.users.page = Math.max(1, S.users.page - 1);
    loadUsers();
  };
  $("#next").onclick = () => {
    S.users.page = Math.min(S.users.pages, S.users.page + 1);
    loadUsers();
  };
}

async function userForm(id) {
  const isEdit = Boolean(id);
  let user = null;
  let nodes = [];
  if (isEdit) {
    const response = await api(`/api/users/${id}`);
    user = response.data.user;
  }
  const nodesResponse = await api("/api/nodes");
  nodes = nodesResponse.data.nodes;
  const selected = new Set((user?.node_ids ?? []).map(Number));

  const body = form([
    { type: "html", html: `<div class="row-2">` },
    { label: "نام کاربری", name: "username", value: user?.username ?? "", placeholder: "مثلاً ali_01" },
    { label: "حجم (گیگابایت — ۰ = نامحدود)", name: "data_gb", type: "number", value: user ? (user.data_limit_bytes / 1073741824).toFixed(2) : 30 },
    { type: "html", html: `</div><div class="row-3">` },
    { label: "مدت (روز)", name: "days", type: "number", value: isEdit ? 0 : 30 },
    { label: "تعداد دستگاه", name: "device_limit", type: "number", value: user?.device_limit ?? 2 },
    { label: "محدودیت سرعت (Mbps)", name: "speed_mbps", type: "number", value: user?.speed_limit_mbps ?? 0 },
    { type: "html", html: `</div><div class="row-2">` },
    { label: "آیدی تلگرام", name: "telegram_id", value: user?.telegram_id ?? "" },
    { label: "ایمیل (اختیاری)", name: "email", value: user?.email ?? "" },
    { type: "html", html: `</div><div class="row-2">` },
    { label: "یادداشت", name: "note", value: user?.note ?? "" },
    { label: "برچسب‌ها (با کاما جدا کنید)", name: "tags", value: (user?.tags ?? []).join(", "), placeholder: "مشتری-A, مهم" },
    { type: "html", html: `</div>` },
  ]);

  const nodeBox = document.createElement("div");
  nodeBox.innerHTML = `<label class="f">نودها (سرویس روی این نودها ساخته می‌شود)</label><div class="chips">${nodes
    .map(
      (node) =>
        `<label class="chip"><input type="checkbox" value="${node.id}" ${selected.has(node.id) ? "checked" : ""} style="margin-inline-end:6px"/>${esc(node.name)} <span style="color:#7d90b3">(${esc(node.protocol)})</span></label>`
    )
    .join("")}</div>`;

  const wrap = document.createElement("div");
  wrap.appendChild(body);
  wrap.appendChild(nodeBox);
  if (isEdit && user) {
    const extra = document.createElement("div");
    extra.innerHTML = `
      <label class="f">وضعیت</label>
      <select class="input" name="status">
        ${["active", "disabled", "on_hold"].map((value) => `<option value="${value}" ${user.status === value ? "selected" : ""}>${value}</option>`).join("")}
      </select>
      <label class="check"><input type="checkbox" name="reset_usage"/> مصرف قبلی صفر شود</label>
      <div class="copy-row" style="margin-top:10px">
        <input class="input" readonly value="${esc(user.sub_token ?? "")}"/>
        <button class="btn sm" type="button" id="copy-sub">کپی لینک ساب</button>
      </div>`;
    wrap.appendChild(extra);
  } else {
    wrap.insertAdjacentHTML("beforeend", `<label class="check"><input type="checkbox" name="send_telegram"/> اطلاع‌رسانی به کاربر از طریق ربات</label>`);
    if (S.me?.role === "owner") {
      try {
        const list = (await api("/api/admins")).data.admins.filter((item) => item.role !== "owner");
        if (list.length) {
          const box = document.createElement("div");
          box.innerHTML = `<label class="f">ساخت به‌نام نماینده (اختیاری)</label>
            <select class="input" name="admin_id"><option value="">— خودم (مدیر اصلی) —</option>
            ${list.map((item) => `<option value="${item.id}">${esc(item.username)} (${esc(item.role)})</option>`).join("")}</select>`;
          wrap.insertBefore(box, wrap.firstChild);
        }
      } catch (error) {
        /* resellers cannot list admins — ignore */
      }
    }
  }

  modal({
    title: isEdit ? `ویرایش کاربر ${esc(user.username)}` : "افزودن کاربر جدید",
    body: wrap,
    wide: true,
    actions: [
      {
        label: isEdit ? "ذخیره تغییرات" : "ساخت کاربر و دریافت لینک",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          const nodeIds = $$("input[type=checkbox]:checked", nodeBox)
            .map((box) => Number(box.value))
            .filter(Boolean);
          if (!values.username) {
            toast("نام کاربری را وارد کنید", "err");
            return false;
          }
          if (isEdit) {
            await api(`/api/users/${id}`, {
              method: "PUT",
              body: {
                username: values.username,
                data_gb: values.data_gb === "" ? undefined : Number(values.data_gb),
                device_limit: Number(values.device_limit || 0),
                speed_mbps: Number(values.speed_mbps || 0),
                telegram_id: values.telegram_id,
                email: values.email,
                note: values.note,
                tags: values.tags,
                status: values.status,
                reset_usage: values.reset_usage,
              },
            });
            await api(`/api/users/${id}/nodes`, { method: "POST", body: { node_ids: nodeIds } });
            toast("کاربر به‌روزرسانی شد", "ok");
          } else {
            const created = await api("/api/users", {
              method: "POST",
              body: {
                username: values.username,
                data_gb: Number(values.data_gb || 0),
                days: Number(values.days || 0),
                device_limit: Number(values.device_limit || 0),
                speed_mbps: Number(values.speed_mbps || 0),
                telegram_id: values.telegram_id,
                email: values.email,
                note: values.note,
                tags: values.tags,
                node_ids: nodeIds,
                admin_id: values.admin_id ? Number(values.admin_id) : undefined,
              },
            });
            const urls = created.data.subscription;
            toast("کاربر ساخته شد ✓", "ok");
            showSubscriptionDialog(created.data.user, urls);
          }
          loadUsers();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

function showSubscriptionDialog(user, urls) {
  modal({
    title: `لینک‌های کاربر ${esc(user ? user.username : "")}`,
    body: `
      <label class="f">لینک ساب (Base64 — مناسب همه اپ‌ها)</label>
      <div class="copy-row"><input class="input" readonly value="${esc(urls.base64)}"/><button class="btn sm" data-copy="${esc(urls.base64)}">کپی</button></div>
      <label class="f">Clash / Mihomo</label>
      <div class="copy-row"><input class="input" readonly value="${esc(urls.clash)}"/><button class="btn sm" data-copy="${esc(urls.clash)}">کپی</button></div>
      <label class="f">sing-box</label>
      <div class="copy-row"><input class="input" readonly value="${esc(urls.singbox)}"/><button class="btn sm" data-copy="${esc(urls.singbox)}">کپی</button></div>
      <label class="f">Xray (با Fragment و مسیریابی ایران)</label>
      <div class="copy-row"><input class="input" readonly value="${esc(urls.xray)}"/><button class="btn sm" data-copy="${esc(urls.xray)}">کپی</button></div>
      <label class="f">صفحه اطلاعات و QR</label>
      <div class="copy-row"><input class="input" readonly value="${esc(urls.page)}"/><a class="btn sm" target="_blank" href="${esc(urls.page)}">باز کردن</a></div>`,
    actions: [{ label: "بستن", kind: "ghost" }],
  });
  $$("[data-copy]").forEach((button) => {
    button.onclick = () => copyText(button.dataset.copy);
  });
}

async function userLinks(id) {
  const response = await api(`/api/users/${id}/links`);
  const entries = response.data.links;
  const body = document.createElement("div");
  body.innerHTML = entries.length
    ? entries
        .map(
          (entry) => `<label class="f">${esc(entry.nodeName)} <span class="pill">${esc(entry.protocol)}</span></label>
        <div class="copy-row"><input class="input" readonly value="${esc(entry.link)}"/><button class="btn sm" data-copy="${esc(entry.link)}">کپی</button></div>`
        )
        .join("")
    : `<div class="empty">این کاربر روی هیچ نودی تنظیم نشده است</div>`;
  body.insertAdjacentHTML(
    "beforeend",
    `<h4 style="margin:16px 0 6px">فایل‌های اشتراک</h4>
     <div class="chips">
       <button class="btn sm" id="dl-clash">⬇️ Clash</button>
       <button class="btn sm" id="dl-singbox">⬇️ sing-box</button>
       <button class="btn sm" id="dl-xray">⬇️ Xray</button>
       <button class="btn sm" id="dl-base64">⬇️ Base64</button>
     </div>
     <h4 style="margin:16px 0 6px">لینک‌های ساب</h4>
     <div id="sub-links">${loadingBox()}</div>
     <div id="wg-block" style="margin-top:14px"></div>`
  );
  modal({ title: `کانفیگ‌های کاربر #${id}`, body, wide: true, actions: [{ label: "بستن", kind: "ghost" }] });
  $$("[data-copy]").forEach((button) => {
    button.onclick = () => copyText(button.dataset.copy);
  });
  for (const [key, format] of [["dl-clash", "clash"], ["dl-singbox", "singbox"], ["dl-xray", "xray"], ["dl-base64", "base64"]]) {
    const button = $(`#${key}`);
    if (button) button.onclick = () => window.open(`/api/users/${id}/links?format=${format}`, "_blank");
  }
  api(`/api/users/${id}`).then((response) => {
    const urls = response.data.subscriptions;
    $("#sub-links").innerHTML = Object.entries(urls)
      .filter(([key]) => ["base64", "clash", "singbox", "xray", "page"].includes(key))
      .map(
        ([key, value]) => `<div class="copy-row" style="margin-bottom:8px"><span style="width:74px;font-size:12px;color:var(--muted)">${key}</span>
        <input class="input" readonly value="${esc(value)}"/><button class="btn sm" data-copy="${esc(value)}">کپی</button></div>`
      )
      .join("");
    $$("[data-copy]", $("#sub-links")).forEach((button) => {
      button.onclick = () => copyText(button.dataset.copy);
    });
    $("#sub-links").insertAdjacentHTML("beforeend", `<a class="btn sm primary" target="_blank" href="${esc(urls.page)}">🖼 صفحه QR</a>`);
  });
  api(`/api/users/${id}/wireguard`).then((response) => {
    const configs = response.data.configs ?? [];
    if (!configs.length) return;
    $("#wg-block").innerHTML =
      `<h4 style="margin:0 0 6px">کانفیگ WireGuard</h4>` +
      configs
        .map(
          (item) => `<label class="f">${esc(item.node_name)} <span class="pill">${esc(item.address)}</span></label>
        <pre class="code" style="max-height:180px">${esc(item.config)}</pre>
        <div class="chips" style="margin-bottom:10px"><button class="btn sm" data-copy="${esc(item.config)}">📋 کپی کانفیگ</button></div>`
        )
        .join("");
    $$("[data-copy]", $("#wg-block")).forEach((button) => (button.onclick = () => copyText(button.dataset.copy)));
  });
}

function userActions(id) {
  modal({
    title: `عملیات کاربر #${id}`,
    body: `<div class="chips" style="flex-direction:column;align-items:stretch">
      <button class="btn" data-do="extend">⏳ تمدید اعتبار</button>
      <button class="btn" data-do="data">📦 افزودن حجم</button>
      <button class="btn" data-do="reset">♻️ صفر کردن مصرف</button>
      <button class="btn ok" data-do="enable">✅ فعال‌سازی</button>
      <button class="btn danger" data-do="disable">⛔️ غیرفعال‌سازی</button>
      <button class="btn" data-do="sync">🔄 همگام‌سازی با نودها</button>
      <button class="btn" data-do="wireguard">🐧 کانفیگ WireGuard</button>
      <button class="btn danger" data-do="delete">🗑 حذف کاربر</button>
    </div>`,
    actions: [{ label: "بستن", kind: "ghost" }],
  });
  $$("[data-do]").forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.do;
      try {
        if (action === "extend") {
          const days = Number(prompt("چند روز تمدید شود؟", "30"));
          if (!days) return;
          await api(`/api/users/${id}/extend`, { method: "POST", body: { days } });
        } else if (action === "data") {
          const gb = Number(prompt("چند گیگابایت اضافه شود؟", "10"));
          if (!gb) return;
          await api(`/api/users/${id}/extend`, { method: "POST", body: { days: 0, data_gb: gb } });
        } else if (action === "reset") {
          await api(`/api/users/${id}/reset`, { method: "POST" });
        } else if (action === "enable" || action === "disable") {
          await api(`/api/users/${id}/status`, { method: "POST", body: { status: action === "enable" ? "active" : "disabled" } });
        } else if (action === "sync") {
          const result = await api(`/api/users/${id}/sync`, { method: "POST" });
          toast(`همگام‌سازی: ${result.data.synced} موفق، ${result.data.failed} خطا`, result.data.failed ? "warn" : "ok");
        } else if (action === "wireguard") {
          return wireguardUserModal(Number(id));
        } else if (action === "delete") {
          if (!confirm("کاربر حذف شود؟")) return;
          await api(`/api/users/${id}`, { method: "DELETE" });
        }
        toast("انجام شد ✓", "ok");
        loadUsers();
      } catch (error) {
        toast(error.message, "err");
      }
    };
  });
}

/* ----------------------------- wireguard ------------------------------- */

async function wireguardServerModal(id) {
  const response = await api(`/api/nodes/${id}/wireguard`);
  const data = response.data;
  modal({
    title: `🐧 کانفیگ سرور WireGuard — ${data.node}`,
    wide: true,
    body: `<div class="grid cols-4">
        <div class="stat"><div class="k">آدرس سرور</div><div class="v mono" style="font-size:13px">${esc(data.server_address ?? "—")}</div></div>
        <div class="stat"><div class="k">پورت</div><div class="v mono" style="font-size:13px">${esc(data.port ?? "—")}</div></div>
        <div class="stat"><div class="k">کاربران (Peer)</div><div class="v">${fa((data.peers ?? []).length)}</div></div>
        <div class="stat"><div class="k">کلید عمومی سرور</div><div class="v mono" style="font-size:10.5px">${esc((data.server_public_key ?? "—").slice(0, 22))}…</div></div>
      </div>
      <pre class="code" style="margin-top:12px;max-height:340px">${esc(data.config ?? "")}</pre>`,
    actions: [
      { label: "📋 کپی کانفیگ", onClick: async () => copyText(data.config ?? "") },
      { label: "💾 ذخیره در سرور", onClick: async () => {
          const written = await api(`/api/nodes/${id}/wireguard?write=true`);
          toast(`ذخیره شد: ${written.data.path} (${fa(written.data.peers)} کاربر)`, "ok");
        } },
      { label: "بستن", kind: "ghost" },
    ],
  });
}

async function wireguardUserModal(id) {
  const response = await api(`/api/users/${id}/wireguard`);
  const configs = response.data.configs ?? [];
  if (!configs.length) {
    modal({ title: "WireGuard", body: `<div class="empty">این کاربر روی هیچ نود WireGuard فعالی تنظیم نشده است</div>`, actions: [{ label: "بستن", kind: "ghost" }] });
    return;
  }
  modal({
    title: `🐧 کانفیگ WireGuard کاربر #${id}`,
    wide: true,
    body: configs
      .map(
        (item) => `<label class="f">${esc(item.node_name)} <span class="pill">${esc(item.address)}</span></label>
        <pre class="code" style="max-height:200px">${esc(item.config)}</pre>
        <div class="chips" style="margin-bottom:12px">
          <button class="btn sm" data-copy="${esc(item.config)}">📋 کپی</button>
          <button class="btn sm primary" data-download="${esc(item.config)}" data-name="${esc(item.download_name ?? "kalfetela-wireguard.conf")}">⬇️ دانلود فایل</button>
        </div>`
      )
      .join(""),
    actions: [{ label: "بستن", kind: "ghost" }],
  });
  $$("[data-copy]").forEach((button) => (button.onclick = () => copyText(button.dataset.copy)));
  $$("[data-download]").forEach((button) => {
    button.onclick = () => {
      const blob = new Blob([button.dataset.download], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = button.dataset.name;
      link.click();
      URL.revokeObjectURL(link.href);
    };
  });
}

/* -------------------------------- fleet -------------------------------- */

async function renderFleet() {
  setTitle("فلیت پنل‌ها", "مدیریت متمرکز ده‌ها پنل KalFetela روی Railway");
  setActions(`<button class="btn sm" id="fleet-refresh">🔄 بروزرسانی</button>
    <button class="btn sm primary" id="fleet-add">➕ افزودن پنل به فلیت</button>`);
  $("#fleet-refresh").onclick = () => route();
  $("#fleet-add").onclick = () => panelForm();

  $("#view").innerHTML = `<div class="card"><div id="fleet-totals">${loadingBox()}</div></div>
    <div class="card" style="margin-top:16px"><h3>🚀 پنل‌های فلیت</h3><div id="fleet-table">${loadingBox()}</div>
      <div class="hint" style="margin-top:12px">
        هر پنل KalFetela که روی Railway بالا آورده‌اید را با آدرس و <b>توکن API</b> (پنل مقصد → تنظیمات → API) اضافه کنید.
        بعد از افزودن، از «اینباندها/نودها» دکمهٔ «ایمپورت» را بزنید: نودهای پنل مقصد به‌صورت نود محلی اضافه می‌شوند و
        از آن به بعد ساختِ کاربر، مصرف و حذف، خودکار روی همان پنل انجام می‌شود.
      </div>
    </div>`;

  try {
    const response = await api("/api/panels/fleet");
    const { panels, totals } = response.data;
    const cards = [
      { k: "پنل‌ها", v: `${fa(totals.online)}/${fa(totals.panels)}`, d: "آنلاین / کل", cls: totals.online === totals.panels ? "ok" : "warn" },
      { k: "نودهای فلیت", v: fa(totals.nodes), d: `${fa(totals.local_users)} کاربر محلی`, cls: "" },
      { k: "کاربران پنل‌های مقصد", v: fa(totals.remote_users), d: "جمع همه پنل‌ها", cls: "info" },
      { k: "مصرف امروز فلیت", v: fmtBytes(totals.traffic_today), d: `درآمد کل: ${fmtToman(totals.revenue_total)}`, cls: "" },
    ];
    $("#fleet-totals").innerHTML = `<div class="grid cols-4">${cards
      .map((card) => `<div class="stat ${card.cls}"><div class="k">${card.k}</div><div class="v" style="font-size:18px">${card.v}</div><div class="d">${card.d}</div></div>`)
      .join("")}</div>`;

    if (!panels.length) {
      $("#fleet-table").innerHTML = `<div class="empty">هنوز پنلی به فلیت اضافه نشده است</div>`;
      return;
    }
    $("#fleet-table").innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>پنل</th><th>نوع</th><th>وضعیت</th><th>نودها</th><th>کاربران</th><th>مصرف امروز</th><th>منابع</th><th>عملیات</th>
    </tr></thead><tbody>${panels
      .map(
        (panel) => `<tr>
      <td><b>${esc(panel.name)}</b>
        <div class="mono" style="font-size:11px;color:#7d90b3">${esc(panel.base_url)}</div>
        ${(panel.tags ?? []).map((tag) => `<span class="pill" style="margin-inline-start:4px">${esc(tag)}</span>`).join("")}</td>
      <td><span class="pill">${esc(panel.type)}</span></td>
      <td>${panel.online ? '<span class="pill ok">آنلاین</span>' : `<span class="pill danger">${esc((panel.error ?? panel.last_error ?? "قطع").slice(0, 40))}</span>`}
        <div style="font-size:10.5px;color:#7d90b3">${panel.latency_ms ? `${fa(panel.latency_ms)}ms` : ""} ${panel.last_checked_at ? timeAgo(panel.last_checked_at) : ""}</div></td>
      <td>${fa(panel.node_count)} ${panel.nodes !== undefined ? `<span style="color:#7d90b3">(${fa(panel.nodes_online ?? 0)} آنلاین)</span>` : ""}</td>
      <td>${panel.local_users !== undefined ? `${fa(panel.local_users)} محلی` : ""}${panel.users !== undefined ? `<div style="font-size:11px;color:#7d90b3">${fa(panel.users)} کل</div>` : ""}</td>
      <td>${panel.traffic_today !== undefined ? fmtBytes(panel.traffic_today) : "—"}</td>
      <td style="font-size:11.5px">CPU ${fa(Math.round(panel.cpu ?? 0))}٪<br/>RAM ${fa(Math.round(panel.ram_percent ?? 0))}٪</td>
      <td><div class="chips">
        <button class="btn sm" data-fleet="nodes" data-id="${panel.id}">⬇️ نودها</button>
        <button class="btn sm" data-fleet="refresh" data-id="${panel.id}">🔄</button>
        <button class="btn sm" data-fleet="users" data-id="${panel.id}">👥 کاربران</button>
        <button class="btn sm" data-fleet="open" data-id="${panel.id}">↗️ بازکردن</button>
      </div></td></tr>`
      )
      .join("")}</tbody></table></div>`;

    $$("[data-fleet]").forEach((button) => {
      button.onclick = () => fleetAction(button.dataset.fleet, Number(button.dataset.id));
    });
  } catch (error) {
    $("#fleet-totals").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    $("#fleet-table").innerHTML = "";
  }
}

async function fleetAction(action, id) {
  try {
    if (action === "open") {
      const panel = (await api("/api/panels")).data.panels.find((item) => item.id === id);
      window.open(panel?.base_url ?? "", "_blank");
      return;
    }
    if (action === "refresh") {
      await api(`/api/panels/${id}/test`, { method: "POST" });
      toast("پنل بررسی شد", "ok");
      return route();
    }
    if (action === "users") {
      const snapshots = await Promise.all((await api(`/api/nodes?`)).data.nodes.filter((node) => node.panel_id === id).map((node) => api(`/api/nodes/${node.id}/users`)));
      const total = snapshots.reduce((sum, item) => sum + (item.data.users?.length ?? 0), 0);
      toast(`${total} کاربر روی نودهای این پنل`, "info");
      return;
    }
    if (action === "nodes") {
      const inbounds = (await api(`/api/panels/${id}/inbounds`)).data.inbounds ?? [];
      if (!inbounds.length) {
        toast("نودی در پنل مقصد پیدا نشد", "warn");
        return;
      }
      const host = prompt("دامنه/آی‌پی که کاربران به آن وصل شوند (خالی = آدرس خود پنل مقصد)", "");
      const result = await api(`/api/panels/${id}/import`, { method: "POST", body: { inbounds, host: host ?? "" } });
      toast(`${fa(result.data.created.length)} نود اضافه شد`, "ok");
      return route();
    }
  } catch (error) {
    toast(error.message, "err");
  }
}

/* ------------------------- apps, QR & guides --------------------------- */

async function renderApps() {
  setTitle("برنامه‌ها و QR", "کلاینت‌های پیشنهادی و ساخت QR برای لینک ساب");
  setActions("");
  const response = await api("/api/public/apps");
  const { apps, steps } = response.data;
  const users = (await api("/api/users?per_page=100&with_tokens=1")).data.users;
  $("#view").innerHTML = `
    <div class="card">
      <h3>🔳 ساخت QR برای لینک ساب</h3>
      <div class="row-2" style="align-items:end">
        <div><label class="f">لینک ساب یا هر متن دیگر</label><input class="input" id="qr-text" placeholder="https://.../sub/xxxx"/></div>
        <div><label class="f">یا کاربر را انتخاب کنید</label><select class="input" id="qr-user">
          <option value="">— انتخاب کاربر —</option>
          ${users.map((user) => `<option value="${user.id}" data-token="${esc(user.sub_token ?? "")}">${esc(user.username)}</option>`).join("")}
        </select></div>
      </div>
      <div class="chips" style="margin-top:12px">
        <button class="btn primary" id="qr-make">ساخت QR</button>
        <button class="btn" id="qr-download" disabled>⬇️ دانلود SVG</button>
        <button class="btn" id="qr-copy" disabled>📋 کپی لینک</button>
      </div>
      <div id="qr-out" style="margin-top:16px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>📱 راهنمای اتصال</h3>
      <div class="steps">${steps.map((step) => `<div class="step"><b>${esc(step.title)}</b><span>${esc(step.body)}</span></div>`).join("")}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>⬇️ کلاینت‌های پیشنهادی</h3>
      <div class="apps">${apps
        .map(
          (app) => `<a class="app" href="${app.url}" target="_blank" rel="noreferrer">
        <b>${esc(app.name)} ${app.featured ? "⭐" : ""}</b>
        <span class="muted">${app.platforms.map((p) => esc(p)).join(" · ")}</span>
        <span class="note">${esc(app.note)}</span>
        <span class="note mono">فرمت: ${app.formats.join(" / ")}</span>
      </a>`
        )
        .join("")}</div>
    </div>`;

  const makeQr = () => {
    const manual = $("#qr-text").value.trim();
    const selected = $("#qr-user");
    const option = selected.selectedOptions[0];
    const token = option?.dataset.token ?? "";
    const base = location.origin;
    const url = manual || (token ? `${base}/sub/${token}` : "");
    if (!url) return toast("یک لینک وارد کنید یا کاربر را انتخاب کنید", "warn");
    $("#qr-text").value = url;
    $("#qr-out").innerHTML = `<div class="qr-box"><img alt="QR" src="/api/qr?data=${encodeURIComponent(url)}&scale=6"/></div>
      <div class="copy-row"><input class="input" readonly value="${esc(url)}"/><button class="btn sm" id="qr-inline-copy">کپی</button></div>
      <div class="hint" style="margin-top:8px">با دوربین گوشی اسکن کنید تا لینک ساب مستقیم در برنامه اضافه شود.</div>`;
    $("#qr-inline-copy").onclick = () => copyText(url);
    $("#qr-download").disabled = false;
    $("#qr-copy").disabled = false;
    $("#qr-download").onclick = () => window.open(`/api/qr?data=${encodeURIComponent(url)}&scale=10`, "_blank");
    $("#qr-copy").onclick = () => copyText(url);
  };
  $("#qr-make").onclick = makeQr;
  $("#qr-user").onchange = () => {
    if ($("#qr-user").value) makeQr();
  };
  $("#qr-text").onkeydown = (event) => {
    if (event.key === "Enter") makeQr();
  };
}

/* -------------------------------- nodes -------------------------------- */
async function renderNodes() {
  setTitle("نودها و هسته", "اجرای Xray داخل پنل + اتصال به پنل‌های خارجی و ایجنت");
  setActions(`<button class="btn sm primary" id="new-node">➕ نود جدید</button>`);
  $("#new-node").onclick = () => nodeForm();
  const response = await api("/api/nodes");
  S.nodes = response.data.nodes;
  S.core = response.data.core;
  const embedded = S.nodes.filter((node) => node.kind === "embedded");
  const others = S.nodes.filter((node) => node.kind !== "embedded");

  $("#view").innerHTML = `
    <div class="card" id="core-card"></div>
    <div class="card" style="margin-top:16px">
      <h3>🌍 نودهای پنل / ایجنت / سفارشی</h3>
      <div id="other-nodes"></div>
    </div>`;

  renderCoreCard();
  $("#other-nodes").innerHTML = others.length ? nodeTable(others) : `<div class="empty">نود خارجی ثبت نشده است</div>`;
  bindNodeTable();
  void embedded;
}

function renderCoreCard() {
  const core = S.core ?? {};
  const embedded = S.nodes.filter((node) => node.kind === "embedded");
  $("#core-card").innerHTML = `
    <h3>🚀 هسته داخلی Xray (اجرا داخل همین سرور)</h3>
    <div class="grid cols-4">
      <div class="stat ${core.installed ? "ok" : "danger"}"><div class="k">هسته</div><div class="v" style="font-size:16px">${core.installed ? "نصب شده" : "نصب نشده"}</div><div class="d">${esc(core.version ?? "—")}</div></div>
      <div class="stat ${core.running ? "ok" : "warn"}"><div class="k">وضعیت</div><div class="v" style="font-size:16px">${core.running ? "در حال اجرا" : "متوقف"}</div><div class="d">PID ${esc(core.pid ?? "—")}</div></div>
      <div class="stat"><div class="k">پورت‌های فعال</div><div class="v" style="font-size:16px">${fa((core.ports ?? []).length)}</div><div class="d">${esc((core.ports ?? []).join(", ") || "—")}</div></div>
      <div class="stat ${core.error ? "danger" : ""}"><div class="k">آخرین خطا</div><div class="v" style="font-size:12px;font-weight:600">${esc((core.error ?? "بدون خطا").slice(0, 80))}</div><div class="d">API: ${esc(core.api_port ?? "")}</div></div>
    </div>
    <div class="chips" style="margin-top:14px">
      <button class="btn sm primary" id="core-install">⬇️ نصب / بروزرسانی هسته</button>
      <button class="btn sm" id="core-restart">↻ ری‌استارت</button>
      <button class="btn sm" id="core-config">🧾 مشاهده کانفیگ</button>
      <button class="btn sm" id="core-logs">📜 لاگ‌ها</button>
      <button class="btn sm" id="core-agent">🤖 نصب ایجنت روی VPS</button>
    </div>
    <div class="hint" style="margin-top:12px">
      برای اتصال کاربران به نود داخلی، در Railway از بخش Settings → Networking یک <b>TCP Proxy</b> روی پورتی که نود را روی آن ساخته‌اید بسازید و همان آدرس:پورت را در فیلد «آدرس/پورت نود» بگذارید.
    </div>
    <div id="embedded-nodes" style="margin-top:14px"></div>`;

  $("#embedded-nodes").innerHTML = embedded.length
    ? `<div class="table-wrap"><table><thead><tr><th>نام</th><th>پروتکل</th><th>پورت</th><th>امنیت</th><th>کاربران</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
      ${embedded
        .map(
          (node) => `<tr>
        <td><b>${esc(node.name)}</b><div class="mono" style="font-size:11px;color:#7d90b3">${esc(node.host)}</div></td>
        <td>${esc(node.protocol)} / ${esc(node.transport)}</td>
        <td class="mono">${esc(node.port)}</td>
        <td>${esc(node.security)}</td>
        <td>${fa(node.user_count)}</td>
        <td>${statusPill(node.status)}</td>
        <td><div class="chips">
          <button class="btn sm" data-node-act="edit" data-id="${node.id}">✏️</button>
          <button class="btn sm" data-node-act="test" data-id="${node.id}">🔍 تست</button>
          <button class="btn sm" data-node-act="sync" data-id="${node.id}">🔄</button>
          ${node.protocol === "wireguard" ? `<button class="btn sm" data-node-act="wireguard" data-id="${node.id}" title="کانفیگ سرور WireGuard">🐧</button>` : ""}
          <button class="btn sm danger" data-node-act="delete" data-id="${node.id}">🗑</button>
        </div></td></tr>`
        )
        .join("")}</tbody></table></div>`
    : `<div class="empty">نود داخلی ساخته نشده — با «نود جدید» یک نود از نوع «داخلی (Railway)» بسازید</div>`;

  $("#core-install").onclick = async () => {
    const button = $("#core-install");
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> در حال نصب…`;
    try {
      const result = await api("/api/nodes/core/install", { method: "POST", body: {} });
      toast(`هسته ${result.data.version} نصب شد ✓`, "ok");
      route();
    } catch (error) {
      toast(error.message, "err");
      button.disabled = false;
      button.textContent = "⬇️ نصب / بروزرسانی هسته";
    }
  };
  $("#core-restart").onclick = async () => {
    await api("/api/nodes/core/restart", { method: "POST" });
    toast("هسته ری‌استارت شد", "ok");
  };
  $("#core-config").onclick = async () => {
    const status = await api("/api/nodes/core/status");
    modal({
      title: "کانفیگ هسته Xray",
      wide: true,
      body: `<pre class="code">${esc(status.data.config ?? "هسته نصب نیست")}</pre>`,
      actions: [
        { label: "کپی کانفیگ", onClick: async () => copyText(status.data.config ?? "") },
        { label: "بستن", kind: "ghost" },
      ],
    });
  };
  $("#core-logs").onclick = async () => {
    const logs = await api("/api/system/logs?lines=150");
    modal({
      title: "لاگ‌های هسته",
      wide: true,
      body: `<h4>خطاها</h4><pre class="code">${esc(logs.data.xray_error || "—")}</pre><h4>دسترسی‌ها</h4><pre class="code">${esc(logs.data.xray_access || "—")}</pre>`,
      actions: [{ label: "بستن", kind: "ghost" }],
    });
  };
  $("#core-agent").onclick = async () => {
    const response = await api("/api/nodes/agent/script");
    modal({
      title: "راه‌اندازی ایجنت روی VPS",
      wide: true,
      body: `<div class="hint">Secret ایجنت: <code class="mono">${esc(response.data.secret)}</code></div><pre class="code">${esc(response.data.install)}</pre>`,
      actions: [
        { label: "کپی دستورها", onClick: async () => copyText(response.data.install) },
        { label: "بستن", kind: "ghost" },
      ],
    });
  };
  $$("[data-node-act]").forEach((button) => {
    button.onclick = () => nodeAction(button.dataset.id, button.dataset.nodeAct);
  });
}

function nodeTable(nodes) {
  return `<div class="table-wrap"><table><thead><tr><th>نام</th><th>نوع</th><th>پروتکل</th><th>آدرس</th><th>کاربران</th><th>وضعیت</th><th>منابع</th><th>عملیات</th></tr></thead><tbody>
    ${nodes
      .map(
        (node) => `<tr>
      <td><b>${esc(node.name)}</b></td>
      <td><span class="pill">${esc(node.kind)}</span></td>
      <td>${esc(node.protocol)} / ${esc(node.transport)} / ${esc(node.security)}</td>
      <td class="mono">${esc(node.host)}:${esc(node.port)}</td>
      <td>${fa(node.user_count)}</td>
      <td>${statusPill(node.status)}<div style="font-size:10.5px;color:#7d90b3">${node.last_heartbeat_at ? timeAgo(node.last_heartbeat_at) : ""}</div></td>
      <td style="font-size:11.5px">CPU ${fa(node.cpu_load ?? 0)}٪<br/>RAM ${fa(node.mem_load ?? 0)}٪</td>
      <td><div class="chips">
        <button class="btn sm" data-node-act="edit" data-id="${node.id}">✏️</button>
        <button class="btn sm" data-node-act="test" data-id="${node.id}">🔍</button>
        <button class="btn sm" data-node-act="sync" data-id="${node.id}">🔄</button>
        <button class="btn sm" data-node-act="preview" data-id="${node.id}">🔗</button>
        ${node.protocol === "wireguard" ? `<button class="btn sm" data-node-act="wireguard" data-id="${node.id}" title="کانفیگ سرور WireGuard">🐧</button>` : ""}
        <button class="btn sm danger" data-node-act="delete" data-id="${node.id}">🗑</button>
      </div></td></tr>`
      )
      .join("")}</tbody></table></div>`;
}

function bindNodeTable() {
  $$("[data-node-act]").forEach((button) => {
    button.onclick = () => nodeAction(button.dataset.id, button.dataset.nodeAct);
  });
}

async function nodeAction(id, action) {
  try {
    if (action === "edit") return nodeForm(Number(id));
    if (action === "test") {
      const result = await api(`/api/nodes/${id}/test`, { method: "POST" });
      toast(`نود پاسخ داد ✓ ${result.data.coreVersion ? `(نسخه ${result.data.coreVersion})` : ""}`, "ok");
      return;
    }
    if (action === "sync") {
      const result = await api(`/api/nodes/${id}/sync`, { method: "POST" });
      toast(`همگام‌سازی: ${result.data.synced} موفق / ${result.data.failed} خطا`, result.data.failed ? "warn" : "ok");
      return;
    }
    if (action === "preview") {
      const result = await api(`/api/nodes/${id}/preview`, { method: "POST" });
      modal({ title: "پیش‌نمایش لینک", body: `<div class="copy-row"><input class="input" readonly value="${esc(result.data.link ?? "—")}"/><button class="btn sm" id="cp">کپی</button></div>`, actions: [{ label: "بستن", kind: "ghost" }] });
      $("#cp").onclick = () => copyText(result.data.link ?? "");
      return;
    }
    if (action === "wireguard") return wireguardServerModal(Number(id));
    if (action === "delete") {
      if (!confirm("نود حذف شود؟")) return;
      await api(`/api/nodes/${id}`, { method: "DELETE" });
      toast("نود حذف شد", "ok");
      route();
    }
  } catch (error) {
    toast(error.message, "err");
  }
}

async function nodeForm(id) {
  let node = null;
  if (id) {
    const response = await api(`/api/nodes/${id}`);
    node = response.data.node;
  }
  const panels = (await api("/api/panels")).data.panels;
  const protocols = ["vless", "vmess", "trojan", "shadowsocks", "wireguard"];
  const transports = ["ws", "tcp", "grpc", "httpupgrade", "http", "quic"];
  const security = ["tls", "reality", "none"];

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="row-2">
      <div><label class="f">نام نود</label><input class="input" name="name" value="${esc(node?.name ?? "")}" placeholder="آلمان ۱"/></div>
      <div><label class="f">نوع نود</label>
        <select class="input" name="kind">
          <option value="embedded" ${node?.kind === "embedded" ? "selected" : ""}>داخلی (اجرای Xray در همین سرور)</option>
          <option value="panel" ${!node || node.kind === "panel" ? "selected" : ""}>پنل خارجی (3x-ui / مرزبان)</option>
          <option value="agent" ${node?.kind === "agent" ? "selected" : ""}>ایجنت روی VPS</option>
          <option value="custom" ${node?.kind === "custom" ? "selected" : ""}>سفارشی (فقط لینک)</option>
        </select>
      </div>
    </div>
    <div class="row-3">
      <div><label class="f">پروتکل</label><select class="input" name="protocol" id="f-protocol">${protocols.map((item) => `<option ${node?.protocol === item ? "selected" : ""}>${item}</option>`).join("")}</select>
        <div class="hint" id="wg-hint" style="display:none">برای WireGuard زنجیره‌ی کاربران: کلیدها خودکار ساخته می‌شوند؛ فقط «آدرس» (دامنه/آی‌پی) و «پورت» را درست بدهید. برای اجرا روی VPS از ایجنت با حالت WireGuard استفاده کنید.</div>
      </div>
      <div><label class="f">ترانسپورت</label><select class="input" name="transport">${transports.map((item) => `<option ${node?.transport === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
      <div><label class="f">امنیت</label><select class="input" name="security">${security.map((item) => `<option ${node?.security === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
    </div>
    <div class="row-2">
      <div><label class="f">آدرس (دامنه یا IP عمومی)</label><input class="input" name="host" value="${esc(node?.host ?? "")}" placeholder="example.up.railway.app"/></div>
      <div><label class="f">پورت</label><input class="input" name="port" type="number" value="${esc(node?.port ?? 10001)}"/></div>
    </div>
    <div class="row-3">
      <div><label class="f">برچسب‌ها (با کاما)</label><input class="input" name="tags" value="${(node?.tags ?? []).join(", ")}" placeholder="آلمان, پرسرعت, مشتری-A"/></div>
      <div><label class="f">ترتیب نمایش</label><input class="input" name="sort" type="number" value="${esc(node?.sort ?? 0)}"/></div>
    </div>
    <div class="row-3">
      <div><label class="f">SNI / Host هدر</label><input class="input" name="sni" value="${esc(node?.sni ?? "")}"/></div>
      <div><label class="f">Path (ws)</label><input class="input" name="path" value="${esc(node?.path ?? "/ws")}"/></div>
      <div><label class="f">ServiceName (grpc)</label><input class="input" name="service_name" value="${esc(node?.service_name ?? "")}"/></div>
    </div>
    <div class="row-3">
      <div><label class="f">Flow (Vision)</label><input class="input" name="flow" value="${esc(node?.flow ?? "")}" placeholder="xtls-rprx-vision"/></div>
      <div><label class="f">Fingerprint</label><input class="input" name="fingerprint" value="${esc(node?.fingerprint ?? "chrome")}"/></div>
      <div><label class="f">ALPN</label><input class="input" name="alpn" value="${esc(node?.alpn ?? "h2,http/1.1")}"/></div>
    </div>
    <div class="row-3 reality-only">
      <div><label class="f">REALITY dest</label><input class="input" name="reality_dest" value="${esc(node?.reality_dest ?? "www.cloudflare.com:443")}"/></div>
      <div><label class="f">ShortId</label><input class="input" name="reality_short_id" value="${esc(node?.reality_short_id ?? "")}"/></div>
      <div><label class="f">PublicKey (خودکار ساخته می‌شود)</label><input class="input" name="reality_public_key" value="${esc(node?.reality_public_key ?? "")}" ${node ? "readonly" : ""}/></div>
    </div>
    <div class="row-2 panel-only">
      <div><label class="f">پنل متصل</label><select class="input" name="panel_id">
        <option value="">— بدون پنل —</option>
        ${panels.map((panel) => `<option value="${panel.id}" ${node?.panel_id === panel.id ? "selected" : ""}>${esc(panel.name)} (${esc(panel.type)})</option>`).join("")}
      </select></div>
      <div><label class="f">شناسه اینباند روی پنل</label><input class="input" name="inbound_id" value="${esc(node?.inbound_id ?? "")}"/></div>
    </div>
    <div class="row-3 agent-only">
      <div><label class="f">Secret ایجنت</label><input class="input" name="agent_secret" value="${esc(node?.agent_secret ?? "")}"/></div>
    </div>
    <div class="row-3">
      <div><label class="f">DNS</label><input class="input" name="dns" value="${esc(node?.dns ?? "1.1.1.1, 8.8.8.8")}"/></div>
      <div><label class="f">MTU (WireGuard)</label><input class="input" name="mtu" type="number" value="${esc(node?.mtu ?? 1420)}"/></div>
      <div><label class="f">ظرفیت کاربر</label><input class="input" name="capacity" type="number" value="${esc(node?.capacity ?? 0)}"/></div>
    </div>
    <label class="check"><input type="checkbox" name="active" ${!node || node.active ? "checked" : ""}/> نود فعال باشد</label>`;

  const syncWireguardFields = () => {
    const isWg = wrap.querySelector("#f-protocol").value === "wireguard";
    const hint = wrap.querySelector("#wg-hint");
    if (hint) hint.style.display = isWg ? "block" : "none";
    const port = wrap.querySelector('[name="port"]');
    const transport = wrap.querySelector('[name="transport"]');
    const security = wrap.querySelector('[name="security"]');
    const sni = wrap.querySelector('[name="sni"]');
    if (transport) transport.closest("div").style.opacity = isWg ? ".45" : "1";
    if (security) security.closest("div").style.opacity = isWg ? ".45" : "1";
    if (sni) sni.closest("div").style.opacity = isWg ? ".45" : "1";
    if (isWg && port && Number(port.value) === 10001) port.value = "51820";
    if (!isWg && port && Number(port.value) === 51820) port.value = "10001";
  };
  wrap.querySelector("#f-protocol").onchange = syncWireguardFields;
  if (node?.protocol === "wireguard" || !id) syncWireguardFields();

  modal({
    title: id ? `ویرایش نود ${esc(node.name)}` : "افزودن نود جدید",
    body: wrap,
    wide: true,
    actions: [
      {
        label: "ذخیره",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          values.port = Number(values.port);
          values.panel_id = values.panel_id ? Number(values.panel_id) : null;
          values.mtu = values.mtu ? Number(values.mtu) : null;
          values.capacity = Number(values.capacity || 0);
          if (!values.name || !values.host || !values.port) {
            toast("نام، آدرس و پورت الزامی است", "err");
            return false;
          }
          if (id) await api(`/api/nodes/${id}`, { method: "PUT", body: values });
          else await api("/api/nodes", { method: "POST", body: values });
          toast("ذخیره شد ✓", "ok");
          route();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

/* ------------------------------- panels -------------------------------- */
async function renderPanels() {
  setTitle("پنل‌های متصل", "ورود به 3x-ui / مرزبان و ایمپورت اینباندها");
  setActions(`<button class="btn sm primary" id="new-panel">➕ افزودن پنل</button>`);
  $("#new-panel").onclick = () => panelForm();
  const [response, fleet] = await Promise.all([api("/api/panels"), api("/api/panels/fleet").catch(() => null)]);
  const panels = response.data.panels;
  const rows = fleet?.data?.panels ?? [];
  const live = Object.fromEntries(rows.map((row) => [row.id, row]));
  const totals = fleet?.data?.totals;
  $("#view").innerHTML = `
    ${totals ? `<div class="grid cols-5" style="margin-bottom:16px">
      <div class="stat"><div class="k">پنل‌ها</div><div class="v">${fa(totals.panels)}</div><div class="d">${fa(totals.online)} آنلاین</div></div>
      <div class="stat"><div class="k">ایمپورت‌شده</div><div class="v">${fa(totals.nodes)}</div><div class="d">${fa(totals.local_users)} کاربر محلی</div></div>
      <div class="stat"><div class="k">کاربران پنل‌های مقصد</div><div class="v">${fa(totals.remote_users)}</div><div class="d">مجموع همه پنل‌ها</div></div>
      <div class="stat"><div class="k">مصرف امروز فلیت</div><div class="v">${fmtBytes(totals.traffic_today)}</div><div class="d">از پنل‌های KalFetela</div></div>
      <div class="stat"><div class="k">درآمد پنل‌های مقصد</div><div class="v">${fmtToman(totals.revenue_total)}</div><div class="d">مجموع</div></div>
    </div>` : ""}
    <div class="card">
      <h3>🔌 پنل‌ها و فلیت (چندین اکانت / سرور روی Railway)</h3>
      <div id="panel-table"></div>
      <div class="hint" style="margin-top:12px">
        رمز ورود پنل‌های خارجی در دیتابیس ذخیره می‌شود؛ برای امنیت بیشتر از توکن API یا دسترسی محدود استفاده کنید.
      </div>
    </div>`;
  $("#panel-table").innerHTML = panels.length
    ? `<div class="table-wrap"><table><thead><tr><th>نام</th><th>نوع</th><th>آدرس</th><th>وضعیت</th><th>آخرین بررسی</th><th>عملیات</th></tr></thead><tbody>
      ${panels
        .map(
          (panel) => `<tr>
        <td><b>${esc(panel.name)}</b>
          ${(panel.tags ?? []).map((tag) => `<span class="pill" style="margin-inline-start:4px">${esc(tag)}</span>`).join("")}
          ${panel.node_count ? `<div style="font-size:11px;color:#7d90b3">${fa(panel.node_count)} نود · ${fa(panel.local_users ?? 0)} کاربر محلی</div>` : ""}
          ${live[panel.id]?.users !== undefined ? `<div style="font-size:11px;color:#7d90b3">پنل مقصد: ${fa(live[panel.id].users)} کاربر · ${fmtBytes(live[panel.id].traffic_today ?? 0)} امروز</div>` : ""}
        </td>
        <td><span class="pill">${esc(panel.type)}</span>${live[panel.id]?.latency_ms ? `<div style="font-size:11px;color:#7d90b3">${fa(live[panel.id].latency_ms)}ms</div>` : ""}</td>
        <td class="mono">${esc(panel.base_url)}</td>
        <td>${statusPill(panel.status)}<div style="font-size:11px;color:#7d90b3">${esc((panel.last_error ?? "").slice(0, 60))}</div></td>
        <td>${panel.last_checked_at ? timeAgo(panel.last_checked_at) : "—"}</td>
        <td><div class="chips">
          <button class="btn sm" data-panel-act="test" data-id="${panel.id}">🔍 تست</button>
          <button class="btn sm" data-panel-act="import" data-id="${panel.id}">⬇️ ایمپورت اینباند</button>
          ${panel.type === "kalfetela" ? `<button class="btn sm ok" data-panel-act="import-all" data-id="${panel.id}" title="همه‌ی نودهای پنل مقصد را یکجا اضافه کن">⚡ ایمپورت همه</button>` : ""}
          <button class="btn sm" data-panel-act="sync" data-id="${panel.id}" title="وضعیت و مصرف کاربران را از پنل مقصد بخوان">🤝 همگام‌سازی</button>
          <button class="btn sm" data-panel-act="edit" data-id="${panel.id}">✏️</button>
          <button class="btn sm danger" data-panel-act="delete" data-id="${panel.id}">🗑</button>
        </div></td></tr>`
        )
        .join("")}</tbody></table></div>`
    : `<div class="empty">پنلی متصل نشده است</div>`;

  $$("[data-panel-act]").forEach((button) => {
    button.onclick = async () => {
      const id = Number(button.dataset.id);
      const action = button.dataset.panelAct;
      try {
        if (action === "edit") return panelForm(panels.find((panel) => panel.id === id));
        if (action === "delete") {
          if (!confirm("پنل حذف شود؟")) return;
          await api(`/api/panels/${id}`, { method: "DELETE" });
          return route();
        }
        if (action === "test") {
          const result = await api(`/api/panels/${id}/test`, { method: "POST" });
          toast(`اتصال برقرار شد — ${fa(result.data.inbounds.length)} اینباند`, "ok");
          return route();
        }
        if (action === "import-all") {
          const result = await api(`/api/panels/${id}/inbounds`);
          const inbounds = result.data.inbounds ?? [];
          if (!inbounds.length) return toast("نودی در پنل مقصد پیدا نشد", "warn");
          const response = await api(`/api/panels/${id}/import`, { method: "POST", body: { inbounds } });
          toast(`${fa(response.data.created.length)} نود اضافه شد`, "ok");
          return route();
        }
        if (action === "sync") {
          const nodes = (await api("/api/nodes")).data.nodes.filter((node) => node.panel_id === id);
          const results = await Promise.allSettled(nodes.map((node) => api(`/api/nodes/${node.id}/sync`, { method: "POST" })));
          const okCount = results.filter((item) => item.status === "fulfilled").length;
          toast(`${fa(okCount)} از ${fa(nodes.length)} نود همگام شد`, okCount ? "ok" : "warn");
          return route();
        }
        if (action === "import") {
          const result = await api(`/api/panels/${id}/inbounds`);
          const inbounds = result.data.inbounds;
          const body = document.createElement("div");
          body.innerHTML = inbounds.length
            ? `<div class="hint">اینباندهای مورد نظر را انتخاب کنید تا به عنوان نود اضافه شوند.</div>
               <label class="f">آدرس سرور (دامنه یا IP که کاربران به آن وصل می‌شوند)</label>
               <input class="input" id="import-host" placeholder="server.example.com"/>
               <div style="margin-top:12px">${inbounds
                 .map(
                   (inbound) => `<label class="check"><input type="checkbox" class="imp" value="${inbound.id}" data-json='${esc(JSON.stringify(inbound))}'/> ${esc(inbound.remark)} — ${esc(inbound.protocol)} / ${esc(inbound.network ?? "")} / پورت ${esc(inbound.port)}</label>`
                 )
                 .join("")}</div>`
            : `<div class="empty">اینباندی پیدا نشد</div>`;
          modal({
            title: "ایمپورت اینباندها",
            body,
            wide: true,
            actions: [
              {
                label: "ایمپورت",
                kind: "primary",
                onClick: async () => {
                  const selected = $$(".imp:checked", body).map((box) => JSON.parse(box.dataset.json));
                  if (!selected.length) return false;
                  const host = $("#import-host", body).value.trim();
                  await api(`/api/panels/${id}/import`, { method: "POST", body: { inbounds: selected, host } });
                  toast("ایمپورت انجام شد ✓", "ok");
                  route();
                  return true;
                },
              },
              { label: "انصراف", kind: "ghost" },
            ],
          });
        }
      } catch (error) {
        toast(error.message, "err");
      }
    };
  });
}

function panelForm(panel) {
  const wrap = form([
    { label: "نام پنل", name: "name", value: panel?.name ?? "", placeholder: "آلمان ۱" },
    { label: "نوع", name: "type", type: "select", value: panel?.type ?? "x-ui", options: [
      { value: "kalfetela", label: "🚀 KalFetela (فلیت)" },
      { value: "x-ui", label: "3x-ui" },
      { value: "sanaei", label: "Sanaei" },
      { value: "alireza", label: "Alireza" },
      { value: "marzban", label: "Marzban" },
      { value: "custom", label: "سفارشی" },
    ] },
    { label: "آدرس پنل (با https://)", name: "base_url", value: panel?.base_url ?? "", placeholder: "https://panel.example.com:2053" },
    { label: "نام کاربری", name: "username", value: panel?.username ?? "" },
    { label: "رمز عبور", name: "password", type: "password", value: panel?.password ?? "" },
    { label: "توکن API (برای KalFetela و 3x-ui لازم است)", name: "api_token", value: panel?.api_token ?? "" },
    { label: "برچسب‌ها (با کاما جدا کنید)", name: "tags", value: (panel?.tags ?? []).join(", "), placeholder: "آلمان, پرسرعت" },
    { label: "یادداشت", name: "notes", value: panel?.notes ?? "" },
    { label: "مسیر پایه (اختیاری)", name: "base_path", value: (panel?.extra && (() => { try { return JSON.parse(panel.extra).base_path ?? ""; } catch { return ""; } })()) || "", placeholder: "xui" },
  ]);
  wrap.insertAdjacentHTML(
    "afterbegin",
    `<div class="hint" style="margin-bottom:10px">
      <b>KalFetela (فلیت):</b> آدرس ریشه‌ی پنل مقصد (مثلاً <span class="mono">https://xxx.up.railway.app</span>) را بگذارید و
      «توکن API» را از آن پنل بسازید: <b>تنظیمات → API</b> → ساخت کلید (<span class="mono">kf_…</span>).
      بعد از افزودن، با دکمه‌ی «ایمپورت همه» تمام نودهای آن پنل به‌عنوان نود اینجا اضافه می‌شوند و
      ساخت/حذف/مصرف کاربران از همین پنل مدیریت می‌شود.
    </div>`
  );
  modal({
    title: panel ? "ویرایش پنل" : "افزودن پنل",
    body: wrap,
    actions: [
      {
        label: "ذخیره",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          const body = {
            name: values.name,
            type: values.type,
            base_url: values.base_url,
            username: values.username,
            password: values.password,
            api_token: values.api_token,
            tags: values.tags,
            notes: values.notes,
            extra: values.base_path ? { base_path: values.base_path } : null,
          };
          if (panel) await api(`/api/panels/${panel.id}`, { method: "PUT", body });
          else await api("/api/panels", { method: "POST", body });
          toast("ذخیره شد ✓", "ok");
          route();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

/* -------------------------------- plans -------------------------------- */
async function renderPlans() {
  setTitle("پلن‌ها و تعرفه‌ها", "تعرفه‌ای که در ربات و صفحه فروش نمایش داده می‌شود");
  setActions(`<button class="btn sm primary" id="new-plan">➕ پلن جدید</button>`);
  $("#new-plan").onclick = () => planForm();
  const response = await api("/api/plans");
  const plans = response.data.plans;
  $("#view").innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table><thead><tr><th>نام</th><th>قیمت</th><th>حجم</th><th>مدت</th><th>دستگاه</th><th>سرعت</th><th>نودها</th><th>نمایش</th><th>عملیات</th></tr></thead>
        <tbody>${plans
          .map(
            (plan) => `<tr>
          <td><b>${esc(plan.name)}</b><div style="font-size:11px;color:#7d90b3">${esc(plan.description ?? "")}</div></td>
          <td>${fmtToman(plan.price)}</td>
          <td>${plan.data_gb ? `${fa(plan.data_gb)} گیگ` : "نامحدود"}</td>
          <td>${plan.days ? `${fa(plan.days)} روز` : "بدون انقضا"}</td>
          <td>${plan.device_limit ? fa(plan.device_limit) : "∞"}</td>
          <td>${plan.speed_mbps ? `${fa(plan.speed_mbps)} Mbps` : "آزاد"}</td>
          <td class="mono" style="font-size:11px">${esc(plan.node_ids ?? "همه")}</td>
          <td>${plan.visible ? '<span class="pill ok">فعال</span>' : '<span class="pill">مخفی</span>'}</td>
          <td><div class="chips">
            <button class="btn sm" data-plan-act="edit" data-id="${plan.id}">✏️</button>
            <button class="btn sm danger" data-plan-act="delete" data-id="${plan.id}">🗑</button>
          </div></td></tr>`
          )
          .join("")}</tbody></table>
      </div>
      ${plans.length ? "" : `<div class="empty">پلنی ساخته نشده است</div>`}
    </div>`;
  $$("[data-plan-act]").forEach((button) => {
    button.onclick = async () => {
      const id = Number(button.dataset.id);
      if (button.dataset.planAct === "edit") return planForm(plans.find((plan) => plan.id === id));
      if (!confirm("پلن حذف شود؟")) return;
      await api(`/api/plans/${id}`, { method: "DELETE" });
      route();
    };
  });
}

async function planForm(plan) {
  const nodes = (await api("/api/nodes")).data.nodes;
  const selected = new Set((plan?.node_ids ? JSON.parse(plan.node_ids) : []).map(Number));
  const wrap = document.createElement("div");
  wrap.innerHTML = form([
    { label: "نام پلن", name: "name", value: plan?.name ?? "" },
    { label: "قیمت (تومان)", name: "price", type: "number", value: plan?.price ?? 0 },
    { label: "حجم (گیگابایت — ۰ نامحدود)", name: "data_gb", type: "number", value: plan?.data_gb ?? 30 },
    { label: "مدت (روز)", name: "days", type: "number", value: plan?.days ?? 30 },
    { label: "تعداد دستگاه", name: "device_limit", type: "number", value: plan?.device_limit ?? 1 },
    { label: "محدودیت سرعت (Mbps)", name: "speed_mbps", type: "number", value: plan?.speed_mbps ?? 0 },
    { label: "توضیح", name: "description", value: plan?.description ?? "" },
  ]).innerHTML + `<label class="f">نودهای این پلن (خالی = همه نودها)</label><div class="chips">${nodes
    .map((node) => `<label class="chip"><input type="checkbox" value="${node.id}" ${selected.has(node.id) ? "checked" : ""} style="margin-inline-end:6px"/>${esc(node.name)}</label>`)
    .join("")}</div><label class="check"><input type="checkbox" name="visible" ${!plan || plan.visible ? "checked" : ""}/> در فروشگاه نمایش داده شود</label>`;
  modal({
    title: plan ? "ویرایش پلن" : "پلن جدید",
    body: wrap,
    actions: [
      {
        label: "ذخیره",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          const nodeIds = $$("input[type=checkbox]:checked", wrap)
            .filter((box) => box.name !== "visible")
            .map((box) => Number(box.value));
          const body = {
            name: values.name,
            price: Number(values.price || 0),
            data_gb: Number(values.data_gb || 0),
            days: Number(values.days || 0),
            device_limit: Number(values.device_limit || 0),
            speed_mbps: Number(values.speed_mbps || 0),
            description: values.description,
            visible: values.visible,
            node_ids: nodeIds,
          };
          if (plan) await api(`/api/plans/${plan.id}`, { method: "PUT", body });
          else await api("/api/plans", { method: "POST", body });
          toast("ذخیره شد ✓", "ok");
          route();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

/* ------------------------------- finance ------------------------------- */
async function renderFinance() {
  setTitle("پرداخت‌ها و درآمد", "سفارش‌های ربات، تایید و گزارش مالی");
  setActions(`<button class="btn sm" id="new-payment">➕ ثبت دستی</button>`);
  $("#new-payment").onclick = () => paymentForm();
  const [payments, report] = await Promise.all([api("/api/payments?limit=100"), api("/api/payments/report?days=30")]);
  const revenue = payments.data.revenue;
  $("#view").innerHTML = `
    <div class="grid cols-4">
      <div class="stat info"><div class="k">درآمد امروز</div><div class="v" style="font-size:17px">${fmtToman(revenue.today)}</div></div>
      <div class="stat"><div class="k">۳۰ روز اخیر</div><div class="v" style="font-size:17px">${fmtToman(revenue.month)}</div></div>
      <div class="stat ok"><div class="k">کل درآمد</div><div class="v" style="font-size:17px">${fmtToman(revenue.total)}</div></div>
      <div class="stat warn"><div class="k">در انتظار تایید</div><div class="v" style="font-size:17px">${fmtToman(revenue.pending)}</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>📈 فروش ۳۰ روز</h3><div id="rev-chart"></div></div>
      <div class="card"><h3>💳 روش‌های پرداخت</h3><div id="rev-methods"></div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>🧾 سفارش‌ها</h3>
      <div class="toolbar">
        <div class="chips" id="pay-filters">
          <button class="chip active" data-status="all">همه</button>
          <button class="chip" data-status="pending">در انتظار</button>
          <button class="chip" data-status="approved">تایید شده</button>
          <button class="chip" data-status="rejected">رد شده</button>
        </div>
      </div>
      <div id="pay-table"></div>
    </div>`;

  const renderPayments = (items) => {
    $("#pay-table").innerHTML = items.length
      ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>کاربر</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>تاریخ</th><th>عملیات</th></tr></thead><tbody>
        ${items
          .map(
            (payment) => `<tr>
          <td>${fa(payment.id)}</td>
          <td>${esc(payment.telegram_id ?? payment.user_id ?? "—")}</td>
          <td>${fmtToman(payment.amount)}</td>
          <td>${esc(payment.method)}</td>
          <td>${statusPill(payment.status)}</td>
          <td>${jdate(payment.created_at, true)}</td>
          <td><div class="chips">
            ${payment.status === "pending" ? `<button class="btn sm ok" data-pay="approve" data-id="${payment.id}">✅ تایید</button>
            <button class="btn sm danger" data-pay="reject" data-id="${payment.id}">❌ رد</button>` : ""}
            ${payment.status === "approved" ? `<button class="btn sm" data-pay="refund" data-id="${payment.id}">↩️ بازگشت</button>` : ""}
            <button class="btn sm danger" data-pay="delete" data-id="${payment.id}">🗑</button>
          </div></td></tr>`
          )
          .join("")}</tbody></table></div>`
      : `<div class="empty">سفارشی ثبت نشده است</div>`;
    $$("[data-pay]").forEach((button) => {
      button.onclick = async () => {
        const id = Number(button.dataset.id);
        const action = button.dataset.pay;
        try {
          if (action === "delete") {
            if (!confirm("حذف شود؟")) return;
            await api(`/api/payments/${id}`, { method: "DELETE" });
          } else if (action === "reject") {
            const reason = prompt("دلیل رد (اختیاری)") ?? "";
            await api(`/api/payments/${id}/reject`, { method: "POST", body: { reason } });
          } else {
            await api(`/api/payments/${id}/${action}`, { method: "POST" });
          }
          toast("انجام شد ✓", "ok");
          renderFinance();
        } catch (error) {
          toast(error.message, "err");
        }
      };
    });
  };
  renderPayments(payments.data.payments);

  $$("#pay-filters .chip").forEach((chip) => {
    chip.onclick = async () => {
      $$("#pay-filters .chip").forEach((item) => item.classList.remove("active"));
      chip.classList.add("active");
      const response = await api(`/api/payments?status=${chip.dataset.status}&limit=100`);
      renderPayments(response.data.payments);
    };
  });

  const daily = (report.data.daily ?? []).slice(0, 30).reverse();
  const max = Math.max(1, ...daily.map((item) => Number(item.total)));
  $("#rev-chart").innerHTML = daily.length
    ? `<div class="chart">${daily
        .map((item) => `<div class="col" title="${item.day}: ${fmtToman(item.total)}"><span style="height:${Math.round((Number(item.total) / max) * 100)}%"></span></div>`)
        .join("")}</div>
       <div style="font-size:12px;color:var(--muted);margin-top:6px">مجموع ۳۰ روز: ${fmtToman(daily.reduce((sum, item) => sum + Number(item.total), 0))}</div>`
    : `<div class="empty">داده‌ای نیست</div>`;
  $("#rev-methods").innerHTML = report.data.by_method?.length
    ? `<div class="kv">${report.data.by_method
        .map((item) => `<div class="k">${esc(item.method)}</div><div>${fmtToman(item.total)} <span style="color:var(--muted)">(${fa(item.count)} پرداخت)</span></div>`)
        .join("")}</div>`
    : `<div class="empty">داده‌ای نیست</div>`;
}

function paymentForm() {
  const wrap = form([
    { label: "شناسه کاربر (اختیاری)", name: "user_id", type: "number" },
    { label: "آیدی تلگرام (اختیاری)", name: "telegram_id" },
    { label: "مبلغ (تومان)", name: "amount", type: "number", value: 0 },
    { label: "روش", name: "method", type: "select", value: "manual", options: [
      { value: "manual", label: "دستی" },
      { value: "card", label: "کارت به کارت" },
      { value: "gateway", label: "درگاه" },
      { value: "wallet", label: "کیف پول" },
      { value: "crypto", label: "کریپتو" },
    ] },
    { label: "شرح", name: "note" },
    { type: "html", html: `<label class="check"><input type="checkbox" name="approved" checked/> همین حالا تایید شود</label>` },
  ]);
  modal({
    title: "ثبت پرداخت دستی",
    body: wrap,
    actions: [
      {
        label: "ثبت",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          await api("/api/payments", {
            method: "POST",
            body: {
              user_id: values.user_id ? Number(values.user_id) : null,
              telegram_id: values.telegram_id,
              amount: Number(values.amount || 0),
              method: values.method,
              note: values.note,
              status: values.approved ? "approved" : "pending",
            },
          });
          toast("ثبت شد ✓", "ok");
          renderFinance();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

/* ------------------------------- tickets ------------------------------- */
async function renderTickets() {
  setTitle("تیکت‌ها", "پیام‌های کاربران از ربات و سایت");
  setActions(`<button class="btn sm" id="broadcast">📣 پیام گروهی</button>`);
  $("#broadcast").onclick = () => {
    const wrap = form([{ label: "متن پیام برای همه کاربران (از طریق ربات)", name: "text", type: "textarea" }]);
    modal({
      title: "ارسال پیام گروهی",
      body: wrap,
      actions: [
        {
          label: "ارسال",
          kind: "primary",
          onClick: async () => {
            const values = formValues(wrap);
            const result = await api("/api/tickets/broadcast", { method: "POST", body: { text: values.text } });
            toast(`${fa(result.data.sent)} پیام ارسال شد`, "ok");
            return true;
          },
        },
        { label: "انصراف", kind: "ghost" },
      ],
    });
  };
  const response = await api("/api/tickets");
  const tickets = response.data.tickets;
  $("#view").innerHTML = `<div class="card"><div id="ticket-table"></div></div>`;
  $("#ticket-table").innerHTML = tickets.length
    ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>موضوع</th><th>فرستنده</th><th>وضعیت</th><th>آخرین بروزرسانی</th><th></th></tr></thead><tbody>
      ${tickets
        .map(
          (ticket) => `<tr>
        <td>${fa(ticket.id)}</td>
        <td><b>${esc(ticket.subject)}</b><div style="font-size:11px;color:#7d90b3">${esc(ticket.category)}</div></td>
        <td>${esc(ticket.name ?? "—")}<div class="mono" style="font-size:11px">${esc(ticket.telegram_id ?? "")}</div></td>
        <td>${statusPill(ticket.status)}</td>
        <td>${timeAgo(ticket.updated_at)}</td>
        <td><button class="btn sm" data-ticket="${ticket.id}">مشاهده و پاسخ</button></td></tr>`
        )
        .join("")}</tbody></table></div>`
    : `<div class="empty">تیکتی وجود ندارد</div>`;
  $$("[data-ticket]").forEach((button) => {
    button.onclick = () => ticketView(Number(button.dataset.ticket));
  });
}

async function ticketView(id) {
  const response = await api(`/api/tickets/${id}`);
  const { ticket, messages } = response.data;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="hint">موضوع: <b>${esc(ticket.subject)}</b> — ${statusPill(ticket.status)}</div>
    <div style="max-height:320px;overflow:auto;margin-top:12px">
      ${messages
        .map(
          (message) => `<div class="card" style="padding:10px;margin-bottom:8px;background:${message.author === "admin" ? "#0d1b2e" : "#0b1220"}">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${message.author === "admin" ? "مدیر" : "کاربر"} · ${jdate(message.created_at, true)}</div>
        <div style="font-size:13px;line-height:2;white-space:pre-wrap">${esc(message.body)}</div></div>`
        )
        .join("")}
    </div>
    <label class="f">پاسخ شما (به کاربر در تلگرام ارسال می‌شود)</label>
    <textarea class="input" id="ticket-reply"></textarea>
    <div class="chips" style="margin-top:10px">
      <button class="btn sm ok" data-status="closed">بستن تیکت</button>
    </div>`;
  modal({
    title: `تیکت #${id}`,
    body: wrap,
    actions: [
      {
        label: "ارسال پاسخ",
        kind: "primary",
        onClick: async () => {
          const text = $("#ticket-reply", wrap).value.trim();
          if (!text) return false;
          await api(`/api/tickets/${id}/reply`, { method: "POST", body: { body: text } });
          toast("پاسخ ارسال شد ✓", "ok");
          renderTickets();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
  $$("[data-status]", wrap).forEach((button) => {
    button.onclick = async () => {
      await api(`/api/tickets/${id}`, { method: "PUT", body: { status: button.dataset.status } });
      toast("وضعیت تیکت تغییر کرد", "ok");
      renderTickets();
    };
  });
}

/* -------------------------------- admins ------------------------------- */
async function renderAdmins() {
  setTitle("ادمین‌ها و نمایندگان", "دسترسی، سقف حجم و کیف پول");
  setActions(`<button class="btn sm primary" id="new-admin">➕ ادمین جدید</button>`);
  $("#new-admin").onclick = () => adminForm();
  const response = await api("/api/admins");
  const admins = response.data.admins;
  S.admins = admins;
  $("#view").innerHTML = `<div class="card"><div class="table-wrap">
    <table><thead><tr><th>نام کاربری</th><th>نقش</th><th>کاربران</th><th>مصرف / سقف</th><th>کیف پول</th><th>دسترسی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
    ${admins
      .map(
        (admin) => `<tr>
      <td><b>${esc(admin.username)}</b><div style="font-size:11px;color:#7d90b3">آخرین ورود: ${admin.last_login_at ? timeAgo(admin.last_login_at) : "—"}</div></td>
      <td>${admin.role === "owner" ? '<span class="pill violet">مدیر اصلی</span>' : admin.role === "reseller" ? '<span class="pill info">نماینده</span>' : '<span class="pill">ادمین</span>'}</td>
      <td>${fa(admin.user_count)}${admin.max_users ? ` / ${fa(admin.max_users)}` : ""}</td>
      <td style="min-width:150px">
        <div style="font-size:12px">${fmtBytes(admin.used_bytes)}${admin.quota_bytes ? ` از ${fmtBytes(admin.quota_bytes)}` : ""}</div>
        <div class="bar ${admin.limit_reached ? "hot" : ""}"><i style="width:${admin.quota_bytes ? Math.min(100, Math.round((admin.used_bytes / admin.quota_bytes) * 100)) : 3}%"></i></div>
      </td>
      <td>${fmtToman(admin.credit)}</td>
      <td style="font-size:11.5px">${admin.can_manage_nodes ? "🌐 نودها " : ""}${admin.can_manage_admins ? "🛡 ادمین " : ""}${admin.can_use_bot ? "🤖 ربات" : ""}</td>
      <td>${statusPill(admin.status)}</td>
      <td><div class="chips">
        <button class="btn sm" data-admin-act="edit" data-id="${admin.id}">✏️</button>
        <button class="btn sm" data-admin-act="credit" data-id="${admin.id}">💰</button>
        <button class="btn sm" data-admin-act="impersonate" data-id="${admin.id}">👤 ورود</button>
        <button class="btn sm danger" data-admin-act="delete" data-id="${admin.id}">🗑</button>
      </div></td></tr>`
      )
      .join("")}</tbody></table></div></div>`;
  $$("[data-admin-act]").forEach((button) => {
    button.onclick = async () => {
      const id = Number(button.dataset.id);
      const action = button.dataset.adminAct;
      const admin = admins.find((item) => item.id === id);
      try {
        if (action === "edit") return adminForm(admin);
        if (action === "credit") {
          const amount = Number(prompt("مبلغ شارژ (تومان) — عدد منفی برای برداشت:", "100000"));
          if (!amount) return;
          await api(`/api/admins/${id}/credit`, { method: "POST", body: { amount: Math.abs(amount), mode: amount < 0 ? "subtract" : "add" } });
          toast("کیف پول به‌روز شد", "ok");
          return route();
        }
        if (action === "impersonate") {
          await api(`/api/admins/${id}/impersonate`, { method: "POST" });
          location.reload();
          return;
        }
        if (action === "delete") {
          if (!confirm(`ادمین ${admin.username} حذف شود؟`)) return;
          await api(`/api/admins/${id}`, { method: "DELETE" });
          toast("حذف شد", "ok");
          route();
        }
      } catch (error) {
        toast(error.message, "err");
      }
    };
  });
}

function adminForm(admin) {
  const wrap = form([
    { label: "نام کاربری", name: "username", value: admin?.username ?? "" },
    { label: admin ? "رمز عبور جدید (خالی = بدون تغییر)" : "رمز عبور", name: "password", type: "password" },
    { label: "نقش", name: "role", type: "select", value: admin?.role ?? "reseller", options: [
      { value: "admin", label: "ادمین" },
      { value: "reseller", label: "نماینده فروش" },
    ] },
    { label: "سقف حجم کل (بایت — ۰ نامحدود)", name: "quota_bytes", type: "number", value: admin?.quota_bytes ?? 0 },
    { label: "سقف تعداد کاربر", name: "max_users", type: "number", value: admin?.max_users ?? 0 },
    { label: "کیف پول (تومان)", name: "credit", type: "number", value: admin?.credit ?? 0 },
    { label: "آیدی تلگرام", name: "telegram_id", value: admin?.telegram_id ?? "" },
    { label: "یادداشت", name: "note", value: admin?.note ?? "" },
    { type: "html", html: `<label class="check"><input type="checkbox" name="can_manage_nodes" ${!admin || admin.can_manage_nodes ? "checked" : ""}/> مدیریت نودها</label>` },
    { type: "html", html: `<label class="check"><input type="checkbox" name="can_manage_admins" ${admin?.can_manage_admins ? "checked" : ""}/> مدیریت ادمین‌ها</label>` },
    { type: "html", html: `<label class="check"><input type="checkbox" name="can_use_bot" ${!admin || admin.can_use_bot ? "checked" : ""}/> دسترسی به ربات</label>` },
    ...(admin ? [{ type: "html", html: `<label class="check"><input type="checkbox" name="status_disabled" ${admin.status === "disabled" ? "checked" : ""}/> غیرفعال کردن حساب</label>` }] : []),
  ]);
  modal({
    title: admin ? `ویرایش ${esc(admin.username)}` : "افزودن ادمین / نماینده",
    body: wrap,
    actions: [
      {
        label: "ذخیره",
        kind: "primary",
        onClick: async () => {
          const values = formValues(wrap);
          const body = {
            username: values.username,
            password: values.password || undefined,
            role: values.role,
            quota_bytes: Number(values.quota_bytes || 0),
            max_users: Number(values.max_users || 0),
            credit: Number(values.credit || 0),
            telegram_id: values.telegram_id,
            note: values.note,
            can_manage_nodes: values.can_manage_nodes,
            can_manage_admins: values.can_manage_admins,
            can_use_bot: values.can_use_bot,
            status: values.status_disabled ? "disabled" : "active",
          };
          if (admin) await api(`/api/admins/${admin.id}`, { method: "PUT", body });
          else await api("/api/admins", { method: "POST", body });
          toast("ذخیره شد ✓", "ok");
          route();
          return true;
        },
      },
      { label: "انصراف", kind: "ghost" },
    ],
  });
}

/* ------------------------------- settings ------------------------------ */
let settingsTab = "brand";

async function renderSettings() {
  setTitle("تنظیمات پنل", "برند، ربات، فروشگاه، Xray، امنیت و بکاپ");
  const response = await api("/api/settings");
  S.settings = response.data.settings;
  const s = S.settings;
  const tabs = [
    ["brand", "برند و عمومي"],
    ["bot", "ربات تلگرام"],
    ["shop", "فروشگاه و پرداخت"],
    ["notify", "اعلان‌ها"],
    ["xray", "Xray و مسیریابی"],
    ["security", "امنیت"],
    ["api", "API و یکپارچه‌سازی"],
    ["backup", "بکاپ و نگهداری"],
  ];
  $("#view").innerHTML = `
    <div class="card">
      <div class="tabs">${tabs.map(([key, label]) => `<button data-tab="${key}" class="${settingsTab === key ? "active" : ""}">${esc(label)}</button>`).join("")}</div>
      <div id="settings-body"></div>
    </div>`;
  $$("[data-tab]").forEach((button) => {
    button.onclick = () => {
      settingsTab = button.dataset.tab;
      $$("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
      renderSettingsTab();
    };
  });
  renderSettingsTab();

  function renderSettingsTab() {
    const body = $("#settings-body");
    const field = (key, label, type = "text", options = null) =>
      options
        ? `<label class="f">${esc(label)}</label><select class="input" data-key="${key}">${options.map(([value, text]) => `<option value="${esc(value)}" ${s[key] === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>`
        : `<label class="f">${esc(label)}</label><input class="input" data-key="${key}" type="${type}" value="${esc(s[key] ?? "")}"/>`;
    const textarea = (key, label) => `<label class="f">${esc(label)}</label><textarea class="input" data-key="${key}">${esc(s[key] ?? "")}</textarea>`;
    const saveButton = (extra = "") => `<div class="chips" style="margin-top:16px"><button class="btn primary" id="save-settings">💾 ذخیره تغییرات</button>${extra}</div>`;

    if (settingsTab === "brand") {
      body.innerHTML = `
        <div class="row-2">${field("panel_name", "نام پنل / برند")}${field("brand_tagline", "شعار پنل")}</div>
        <div class="row-3">${field("support_id", "آیدی پشتیبانی تلگرام")}${field("support_link", "لینک پشتیبانی")}${field("channel_link", "لینک کانال")}</div>
        <div class="row-3">${field("server_location", "موقعیت سرور (نمایشی)")}${field("host_name", "نام هاست")}${field("panel_path", "مسیر پنل")}</div>
        ${textarea("announcement", "اعلان بالای صفحه و ربات")}
        ${field("announcement_active", "نمایش اعلان", "text", [["false", "خیر"], ["true", "بله"]])}
        ${saveButton()}`;
    }
    if (settingsTab === "bot") {
      body.innerHTML = `
        <div class="row-2">
          ${field("bot_token", "توکن ربات (از BotFather)", "password")}
          ${field("bot_owner_ids", "آیدی عددی مدیران (با کاما جدا کنید)")}
        </div>
        <div class="row-2">
          ${field("bot_shop_enabled", "فروش از طریق ربات", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("bot_auto_approve", "تایید خودکار سفارش‌ها", "text", [["false", "دستی"], ["true", "خودکار"]])}
        </div>
        <div class="row-2">
          ${field("trial_enabled", "تست رایگان", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("trial_days", "مدت تست (روز)")}
        </div>
        <div class="row-2">${field("trial_gb", "حجم تست (گیگ)")}${field("register_enabled", "ثبت‌نام از سایت", "text", [["false", "غیرفعال"], ["true", "فعال"]])}</div>
        ${textarea("bot_welcome", "پیام خوش‌آمد ربات")}
        <div id="bot-status" class="hint"></div>
        ${saveButton(`<button class="btn" id="bot-test">🧪 ارسال پیام تست</button><button class="btn ghost" id="bot-status-btn">وضعیت ربات</button>`)}`;
      $("#bot-test").onclick = async () => {
        await saveSettings();
        await api("/api/settings/bot/test", { method: "POST", body: { text: "✅ تست موفق — پنل KalFetela" } });
        toast("پیام تست ارسال شد", "ok");
      };
      $("#bot-status-btn").onclick = async () => {
        const status = await api("/api/settings/bot/status");
        $("#bot-status").innerHTML = `وضعیت پولینگ: <b>${status.data.polling ? "فعال" : "غیرفعال"}</b> · توکن: ${status.data.token_set ? "✓" : "✗"} ${status.data.info ? `· ربات: @${esc(status.data.info.username)}` : ""}`;
      };
    }
    if (settingsTab === "shop") {
      body.innerHTML = `
        <div class="row-2">${field("card_number", "شماره کارت")}${field("card_holder", "به نام")}</div>
        ${textarea("payment_instructions", "توضیح روش پرداخت")}
        <div class="row-3">${field("usdt_enabled", "پرداخت USDT", "text", [["false", "غیرفعال"], ["true", "فعال"]])}${field("usdt_rate", "نرخ دلار (تومان)")}${field("usdt_wallet", "آدرس ولت (TRC20)")}</div>
        ${field("subscription_note", "توضیح زیر لینک ساب")}
        ${saveButton()}`;
    }
    if (settingsTab === "notify") {
      body.innerHTML = `
        <div class="row-3">
          ${field("telegram_notify_expiry", "اعلان انقضا", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("notify_expiry_days", "چند روز مانده اطلاع بده (با کاما)")}
          ${field("notify_low_quota_percent", "درصد هشدار حجم")}
        </div>
        <div class="row-3">
          ${field("telegram_notify_quota", "اعلان اتمام حجم", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("telegram_notify_login", "اعلان ورود کاربران", "text", [["false", "خیر"], ["true", "بله"]])}
          ${field("telegram_report_daily", "گزارش روزانه برای مدیر", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
        </div>
        ${field("device_limit_block", "قطع خودکار کاربر با دستگاه بیشتر از حد", "text", [["false", "خیر"], ["true", "بله"]])}
        ${saveButton()}`;
    }
    if (settingsTab === "xray") {
      body.innerHTML = `
        <div class="row-3">
          ${field("xray_log_level", "سطح لاگ", "text", [["warning", "warning"], ["info", "info"], ["error", "error"], ["debug", "debug"]])}
          ${field("xray_fragment", "Fragment (ایران)")}
          ${field("xray_dns", "DNS سرور")}
        </div>
        <div class="row-3">
          ${field("xray_route_iran", "مسیریابی مستقیم ایران", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("xray_block_ads", "مسدودسازی تبلیغات", "text", [["true", "فعال"], ["false", "غیرفعال"]])}
          ${field("online_window_minutes", "بازه «آنلاین» (دقیقه)")}
        </div>
        ${textarea("blocked_domains", "دامنه‌های بلاک (هر خط یکی)")}
        ${textarea("direct_domains", "دامنه‌های مستقیم (هر خط یکی)")}
        <div class="chips" style="margin-top:12px"><button class="btn" id="rules-preview">👁 پیش‌نمایش قوانین Xray</button></div>
        <div id="rules-box" style="margin-top:12px"></div>
        ${saveButton()}`;
      $("#rules-preview").onclick = async () => {
        await saveSettings();
        const response = await api("/api/settings/xray-rules");
        $("#rules-box").innerHTML = `<pre class="code">${esc(response.data.rules)}</pre>`;
      };
    }
    if (settingsTab === "security") {
      body.innerHTML = `
        <div class="row-3">
          ${field("security_2fa", "ورود دو مرحله‌ای با تلگرام", "text", [["false", "غیرفعال"], ["true", "فعال"]])}
          ${field("login_rate_limit", "حداکثر تلاش ورود ناموفق")}
          ${field("allow_multi_connection", "اجازه اتصال چند دستگاه", "text", [["true", "بله"], ["false", "خیر"]])}
        </div>
        <div class="row-2">${field("ip_limit_per_user", "سقف IP هر کاربر (۰ = آزاد)")}${field("backup_keep_days", "نگهداری بکاپ (روز)")}</div>
        ${saveButton()}`;
    }
    if (settingsTab === "api") {
      body.innerHTML = `
        <div class="hint">با کلید API می‌توانید از سیستم‌های بیرونی (بات، CRM، اسکریپت) کاربر بسازید و مصرف بگیرید. هدر <code class="mono">X-API-Key</code> را ارسال کنید.</div>
        <div class="chips" style="margin-top:12px"><button class="btn primary" id="new-token">➕ ساخت کلید جدید</button></div>
        <div id="token-list" style="margin-top:14px">${loadingBox()}</div>
        <h4 style="margin-top:18px">نمونه فراخوانی</h4>
        <pre class="code">curl -H "X-API-Key: kf_xxx" https://YOUR-DOMAIN/api/users
curl -X POST -H "X-API-Key: kf_xxx" -H "content-type: application/json" \\
  -d '{"username":"ali","data_gb":50,"days":30}' https://YOUR-DOMAIN/api/users</pre>
        ${saveButton()}`;
      const loadTokens = async () => {
        const response = await api("/api/settings/tokens");
        $("#token-list").innerHTML = response.data.tokens.length
          ? `<div class="table-wrap"><table><thead><tr><th>نام</th><th>کلید</th><th>ساخته شده</th><th>آخرین استفاده</th><th></th></tr></thead><tbody>
            ${response.data.tokens
              .map(
                (token) => `<tr><td>${esc(token.name)}</td><td class="mono">${esc(token.token)}</td><td>${jdate(token.created_at)}</td><td>${token.last_used_at ? timeAgo(token.last_used_at) : "—"}</td>
              <td><button class="btn sm danger" data-token="${token.id}">🗑</button></td></tr>`
              )
              .join("")}</tbody></table></div>`
          : `<div class="empty">کلیدی ساخته نشده است</div>`;
        $$("[data-token]").forEach((button) => {
          button.onclick = async () => {
            await api(`/api/settings/tokens/${button.dataset.token}`, { method: "DELETE" });
            loadTokens();
          };
        });
      };
      loadTokens();
      $("#new-token").onclick = async () => {
        const name = prompt("نام کلید:", "integration") ?? "integration";
        const response = await api("/api/settings/tokens", { method: "POST", body: { name, scopes: "*" } });
        modal({
          title: "کلید API ساخته شد",
          body: `<div class="hint">این کلید فقط یک بار نمایش داده می‌شود.</div><div class="copy-row"><input class="input" readonly value="${esc(response.data.token)}"/><button class="btn sm" id="cp">کپی</button></div>`,
          actions: [{ label: "بستن", kind: "ghost" }],
        });
        $("#cp").onclick = () => copyText(response.data.token);
        loadTokens();
      };
    }
    if (settingsTab === "backup") {
      body.innerHTML = `
        <div class="chips">
          <button class="btn primary" id="bk-now">💾 ساخت بکاپ</button>
          <a class="btn" href="/api/settings/backup/download" target="_blank">⬇️ دانلود بکاپ کامل</a>
          <button class="btn" id="bk-list">📂 لیست بکاپ‌ها</button>
          <button class="btn danger" id="bk-prune">🧹 پاکسازی قدیمی‌ها</button>
        </div>
        <div id="bk-box" style="margin-top:14px"></div>
        <h4 style="margin-top:18px">نگهداری</h4>
        <div class="chips">
          <button class="btn" data-maint="purge-traffic">🗑 حذف لاگ ترافیک قدیمی</button>
          <button class="btn" data-maint="purge-sessions">🚪 پاکسازی نشست‌ها</button>
          <button class="btn" data-maint="purge-devices">📱 پاکسازی دستگاه‌ها</button>
          <button class="btn" data-maint="vacuum">⚡ بهینه‌سازی دیتابیس</button>
          <button class="btn" data-maint="restart-xray">🔄 ری‌استارت Xray</button>
        </div>
        ${saveButton()}`;
      $("#bk-now").onclick = async () => {
        const result = await api("/api/settings/backups", { method: "POST" });
        toast(`بکاپ ساخته شد (${fmtBytes(result.data.bytes)})`, "ok");
      };
      $("#bk-list").onclick = async () => {
        const response = await api("/api/settings/backups");
        $("#bk-box").innerHTML = response.data.backups.length
          ? `<div class="table-wrap"><table><thead><tr><th>نام</th><th>حجم</th><th>تاریخ</th><th></th></tr></thead><tbody>
            ${response.data.backups
              .map(
                (backup) => `<tr><td class="mono" style="font-size:11px">${esc(backup.name)}</td><td>${fmtBytes(backup.bytes)}</td><td>${jdate(backup.createdAt, true)}</td>
              <td><div class="chips"><a class="btn sm" target="_blank" href="/api/settings/backup/download?name=${encodeURIComponent(backup.name)}">⬇️</a>
              <button class="btn sm danger" data-restore="${esc(backup.name)}">↩️ بازگردانی</button></div></td></tr>`
              )
              .join("")}</tbody></table></div>`
          : `<div class="empty">بکاپی ذخیره نشده است</div>`;
        $$("[data-restore]").forEach((button) => {
          button.onclick = () => {
            if (!confirm("بازگردانی، داده‌های فعلی را جایگزین می‌کند. مطمئن هستید؟")) return;
            api("/api/settings/restore", { method: "POST", body: { name: button.dataset.restore, wipe: true } })
              .then(() => toast("بازگردانی انجام شد — صفحه را رفرش کنید", "ok"))
              .catch((error) => toast(error.message, "err"));
          };
        });
      };
      $("#bk-prune").onclick = async () => {
        const response = await api("/api/settings/backups", { method: "DELETE" });
        toast(`${fa(response.data.removed)} بکاپ قدیمی حذف شد`, "ok");
      };
      $$("[data-maint]").forEach((button) => {
        button.onclick = async () => {
          const response = await api("/api/settings/maintenance", { method: "POST", body: { action: button.dataset.maint } });
          toast(response.data.message ?? `${fa(response.data.removed ?? 0)} مورد پردازش شد`, "ok");
        };
      });
    }

    $("#save-settings").onclick = () => saveSettings();
  }

  async function saveSettings() {
    const values = {};
    $$("[data-key]").forEach((input) => {
      values[input.dataset.key] = input.value;
    });
    await api("/api/settings", { method: "PUT", body: values });
    S.settings = { ...S.settings, ...values };
    if (S.settings.panel_name) $("#brand-name").textContent = S.settings.panel_name;
    toast("تنظیمات ذخیره شد ✓", "ok");
  }
  window.__saveSettings = saveSettings;
}

/* -------------------------------- system ------------------------------- */
async function renderSystem() {
  setTitle("سیستم", "منابع سرور، سلامت، لاگ‌ها و بروزرسانی");
  setActions(`<button class="btn sm" id="check-update">🔍 بررسی بروزرسانی</button>`);
  const [info, health] = await Promise.all([api("/api/system/info"), api("/api/system/health")]);
  const data = info.data;
  $("#view").innerHTML = `
    <div class="grid cols-4">
      <div class="stat info"><div class="k">پنل</div><div class="v" style="font-size:16px">${esc(data.app.name)} ${esc(data.app.version)}</div><div class="d">Node ${esc(data.app.node)}</div></div>
      <div class="stat"><div class="k">سیستم</div><div class="v" style="font-size:15px">${esc(data.host.provider)}</div><div class="d">${esc(data.host.platform ?? data.app.platform)} — ${esc(data.host.region)}</div></div>
      <div class="stat ${data.xray.installed ? "ok" : "warn"}"><div class="k">هسته Xray</div><div class="v" style="font-size:16px">${esc(data.xray.version ?? "—")}</div><div class="d">${data.xray.running ? "در حال اجرا" : "متوقف"}</div></div>
      <div class="stat"><div class="k">دیتابیس</div><div class="v" style="font-size:16px">${esc(data.app.dialect)}</div><div class="d">${esc(data.data_dir)}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>📊 منابع زنده</h3>
      <div class="grid cols-4">
        <div class="stat"><div class="k">CPU</div><div class="v">${fa(data.cpu.usage_percent)}٪</div><div class="bar"><i style="width:${data.cpu.usage_percent}%"></i></div></div>
        <div class="stat"><div class="k">RAM</div><div class="v">${fa(data.memory.percent)}٪</div><div class="bar"><i style="width:${data.memory.percent}%"></i></div></div>
        <div class="stat"><div class="k">دیسک</div><div class="v">${fa(data.disk?.percent ?? 0)}٪</div><div class="bar"><i style="width:${data.disk?.percent ?? 0}%"></i></div></div>
        <div class="stat"><div class="k">آپ‌تایم</div><div class="v" style="font-size:16px">${fa(Math.floor(data.process.uptime_seconds / 3600))} ساعت</div><div class="d">PID ${fa(data.process.pid)}</div></div>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>🧪 بررسی سلامت</h3><div id="health-box">${loadingBox()}</div></div>
      <div class="card"><h3>🚀 بروزرسانی</h3><div id="update-box">آخرین بررسی: ${esc(data.update ? jdate(data.update.checkedAt, true) : "—")}</div>
        <div class="hint">نسخه فعلی: ${esc(data.app.version)}${data.update ? ` · آخرین نسخه: ${esc(data.update.version)}` : ""}</div>
        <div class="chips" style="margin-top:10px"><a class="btn sm" target="_blank" href="${esc(data.update?.url ?? "https://github.com/XTITANPROX/KMD-VPN")}">صفحه انتشارها</a></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h3>📜 لاگ هسته Xray</h3><div id="logs-box">${loadingBox()}</div></div>`;

  $("#check-update").onclick = async () => {
    const response = await api("/api/system/update");
    toast(response.data.latest ? `آخرین نسخه: ${response.data.latest.version}` : "بررسی ناموفق بود", response.data.latest ? "ok" : "warn");
  };
  try {
    const checks = await api("/api/system/config-check");
    $("#health-box").innerHTML = checks.data.checks
      .map((check) => `<div class="check">${check.ok ? "✅" : "⚠️"} <b>${esc(check.name)}</b> — ${esc(check.detail)}</div>`)
      .join("");
  } catch {
    $("#health-box").innerHTML = `<div class="empty">در دسترس نیست</div>`;
  }
  const logs = await api("/api/system/logs?lines=60");
  $("#logs-box").innerHTML = `<pre class="code">${esc(logs.data.xray_error || "لاگی موجود نیست")}</pre>`;
  void health;
}

/* ------------------------------- profile ------------------------------- */
async function renderProfile() {
  setTitle("حساب من", "تغییر رمز عبور و اتصال تلگرام");
  const me = (await api("/api/auth/me")).data;
  $("#view").innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>🔐 تغییر رمز عبور</h3>
        <label class="f">رمز فعلی</label><input class="input" id="pw-current" type="password"/>
        <label class="f">رمز جدید</label><input class="input" id="pw-new" type="password"/>
        <label class="f">تکرار رمز جدید</label><input class="input" id="pw-new2" type="password"/>
        <div class="chips" style="margin-top:14px"><button class="btn primary" id="pw-save">ذخیره</button></div>
      </div>
      <div class="card">
        <h3>🤖 اتصال تلگرام</h3>
        <div class="hint">آیدی عددی خود را وارد کنید تا اعلان‌ها و کد ورود برایتان ارسال شود (از ربات @userinfobot بگیرید).</div>
        <label class="f">آیدی عددی تلگرام</label><input class="input" id="tg-id" value="${esc(me.admin.telegram_id ?? "")}"/>
        <div class="chips" style="margin-top:14px"><button class="btn primary" id="tg-save">ذخیره</button></div>
        <h3 style="margin-top:22px">📋 اطلاعات حساب</h3>
        <div class="kv">
          <div class="k">نام کاربری</div><div>${esc(me.admin.username)}</div>
          <div class="k">نقش</div><div>${esc(me.admin.role)}</div>
          <div class="k">کیف پول</div><div>${fmtToman(me.admin.credit)}</div>
          <div class="k">اخرین ورود</div><div>${me.admin.last_login_at ? jdate(me.admin.last_login_at, true) : "—"}</div>
        </div>
      </div>
    </div>`;
  $("#pw-save").onclick = async () => {
    if ($("#pw-new").value !== $("#pw-new2").value) return toast("رمزهای جدید یکسان نیستند", "err");
    try {
      await api("/api/auth/password", { method: "POST", body: { current_password: $("#pw-current").value, new_password: $("#pw-new").value } });
      toast("رمز عبور تغییر کرد ✓", "ok");
    } catch (error) {
      toast(error.message, "err");
    }
  };
  $("#tg-save").onclick = async () => {
    try {
      await api("/api/auth/telegram-link", { method: "POST", body: { telegram_id: $("#tg-id").value.trim() } });
      toast("تلگرام متصل شد ✓", "ok");
    } catch (error) {
      toast(error.message, "err");
    }
  };
}

/* --------------------------------- boot -------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  checkAuth().catch((error) => {
    document.body.innerHTML = `<div class="auth-wrap"><div class="auth-card"><h1>خطا</h1><p class="sub">${esc(error.message)}</p></div></div>`;
  });
});
