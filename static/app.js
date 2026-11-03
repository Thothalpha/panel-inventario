/* Panel de inventario — frontend */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const state = { data: null, rules: null, sort: { key: "value", dir: -1 }, sev: "", chat: [], charts: {} };

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (d ? nf1 : nf).format(v);
const fmtEur = v => (v === null || v === undefined) ? "—" : eur.format(v);
const fmtK = v => v === null || v === undefined ? "—" : Math.abs(v) >= 1000 ? nf1.format(v / 1000) + " K€" : eur.format(v);
const fmtDate = s => s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const md = s => DOMPurify.sanitize(marked.parse(s || ""));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const SEV = { critica: { label: "Crítica", ico: "⛔" }, alta: { label: "Alta", ico: "▲" }, media: { label: "Media", ico: "●" }, baja: { label: "Baja", ico: "○" } };
const KIND = {
  rotura: "Sin stock", riesgo_rotura: "Riesgo de rotura", bajo_minimo: "Bajo mínimo Odoo", punto_pedido: "Bajo punto de pedido",
  exceso: "Exceso", sin_movimiento: "Sin movimiento", negativo: "Stock negativo", anomalia: "Anomalía de demanda",
  compra_retrasada: "Compra retrasada", caducidad: "Caducidad",
};
const kindLabel = k => KIND[k] || (k.startsWith("regla") ? "Personalizada" : k);
const sevBadge = s => `<span class="sev ${s}"><i class="ico" aria-hidden="true"></i>${SEV[s].label}</span>`;

const STATIC = window.STATIC_DEMO === true;

/* ---- Demo estática (GitHub Pages): sin servidor. Datos precalculados en data/*.json;
   alertas personalizadas y "vistas" se guardan solo en el navegador de quien la mira. */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("inv-demo-" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("inv-demo-" + k, JSON.stringify(v)); } catch {} },
};
const OPS = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b, "==": (a, b) => a === b };
let _ai = null;
const getJSON = async rel => { const r = await fetch(rel); if (!r.ok) throw new Error("No se pudo cargar " + rel); return r.json(); };
async function staticApi(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (path.startsWith("/api/dashboard")) {
    const d = await getJSON("data/dashboard.json");
    const rules = LS.get("rules", []), metrics = (await getJSON("data/rules.json")).metrics;
    const fmtN = v => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(v);
    for (const r of rules.filter(r => r.active)) {
      const vals = r.scope_values.map(v => v.toLowerCase());
      for (const p of d.products) {
        if (r.scope_type === "category" && !vals.some(v => p.categ.toLowerCase().includes(v))) continue;
        if (r.scope_type === "products" && !vals.includes(p.ref.toLowerCase())) continue;
        const v = p[r.metric];
        if (v === null || v === undefined || !OPS[r.op](+v, r.threshold)) continue;
        d.alerts.push({ key: `regla${r.id}:${p.id}`, kind: `regla${r.id}`, severity: r.severity, product_id: p.id, ref: p.ref, name: p.name,
          categ: p.categ, title: r.name, detail: `${metrics[r.metric]} = ${fmtN(v)} (${r.op} ${fmtN(r.threshold)}).`, action: r.description || "Revisar", impact_eur: null });
      }
    }
    const acks = LS.get("acks", {}), rank = { critica: 0, alta: 1, media: 2, baja: 3 };
    d.alerts.forEach(a => a.acked = !!acks[a.key]);
    d.alerts.sort((a, b) => (a.acked - b.acked) || (rank[a.severity] - rank[b.severity]) || ((b.impact_eur || 0) - (a.impact_eur || 0)));
    d.last_summary = LS.get("summary", null);
    return d;
  }
  if (path.startsWith("/api/products/")) return getJSON("data/products/" + path.split("/").pop() + ".json");
  if (path === "/api/rules" && method === "GET") return { ...(await getJSON("data/rules.json")), rules: LS.get("rules", []) };
  if (path === "/api/rules" && method === "POST") {
    if (!body.name || !body.metric || Number.isNaN(+body.threshold)) throw new Error("Completa nombre, métrica y umbral");
    if (body.scope_type !== "all" && !(body.scope_values || []).length) throw new Error("Indica las categorías o referencias de producto");
    const rules = LS.get("rules", []);
    const rule = { ...body, threshold: +body.threshold, active: true, id: Date.now() };
    rules.unshift(rule); LS.set("rules", rules); return rule;
  }
  if (path.startsWith("/api/rules/")) {
    const id = +path.split("/").pop();
    let rules = LS.get("rules", []);
    rules = method === "DELETE" ? rules.filter(r => r.id !== id) : rules.map(r => r.id === id ? { ...r, active: !!body.active } : r);
    LS.set("rules", rules); return { ok: true };
  }
  if (path === "/api/alerts/ack") {
    const acks = LS.get("acks", {}); (body.keys || []).forEach(k => acks[k] = new Date().toISOString()); LS.set("acks", acks); return { ok: true };
  }
  if (path === "/api/settings" && method === "GET") return getJSON("data/settings.json");
  if (path === "/api/settings") throw new Error("En la demo publicada los parámetros no se pueden recalcular (no hay servidor). En la versión real se guardan y el panel se recalcula al momento.");
  _ai = _ai || await getJSON("data/ai.json");
  await wait(900);
  if (path === "/api/ai/summary") { LS.set("summary", { content: _ai.summary.text, created_at: new Date().toISOString() }); return _ai.summary; }
  if (path === "/api/ai/chat") {
    const last = (body.messages || []).filter(m => m.role === "user").pop()?.content || "";
    const key = Object.keys(_ai.chat).find(k => last.includes(k) || k.includes(last.replace(/^Crea una alerta personalizada.*?: /, "")));
    if (key) return _ai.chat[key];
    const ref = last.match(/producto (\S+)/)?.[1];
    if (ref && _ai.products[ref]) return _ai.products[ref];
    return { text: "En esta **demo publicada** el asistente no está conectado (no hay servidor ni clave de IA), así que solo responde a las preguntas de ejemplo de abajo y al botón «Preguntar a la IA por este producto».\n\nEn la versión real puedes preguntarle cualquier cosa: Claude consulta el panel y lanza las consultas a Odoo en el momento (solo lectura).", proposals: [], queries: [] };
  }
  throw new Error("No disponible en la demo: " + path);
}

async function api(path, opts = {}) {
  if (STATIC) return staticApi(path, opts);
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

/* ---------------------------------------------------------------- tabs */
$$(".tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(t) {
  $$(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  $$(".tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + t));
  try { localStorage.setItem("inv-tab", t); } catch {}
}

/* ---------------------------------------------------------------- carga */
async function load(refresh = false) {
  const btn = $("#refresh");
  btn.disabled = true; btn.textContent = "Cargando…";
  try {
    state.data = await api("/api/dashboard" + (refresh ? "?refresh=1" : ""));
    render();
  } catch (e) {
    $("#warnings").innerHTML = `<div class="warn">No se pudieron cargar los datos: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "↻ Actualizar";
  }
}

function render() {
  const d = state.data;
  const live = d.source === "odoo";
  $("#source").className = "badge " + (live ? "live" : "demo");
  $("#source").textContent = live ? "Odoo en vivo" : (STATIC ? "Demo · datos ficticios" : "Modo demo");
  $("#refresh").hidden = STATIC;
  $("#review").hidden = !STATIC || LS.get("review-closed", false);
  $("#updated").textContent = "Datos de " + new Date(d.generated_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  $("#warnings").innerHTML = d.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join("");
  const open = d.alerts.filter(a => !a.acked && (a.severity === "critica" || a.severity === "alta")).length;
  $("#alert-count").textContent = open || "";
  if (!d.ai_available) {
    $("#gen-summary").disabled = true;
    $("#gen-summary").title = "Configura ANTHROPIC_API_KEY en el .env";
  }
  if (STATIC) $("#updated").textContent = "Vista previa para revisión";
  if (d.last_summary) showSummary(d.last_summary.content, d.last_summary.created_at, d.last_summary.model);
  renderKpis(); renderCharts(); renderTopDemand(); renderFilters(); renderProducts(); renderAlerts();
}

/* ---------------------------------------------------------------- resumen */
function renderKpis() {
  const o = state.data.overview;
  const s = o.alerts_by_severity;
  const dq = o.data_quality || {};
  const tiles = [
    ["Valor del stock", fmtK(o.stock_value), `${fmt(o.skus_with_stock)} de ${fmt(o.skus)} productos con stock`],
    ["Rotación anual", o.turnover === null ? "—" : fmt(o.turnover, 1) + "×", "consumo 12 m / stock actual"],
    ["Alertas urgentes", fmt(s.critica + s.alta), `${fmt(s.critica)} críticas · ${fmt(s.alta)} altas`],
    ["A pedir", fmt(o.to_order_count), `≈ ${fmtK(o.to_order_value)} a coste`],
    ["Exceso (> 1 año)", fmtK(o.overstock_value), "valor con cobertura > 365 d"],
    ["Sin movimiento", fmtK(o.dead_stock_value), "> 180 días parado"],
    ["Compras en curso", fmtK(o.pending_po_value), "pendiente de recibir"],
    ["Precisión previsión", o.forecast_accuracy === null ? "—" : fmt(o.forecast_accuracy * 100) + " %",
      "1 − WAPE, bloques de 4 semanas"],
  ];
  if (dq.sin_coste_con_stock) tiles.push(["Calidad de datos", fmt(dq.sin_coste_con_stock), "productos con stock y sin coste"]);
  $("#kpis").innerHTML = tiles.map(([l, v, h]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join("");
}

function baseOpts(extra = {}) {
  const grid = css("--grid"), ink2 = css("--ink-2");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink"), borderColor: css("--axis"), borderWidth: 1, padding: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink2 }, border: { color: css("--axis") } },
      y: { grid: { color: grid }, ticks: { color: ink2 }, border: { display: false }, beginAtZero: true },
    },
    ...extra,
  };
}
function chart(id, cfg) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.getElementById(id), cfg);
  return state.charts[id];
}

function renderCharts() {
  const o = state.data.overview;
  // Cobertura (tramos ordenados; el color marca el estado, la etiqueta del eje lo nombra)
  const cb = o.coverage_buckets;
  const covColor = { "Sin stock": "--critical", "< plazo": "--critical", "< 30 d": "--warning", "> 365 d": "--serious" };
  chart("ch-coverage", {
    type: "bar",
    data: { labels: Object.keys(cb), datasets: [{ data: Object.values(cb), backgroundColor: Object.keys(cb).map(k => css(covColor[k] || "--seq-400")), borderRadius: 4, maxBarThickness: 44 }] },
    options: baseOpts({ plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.raw} productos` } } } }),
  });
  // Alertas por tipo
  const byKind = {};
  state.data.alerts.filter(a => !a.acked).forEach(a => byKind[kindLabel(a.kind)] = (byKind[kindLabel(a.kind)] || 0) + 1);
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]);
  chart("ch-alerts", {
    type: "bar",
    data: { labels: kinds.map(k => k[0]), datasets: [{ data: kinds.map(k => k[1]), backgroundColor: css("--s1"), borderRadius: 4, maxBarThickness: 22 }] },
    options: baseOpts({ indexAxis: "y", scales: { x: { grid: { color: css("--grid") }, ticks: { color: css("--ink-2") }, beginAtZero: true }, y: { grid: { display: false }, ticks: { color: css("--ink-2") } } } }),
  });
  // Valor por categoría (top 8 + otros)
  const cats = Object.entries(o.value_by_category).filter(c => c[1] > 0);
  const top = cats.slice(0, 8);
  const rest = cats.slice(8).reduce((s, c) => s + c[1], 0);
  if (rest > 0) top.push(["Otras", rest]);
  chart("ch-categ", {
    type: "bar",
    data: { labels: top.map(c => c[0].length > 28 ? c[0].slice(0, 27) + "…" : c[0]), datasets: [{ data: top.map(c => c[1]), backgroundColor: css("--s1"), borderRadius: 4, maxBarThickness: 22 }] },
    options: baseOpts({ indexAxis: "y", plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { title: c => cats[c[0].dataIndex]?.[0] || "Otras", label: c => fmtEur(c.raw) } } },
      scales: { x: { grid: { color: css("--grid") }, ticks: { color: css("--ink-2"), callback: v => fmtK(v) }, beginAtZero: true }, y: { grid: { display: false }, ticks: { color: css("--ink-2") } } } }),
  });
  // Matriz ABC/XYZ (secuencial azul por valor)
  const m = o.abc_xyz;
  const maxV = Math.max(1, ...Object.values(m).map(c => c.value));
  const steps = ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"];
  let html = `<div class="abc"><div></div><div class="h">X estable</div><div class="h">Y variable</div><div class="h">Z errática</div>`;
  for (const a of ["A", "B", "C"]) {
    html += `<div class="h">${a}</div>`;
    for (const x of ["X", "Y", "Z"]) {
      const c = m[a + x] || { count: 0, value: 0 };
      const i = c.count ? Math.min(4, Math.floor((c.value / maxV) * 4.999)) : -1;
      const bg = i < 0 ? "var(--surface-2)" : `var(${steps[i]})`;
      const theme = document.documentElement.dataset.theme;
      const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const ink = (dark ? i <= 2 : i >= 3) ? "#ffffff" : "#0b0b0b";
      html += `<div class="c" style="background:${bg};color:${i < 0 ? "var(--ink-2)" : ink}" title="${a}${x}: ${c.count} productos · ${fmtEur(c.value)}"><b>${c.count}</b><span>${fmtK(c.value)}</span></div>`;
    }
  }
  $("#abcxyz").innerHTML = html + "</div>";
}

function renderTopDemand() {
  const rows = state.data.overview.top_demand_30d;
  const byId = Object.fromEntries(state.data.products.map(p => [p.id, p]));
  $("#top-demand").innerHTML = `<thead><tr><th>Ref.</th><th>Producto</th><th class="num">Demanda prevista 30 d</th><th class="num">Stock</th><th class="num">Cobertura (d)</th><th>Rotura estimada</th></tr></thead><tbody>` +
    rows.map(r => { const p = byId[r.id]; return `<tr data-id="${r.id}"><td>${esc(r.ref)}</td><td class="name">${esc(r.name)}</td><td class="num">${fmt(r.forecast_30d)}</td><td class="num">${fmt(r.on_hand)}</td><td class="num">${fmt(p?.coverage_days)}</td><td>${fmtDate(p?.stockout_date)}</td></tr>`; }).join("") + "</tbody>";
  $$("#top-demand tbody tr").forEach(tr => tr.addEventListener("click", () => openDetail(+tr.dataset.id)));
}

/* ---------------------------------------------------------------- resumen IA */
function showSummary(content, when, model) {
  $("#summary").classList.remove("muted");
  $("#summary").innerHTML = md(content);
  $("#summary-meta").textContent = when ? `Generado ${new Date(when).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` : "";
}
$("#gen-summary").addEventListener("click", async () => {
  const b = $("#gen-summary");
  b.disabled = true;
  $("#summary").innerHTML = `<span class="spinner"></span>Analizando el inventario y consultando Odoo… (puede tardar un minuto)`;
  try {
    const r = await api("/api/ai/summary", { method: "POST" });
    showSummary(r.text, new Date().toISOString(), r.model);
  } catch (e) {
    $("#summary").innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  } finally { b.disabled = !state.data.ai_available; }
});

/* ---------------------------------------------------------------- productos */
const COLS = [
  ["ref", "Ref."], ["name", "Producto"], ["on_hand", "Stock", 1], ["virtual", "Previsto", 1], ["forecast_30d", "Demanda 30 d", 1],
  ["coverage_days", "Cobertura (d)", 1], ["stockout_date", "Rotura"], ["lead_time_days", "Plazo (d)", 1], ["reorder_point", "Punto pedido", 1],
  ["suggested_order", "Sugerido", 1], ["abc", "ABC"], ["xyz", "XYZ"], ["value", "Valor €", 1], ["days_idle", "Días parado", 1],
];
function renderFilters() {
  const cats = [...new Set(state.data.products.map(p => p.categ))].sort();
  const sel = $("#f-categ"), cur = sel.value;
  sel.innerHTML = `<option value="">Todas las categorías</option>` + cats.map(c => `<option>${esc(c)}</option>`).join("");
  sel.value = cur;
}
function filteredProducts() {
  const t = $("#f-text").value.trim().toLowerCase(), c = $("#f-categ").value, abc = $("#f-abc").value, st = $("#f-state").value;
  const riskIds = new Set(state.data.alerts.filter(a => a.kind === "rotura" || a.kind === "riesgo_rotura").map(a => a.product_id));
  return state.data.products.filter(p =>
    (!t || p.ref.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)) && (!c || p.categ === c) && (!abc || p.abc === abc) &&
    (!st || (st === "riesgo" && riskIds.has(p.id)) || (st === "pedir" && p.suggested_order > 0) ||
      (st === "exceso" && p.coverage_days > 365) || (st === "parado" && p.days_idle > 180 && p.on_hand > 0) || (st === "stock" && p.on_hand > 0)));
}
function renderProducts() {
  const rows = filteredProducts();
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
  $("#f-count").textContent = `${rows.length} productos`;
  const head = `<thead><tr>${COLS.map(([k, l, n]) => `<th data-k="${k}" class="${n ? "num" : ""}" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`).join("")}</tr></thead>`;
  const body = rows.slice(0, 500).map(p => `<tr data-id="${p.id}">${COLS.map(([k, , n]) => {
    let v = p[k];
    if (k === "stockout_date") v = fmtDate(v);
    else if (k === "value") v = fmt(v);
    else if (n) v = fmt(v, k === "coverage_days" ? 0 : 0);
    else v = esc(v ?? "—");
    return `<td class="${n ? "num" : ""} ${k === "name" ? "name" : ""}">${v}</td>`;
  }).join("")}</tr>`).join("");
  $("#products").innerHTML = head + `<tbody>${body}</tbody>`;
  $$("#products th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "coverage_days" || k === "ref" || k === "name" ? 1 : -1) };
    renderProducts();
  }));
  $$("#products tbody tr").forEach(tr => tr.addEventListener("click", () => openDetail(+tr.dataset.id)));
}
["#f-text", "#f-categ", "#f-abc", "#f-state"].forEach(s => $(s).addEventListener("input", renderProducts));

/* ---------------------------------------------------------------- detalle */
async function openDetail(pid) {
  const dlg = $("#detail");
  const p = state.data.products.find(x => x.id === pid);
  $("#d-title").textContent = `${p.ref} · ${p.name}`;
  $("#d-sub").textContent = `${p.categ} · ${p.uom}${p.supplier ? " · Proveedor: " + p.supplier : ""}`;
  $("#d-kpis").innerHTML = "";
  $("#d-tables").innerHTML = "";
  if (!dlg.open) dlg.showModal();
  const d = await api("/api/products/" + pid);
  const m = d.metrics;
  const tiles = [
    ["Stock a mano", fmt(m.on_hand)], ["Previsto", fmt(m.virtual)], ["Demanda prevista 30 d", fmt(m.forecast_30d)],
    ["Cobertura", m.coverage_days === null ? "—" : fmt(m.coverage_days) + " d"], ["Rotura estimada", fmtDate(m.stockout_date)],
    ["Plazo de entrega", fmt(m.lead_time_days) + " d"], ["Stock de seguridad", fmt(m.safety_stock)], ["Punto de pedido", fmt(m.reorder_point)],
    ["Cantidad sugerida", fmt(m.suggested_order)], ["Mín/Máx Odoo", m.orderpoint_min === null ? "sin regla" : `${fmt(m.orderpoint_min)} / ${fmt(m.orderpoint_max)}`],
    ["Clase", `${m.abc}${m.xyz || ""}`], ["Valor", fmtEur(m.value)],
  ];
  $("#d-kpis").innerHTML = tiles.map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
  const f = d.forecast;
  $("#d-method").textContent = `Método: ${f.method}` + (f.accuracy !== null && f.accuracy !== undefined ? ` · precisión en backtest ${fmt(f.accuracy * 100)} %` : " · sin backtest (historia corta)") + " · banda: intervalo del 80 %";

  const hw = d.history.weeks.slice(-52), hv = d.history.values.slice(-52);
  const labels = [...hw, ...f.future_weeks].map(w => new Date(w).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }));
  const pad = Array(hw.length).fill(null);
  const lastH = hv[hv.length - 1];
  chart("ch-demand", {
    type: "line",
    data: {
      labels, datasets: [
        { label: "Demanda real", data: [...hv, ...Array(f.forecast.length).fill(null)], borderColor: css("--s1"), backgroundColor: css("--s1"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
        { label: "Banda 80 % (alta)", data: [...pad.slice(1), lastH, ...f.hi], borderColor: "transparent", backgroundColor: css("--s2") + "26", pointRadius: 0, fill: "+1" },
        { label: "Banda 80 % (baja)", data: [...pad.slice(1), lastH, ...f.lo], borderColor: "transparent", pointRadius: 0, fill: false },
        { label: "Previsión", data: [...pad.slice(1), lastH, ...f.forecast], borderColor: css("--s2"), backgroundColor: css("--s2"), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4 },
      ],
    },
    options: baseOpts({
      interaction: { mode: "index", intersect: false },
      plugins: { ...baseOpts().plugins, legend: { display: true, labels: { color: css("--ink-2"), boxWidth: 14, filter: i => !i.text.includes("baja") } },
        tooltip: { ...baseOpts().plugins.tooltip, filter: i => i.raw !== null && !i.dataset.label.includes("Banda"), callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw, 1)} ${m.uom}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: css("--ink-2"), maxTicksLimit: 12 } }, y: { grid: { color: css("--grid") }, ticks: { color: css("--ink-2") }, beginAtZero: true } },
    }),
  });
  const pl = f.future_weeks.map(w => new Date(w).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }));
  chart("ch-proj", {
    type: "line",
    data: {
      labels: ["Hoy", ...pl], datasets: [
        { label: "Stock proyectado", data: [m.on_hand, ...d.projection], borderColor: css("--s1"), backgroundColor: css("--s1"), borderWidth: 2, pointRadius: 3, stepped: false },
        { label: "Punto de pedido", data: Array(pl.length + 1).fill(m.reorder_point), borderColor: css("--serious"), borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 },
        { label: "Stock de seguridad", data: Array(pl.length + 1).fill(m.safety_stock), borderColor: css("--critical"), borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0 },
      ],
    },
    options: baseOpts({
      interaction: { mode: "index", intersect: false },
      plugins: { ...baseOpts().plugins, legend: { display: true, labels: { color: css("--ink-2"), boxWidth: 14 } }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)} ${m.uom}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: css("--ink-2") } }, y: { grid: { color: css("--grid") }, ticks: { color: css("--ink-2") } } },
    }),
  });
  const tbl = (title, head, rows) => `<div class="card"><h3>${title}</h3>${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted small">Sin datos</p>`}</div>`;
  $("#d-tables").innerHTML =
    tbl("Stock por ubicación", ["Ubicación", "Lote", "Caducidad", "Cantidad", "Reservado"], d.quants.map(q => [esc(q.location), esc(q.lot || "—"), fmtDate(q.expiration), fmt(q.qty), fmt(q.reserved)])) +
    tbl("Compras pendientes", ["Pedido", "Proveedor", "Fecha prevista", "Pendiente"], d.pending_po.map(po => [esc(po.order), esc(po.partner), fmtDate(po.date), fmt(po.qty)])) +
    (m.used_in.length ? tbl("Se usa en", ["Producto terminado", "Cantidad por unidad"], m.used_in.map(u => [esc(u.parent), fmt(u.qty_per_unit, 1)])) : "");
  $("#d-ask").onclick = () => { dlg.close(); showTab("asistente"); sendChat(`Analiza el producto ${m.ref} (${m.name}): situación, riesgo y qué me recomiendas hacer.`); };
}
$("#d-close").addEventListener("click", () => $("#detail").close());

/* ---------------------------------------------------------------- alertas */
function renderAlerts() {
  const all = state.data.alerts;
  const counts = { "": all.filter(a => !a.acked).length };
  Object.keys(SEV).forEach(s => counts[s] = all.filter(a => !a.acked && a.severity === s).length);
  $("#sev-chips").innerHTML = [["", "Todas"], ...Object.entries(SEV).map(([k, v]) => [k, v.label])]
    .map(([k, l]) => `<button class="chip" data-s="${k}" aria-pressed="${state.sev === k}">${k ? `<span class="sev ${k}" style="border:0;padding:0"></span> ` : ""}${l} (${counts[k]})</button>`).join("");
  $$("#sev-chips .chip").forEach(c => c.addEventListener("click", () => { state.sev = c.dataset.s; renderAlerts(); }));
  const kinds = [...new Set(all.map(a => a.kind))];
  const ks = $("#a-kind"), cur = ks.value;
  ks.innerHTML = `<option value="">Todos los tipos</option>` + kinds.map(k => `<option value="${k}">${kindLabel(k)}</option>`).join("");
  ks.value = cur;
  const list = visibleAlerts();
  $("#alert-list").innerHTML = list.length ? list.slice(0, 300).map(a => `
    <div class="alert ${a.severity} ${a.acked ? "acked" : ""}">
      <div>${sevBadge(a.severity)}</div>
      <div>
        <div class="t">${esc(a.title)}</div>
        <div class="p"><button class="link" data-id="${a.product_id}">${esc(a.ref)}</button> · ${esc(a.name)} · ${kindLabel(a.kind)}</div>
        <div class="p">${esc(a.detail)}</div>
        <div class="a">${esc(a.action)}</div>
      </div>
      <div class="side">
        ${a.impact_eur ? `<span class="small muted">Impacto ≈ ${fmtEur(a.impact_eur)}</span>` : ""}
        ${a.acked ? `<span class="small muted">Vista</span>` : `<button class="btn ghost small" data-ack="${esc(a.key)}">Marcar vista</button>`}
      </div>
    </div>`).join("") : `<div class="card muted">No hay alertas con estos filtros. 🎉</div>`;
  $$("#alert-list [data-ack]").forEach(b => b.addEventListener("click", () => ackAlerts([b.dataset.ack])));
  $$("#alert-list .link").forEach(b => b.addEventListener("click", () => openDetail(+b.dataset.id)));
}
function visibleAlerts() {
  const k = $("#a-kind").value, showAck = $("#a-acked").checked;
  return state.data.alerts.filter(a => (showAck || !a.acked) && (!state.sev || a.severity === state.sev) && (!k || a.kind === k));
}
async function ackAlerts(keys) {
  await api("/api/alerts/ack", { method: "POST", body: JSON.stringify({ keys }) });
  const set = new Set(keys);
  state.data.alerts.forEach(a => { if (set.has(a.key)) a.acked = true; });
  renderAlerts(); renderCharts();
  $("#alert-count").textContent = state.data.alerts.filter(a => !a.acked && (a.severity === "critica" || a.severity === "alta")).length || "";
}
$("#a-kind").addEventListener("input", renderAlerts);
$("#a-acked").addEventListener("input", renderAlerts);
$("#ack-all").addEventListener("click", () => {
  const keys = visibleAlerts().filter(a => !a.acked).map(a => a.key);
  if (keys.length) ackAlerts(keys);
});

/* ---------------------------------------------------------------- reglas */
async function loadRules() {
  state.rules = await api("/api/rules");
  $("#rule-metric").innerHTML = Object.entries(state.rules.metrics).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const scope = r => r.scope_type === "all" ? "Todos los productos" : (r.scope_type === "category" ? "Categorías: " : "Refs.: ") + r.scope_values.join(", ");
  $("#rules").innerHTML = state.rules.rules.length ? state.rules.rules.map(r => `
    <div class="rule">
      <div>${sevBadge(r.severity)} <b>${esc(r.name)}</b><div class="small muted">${esc(scope(r))} · ${esc(state.rules.metrics[r.metric])} ${esc(r.op)} ${fmt(r.threshold, 1)}${r.description ? " · " + esc(r.description) : ""}</div></div>
      <div class="row">
        <label class="check small"><input type="checkbox" data-toggle="${r.id}" ${r.active ? "checked" : ""}> Activa</label>
        <button class="btn ghost" data-del="${r.id}">Eliminar</button>
      </div>
    </div>`).join("") : `<p class="muted small">Aún no hay alertas personalizadas.</p>`;
  $$("#rules [data-toggle]").forEach(c => c.addEventListener("input", async () => {
    await api("/api/rules/" + c.dataset.toggle, { method: "PATCH", body: JSON.stringify({ active: c.checked }) });
    load();
  }));
  $$("#rules [data-del]").forEach(b => b.addEventListener("click", async () => {
    await api("/api/rules/" + b.dataset.del, { method: "DELETE" });
    loadRules(); load();
  }));
}
async function saveRule(rule) {
  await api("/api/rules", { method: "POST", body: JSON.stringify(rule) });
  await loadRules(); await load();
}
$("#rule-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  f.scope_values = f.scope_values ? f.scope_values.split(",").map(s => s.trim()).filter(Boolean) : [];
  f.threshold = parseFloat(f.threshold);
  try { await saveRule(f); e.target.reset(); } catch (err) { alertBox(e.target, err.message); }
});
function alertBox(el, msg) { const d = document.createElement("div"); d.className = "warn"; d.textContent = msg; el.after(d); setTimeout(() => d.remove(), 6000); }

function proposalHtml(p, i) {
  const scope = p.scope_type === "all" ? "todos los productos" : p.scope_values.join(", ");
  return `<div class="proposal">${sevBadge(p.severity)} <b>${esc(p.name)}</b>
    <div class="small muted">Ámbito: ${esc(scope)} · ${esc(state.rules?.metrics?.[p.metric] || p.metric)} ${esc(p.op)} ${fmt(p.threshold, 1)}${p.description ? " · " + esc(p.description) : ""}</div>
    <div class="row"><button class="btn primary" data-save="${i}">Guardar alerta</button><span class="small muted">Propuesta de la IA: no se guarda hasta que la confirmes.</span></div></div>`;
}
function bindProposals(container, proposals) {
  $$("[data-save]", container).forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await saveRule(proposals[+b.dataset.save]); b.textContent = "Guardada ✓"; } catch (e) { b.disabled = false; alertBox(b, e.message); }
  }));
}
$("#nl-rule-btn").addEventListener("click", async () => {
  const text = $("#nl-rule").value.trim();
  if (!text) return;
  const out = $("#nl-rule-out"), b = $("#nl-rule-btn");
  b.disabled = true;
  out.innerHTML = `<p class="small"><span class="spinner"></span>Preparando la alerta…</p>`;
  try {
    const r = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Crea una alerta personalizada (usa proponer_alerta; comprueba antes referencias o categorías si hace falta): " + text }] }) });
    out.innerHTML = `<div class="md small">${md(r.text)}</div>` + r.proposals.map(proposalHtml).join("");
    bindProposals(out, r.proposals);
  } catch (e) { out.innerHTML = `<div class="warn">${esc(e.message)}</div>`; } finally { b.disabled = false; }
});

/* ---------------------------------------------------------------- chat */
const SUGGESTIONS = [
  "¿Qué tengo que pedir esta semana y cuánto?",
  "¿Qué productos se quedan sin stock en los próximos 30 días?",
  "¿Dónde tengo más dinero parado y qué hago con él?",
  "¿Cómo va la cobertura de los componentes de Cronidol?",
  "Avísame si las cajas de Cronidol bajan de 5.000 unidades",
];
$("#suggestions").innerHTML = SUGGESTIONS.map(s => `<button class="chip">${esc(s)}</button>`).join("");
$$("#suggestions .chip").forEach(c => c.addEventListener("click", () => sendChat(c.textContent)));
$("#chat-form").addEventListener("submit", e => { e.preventDefault(); const t = $("#chat-input").value.trim(); if (t) sendChat(t); });
$("#chat-input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chat-form").requestSubmit(); } });

async function sendChat(text) {
  const log = $("#chat-log");
  $("#chat-input").value = "";
  state.chat.push({ role: "user", content: text });
  log.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(text)}</div>`);
  const pending = document.createElement("div");
  pending.className = "msg assistant";
  pending.innerHTML = `<span class="spinner"></span>Pensando y consultando datos…`;
  log.appendChild(pending);
  log.scrollTop = log.scrollHeight;
  $("#chat-send").disabled = true;
  try {
    const r = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ messages: state.chat }) });
    state.chat.push({ role: "assistant", content: r.text });
    pending.classList.add("md");
    const q = r.queries.length ? `<details><summary>${r.queries.length} consultas realizadas</summary>${r.queries.map(x => `<div><code>${esc(x.tool)} ${esc(JSON.stringify(x.input))}</code></div>`).join("")}</details>` : "";
    pending.innerHTML = md(r.text) + r.proposals.map(proposalHtml).join("") + q;
    bindProposals(pending, r.proposals);
  } catch (e) {
    state.chat.pop();
    pending.innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  } finally {
    $("#chat-send").disabled = false;
    log.scrollTop = log.scrollHeight;
  }
}

/* ---------------------------------------------------------------- config */
const SETTING_LABELS = {
  plazo_entrega_defecto_dias: "Plazo de entrega por defecto (días) — si el proveedor no lo tiene en Odoo",
  nivel_servicio: "Nivel de servicio (0,80–0,99) para el stock de seguridad",
  periodo_revision_dias: "Periodo de revisión de compras (días)",
  semanas_historia: "Semanas de historia para la previsión",
  horizonte_semanas: "Horizonte de previsión (semanas)",
  exceso_cobertura_dias: "Exceso: cobertura superior a (días)",
  exceso_valor_min: "Exceso / sin movimiento: valor mínimo para avisar (€)",
  sin_movimiento_dias: "Sin movimiento: más de (días)",
  caducidad_aviso_dias: "Caducidad: avisar con (días) de antelación",
  anomalia_z: "Anomalía de demanda: umbral z",
  ack_dias: "Una alerta vista vuelve a aparecer tras (días)",
  abc_a: "ABC: corte A (fracción acumulada del consumo)",
  abc_b: "ABC: corte B",
  xyz_x: "XYZ: CV máximo para X",
  xyz_y: "XYZ: CV máximo para Y",
};
async function loadSettings() {
  const { settings } = await api("/api/settings");
  $("#settings-form").innerHTML = Object.entries(settings).map(([k, v]) =>
    `<label>${esc(SETTING_LABELS[k] || k)}<input name="${k}" type="number" step="any" value="${v}"></label>`).join("") +
    `<div class="full row"><button class="btn primary">Guardar y recalcular</button><span id="set-msg" class="small muted"></span></div>`;
}
$("#settings-form").addEventListener("submit", async e => {
  e.preventDefault();
  const body = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, parseFloat(v)]));
  try { await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }); $("#set-msg").textContent = "Guardado ✓"; load(); }
  catch (err) { $("#set-msg").textContent = err.message; }
});

/* ---------------------------------------------------------------- inicio */
$("#refresh").addEventListener("click", () => load(true));
try { const t = localStorage.getItem("inv-tab"); if (t && $("#tab-" + t)) showTab(t); } catch {}
$("#review-close").addEventListener("click", () => { $("#review").hidden = true; LS.set("review-closed", true); });
load(); loadRules(); loadSettings();
