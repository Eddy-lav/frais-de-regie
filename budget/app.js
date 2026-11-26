import * as S from "./store.js";
import * as L from "./logic.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const fmt0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = n => fmt.format(n || 0), eur0 = n => fmt0.format(Math.round(n || 0));
const signed = n => (n > 0 ? "+" : "") + eur(n);
const dLong = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dShort = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const mLong = m => new Date(m + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const mShort = m => new Date(m + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "short" });
const num = v => L.parseNumber(v);
const KIND = { courant: "Compte courant", epargne: "Épargne", credit: "Crédit" };

// Pastille de catégorie : une icône sur une teinte propre à la catégorie.
const ICON = { courses: "🛒", logement: "🏠", joint: "🏡", factures: "💡", transport: "🚗", sante: "💊", enfants: "🧸", sorties: "🍽️", shopping: "🛍️", musique: "🎧", impots: "🏛️", banque: "🏦", especes: "💶", autre: "🧩", cachets: "🎚️", are: "📄", ventes: "💿", rembours: "↩️", rev_autre: "➕", epargne: "🐷", interne: "🔁" };
const HUE = { courses: 140, logement: 28, joint: 18, factures: 48, transport: 205, sante: 350, enfants: 300, sorties: 12, shopping: 265, musique: 280, impots: 225, banque: 215, especes: 95, autre: 210, cachets: 150, are: 220, ventes: 290, rembours: 170, rev_autre: 160, epargne: 330, interne: 210 };
const ico = cat => `<span class="ico" style="--h:${HUE[cat] ?? 210}" aria-hidden="true">${ICON[cat] || "•"}</span>`;
const catName = cat => L.CAT[cat]?.name || "";
const txSub = t => { const ty = L.catType(t.cat), n = ty === "int" || ty === "epa" ? L.transferNote(t) : ""; return catName(t.cat) + (n ? ` (${n})` : ""); };

const data = () => ({ accounts: S.list("accounts"), txs: S.list("txs"), charges: S.list("charges"), rules: S.list("rules"), settings: S.settings() });
const accName = id => S.list("accounts").find(a => a.id === id)?.name || "?";
const mainAcc = () => { const a = S.list("accounts"); return a.find(x => x.main) || a.find(x => x.kind === "courant"); };
function catOptions(sel, sign) {
  const groups = [["Dépenses", "dep"], ["Rentrées", "rev"], ["Ni dépense ni rentrée", "epa,int"]];
  return groups.filter(([, t]) => !sign || t.includes(sign) || t.includes("epa"))
    .map(([g, t]) => `<optgroup label="${g}">` + L.CATS.filter(c => t.includes(c.type)).map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.name)}</option>`).join("") + "</optgroup>").join("");
}

function catChips(sel, sign) {
  const groups = [["Dépenses", "dep"], ["Rentrées", "rev"], ["Ni dépense ni rentrée", "epa,int"]].filter(([, t]) => !sign || t.includes(sign) || t.includes("epa"));
  return groups.map(([g, t]) => `<p class="chips-g">${g}</p><div class="chips-row">` + L.CATS.filter(c => t.includes(c.type)).map(c =>
    `<label class="chip" style="--h:${HUE[c.id] ?? 210}"><input type="radio" name="cat" value="${c.id}"${c.id === sel ? " checked" : ""}><span>${ICON[c.id] || ""} ${esc(c.name)}</span></label>`).join("") + "</div>").join("");
}

/* ---------- Frais pro : l'appli Frais de régie dans un cadre ---------- */
const frame = $("fraisFrame");
const fapi = () => { try { return frame.contentWindow?.fraisAPI || null; } catch { return null; } };
function fraisData() {
  const a = fapi();
  if (a) return { exp: a.expenses(), emps: a.employers() };
  try {
    const d = JSON.parse(localStorage.getItem("frais_state") || "{}").data || {};
    return { exp: (d.expenses || []).filter(x => !x.deleted), emps: (d.employers || []).filter(x => !x.deleted) };
  } catch { return { exp: [], emps: [] }; }
}
const empNameOf = (fr, id) => fr.emps.find(e => e.id === id)?.name || "Sans employeur";
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
const needFrais = () => { toast("Les frais pro se chargent. Réessaie dans un instant."); return null; };
// le cadre occupe l'écran entre l'en-tête et la barre d'onglets
function placeFrame() {
  if (tab !== "frais") return;
  const tabs = document.querySelector(".tabs"), sec = $("tab-frais");
  const bottomBar = getComputedStyle(tabs).position === "fixed";
  const top = bottomBar ? document.querySelector(".top").getBoundingClientRect().bottom + 8 : tabs.getBoundingClientRect().bottom + 12;
  sec.style.setProperty("--fr-top", Math.max(0, top) + "px");
  sec.style.setProperty("--fr-bottom", (bottomBar ? tabs.offsetHeight : 0) + "px");
}
addEventListener("resize", placeFrame);
addEventListener("message", e => {
  if (e.origin !== location.origin || e.data?.type !== "frais-ready") return;
  fapi()?.onChange(() => { if (tab !== "frais") queueRender(); });
  queueRender();
});

/* ---------- onglets ---------- */
let tab = "mois";
let opsMonth = L.ym(L.todayStr());
function show(t) {
  tab = t;
  for (const b of document.querySelectorAll(".tabs button")) { if (b.dataset.tab === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  for (const s of document.querySelectorAll(".tab")) s.hidden = s.id !== "tab-" + t;
  $("fab").hidden = t === "frais";
  document.body.classList.toggle("on-frais", t === "frais");
  placeFrame();
  render();
  scrollTo({ top: 0 });
  if (location.hash !== "#" + t) history.replaceState(null, "", t === "mois" ? location.pathname : "#" + t);
}
for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => show(b.dataset.tab);
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) show(g.dataset.go); });

function render() {
  renderSync();
  if (tab === "mois") renderMois();
  if (tab === "ops") renderOps();
  if (tab === "import") renderImportForm();
  if (tab === "comptes") renderComptes();
}

/* ---------- remboursements de frais repérés sur le relevé ---------- */
// Un virement reçu qui vaut exactement un ticket, les tickets envoyés d'un employeur, ou tous ses tickets pas remboursés.
function reimbSuggestions(d, fr) {
  const done = new Set(d.settings.reimbDone || []);
  const cour = new Set(d.accounts.filter(a => a.kind === "courant").map(a => a.id));
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const open = fr.exp.filter(x => x.status !== "remboursee");
  const groups = new Map();
  for (const x of open) { const k = x.employerId || ""; groups.set(k, (groups.get(k) || []).concat(x)); }
  const sum = a => a.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const out = [], used = new Set();
  for (const t of d.txs.filter(t => cour.has(t.accountId) && t.amount > 0 && t.date >= since && !done.has(t.id) && L.catType(t.cat) !== "int")) {
    let hit = null;
    for (const [k, items] of groups) {
      const sent = items.filter(x => x.status === "envoyee" && !used.has(x.id)), all = items.filter(x => !used.has(x.id));
      for (const set of [sent, all, ...all.map(x => [x])]) if (set.length && Math.abs(sum(set) - t.amount) < 0.02) { hit = { tx: t, emp: empNameOf(fr, k), items: set }; break; }
      if (hit) break;
    }
    if (hit) { out.push(hit); hit.items.forEach(x => used.add(x.id)); }
  }
  return out;
}

/* ---------- Ce mois ---------- */
const SEG = 32;
let catsOpen = false;
function renderMois() {
  const d = data();
  const s = L.monthSummary(d);
  const el = $("tab-mois");
  const hasTx = s.main && d.txs.some(t => t.accountId === s.main.id);
  const banner = `${S.isConnected() ? "" : `<p class="note">Tes données ne sont que sur cet appareil. <button class="linkbtn" type="button" data-go="comptes">Connecte Dropbox</button> pour retrouver celles de ton téléphone ou de ton ordi.</p>`}`;
  const setupCard = `<div class="card stack">
      <h2>Combien il te reste ce mois-ci</h2>
      <p class="muted">Pour le calculer, il me faut ce qui est sur ton compte perso et ce qui va encore en partir avant la fin du mois.</p>
      <ol class="steps">
        <li>${hasTx ? "Relevé importé." : `Importe le relevé de ton compte perso (fichier CSV de la Banque Populaire).`}</li>
        <li>Indique le solde affiché par la banque (on te le demande à l'import).</li>
        <li>Vérifie tes charges fixes : l'appli repère toute seule les prélèvements qui reviennent.</li>
      </ol>
      <div class="row"><button class="btn primary" type="button" data-go="import">Importer un relevé</button>
      ${hasTx ? `<button class="btn" type="button" id="btnSetBal">Indiquer le solde</button>` : ""}</div>
    </div>`;
  if (!s.main) { el.innerHTML = banner + setupCard; return; }
  const end = dShort(`${s.month}-${String(L.lastDayOfMonth(s.month)).padStart(2, "0")}`);
  const neg = s.left < 0;
  // vumètre : le solde découpé en reste / charges à venir / coussin
  const D = Math.max(s.balance, s.upcomingTotal + s.cushion, 1);
  const nGo = s.balance <= 0 ? 0 : Math.round(Math.max(s.left, 0) / D * SEG);
  const nMid = Math.round(s.upcomingTotal / D * SEG), nCush = Math.max(0, Math.round(s.cushion / D * SEG));
  const nHot = neg ? Math.min(SEG, Math.max(1, Math.round(-s.left / D * SEG))) : 0;
  let segs = "";
  for (let i = 0; i < SEG; i++) {
    let c = i < nGo ? "go" : i < nGo + nMid ? "mid" : i < nGo + nMid + nCush ? "cush" : "";
    if (neg && i >= SEG - nHot) c = "hot";
    segs += `<i class="${c}" style="--n:${i}"></i>`;
  }
  const lastTx = d.txs.filter(t => t.accountId === s.main.id && !t.manual).map(t => t.date).sort().pop();
  const stale = lastTx && (Date.parse(s.today) - Date.parse(lastTx)) / 864e5 > 6;

  const shownCats = s.cats.filter(c => c.now > 0 || c.avg);
  const catLines = shownCats.slice(0, catsOpen ? 12 : 5).map(c => {
    const max = Math.max(...s.cats.map(x => Math.max(x.now, x.avg || 0)), 1);
    return `<button type="button" class="line tap withico${c.high ? " warn" : ""}" data-cat="${c.cat}" aria-label="Voir les opérations ${esc(catName(c.cat))}">
      ${ico(c.cat)}<span>${esc(catName(c.cat) || c.cat)}</span><span class="money">${eur0(c.now)}</span>
      <div class="bar"><b style="width:${c.now / max * 100}%"></b>${c.avg ? `<s style="left:${c.avg / max * 100}%"></s>` : ""}</div>
      ${c.avg != null ? `<span class="sub">${!c.avg ? "Rien les mois précédents" : (c.high ? "Plus que d'habitude. " : "") + `D'habitude ${eur0(c.avg)} par mois`}</span>` : ""}
    </button>`;
  }).join("");

  const incMax = Math.max(...s.incomeMonths.map(m => m.are + m.cachets + m.other), 1);
  const incKnown = s.incomeMonths.filter(m => m.has);
  const incAvg = incKnown.length ? incKnown.reduce((a, m) => a + m.are + m.cachets + m.other, 0) / incKnown.length : 0;
  const cols = s.incomeMonths.map(m => {
    const t = m.are + m.cachets + m.other, h = v => (v / incMax * 92).toFixed(1) + "px";
    return `<div class="mcol" title="${esc(mLong(m.month))} : ARE ${eur0(m.are)}, cachets ${eur0(m.cachets)}, autres ${eur0(m.other)}">
      <span class="v">${m.has ? eur0(t) : ""}</span>
      <div class="stackbar"><span style="height:${h(m.are)};background:var(--accent)"></span><span style="height:${h(m.cachets)};background:var(--go)"></span><span style="height:${h(m.other)};background:var(--mid)"></span></div>
      <span>${mShort(m.month)}</span></div>`;
  }).join("");

  const sav = d.accounts.filter(a => a.matelas);
  // frais pro avancés, à se faire rembourser
  const fr = fraisData();
  const owed = fr.exp.filter(x => x.status !== "remboursee");
  const byEmp = new Map();
  for (const x of owed) { const k = x.employerId || ""; const o = byEmp.get(k) || { t: 0, n: 0, sent: 0 }; o.t += Number(x.amount) || 0; o.n++; if (x.status === "envoyee") o.sent++; byEmp.set(k, o); }
  const owedTot = owed.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const reimbs = reimbSuggestions(d, fr);
  const reimbHtml = (reimbs.length ? reimbs.map((r, i) => `<div class="note ok stack tight"><span>Virement reçu le ${esc(dShort(r.tx.date))} : ${eur(r.tx.amount)}. Ça correspond ${r.items.length > 1 ? `aux ${r.items.length} tickets` : "au ticket"} ${esc(r.emp)}${r.items.length > 1 ? "" : ` (${esc(r.items[0].merchant || "")})`}.</span>
      <div class="row"><button class="btn" type="button" data-reimb="${i}">Marquer comme remboursé${r.items.length > 1 ? "s" : ""}</button><button class="btn ghost" type="button" data-reimb-no="${i}">Ce n'est pas ça</button></div></div>`).join("") : "")
    + (owed.length ? `<section class="card stack"><div class="row between"><h2>À te faire rembourser</h2><span class="money due big2">${eur(owedTot)}</span></div>
      <div class="lines">${[...byEmp].sort((a, b) => b[1].t - a[1].t).map(([k, o]) => `<button type="button" class="line tap" data-go="frais"><span>${esc(empNameOf(fr, k))}</span><span class="money">${eur(o.t)}</span>
        <span class="sub">${[o.sent ? `${o.sent} envoyé${o.sent > 1 ? "s" : ""}` : "", o.n - o.sent ? `${o.n - o.sent} à envoyer` : ""].filter(Boolean).join(", ")}</span></button>`).join("")}</div></section>` : "");
  const savMissing = sav.filter(a => L.balanceOf(a, d.txs) == null);

  const heroHtml = s.balance == null ? setupCard : `
  <section class="card hero" aria-labelledby="heroLead">
    <p class="lead" id="heroLead">${neg ? "Ce mois-ci, il manque" : "Tu peux encore dépenser"}</p>
    <p class="big${neg ? " neg" : ""}">${eur0(Math.abs(s.left))}</p>
    <p class="perday">${neg
      ? `Les charges à venir dépassent ce qu'il y a sur le compte. Un cachet ou l'ARE arrive avant le ${esc(end)} ?`
      : `jusqu'au ${esc(end)}, soit environ <b>${eur0(s.perDay)} par jour</b> (${s.daysLeft} jour${s.daysLeft > 1 ? "s" : ""}).`}</p>
    <div class="meter on" role="img" aria-label="Solde ${eur0(s.balance)} : ${eur0(Math.max(s.left, 0))} libres, ${eur0(s.upcomingTotal)} de charges à venir, ${eur0(s.cushion)} de coussin">${segs}</div>
    <div class="legend"><span style="--c:var(--go)">Libre</span><span style="--c:var(--mid)">Charges à venir</span><span style="--c:color-mix(in srgb,var(--muted) 55%,transparent)">Coussin</span>${neg ? `<span style="--c:var(--hot)">Manque</span>` : ""}</div>
    <details class="how"><summary>Comment c'est calculé</summary>
    <dl class="calc">
      <dt>Sur ${esc(s.main.name.toLowerCase().startsWith("compte") ? "le " + s.main.name.toLowerCase() : s.main.name)}</dt><dd class="money">${eur(s.balance)}</dd>
      <dt>Charges encore à venir</dt><dd class="money">− ${eur(s.upcomingTotal)}</dd>
      <dt>Coussin gardé de côté</dt><dd class="money">− ${eur(s.cushion)}</dd>
      <dt class="tot">${neg ? "Manque" : "Reste à dépenser"}</dt><dd class="money">${eur(s.left)}</dd>
    </dl></details>
    ${stale ? `<p class="note">Dernière opération importée le ${esc(dShort(lastTx))}. <button class="linkbtn" type="button" data-go="import">Importer le relevé</button> pour un chiffre à jour.</p>` : ""}
  </section>`;
  el.innerHTML = `
  ${banner}
  ${heroHtml}

  <section class="card stack">
    <div class="row between"><h2>${esc(mLong(s.month).replace(/^./, c => c.toUpperCase()))}</h2><button class="linkbtn" type="button" id="goOps">Voir les opérations</button></div>
    <p class="muted">Dépensé ${eur0(s.spent)}, rentré ${eur0(s.income)}.${s.history ? ` Le trait montre ta moyenne des ${s.history} mois précédents.` : ""}</p>
    <div class="lines">${catLines || `<p class="muted">Rien encore ce mois-ci.</p>`}</div>
    ${shownCats.length > 5 ? `<button class="btn ghost more" type="button" id="catsMore" aria-expanded="${catsOpen}">${catsOpen ? "Voir moins" : `Voir les ${shownCats.length} catégories`}</button>` : ""}
  </section>

  ${reimbHtml}
  ${s.upcoming.length ? `<section class="card stack"><h2>Encore à payer ce mois-ci</h2><div class="lines">${s.upcoming.map(c =>
    `<div class="line"><span>${esc(c.name)}</span><span class="money">${eur(c.amount)}</span><span class="sub">vers le ${c.day}</span></div>`).join("")}</div></section>` : ""}


  ${s.big.length ? `<section class="card stack"><h2>Grosses dépenses du mois</h2><div class="lines">${s.big.slice(0, 5).map(t =>
    `<button type="button" class="line tap withico" data-tx="${t.id}">${ico(t.cat)}<span>${esc(L.displayName(t))}</span><span class="money">${eur(-t.amount)}</span><span class="sub">${esc(dShort(t.date))}, ${esc(txSub(t))}</span></button>`).join("")}</div></section>` : ""}

  <section class="card stack">
    <h2>Rentrées des 6 derniers mois</h2>
    <div class="months">${cols}</div>
    <div class="legend"><span style="--c:var(--accent)">ARE</span><span style="--c:var(--go)">Cachets & salaires</span><span style="--c:var(--mid)">Autres</span></div>
    ${incKnown.length ? `<p class="muted">En moyenne ${eur0(incAvg)} par mois sur ${incKnown.length} mois importé${incKnown.length > 1 ? "s" : ""}.</p>` : ""}
  </section>

  <section class="card stack">
    <h2>Épargne</h2>
    ${!sav.length ? `<p class="muted">Coche « épargne de secours » sur tes livrets dans Comptes.</p>`
      : savMissing.length ? `<p class="muted">Indique le solde de ${savMissing.map(a => esc(a.name)).join(" et ")} pour savoir combien de mois tu tiens sans rentrée.</p><button class="btn" type="button" data-go="comptes">Mettre à jour les soldes</button>`
      : s.months == null ? `<p>Épargne de secours : <b>${eur0(s.savings)}</b>.</p>`
      : `<p class="runway"><b>${s.months.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois</b> sans aucune rentrée</p>
         <p class="muted">${eur0(s.savings)} d'épargne de secours (${sav.map(a => esc(a.name)).join(" + ")}), pour ${eur0(s.avgOut)} de sorties par mois en moyenne. Les intermittents visent souvent 3 mois.</p>`}
    ${s.pots.map(p => `<div class="lines block">
      <div class="line"><span>${esc(p.acc.name)} : avance à rembourser</span><span class="money${p.debt > 0 ? " due" : " pos"}">${eur(p.debt)}</span>
        ${p.debt > 0 ? `<span class="sub">Le prochain versement vers le ${esc(p.acc.name)} la rembourse en premier.</span>` : ""}</div>
      <div class="line"><span>Congés spectacles</span><span class="money">${eur(p.conges)}</span></div>
      ${p.balance != null ? `<div class="line"><span>Épargne libre sur le ${esc(p.acc.name)}</span><span class="money">${eur(p.balance - Math.max(0, p.conges))}</span></div>` : ""}
      ${p.debt > 0 && p.conges > 0 ? `<button class="btn" type="button" data-cover="${p.acc.id}">Couvrir l'avance avec les congés (${eur(Math.min(p.debt, p.conges))})</button>` : ""}
    </div>`).join("")}
  </section>`;
  $("btnSetBal")?.addEventListener("click", () => editAccount(s.main));
  $("catsMore")?.addEventListener("click", () => { catsOpen = !catsOpen; renderMois(); });
  $("goOps").onclick = () => { opsMonth = s.month; opsFilter.cat = ""; opsFilter.q = ""; $("fSearch").value = ""; show("ops"); };
  // une catégorie -> ses opérations du mois ; une grosse dépense -> sa fiche
  for (const b of el.querySelectorAll("[data-cat]")) b.onclick = () => {
    opsMonth = s.month; opsFilter.cat = b.dataset.cat; opsFilter.acc = s.main.id; opsFilter.q = ""; $("fSearch").value = ""; show("ops");
  };
  for (const b of el.querySelectorAll("[data-tx]")) b.onclick = () => editTx(S.list("txs").find(t => t.id === b.dataset.tx));
  for (const b of el.querySelectorAll("[data-reimb]")) b.onclick = () => {
    const r = reimbs[+b.dataset.reimb], a = fapi();
    if (!a) return needFrais();
    for (const x of r.items) a.save({ ...x, status: "remboursee" });
    S.saveSettings({ reimbDone: [...(S.settings().reimbDone || []), r.tx.id] });
    toast(r.items.length > 1 ? `${r.items.length} tickets marqués remboursés.` : "Ticket marqué remboursé.");
  };
  for (const b of el.querySelectorAll("[data-reimb-no]")) b.onclick = () => S.saveSettings({ reimbDone: [...(S.settings().reimbDone || []), reimbs[+b.dataset.reimbNo].tx.id] });
  for (const b of el.querySelectorAll("[data-cover]")) b.onclick = () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Appuie encore pour confirmer"; return; }
    const a = S.list("accounts").find(x => x.id === b.dataset.cover), p = L.potsOf(a, S.list("txs"));
    const amount = Math.min(p.debt, p.conges);
    S.save("accounts", { ...a, pots: { ...a.pots, moves: [...(a.pots.moves || []), { date: L.todayStr(), amount }] } });
    toast(`${eur(amount)} de congés utilisés pour rembourser l'avance.`);
  };
}

/* ---------- Opérations ---------- */
const opsFilter = { acc: "", cat: "", q: "" };
$("mPrev").onclick = () => { opsMonth = L.prevMonths(opsMonth, 1)[0]; renderOps(); };
$("mNext").onclick = () => { const [y, m] = opsMonth.split("-").map(Number); opsMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; renderOps(); };
$("fAcc").onchange = e => { opsFilter.acc = e.target.value; renderOps(); };
$("fCat").onchange = e => { opsFilter.cat = e.target.value; renderOps(); };
$("fSearch").oninput = e => { opsFilter.q = e.target.value; renderOps(); };

function renderOps() {
  const accs = S.list("accounts").filter(a => a.kind !== "credit");
  if (!opsFilter.acc || !accs.some(a => a.id === opsFilter.acc)) opsFilter.acc = mainAcc()?.id || "";
  $("fAcc").innerHTML = accs.map(a => `<option value="${a.id}"${a.id === opsFilter.acc ? " selected" : ""}>${esc(a.name)}</option>`).join("");
  $("fCat").innerHTML = `<option value="">Toutes les catégories</option>` + catOptions(opsFilter.cat);
  $("fCat").value = opsFilter.cat;
  $("mLabel").textContent = mLong(opsMonth);
  const q = L.normLabel(opsFilter.q).trim();
  const txs = S.list("txs").filter(t => t.accountId === opsFilter.acc && L.ym(t.date) === opsMonth && (!opsFilter.cat || t.cat === opsFilter.cat)
    && (!q || L.normLabel(t.label + " " + (t.detail || "") + " " + (t.note || "")).includes(q))).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const dep = -txs.filter(t => L.catType(t.cat) === "dep").reduce((s, t) => s + t.amount, 0);
  const rev = txs.filter(t => L.catType(t.cat) === "rev").reduce((s, t) => s + t.amount, 0);
  const isSav = S.list("accounts").find(a => a.id === opsFilter.acc)?.kind === "epargne";
  const inn = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), out = -txs.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  $("opsTotals").textContent = !txs.length ? "" : `${txs.length} opération${txs.length > 1 ? "s" : ""}. ` + (isSav ? `Versé ${eur(inn)}, retiré ${eur(out)}.` : `Dépensé ${eur(dep)}, rentré ${eur(rev)}.`);
  if (!txs.length) { $("opsList").innerHTML = `<p class="empty">Aucune opération ce mois-ci${opsFilter.cat || q ? " avec ces filtres" : ""}.</p>`; return; }
  const linkedIds = new Set(fraisData().exp.filter(x => x.txId).map(x => x.txId));
  const days = new Map();
  for (const t of txs) days.set(t.date, (days.get(t.date) || []).concat(t));
  $("opsList").innerHTML = [...days].map(([d, ts]) => `<div class="day"><h3>${esc(dLong(d))}</h3><div class="card">${ts.map(t => {
    const ty = L.catType(t.cat);
    return `<button type="button" class="op${ty === "int" || ty === "epa" ? " ignored" : ""}" data-id="${t.id}">
      ${ico(t.cat)}<span class="lab">${esc(L.displayName(t))}${t.manual ? `<span class="tag">à la main</span>` : ""}${linkedIds.has(t.id) ? `<span class="tag pro">Frais pro</span>` : ""}</span>
      <span class="money${t.amount > 0 ? " pos" : ""}">${signed(t.amount)}</span>
      <span class="cat">${esc(txSub(t))}</span></button>`;
  }).join("")}</div></div>`).join("");
  for (const b of $("opsList").querySelectorAll(".op")) b.onclick = () => editTx(S.list("txs").find(t => t.id === b.dataset.id));
}

$("fab").onclick = () => openDialog(`
  <h2>Ajouter</h2>
  <button type="button" class="bigchoice" id="chAdd"><span class="ico" style="--h:210" aria-hidden="true">✍️</span><span><b>Ajouter une dépense</b><span class="muted">Une dépense ou une rentrée pas encore sur le relevé</span></span></button>
  <button type="button" class="bigchoice" id="chImp"><span class="ico" style="--h:150" aria-hidden="true">📥</span><span><b>Importer un relevé</b><span class="muted">Fichier CSV ou OFX de la Banque Populaire</span></span></button>
  <div class="row"><button type="button" class="btn ghost" data-act="cancel">Annuler</button></div>`, () => {}, {
  onOpen: () => {
    $("chAdd").onclick = () => { dlg.close(); setTimeout(() => editTx(null), 0); };
    $("chImp").onclick = () => { dlg.close(); show("import"); };
  },
});

/* ---------- fenêtre d'édition ---------- */
const dlg = $("dlg"), dlgForm = $("dlgForm");
function openDialog(html, onSubmit, extra) {
  dlgForm.innerHTML = html;
  dlgForm.onsubmit = e => {
    const r = onSubmit(new FormData(dlgForm));
    if (r === false) e.preventDefault();
  };
  // Boutons secondaires : gérés au clic (sans fenêtre de confirmation du navigateur, peu fiable dans une appli installée).
  // Une action irréversible demande un 2e appui : le bouton change de texte pour confirmer.
  for (const b of dlgForm.querySelectorAll("button[data-act]")) b.onclick = () => {
    const act = b.dataset.act;
    if (act === "cancel") { dlg.close(); return; }
    if (b.dataset.confirm && b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = b.dataset.confirm; return; }
    dlg.close();
    (act === "delete" ? extra?.onDelete : extra?.onClear)?.();
  };
  extra?.onOpen?.();
  dlg.showModal();
}
const dlgButtons = (del) => `<div class="row between dlgbar">${del ? `<button type="button" class="btn danger" data-act="delete" data-confirm="Appuie encore pour confirmer">${del}</button>` : "<span></span>"}
  <div class="row"><button type="button" class="btn ghost" data-act="cancel">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div></div>`;

function editTx(tx) {
  const isNew = !tx;
  const t = tx || { date: L.todayStr(), amount: 0, label: "", cat: "autre", accountId: opsFilter.acc || mainAcc()?.id, manual: true };
  const key = L.keyOf(t.label);
  const accs = S.list("accounts").filter(a => a.kind !== "credit");
  const imported = !t.manual;
  // lien avec un ticket de frais pro (dépense importée uniquement)
  const fr = fraisData();
  const linked = imported && t.amount < 0 ? fr.exp.find(x => x.txId === t.id) : null;
  const cands = imported && t.amount < 0 && !linked ? fr.exp.filter(x => !x.txId && x.status !== "remboursee" && Math.abs((Number(x.amount) || 0) + t.amount) < 0.011 && dayDiff(x.date, t.date) <= 10) : [];
  const STAT = { a_envoyer: "à envoyer", envoyee: "envoyé", remboursee: "remboursé" };
  const proBox = !imported || t.amount >= 0 ? "" : linked
    ? `<div class="pro"><b>Frais pro</b><p>Lié au ticket « ${esc(linked.merchant || "sans nom")} », ${esc(empNameOf(fr, linked.employerId))}, ${STAT[linked.status] || ""}.</p>
        <div class="row"><button type="button" class="btn" id="proOpen">Voir le ticket</button><button type="button" class="btn ghost" id="proUnlink">Délier</button></div></div>`
    : `<div class="pro"><b>C'est un frais pro ?</b>${cands.length ? `<p>${cands.length > 1 ? "Ces tickets ont" : "Ce ticket a"} le même montant à quelques jours près :</p>` : ""}
        ${cands.map(x => `<button type="button" class="match" data-link="${x.id}"><span class="ico" style="--h:210" aria-hidden="true">🧾</span><span><b>${esc(x.merchant || "Sans nom")}</b><span class="muted">${esc(dShort(x.date))}, ${esc(empNameOf(fr, x.employerId))}, ${STAT[x.status] || ""}</span></span><span class="money">${eur(x.amount)}</span></button>`).join("")}
        <button type="button" class="match" id="proNew"><span class="ico" style="--h:150" aria-hidden="true">＋</span><span><b>Créer un ticket</b><span class="muted">Pré-rempli avec cette opération</span></span></button></div>`;
  openDialog(`
    <div class="sheet-head">${imported ? ico(t.cat) : ""}<div><h2>${isNew ? "Ajouter une dépense" : esc(L.displayName(t))}</h2>
      ${imported ? `<p class="sheet-amt${t.amount > 0 ? " pos" : ""}">${signed(t.amount)}</p><p class="muted">${esc(dLong(t.date))}, ${esc(accName(t.accountId))}</p>` : ""}</div></div>
    ${imported ? `<details class="how"><summary>Libellé de la banque</summary><p class="muted">${esc(t.label)}${t.detail ? "<br>" + esc(t.detail) : ""}${t.bankCat ? `<br>Catégorie banque : ${esc(t.bankCat)}` : ""}</p></details>${proBox}` : `
    <div class="seg" role="radiogroup" aria-label="Sens"><label><input type="radio" name="sign" value="-" ${t.amount <= 0 ? "checked" : ""}><span>Dépense</span></label><label><input type="radio" name="sign" value="+" ${t.amount > 0 ? "checked" : ""}><span>Rentrée</span></label></div>
    <div class="grid2">
      <div class="field"><label for="eAmt">Montant (€)</label><input id="eAmt" name="amount" inputmode="decimal" required value="${isNew ? "" : String(Math.abs(t.amount)).replace(".", ",")}" placeholder="0,00"></div>
      <div class="field"><label for="eDate">Date</label><input type="date" id="eDate" name="date" value="${t.date}" required></div>
    </div>`}
    <div class="field"><label for="eLab">${imported ? "Nom affiché" : "Libellé"}</label><input id="eLab" name="label" value="${esc(imported ? t.note || "" : t.label)}" placeholder="${esc(imported ? L.displayName({ ...t, note: "" }) : "Boulangerie, cadeau…")}" ${imported ? "" : "required"}></div>
    <fieldset class="chips"><legend>Catégorie</legend>${catChips(t.cat, imported ? (t.amount < 0 ? "dep" : "rev") : "")}</fieldset>
    ${imported ? "" : `<div class="field"><label for="eAcc">Compte</label><select id="eAcc" name="acc">${accs.map(a => `<option value="${a.id}"${a.id === t.accountId ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>`}
    ${S.list("accounts").find(a => a.id === t.accountId)?.pots ? `<div class="field"><label for="ePot">Enveloppe</label><select id="ePot" name="pot"><option value="">Automatique : ${esc(L.POTS[L.autoPot(t)])}</option>${Object.entries(L.POTS).map(([k, v]) => `<option value="${k}"${t.pot === k ? " selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
    ${imported && key ? `<label class="check"><input type="checkbox" name="rule" checked> Ranger aussi les autres opérations « ${esc(L.cleanLabel(t.label))} » dans cette catégorie, et les prochaines</label>` : ""}
    ${dlgButtons(isNew ? "" : "Supprimer")}`,
  fd => {
    const cat = fd.get("cat");
    if (t.manual) {
      const amt = Math.abs(num(fd.get("amount")));
      if (!amt) { $("eAmt").setCustomValidity("Montant ?"); $("eAmt").reportValidity(); $("eAmt").setCustomValidity(""); return false; }
      S.save("txs", { ...t, date: fd.get("date"), amount: fd.get("sign") === "+" ? amt : -amt, label: fd.get("label").trim(), cat, catManual: true, accountId: fd.get("acc"), createdAt: t.createdAt || new Date().toISOString() });
    } else {
      const pot = fd.has("pot") ? fd.get("pot") || undefined : t.pot;
      S.save("txs", { ...t, cat, catManual: cat !== t.cat ? true : t.catManual, note: fd.get("label").trim(), pot });
      if (fd.get("rule") && key) applyRule(key, cat, t.id);
    }
    toast(isNew ? "Opération ajoutée." : "Enregistré.");
  }, {
    onDelete: () => { S.remove("txs", t); toast("Supprimée."); },
    onOpen: () => {
      for (const b of dlgForm.querySelectorAll("[data-link]")) b.onclick = () => {
        const a = fapi(); if (!a) return needFrais();
        const x = a.expenses().find(e => e.id === b.dataset.link); if (!x) return;
        a.save({ ...x, txId: t.id }); dlg.close(); toast(`Lié au ticket « ${x.merchant || "sans nom"} ».`);
      };
      const nw = $("proNew"); if (nw) nw.onclick = () => {
        const a = fapi(); if (!a) return needFrais();
        dlg.close(); show("frais"); a.openNew({ date: t.date, amount: -t.amount, merchant: L.displayName(t), txId: t.id });
      };
      const op = $("proOpen"); if (op) op.onclick = () => { const a = fapi(); if (!a) return needFrais(); dlg.close(); show("frais"); a.open(linked.id); };
      const ul = $("proUnlink"); if (ul) ul.onclick = () => { const a = fapi(); if (!a) return needFrais(); a.save({ ...linked, txId: null }); dlg.close(); toast("Lien retiré."); };
    },
  });
}
function applyRule(key, cat, exceptId) {
  const old = S.list("rules").find(r => r.key === key);
  S.save("rules", { ...(old || {}), key, cat });
  const ty = L.catType(cat);
  const fits = t => ty === "epa" || ty === "int" || (ty === "dep") === (t.amount < 0);
  const upd = S.list("txs").filter(t => t.id !== exceptId && !t.manual && t.cat !== cat && fits(t) && L.keyOf(t.label) === key).map(t => ({ ...t, cat }));
  if (upd.length) S.save("txs", upd);
}

/* ---------- Import ---------- */
let pendingImport = null;
function renderImportForm() {
  const accs = S.list("accounts").filter(a => a.kind !== "credit");
  const cur = $("iAcc").value || mainAcc()?.id;
  $("iAcc").innerHTML = accs.map(a => `<option value="${a.id}"${a.id === cur ? " selected" : ""}>${esc(a.name)}</option>`).join("");
  renderSuggest($("iSuggest"));
}
$("iFile").onchange = async e => {
  const f = e.target.files[0];
  $("iErr").hidden = true; $("iPreview").hidden = true;
  if (!f) return;
  try {
    const parsed = L.parseStatement(L.decodeBytes(await f.arrayBuffer()));
    if (!parsed.txs.length) throw new Error("Aucune opération trouvée dans ce fichier.");
    preview(parsed);
  } catch (x) { $("iErr").textContent = x.message; $("iErr").hidden = false; }
};
$("iAcc").onchange = () => { if (pendingImport) preview(pendingImport.parsed); };
function preview(parsed) {
  const accId = $("iAcc").value, acc = S.list("accounts").find(a => a.id === accId);
  const plan = L.planImport(parsed.txs, accId, S.list("txs"), S.list("rules"));
  pendingImport = { parsed, plan, accId };
  const dates = parsed.txs.map(t => t.date).sort();
  // solde proposé : celui du fichier (OFX), sinon le solde calculé après import
  let bal = parsed.balance?.amount, balDate = parsed.balance?.date || L.todayStr();
  if (bal == null && acc.ref) {
    const after = [...S.list("txs").filter(t => !plan.replaced.some(r => r.id === t.id)), ...plan.add.map(t => ({ ...t, accountId: accId }))];
    bal = L.balanceOf(acc, after);
  }
  const box = $("iPreview");
  box.hidden = false;
  box.innerHTML = `
    <h2>${plan.add.length ? `${plan.add.length} nouvelle${plan.add.length > 1 ? "s" : ""} opération${plan.add.length > 1 ? "s" : ""}` : "Rien de nouveau"}</h2>
    <p class="muted">Fichier ${parsed.format} du ${esc(dShort(dates[0]))} au ${esc(dShort(dates.at(-1)))}.${plan.dup ? ` ${plan.dup} en double ou déjà importée${plan.dup > 1 ? "s" : ""}, ignorée${plan.dup > 1 ? "s" : ""}.` : ""}${plan.replaced.length ? ` ${plan.replaced.length} saisie${plan.replaced.length > 1 ? "s" : ""} à la main remplacée${plan.replaced.length > 1 ? "s" : ""} par la banque.` : ""}</p>
    ${plan.add.length ? `<table class="prev"><tbody>${plan.add.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(t =>
      `<tr><td>${esc(dShort(t.date))}</td><td>${esc(t.label)}<br><span class="muted">${esc(L.CAT[t.cat]?.name)}</span></td><td class="${t.amount > 0 ? "pos" : ""}">${signed(t.amount)}</td></tr>`).join("")}</tbody></table>
      ${plan.add.length > 8 ? `<p class="muted">… et ${plan.add.length - 8} autres. Tu pourras corriger les catégories dans Opérations.</p>` : ""}` : ""}
    <div class="grid2">
      <div class="field"><label for="iBal">Solde affiché par la banque (€)</label><input id="iBal" inputmode="decimal" value="${bal != null ? String(bal).replace(".", ",") : ""}" placeholder="Par ex. 1 234,56"></div>
      <div class="field"><label for="iBalDate">Solde au</label><input id="iBalDate" type="date" value="${balDate}"></div>
    </div>
    <p class="muted">${parsed.balance ? "Solde lu dans le fichier." : acc.ref ? "Solde calculé avec ce relevé : compare-le à celui de ta banque et corrige-le s'il diffère." : "Recopie le solde que ta banque affiche, c'est la base du calcul."}</p>
    <div class="row"><button class="btn primary" type="button" id="btnDoImport">Importer</button><button class="btn ghost" type="button" id="btnCancelImport">Annuler</button></div>`;
  $("btnCancelImport").onclick = () => { box.hidden = true; pendingImport = null; $("iFile").value = ""; };
  $("btnDoImport").onclick = doImport;
}
function doImport() {
  const { plan, accId } = pendingImport;
  const now = new Date().toISOString();
  if (plan.replaced.length) S.remove("txs", plan.replaced);
  if (plan.add.length) S.save("txs", plan.add.map(t => ({ ...t, createdAt: now })));
  const bal = num($("iBal").value);
  if (!isNaN(bal)) {
    const acc = S.list("accounts").find(a => a.id === accId);
    S.save("accounts", { ...acc, ref: { amount: bal, date: $("iBalDate").value || L.todayStr(), at: new Date().toISOString() } });
  }
  fixCats();
  pendingImport = null; $("iFile").value = "";
  $("iPreview").innerHTML = `<h2>Import terminé</h2><p class="muted">${plan.add.length} opération${plan.add.length > 1 ? "s" : ""} ajoutée${plan.add.length > 1 ? "s" : ""}.</p><div class="row"><button class="btn primary" type="button" data-go="mois">Voir ce qu'il me reste</button></div>`;
  renderSuggest($("iSuggest"));
}

/* ---------- prélèvements repérés ---------- */
function renderSuggest(el) {
  const d = data();
  const sug = L.detectRecurring(d.txs, d.accounts, d.charges, d.settings.dismissed || []);
  if (!sug.length) { el.innerHTML = ""; return; }
  const wasOpen = el.querySelector("details")?.open;
  el.innerHTML = `<details class="sug"${el.id === "iSuggest" ? " open" : ""}><summary>${sug.length} prélèvement${sug.length > 1 ? "s reviennent" : " revient"} chaque mois. Les vérifier</summary>
    <p class="muted">Ajoute-les aux charges fixes pour qu'ils soient retirés de ce qu'il te reste tant qu'ils ne sont pas passés.</p>
    <div class="lines">${sug.slice(0, 12).map(g => `<div class="line"><span>${esc(g.name)}</span><span class="money">${eur(g.amount)}</span>
      <span class="sub">vers le ${g.day}, vu ${g.months} mois, ${esc(accName(g.accountId))}</span>
      <div class="acts"><button class="btn" type="button" data-add="${esc(g.id)}">Ajouter</button><button class="btn ghost" type="button" data-skip="${esc(g.id)}">Pas une charge fixe</button></div></div>`).join("")}</div></details>`;
  if (wasOpen) el.querySelector("details").open = true;
  for (const b of el.querySelectorAll("[data-add]")) b.onclick = () => {
    const g = sug.find(x => x.id === b.dataset.add);
    S.save("charges", { name: g.name, amount: g.amount, day: g.day, accountId: g.accountId, keyword: g.keyword });
    toast(`${g.name} ajouté aux charges fixes.`);
  };
  for (const b of el.querySelectorAll("[data-skip]")) b.onclick = () => S.saveSettings({ dismissed: [...(S.settings().dismissed || []), b.dataset.skip] });
}

/* ---------- Comptes ---------- */
function renderComptes() {
  const d = data();
  $("accList").innerHTML = d.accounts.map(a => {
    const b = L.balanceOf(a, d.txs);
    return `<button type="button" class="acc" data-id="${a.id}"><span class="n">${esc(a.name)}</span><span class="money">${b == null ? `<span class="muted">Solde ?</span>` : eur(a.kind === "credit" ? -Math.abs(b) : b)}</span>
      <span class="k">${KIND[a.kind]}${a.main ? ", sert au calcul du reste" : ""}${a.matelas ? ", épargne de secours" : ""}${a.ref?.date && a.kind === "credit" ? `, mis à jour le ${esc(dShort(a.ref.date))}` : ""}</span></button>`;
  }).join("");
  for (const b of $("accList").querySelectorAll(".acc")) b.onclick = () => editAccount(S.list("accounts").find(a => a.id === b.dataset.id));
  const month = L.ym(L.todayStr());
  $("chargeList").innerHTML = d.charges.length ? `<div class="lines">${d.charges.slice().sort((a, b) => a.day - b.day).map(c => {
    const paid = L.chargeMatch(c, d.txs, month);
    return `<button type="button" class="acc" data-ch="${c.id}"><span class="n">${esc(c.name)}</span><span class="money">${eur(c.amount)}</span>
      <span class="k">Vers le ${c.day}, ${esc(accName(c.accountId))}. ${paid ? `Passé le ${esc(dShort(paid.date))}.` : "À venir ce mois-ci."}</span></button>`;
  }).join("")}</div>` : `<p class="empty">Pas encore de charge fixe.</p>`;
  for (const b of $("chargeList").querySelectorAll("[data-ch]")) b.onclick = () => editCharge(S.list("charges").find(c => c.id === b.dataset.ch));
  renderSuggest($("chargeSuggest"));
  const st = S.settings();
  if (document.activeElement !== $("sCushion")) $("sCushion").value = String(st.cushion).replace(".", ",");
  if (document.activeElement !== $("sBig")) $("sBig").value = String(st.bigSpend).replace(".", ",");
  const con = S.isConnected();
  $("dbxText").textContent = con ? "Connecté. Tes données sont rangées dans Dropbox, dossier Applications › Frais de regie Eddy › budget, et partagées entre ton ordi et ton téléphone."
    : "Pas connecté sur cet appareil. Si Frais de régie est déjà connecté ici, ouvre-le une fois puis reviens. Sinon, ouvre Dropbox, autorise l'appli, puis colle le code affiché.";
  $("dbxConnect").hidden = con;
  if (!con) $("settingsFold").open = true;
}
$("sCushion").onchange = e => { const v = num(e.target.value); if (!isNaN(v)) S.saveSettings({ cushion: v }); };
$("sBig").onchange = e => { const v = num(e.target.value); if (!isNaN(v)) S.saveSettings({ bigSpend: v }); };
$("btnAddAcc").onclick = () => editAccount(null);
$("btnAddCharge").onclick = () => editCharge(null);
$("btnDbxOpen").onclick = () => S.openCodePage();
$("btnDbxOk").onclick = async () => {
  $("dbxErr").textContent = "";
  try { await S.finishWithCode($("dbxCode").value); $("dbxCode").value = ""; toast("Dropbox connecté."); }
  catch (e) { $("dbxErr").textContent = e.code === "no_pkce" ? "Clique d'abord sur « Ouvrir Dropbox »." : "Le code n'a pas marché. Recommence depuis « Ouvrir Dropbox »."; }
};
$("btnRestore").onclick = () => $("restoreFile").click();
$("restoreFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { S.restoreData(JSON.parse(await f.text())); toast("Sauvegarde restaurée."); show("mois"); }
  catch { toast("Ce fichier n'est pas une sauvegarde de Reste à vivre."); }
};
$("btnBackup").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([S.exportData()], { type: "application/json" }));
  a.download = `budget-sauvegarde-${L.todayStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

function editAccount(acc) {
  const isNew = !acc;
  const a = acc || { name: "", kind: "courant" };
  const txs = S.list("txs");
  const bal = isNew ? null : L.balanceOf(a, txs);
  const nTx = txs.filter(t => t.accountId === a.id).length;
  openDialog(`
    <h2>${isNew ? "Nouveau compte" : esc(a.name)}</h2>
    <div class="grid2">
      <div class="field"><label for="aName">Nom</label><input id="aName" name="name" value="${esc(a.name)}" required placeholder="Compte beatmaking"></div>
      <div class="field"><label for="aKind">Type</label><select id="aKind" name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === a.kind ? " selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label for="aBal">${a.kind === "credit" ? "Capital restant dû (€)" : "Solde (€)"}</label><input id="aBal" name="bal" inputmode="decimal" value="${bal != null ? String(a.kind === "credit" ? Math.abs(bal) : bal).replace(".", ",") : ""}" placeholder="Celui affiché par la banque"></div>
      <div class="field"><label for="aDate">Au</label><input id="aDate" name="date" type="date" value="${L.todayStr()}"></div>
    </div>
    <label class="check"><input type="checkbox" name="main" ${a.main ? "checked" : ""}> Compte principal : c'est sur lui que je calcule ce qu'il te reste</label>
    <label class="check"><input type="checkbox" name="matelas" ${a.matelas ? "checked" : ""}> Épargne de secours (dispo tout de suite si les contrats s'arrêtent)</label>
    ${a.kind === "epargne" ? `<div class="block stack">
      <label class="check"><input type="checkbox" name="pots" id="aPots" ${a.pots ? "checked" : ""}> Suivre les avances au compte courant et les congés spectacles sur ce livret</label>
      <div class="grid2" id="aPotsFields" ${a.pots ? "" : "hidden"}>
        <div class="field"><label for="pStart">Point de départ</label><input id="pStart" name="pStart" type="date" value="${a.pots?.start || L.todayStr()}"></div>
        <div class="field"><label for="pDebt">Avance due ce jour-là (€)</label><input id="pDebt" name="pDebt" inputmode="decimal" value="${String(a.pots?.debt ?? 0).replace(".", ",")}"></div>
        <div class="field"><label for="pConges">Congés dispo ce jour-là (€)</label><input id="pConges" name="pConges" inputmode="decimal" value="${String(a.pots?.conges ?? 0).replace(".", ",")}"></div>
      </div>
      <p class="muted">Ensuite, chaque virement est rangé tout seul d'après son motif : « avance » ou « remboursement avance », « congés » ou « vacances », sinon épargne. Un versement rembourse l'avance en premier. Tu peux changer l'enveloppe d'une opération dans sa fiche.</p>
    </div>` : ""}
    ${nTx ? `<div class="block stack"><p class="muted">${nTx} opérations importées. En cas d'import raté (doublons…), efface-les puis réimporte le relevé.</p><button type="button" class="btn danger" data-act="clear" data-confirm="Appuie encore pour effacer les ${nTx} opérations" style="align-self:flex-start">Effacer les opérations de ce compte</button></div>` : ""}
    ${dlgButtons(isNew ? "" : "Supprimer le compte")}`,
  fd => {
    const v = { ...a, name: fd.get("name").trim(), kind: fd.get("kind"), main: !!fd.get("main"), matelas: !!fd.get("matelas") };
    if (fd.get("pots")) {
      const start = fd.get("pStart") || L.todayStr(), debt = num(fd.get("pDebt")) || 0, conges = num(fd.get("pConges")) || 0;
      const same = a.pots && a.pots.start === start && a.pots.debt === debt && a.pots.conges === conges;
      v.pots = same ? a.pots : { start, debt, conges, moves: [] };
    } else if (a.kind === "epargne") v.pots = null;
    const b = num(fd.get("bal"));
    const changed = !isNaN(b) && (bal == null || Math.abs(b - (a.kind === "credit" ? Math.abs(bal) : bal)) > 0.004);
    if (changed) v.ref = { amount: v.kind === "credit" ? Math.abs(b) : b, date: fd.get("date") || L.todayStr(), at: new Date().toISOString() };
    if (v.main) { const others = S.list("accounts").filter(x => x.main && x.id !== a.id).map(x => ({ ...x, main: false })); if (others.length) S.save("accounts", others); }
    S.save("accounts", v);
  }, {
    onOpen: () => { const c = $("aPots"); if (c) c.onchange = () => { $("aPotsFields").hidden = !c.checked; }; },
    onClear: () => {
      S.remove("txs", txs.filter(t => t.accountId === a.id));
      S.save("accounts", { ...a, ref: null });
      toast("Opérations effacées. Réimporte le relevé.");
    },
    onDelete: () => {
      S.remove("txs", txs.filter(t => t.accountId === a.id));
      S.remove("charges", S.list("charges").filter(c => c.accountId === a.id));
      S.remove("accounts", a);
    },
  });
}
function editCharge(ch) {
  const isNew = !ch;
  const c = ch || { name: "", amount: "", day: 5, accountId: mainAcc()?.id, keyword: "" };
  const accs = S.list("accounts").filter(a => a.kind === "courant");
  openDialog(`
    <h2>${isNew ? "Nouvelle charge fixe" : esc(c.name)}</h2>
    <div class="grid2">
      <div class="field"><label for="cName">Nom</label><input id="cName" name="name" value="${esc(c.name)}" required placeholder="Prêt immo"></div>
      <div class="field"><label for="cAmt">Montant (€)</label><input id="cAmt" name="amount" inputmode="decimal" required value="${c.amount === "" ? "" : String(c.amount).replace(".", ",")}"></div>
      <div class="field"><label for="cDay">Jour du mois</label><input id="cDay" name="day" type="number" min="1" max="31" value="${c.day}"></div>
      <div class="field"><label for="cAcc">Compte</label><select id="cAcc" name="acc">${accs.map(a => `<option value="${a.id}"${a.id === c.accountId ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="cKey">Mot repéré dans le libellé de la banque</label><input id="cKey" name="keyword" value="${esc(c.keyword)}" placeholder="FREE MOBILE"></div>
    <p class="muted">La charge compte comme payée dès qu'une opération du mois contient ce mot ou a exactement ce montant.</p>
    ${dlgButtons(isNew ? "" : "Supprimer")}`,
  fd => {
    const amt = Math.abs(num(fd.get("amount")));
    if (!amt) return false;
    S.save("charges", { ...c, name: fd.get("name").trim(), amount: amt, day: Math.min(31, Math.max(1, +fd.get("day") || 1)), accountId: fd.get("acc"), keyword: L.deaccent(fd.get("keyword")).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() });
  }, { onDelete: () => S.remove("charges", c) });
}

/* ---------- petits messages ---------- */
let toastT;
function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "note"; t.setAttribute("role", "status"); t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:40;box-shadow:0 6px 18px rgba(0,0,0,.2)"; document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- synchro ---------- */
const SYNC_TXT = { local: "Sur cet appareil", sync: "Synchronisation…", ok: "Dans Dropbox", offline: "Hors ligne, envoi plus tard", full: "Dropbox plein" };
function renderSync() {
  const s = S.getStatus();
  $("syncChip").dataset.s = s.status;
  $("syncText").textContent = SYNC_TXT[s.status] || s.status;
  $("syncChip").title = s.lastError || "";
}
$("syncChip").onclick = () => { if (!S.isConnected()) show("comptes"); else S.sync(); };

let raf = 0;
function queueRender() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!dlg.open) render(); else renderSync(); }); }
S.onChange(queueRender);
dlg.addEventListener("close", () => render());

/* ---------- démarrage ---------- */
function fixCats() {
  const upd = L.fixCats(S.list("txs"), S.list("accounts"));
  if (upd.length) S.save("txs", upd);
}
async function boot() {
  if (S.isConnected()) await S.sync();
  if (S.isEmpty()) S.seed("accounts", L.defaultAccounts());
  fixCats();
  const h = location.hash.slice(1);
  if (["ops", "frais", "comptes", "import"].includes(h)) show(h); else render();
}
boot();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    const onWaiting = w => { if (!w) return; $("updateBar").hidden = false; $("btnReload").onclick = () => w.postMessage("skipWaiting"); };
    if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) onWaiting(w); });
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
}
