import { CONFIG } from "./config.js";
import * as store from "./store.js";
import { CATS, readPdf, pdfPages, shrink, localParse, readWithClaude, USUAL_VAT, vatFromTtc } from "./readers.js";

const STATUS_LABEL = { a_envoyer: "À envoyer", envoyee: "Envoyée", remboursee: "Remboursée" };
const $ = id => document.getElementById(id);
const S = { fStatus: "a_envoyer", fEmp: "all", editing: null, photoBlob: null, photoType: "", previewBlob: null, ocrCtl: 0 };
const LSK = { key: "frais_claude_key", ai: "frais_ai_pdf" };
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

const fmt = n => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const frDate = s => s ? s.split("-").reverse().join("/") : "";
const parseAmt = v => { const n = parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const empName = id => (store.employers().find(e => e.id === id) || {}).name || "Sans employeur";
const slug = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ticket";
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
function notice(msg) { const n = $("notice"); n.textContent = msg || ""; n.hidden = !msg; }
const isImg = t => String(t || "").startsWith("image/");

/* ---------- vignettes ---------- */
const urlCache = new Map();
async function fileUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  const b = await store.getFile(path);
  const u = URL.createObjectURL(b); urlCache.set(path, u); return u;
}
const thumbIO = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { thumbIO.unobserve(e.target); loadThumb(e.target); }
}, { rootMargin: "200px" }) : null;
function loadThumb(node) {
  fileUrl(node.dataset.path).then(u => { const img = el("img", { class: "thumb", src: u, alt: "" }); node.replaceWith(img); }).catch(() => {});
}

/* ---------- rendu ---------- */
function fillSelects() {
  const emps = store.employers().slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const opts = (sel, withAll, withNew) => {
    const cur = sel.value || (sel === $("empFilter") ? S.fEmp : "");
    sel.replaceChildren();
    if (withAll) sel.append(el("option", { value: "all", text: "Tous les employeurs" }));
    for (const e of emps) sel.append(el("option", { value: e.id, text: e.name }));
    if (withNew) sel.append(el("option", { value: "__new", text: "+ Nouvel employeur…" }));
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  };
  opts($("empFilter"), true, false); $("empFilter").value = [...$("empFilter").options].some(o => o.value === S.fEmp) ? S.fEmp : "all";
  opts($("fEmp"), false, true);
  opts($("eEmp"), false, false);
  const c = $("fCat"); if (!c.options.length) for (const k of CATS) c.append(el("option", { value: k, text: k }));
}
function render() {
  fillSelects();
  const all = store.expenses();
  const sum = $("summary"); sum.replaceChildren();
  const byEmp = new Map();
  for (const x of all.filter(x => x.status === "a_envoyer")) { const k = x.employerId || ""; const o = byEmp.get(k) || { n: 0, t: 0 }; o.n++; o.t += Number(x.amount) || 0; byEmp.set(k, o); }
  if (!byEmp.size) sum.append(el("div", { class: "empty", style: "grid-column:1/-1", text: "Rien à envoyer pour l’instant." }));
  else for (const [k, o] of [...byEmp.entries()].sort((a, b) => b[1].t - a[1].t)) {
    sum.append(el("button", { type: "button", class: "sum" + (S.fEmp === k ? " active" : ""), onclick: () => { S.fEmp = S.fEmp === k ? "all" : k; S.fStatus = "a_envoyer"; syncSeg(); render(); } },
      el("span", { class: "name", text: empName(k) }), el("span", { class: "amt", text: fmt(o.t) }), el("span", { class: "cnt", text: o.n + " ticket" + (o.n > 1 ? "s" : "") })));
  }
  const list = $("list"); list.replaceChildren();
  const rows = all.filter(x => (S.fStatus === "all" || x.status === S.fStatus) && (S.fEmp === "all" || x.employerId === S.fEmp))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!rows.length) {
    list.append(el("div", { class: "empty" }, all.length ? "Aucun ticket avec ces filtres." : "Aucun ticket pour l’instant. Appuie sur « + Ticket » et ajoute la photo ou le PDF du ticket."));
    return;
  }
  for (const x of rows) {
    const thumbPath = isImg(x.receipt?.type) ? x.receipt.path : x.preview;
    let th;
    if (thumbPath && urlCache.has(thumbPath)) th = el("img", { class: "thumb", src: urlCache.get(thumbPath), alt: "" });
    else { th = el("div", { class: "thumb", text: x.receipt ? (isImg(x.receipt.type) ? "Photo" : "PDF") : "—" }); if (thumbPath) { th.dataset.path = thumbPath; thumbIO ? thumbIO.observe(th) : loadThumb(th); } }
    list.append(el("button", { type: "button", class: "item", onclick: () => openForm(x) }, th,
      el("div", { class: "main" }, el("div", { class: "mer", text: x.merchant || "(sans nom)" }), el("div", { class: "meta", text: [frDate(x.date), x.category, empName(x.employerId)].filter(Boolean).join(", ") })),
      el("div", { class: "right" }, el("span", { class: "money", text: fmt(x.amount) }), el("span", { class: "pill " + x.status, text: STATUS_LABEL[x.status] || "" }),
        isEmbed ? el("span", { class: "pill " + (x.txId ? "linked" : "unlinked"), text: x.txId ? "Lié au relevé" : "Pas lié au relevé" }) : null)));
  }
}
function syncSeg() { for (const b of $("statusSeg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.s === S.fStatus)); }
function renderSync() {
  const s = store.getStatus();
  const chip = $("syncChip"); chip.dataset.s = s.status;
  const waiting = s.pendingFiles ? ` (${s.pendingFiles} fichier${s.pendingFiles > 1 ? "s" : ""} en attente)` : "";
  $("syncText").textContent =
    s.status === "ok" ? "Synchronisé avec Dropbox" :
    s.status === "sync" ? "Synchronisation…" :
    s.status === "full" ? "Dropbox est plein" :
    s.status === "scope" ? "Dropbox : autorisation manquante" :
    s.status === "offline" ? "Hors ligne, envoi plus tard" + waiting :
    store.hasAppKey() ? "Sur cet appareil seulement · Connecter Dropbox" : "Sur cet appareil seulement";
  renderDbx();
}

/* ---------- panneaux ---------- */
const PANELS = ["formPanel", "exportPanel", "empPanel", "setPanel"];
function showOnly(id) { for (const p of PANELS) $(p).hidden = p !== id; document.body.classList.toggle("panel-open", !!id); if (id) $(id).scrollIntoView({ behavior: "smooth", block: "start" }); }
function openForm(x) {
  S.editing = x || null; S.linkTx = null; S.photoBlob = null; S.previewBlob = null; S.photoType = x?.receipt?.type || ""; S.ocrCtl++;
  $("formTitle").textContent = x ? "Modifier le ticket" : "Nouveau ticket";
  $("fDate").value = x?.date || today();
  $("fAmount").value = x ? String(x.amount).replace(".", ",") : "";
  $("fMerchant").value = x?.merchant || "";
  fillSelects();
  $("fCat").value = x?.category || CATS[0];
  const emps = store.employers();
  $("fEmp").value = x?.employerId || (S.fEmp !== "all" ? S.fEmp : (emps[0]?.id || "__new"));
  $("newEmpField").hidden = $("fEmp").value !== "__new"; $("fNewEmp").value = "";
  $("fStatus").value = x?.status || "a_envoyer";
  $("fVatRate").value = x?.vatRate == null ? "" : String(x.vatRate);
  $("fVat").value = x?.vat == null ? "" : String(x.vat.toFixed(2)).replace(".", ",");
  S.vatManual = x?.vat != null && (x.vatRate === "multi" || x.vatRate == null || Math.abs(vatFromTtc(x.amount, x.vatRate) - x.vat) > 0.01);
  updateVat();
  $("fNote").value = x?.note || "";
  $("fPhoto").value = "";
  const pv = $("fPreview"); pv.hidden = true; pv.removeAttribute("src");
  const pPath = isImg(S.photoType) ? x?.receipt?.path : x?.preview;
  if (pPath) fileUrl(pPath).then(u => { if (S.editing === x) { pv.src = u; pv.hidden = false; } }).catch(() => {});
  $("btnView").hidden = !x?.receipt;
  const st = $("ocrStatus"); st.className = "status";
  st.textContent = x?.receipt ? (isImg(S.photoType) ? "" : "Justificatif PDF joint.") : (lsGet(LSK.key) ? "Les PDF se remplissent tout seuls. Les photos sont lues par Claude." : "Les PDF se remplissent tout seuls, sans IA.");
  $("mmStatus").textContent = ""; renderMm();
  $("btnDelete").hidden = !x; $("btnDelete").dataset.armed = ""; $("btnDelete").textContent = "Supprimer";
  $("saveStatus").textContent = ""; $("btnSave").disabled = false;
  showOnly("formPanel");
}

/* ---------- TVA ---------- */
const rateVal = () => { const v = $("fVatRate").value; return v === "" ? null : v === "multi" ? "multi" : parseFloat(v); };
const pct = r => String(r).replace(".", ",") + " %";
function updateVat() {
  const ttc = parseAmt($("fAmount").value), rate = rateVal();
  if (!S.vatManual) {
    if (typeof rate === "number" && isFinite(ttc)) $("fVat").value = vatFromTtc(ttc, rate).toFixed(2).replace(".", ",");
    else if (rate == null) $("fVat").value = "";
  }
  const vat = parseAmt($("fVat").value);
  $("htLine").textContent = isFinite(ttc) && isFinite(vat) ? `Hors taxes : ${fmt(ttc - vat)}` : "";
  const usual = USUAL_VAT[$("fCat").value], hint = $("vatHint");
  hint.hidden = !(rate == null && usual);
  if (usual) hint.textContent = `Taux habituel pour « ${$("fCat").value} » : ${pct(usual)} (vérifie sur le ticket)`;
}
$("fAmount").addEventListener("input", updateVat);
$("fCat").addEventListener("change", updateVat);
$("fVatRate").addEventListener("change", () => { S.vatManual = false; updateVat(); });
$("fVat").addEventListener("input", () => { S.vatManual = $("fVat").value.trim() !== ""; updateVat(); });
$("vatHint").addEventListener("click", () => { const u = USUAL_VAT[$("fCat").value]; if (u) { $("fVatRate").value = String(u); S.vatManual = false; updateVat(); } });

/* ---------- photo / PDF + lecture auto ---------- */
function applyResult(r) {
  if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) $("fDate").value = r.date;
  if (typeof r.montant === "number" && isFinite(r.montant)) $("fAmount").value = r.montant.toFixed(2).replace(".", ",");
  if (r.marchand && !$("fMerchant").value) $("fMerchant").value = String(r.marchand).slice(0, 80);
  if (CATS.includes(r.categorie)) $("fCat").value = r.categorie;
  if (r.detail && !$("fNote").value) $("fNote").value = String(r.detail).slice(0, 120);
  if (r.taux_tva != null && [...$("fVatRate").options].some(o => o.value === String(r.taux_tva))) $("fVatRate").value = String(r.taux_tva);
  if (typeof r.tva === "number" && isFinite(r.tva)) { $("fVat").value = r.tva.toFixed(2).replace(".", ","); S.vatManual = true; }
  else S.vatManual = false;
  updateVat();
  renderMm();
}
$("fPhoto").addEventListener("change", async e => {
  const f = e.target.files?.[0]; if (!f) return;
  const st = $("ocrStatus"); st.className = "status";
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const blob = isPdf ? (f.type === "application/pdf" ? f : new Blob([f], { type: "application/pdf" })) : await shrink(f);
  S.photoBlob = blob; S.photoType = isPdf ? "application/pdf" : (blob.type || f.type || "image/jpeg");
  const pv = $("fPreview"); pv.hidden = true; S.previewBlob = null; $("btnView").hidden = false;
  if (isImg(S.photoType)) { pv.src = URL.createObjectURL(blob); pv.hidden = false; }
  const ticket = ++S.ocrCtl;
  const key = lsGet(LSK.key);
  let pdfText = "", pdfImg = null;
  if (isPdf) {
    st.textContent = "Lecture du PDF…";
    try { const r = await readPdf(blob); pdfText = r.text; pdfImg = r.img; }
    catch { st.className = "status err"; st.textContent = "PDF joint, mais je n’ai pas pu l’ouvrir. Remplis les champs à la main."; return; }
    if (ticket !== S.ocrCtl) return;
    if (pdfImg) { S.previewBlob = pdfImg; pv.src = URL.createObjectURL(pdfImg); pv.hidden = false; }
    const r = pdfText.length >= 30 ? localParse(pdfText, f.name) : {};
    applyResult(r);
    const got = [r.date && "la date", r.montant != null && "le montant", r.marchand && "le commerçant", r.taux_tva != null && "la TVA"].filter(Boolean);
    const enough = r.date && r.montant != null;
    if (enough || !key || lsGet(LSK.ai) !== "1") {
      st.className = got.length ? "status okk" : "status";
      st.textContent = got.length ? `J’ai trouvé ${got.join(", ")}. Vérifie, puis complète le reste.` :
        pdfText.length < 30 ? "PDF joint. Il ne contient pas de texte lisible : remplis les champs à la main." : "Rien trouvé automatiquement : remplis les champs à la main.";
      return;
    }
  } else if (!key) { st.textContent = "Photo jointe. Remplis les champs à la main (ou ajoute une clé Claude dans Réglages)."; return; }
  st.textContent = isPdf ? "Lecture du PDF par Claude…" : "Lecture du ticket par Claude…";
  try {
    const r = await readWithClaude({ apiKey: key, text: isPdf && pdfText.length >= 30 ? pdfText : null, image: isPdf ? (pdfText.length >= 30 ? null : pdfImg) : blob });
    if (ticket !== S.ocrCtl) return;
    applyResult(r);
    st.className = "status okk";
    st.textContent = (r.devise && r.devise !== "EUR") ? `Lu. Attention : montant en ${r.devise}, convertis-le en euros.` : "Lu. Vérifie et choisis l’employeur.";
  } catch (err) {
    if (ticket !== S.ocrCtl) return;
    st.className = "status err";
    st.textContent = {
      bad_key: "Clé Claude refusée. Vérifie-la dans Réglages.",
      no_credit: "Plus de crédit sur ton compte API Claude.",
      rate_limited: "Trop de lectures d’un coup. Réessaie dans un instant.",
      offline: "Pas de connexion : remplis les champs à la main.",
    }[err.code] || "Je n’ai pas réussi à lire ce ticket. Remplis les champs à la main.";
  }
});

/* ---------- enregistrer ---------- */
function ensureEmployer() {
  const v = $("fEmp").value;
  if (v !== "__new") return v;
  const name = $("fNewEmp").value.trim(); if (!name) throw new Error("Donne un nom au nouvel employeur.");
  const ex = store.employers().find(e => e.name.toLowerCase() === name.toLowerCase()); if (ex) return ex.id;
  return store.saveEmployer({ id: store.uid(), name }).id;
}
// Enregistre le formulaire. Renvoie le ticket enregistré, ou null si une erreur est affichée.
async function saveForm(extra = {}) {
  const st = $("saveStatus"); st.className = "status";
  const amount = parseAmt($("fAmount").value);
  if (!$("fDate").value) { st.className = "status err"; st.textContent = "Indique la date."; return null; }
  if (!isFinite(amount) || amount <= 0) { st.className = "status err"; st.textContent = "Indique un montant valide."; return null; }
  const vatTxt = $("fVat").value.trim(), vat = vatTxt ? parseAmt(vatTxt) : null;
  if (vatTxt && (!isFinite(vat) || vat < 0 || vat >= amount)) { st.className = "status err"; st.textContent = "Le montant de TVA ne semble pas correct."; return null; }
  st.textContent = "Enregistrement…";
  try {
    const employerId = ensureEmployer();
    const old = S.editing;
    const id = old?.id || store.uid();
    let receipt = old?.receipt || null, preview = old?.preview || null;
    if (S.photoBlob) {
      const ext = S.photoType === "application/pdf" ? "pdf" : S.photoType === "image/png" ? "png" : "jpg";
      const date = $("fDate").value;
      const path = `/justificatifs/${date.slice(0, 4)}/${date}_${slug($("fMerchant").value)}_${id.slice(-6)}.${ext}`;
      if (old?.receipt?.path && old.receipt.path !== path) store.removeFile(old.receipt.path);
      if (old?.preview && old.preview !== `/apercus/${id}.jpg`) store.removeFile(old.preview);
      await store.putFile(path, S.photoBlob);
      receipt = { path, type: S.photoType }; preview = null;
      if (S.photoType === "application/pdf" && S.previewBlob) { preview = `/apercus/${id}.jpg`; await store.putFile(preview, S.previewBlob); }
    }
    const status = extra.status || $("fStatus").value;
    const saved = store.saveExpense({ ...(old || {}), id, date: $("fDate").value, amount, merchant: $("fMerchant").value.trim(), category: $("fCat").value, employerId,
      status, note: $("fNote").value.trim(), receipt, preview, vatRate: rateVal(), vat: vat == null ? (rateVal() === 0 ? 0 : null) : vat,
      createdAt: old?.createdAt || new Date().toISOString(), sentAt: status === "a_envoyer" ? null : (extra.sentAt || old?.sentAt || null),
      ...(extra.via ? { via: extra.via } : {}), ...(S.linkTx && !old ? { txId: S.linkTx } : {}) });
    // le formulaire continue sur ce ticket (photo déjà enregistrée)
    S.editing = saved; S.photoBlob = null; S.previewBlob = null; S.photoType = saved.receipt?.type || "";
    S.fEmp = employerId; S.fStatus = status; syncSeg();
    st.textContent = "";
    return saved;
  } catch (err) {
    st.className = "status err"; st.textContent = err?.message && !err.code ? err.message : "L’enregistrement a échoué. Réessaie.";
    return null;
  }
}
$("btnSave").addEventListener("click", async () => {
  $("btnSave").disabled = true;
  try { if (await saveForm()) { showOnly(null); render(); } }
  finally { $("btnSave").disabled = false; }
});

/* ---------- Movinmotion ---------- */
const MM_URL = "https://www.movinmotion.com/connexion/";
const isMm = id => !!store.employers().find(e => e.id === id)?.movinmotion;
function mmSummary() {
  const vat = $("fVat").value.trim();
  return [
    ["Date", frDate($("fDate").value)],
    ["Montant TTC", $("fAmount").value.trim() ? $("fAmount").value.trim() + " €" : ""],
    ["TVA", vat ? `${vat} €${rateVal() != null && rateVal() !== "multi" ? " (" + String(rateVal()).replace(".", ",") + " %)" : ""}` : ""],
    ["Commerçant", $("fMerchant").value.trim()],
    ["Catégorie", $("fCat").value],
    ["Détail", $("fNote").value.trim()],
  ].filter(([, v]) => v);
}
function renderMm() {
  const box = $("mmBox"); const on = isMm($("fEmp").value);
  box.hidden = !on; if (!on) return;
  const list = $("mmList"); list.replaceChildren();
  for (const [k, v] of mmSummary()) {
    const copy = el("button", { type: "button", class: "linkbtn", text: "Copier", onclick: async () => {
      try { await navigator.clipboard.writeText(v.replace(/ €.*$/, "").trim()); copy.textContent = "Copié ✓"; setTimeout(() => copy.textContent = "Copier", 1500); } catch { copy.textContent = "Copie impossible"; }
    } });
    list.append(el("div", { class: "mm-row" }, el("span", { class: "mm-k", text: k }), el("span", { class: "mm-v", text: v }), copy));
  }
  const sent = S.editing?.via === "movinmotion" && S.editing.status !== "a_envoyer";
  $("btnMm").textContent = sent ? "Renvoyer le justificatif" : "Envoyer vers Movinmotion";
}
["fDate", "fAmount", "fVat", "fMerchant", "fNote"].forEach(id => $(id).addEventListener("input", renderMm));
["fVatRate", "fCat", "fEmp"].forEach(id => $(id).addEventListener("change", renderMm));
$("btnMm").addEventListener("click", async () => {
  const st = $("mmStatus"); st.className = "status";
  $("btnMm").disabled = true;
  try {
    const hadReceipt = !!(S.photoBlob || S.editing?.receipt);
    const x = await saveForm({ status: "envoyee", sentAt: new Date().toISOString(), via: "movinmotion" });
    if (!x) return;
    $("fStatus").value = "envoyee";
    if (!hadReceipt) { st.className = "status err"; st.textContent = "Ajoute d’abord la photo ou le PDF du ticket."; return; }
    const blob = await store.getFile(x.receipt.path);
    const ext = x.receipt.path.split(".").pop();
    const name = `${x.date}_${slug(x.merchant)}_${(Number(x.amount) || 0).toFixed(2).replace(".", ",")}EUR.${ext}`;
    const file = new File([blob], name, { type: x.receipt.type });
    const text = mmSummary().map(([k, v]) => `${k} : ${v}`).join("\n");
    const mobile = matchMedia("(pointer:coarse)").matches;
    if (mobile && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); }
      catch (e) { if (e?.name === "AbortError") { st.textContent = "Partage annulé. Le ticket reste marqué « Envoyée », change le statut si besoin."; return; } throw e; }
    } else {
      const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      try { await navigator.clipboard.writeText(text); } catch {}
    }
    st.className = "status okk";
    st.textContent = mobile ? "Justificatif prêt. Dans Movinmotion : Mes dépenses, puis +, ajoute ce fichier et vérifie les champs." :
      "Justificatif téléchargé et infos copiées. Dans Movinmotion : Mes dépenses, puis +, ajoute ce fichier et vérifie les champs.";
    renderMm(); render();
  } catch { st.className = "status err"; st.textContent = "Le justificatif n’a pas pu être préparé (hors ligne ?)."; }
  finally { $("btnMm").disabled = false; }
});

$("btnDelete").addEventListener("click", () => {
  const b = $("btnDelete");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirmer la suppression"; return; }
  if (S.editing) store.deleteExpense(S.editing);
  showOnly(null); render();
});
$("fEmp").addEventListener("change", () => { $("newEmpField").hidden = $("fEmp").value !== "__new"; if (!$("newEmpField").hidden) $("fNewEmp").focus(); });

/* ---------- employeurs ---------- */
function renderEmps() {
  const box = $("empList"); box.replaceChildren();
  const emps = store.employers().slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  if (!emps.length) box.append(el("div", { class: "empty", text: "Aucun employeur. Ajoute ceux pour qui tu travailles." }));
  for (const e of emps) {
    const used = store.expenses().some(x => x.employerId === e.id);
    const inp = el("input", { type: "text", value: e.name, "aria-label": "Nom de " + e.name });
    const save = el("button", { type: "button", class: "btn", text: "Renommer", onclick: () => { const n = inp.value.trim(); if (n && n !== e.name) { store.saveEmployer({ ...e, name: n }); $("empStatus").textContent = "Renommé."; } } });
    const del = el("button", { type: "button", class: "btn danger", text: "Retirer", disabled: used, title: used ? "Des tickets sont rattachés à cet employeur" : null,
      onclick: () => { if (!used) { store.saveEmployer({ ...e, deleted: true }); renderEmps(); } } });
    const mm = el("input", { type: "checkbox", checked: !!e.movinmotion, onchange: ev => store.saveEmployer({ ...e, movinmotion: ev.target.checked }) });
    box.append(el("div", { class: "emp-item" }, el("div", { class: "emp-row" }, inp, save, del), el("label", { class: "check small" }, mm, "Passe par Movinmotion (onglet « Mes dépenses »)")));
  }
}
$("btnEmpAdd").addEventListener("click", () => {
  const n = $("empNew").value.trim(); if (!n) return;
  if (store.employers().some(e => e.name.toLowerCase() === n.toLowerCase())) { $("empStatus").textContent = "Cet employeur existe déjà."; return; }
  store.saveEmployer({ id: store.uid(), name: n }); $("empNew").value = ""; $("empStatus").textContent = ""; renderEmps();
});

/* ---------- export ---------- */
function exportRows() {
  const emp = $("eEmp").value, which = $("eWhich").value;
  return store.expenses().filter(x => x.employerId === emp && (which === "all" || x.status === "a_envoyer")).sort((a, b) => a.date.localeCompare(b.date));
}
function updateExpPreview() {
  const r = exportRows(); const t = r.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  $("expPreview").textContent = r.length ? `${r.length} ticket${r.length > 1 ? "s" : ""} pour ${fmt(t)}, du ${frDate(r[0].date)} au ${frDate(r[r.length - 1].date)}` : "Aucun ticket pour cet employeur.";
  $("btnPdf").disabled = $("btnCsv").disabled = !r.length;
  $("expMm").hidden = !isMm($("eEmp").value);
}
["eEmp", "eWhich"].forEach(id => $(id).addEventListener("change", updateExpPreview));
const fileBase = () => `Note-de-frais_${slug(empName($("eEmp").value))}_${today()}`;
function markSent(rows) {
  if (!$("eMark").checked) return;
  const at = new Date().toISOString();
  for (const x of rows) if (x.status === "a_envoyer") store.saveExpense({ ...x, status: "envoyee", sentAt: at });
}
function saveName() { const n = $("eName").value.trim(); if (n !== (store.profile().name || "")) store.setName(n); }
async function deliver(filename, blob, rows) {
  const st = $("expStatus"); st.className = "status";
  // copie dans Dropbox, dossier notes-de-frais
  store.putFile(`/notes-de-frais/${filename}`, blob).catch(() => {});
  const file = new File([blob], filename, { type: blob.type });
  const mobile = matchMedia("(pointer:coarse)").matches;
  try {
    if (mobile && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: filename });
    else { const a = el("a", { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
    st.className = "status okk"; st.textContent = store.isConnected() ? "Fichier prêt, copie rangée dans Dropbox (notes-de-frais)." : "Fichier prêt.";
    markSent(rows); render(); updateExpPreview();
  } catch (e) {
    if (e?.name === "AbortError") { st.textContent = "Partage annulé."; return; }
    st.className = "status err"; st.textContent = "Le fichier n’a pas pu être enregistré ici.";
  }
}
$("btnCsv").addEventListener("click", async () => {
  const rows = exportRows(); if (!rows.length) return; saveName();
  const q = s => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const n2 = v => v == null ? "" : (Number(v) || 0).toFixed(2).replace(".", ",");
  const lines = [["Date", "Commerçant", "Catégorie", "Détail", "Montant HT (EUR)", "Taux TVA", "TVA (EUR)", "Montant TTC (EUR)", "Statut"].map(q).join(";")];
  for (const x of rows) lines.push([frDate(x.date), x.merchant, x.category, x.note, x.vat == null ? "" : n2(x.amount - x.vat), rateLabel(x.vatRate), n2(x.vat), n2(x.amount), STATUS_LABEL[x.status]].map(q).join(";"));
  const t = totals(rows);
  lines.push(["", "", "", "Total", n2(t.ht), "", n2(t.vat), n2(t.ttc), ""].map(q).join(";"));
  await deliver(fileBase() + ".csv", new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), rows);
});
const rateLabel = r => r == null ? "" : r === "multi" ? "plusieurs" : String(r).replace(".", ",") + " %";
function totals(rows) {
  const ttc = rows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const vat = rows.reduce((s, x) => s + (x.vat == null ? 0 : Number(x.vat) || 0), 0);
  const byRate = new Map();
  for (const x of rows) if (x.vat != null && x.vat > 0) { const k = rateLabel(x.vatRate) || "?"; const o = byRate.get(k) || { ht: 0, vat: 0 }; o.ht += x.amount - x.vat; o.vat += x.vat; byRate.set(k, o); }
  return { ttc, vat, ht: ttc - vat, byRate, missing: rows.filter(x => x.vat == null).length };
}
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const imgSize = url => new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = url; });
$("btnPdf").addEventListener("click", async () => {
  const rows = exportRows(); if (!rows.length) return; saveName();
  const st = $("expStatus"); st.className = "status";
  if (!window.jspdf?.jsPDF) { st.className = "status err"; st.textContent = "Le générateur PDF n’a pas chargé (connexion ?). Utilise le CSV."; return; }
  $("btnPdf").disabled = true; st.textContent = "Préparation du PDF…";
  try {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, M = 16; let y = 20;
    const emp = empName($("eEmp").value), total = rows.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const eur = n => (Number(n) || 0).toFixed(2).replace(".", ",") + " EUR";
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("Note de frais", M, y); y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
    doc.text(`Salarié : ${store.profile().name || "—"}`, M, y); y += 5.5;
    doc.text(`Employeur : ${emp}`, M, y); y += 5.5;
    doc.text(`Période : du ${frDate(rows[0].date)} au ${frDate(rows[rows.length - 1].date)}`, M, y); y += 5.5;
    doc.text(`Établie le ${frDate(today())}`, M, y); y += 9;
    const cols = [{ t: "Date", x: M, w: 19 }, { t: "Commerçant", x: M + 19, w: 38 }, { t: "Détail", x: M + 57, w: 43 },
      { t: "HT", x: M + 122, r: true }, { t: "TVA", x: M + 150, r: true }, { t: "TTC", x: W - M, r: true }];
    const head = () => { doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); for (const c of cols) doc.text(c.t, c.x, y, c.r ? { align: "right" } : undefined); y += 2; doc.setDrawColor(160); doc.line(M, y, W - M, y); y += 5; doc.setFont("helvetica", "normal"); };
    const small = (txt, x, yy, opt) => { doc.setFontSize(7.5); doc.setTextColor(120); doc.text(txt, x, yy, opt); doc.setTextColor(0); doc.setFontSize(9.5); };
    head();
    rows.forEach((x, i) => {
      const det = doc.splitTextToSize(x.note || "", cols[2].w - 2), mer = doc.splitTextToSize(x.merchant || "", cols[1].w - 2);
      const h = Math.max(det.length, mer.length + 1, 2) * 4.3 + 1;
      if (y + h > 280) { doc.addPage(); y = 20; head(); }
      doc.text(frDate(x.date), cols[0].x, y); doc.text(mer, cols[1].x, y); doc.text(det, cols[2].x, y);
      small((x.category || "") + (x.receipt ? "" : " · sans justificatif"), cols[1].x, y + mer.length * 4.3);
      doc.text(x.vat == null ? "—" : eur(x.amount - x.vat), cols[3].x, y, { align: "right" });
      doc.text(x.vat == null ? "non indiquée" : eur(x.vat), cols[4].x, y, { align: "right" });
      if (x.vatRate != null) small(rateLabel(x.vatRate), cols[4].x, y + 4, { align: "right" });
      doc.text(eur(x.amount), cols[5].x, y, { align: "right" });
      if (x.receipt) small(`Justif. n°${i + 1}`, cols[0].x, y + 4.3);
      y += h + 2;
    });
    const t = totals(rows);
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setDrawColor(160); doc.line(M, y, W - M, y); y += 6;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text("Totaux", M, y); doc.text(eur(t.ht), cols[3].x, y, { align: "right" }); doc.text(eur(t.vat), cols[4].x, y, { align: "right" }); doc.text(eur(t.ttc), cols[5].x, y, { align: "right" }); y += 8;
    doc.setFontSize(11); doc.text("Total à rembourser (TTC)", M, y); doc.text(eur(total), W - M, y, { align: "right" }); y += 7;
    doc.setFont("helvetica", "normal");
    if (t.byRate.size) {
      doc.setFontSize(8.5); doc.setTextColor(90);
      doc.text("TVA par taux : " + [...t.byRate.entries()].map(([k, o]) => `${k} : HT ${eur(o.ht)}, TVA ${eur(o.vat)}`).join(" · "), M, y, { maxWidth: W - 2 * M }); y += 5;
      doc.setTextColor(0);
    }
    if (t.missing) { small(`${t.missing} justificatif${t.missing > 1 ? "s" : ""} sans TVA indiquée : compté${t.missing > 1 ? "s" : ""} TTC dans le total HT.`, M, y); y += 5; }
    y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text("Signature :", M, y);
    const place = async (blob, title) => {
      const url = await blobToDataUrl(blob); const sz = await imgSize(url); if (!sz) throw 0;
      const maxW = W - 2 * M, maxH = 297 - 24 - 16; const s = Math.min(maxW / sz.w, maxH / sz.h);
      doc.addImage(url, blob.type === "image/png" ? "PNG" : "JPEG", M, 24, sz.w * s, sz.h * s);
    };
    let n = 0;
    for (const [i, x] of rows.entries()) {
      if (!x.receipt) continue;
      st.textContent = `Ajout des justificatifs… ${++n}`;
      doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(`Justificatif n°${i + 1} — ${frDate(x.date)} — ${x.merchant || ""} — ${eur(x.amount)}`, M, 16);
      doc.setFont("helvetica", "normal");
      try {
        const b = await store.getFile(x.receipt.path);
        if (isImg(x.receipt.type)) await place(b);
        else {
          const { pages } = await pdfPages(b, 5);
          for (const [k, pg] of pages.entries()) {
            if (k > 0) { doc.addPage(); doc.setFontSize(9.5); doc.text(`Justificatif n°${i + 1}, page ${k + 1}`, M, 16); }
            await place(pg);
          }
        }
      } catch { doc.setFontSize(10); doc.text("Justificatif introuvable (hors ligne ?) : à joindre séparément.", M, 26); }
    }
    st.textContent = "";
    await deliver(fileBase() + ".pdf", doc.output("blob"), rows);
  } catch { st.className = "status err"; st.textContent = "La création du PDF a échoué. Essaie le CSV."; }
  finally { $("btnPdf").disabled = false; }
});

/* ---------- aperçu en grand ---------- */
let lastFocus = null;
async function openViewer() {
  const body = $("vBody"); body.replaceChildren(el("p", { class: "status", text: "Chargement…" }));
  $("vTitle").textContent = ($("fMerchant").value || "Justificatif") + ($("fDate").value ? ", " + frDate($("fDate").value) : "");
  lastFocus = document.activeElement; $("viewer").hidden = false; $("vClose").focus();
  try {
    let blob = S.photoBlob, type = S.photoType;
    if (!blob && S.editing?.receipt) { blob = await store.getFile(S.editing.receipt.path); type = S.editing.receipt.type; }
    if (!blob) throw 0;
    if (isImg(type)) { body.replaceChildren(el("img", { src: URL.createObjectURL(blob), alt: "Justificatif" })); return; }
    const { pages, total } = await pdfPages(blob, 10);
    body.replaceChildren(...pages.map((p, k) => el("img", { src: URL.createObjectURL(p), alt: "Page " + (k + 1) })));
    if (total > pages.length) body.append(el("p", { class: "status", text: `${total - pages.length} page(s) de plus non affichée(s).` }));
  } catch { body.replaceChildren(el("p", { class: "status err", text: "Impossible d’afficher ce justificatif (hors ligne ?)." })); }
}
function closeViewer() { $("viewer").hidden = true; $("vBody").replaceChildren(); lastFocus?.focus?.(); }
$("btnView").addEventListener("click", openViewer);
$("fPreview").addEventListener("click", openViewer);
$("vClose").addEventListener("click", closeViewer);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("viewer").hidden) closeViewer(); });

/* ---------- réglages ---------- */
function renderDbx() {
  const s = store.getStatus();
  const t = $("dbxText");
  if (!store.hasAppKey()) { t.textContent = "Dropbox n’est pas encore configuré dans l’appli. Tes tickets restent sur cet appareil en attendant."; }
  else if (s.status === "scope") t.textContent = "L’appli Dropbox n’a pas les autorisations nécessaires. Sur dropbox.com/developers/apps, onglet Permissions, coche files.content.read et files.content.write, clique Submit, puis reviens ici, déconnecte cet appareil et reconnecte-le.";
  else if (!s.connected && /token_scope/.test(s.lastError)) t.textContent = "Les autorisations de l’appli Dropbox ont changé : reconnecte Dropbox pour les appliquer.";
  else if (s.connected) {
    t.textContent = s.status === "ok" ? "Connecté. Tes tickets et justificatifs sont dans Dropbox, dossier Applications." :
      s.status === "full" ? "Connecté, mais ton Dropbox est plein : les nouveaux justificatifs attendent sur cet appareil." :
      s.status === "sync" ? "Connecté. Synchronisation en cours…" :
      /^offline/.test(s.lastError) || !s.lastError ? "Connecté. Pas de connexion pour l’instant : tout partira dès que possible." :
      "Connecté, mais Dropbox refuse l’envoi. Détail technique : " + s.lastError;
  } else t.textContent = "Pas connecté. Tes tickets restent sur cet appareil. Connecte Dropbox pour les retrouver sur l’ordi et le téléphone.";
  $("btnDbxConnect").hidden = s.connected || !store.hasAppKey();
  $("btnDbxSync").hidden = $("btnDbxOff").hidden = !s.connected;
  $("btnCodeFlow").hidden = s.connected || !store.hasAppKey() || !$("codeBox").hidden;
  if (s.connected) $("codeBox").hidden = true;
}
async function startCodeFlow() { $("codeBox").hidden = false; renderDbx(); await store.openCodePage(); $("dbxCode").focus(); }
$("btnDbxConnect").addEventListener("click", () => store.useCodeFlow() ? startCodeFlow() : store.connectWithRedirect());
$("btnCodeFlow").addEventListener("click", startCodeFlow);
$("btnDbxCode").addEventListener("click", async () => {
  const code = $("dbxCode").value; if (!code.trim()) return;
  $("btnDbxCode").disabled = true;
  try { await store.finishWithCode(code); $("dbxCode").value = ""; $("codeBox").hidden = true; await store.sync(); }
  catch (e) { $("dbxText").textContent = e.code === "offline" ? "Pas de connexion. Réessaie." : "Code refusé. Relance « Connecter Dropbox » et colle le nouveau code."; }
  finally { $("btnDbxCode").disabled = false; renderSync(); }
});
$("btnDbxSync").addEventListener("click", () => store.sync());
$("btnDbxOff").addEventListener("click", () => {
  const b = $("btnDbxOff");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirmer la déconnexion"; return; }
  b.dataset.armed = ""; b.textContent = "Déconnecter cet appareil"; store.disconnect();
});
$("btnName").addEventListener("click", () => { store.setName($("sName").value.trim()); });
$("btnKey").addEventListener("click", () => {
  const k = $("sKey").value.trim();
  lsSet(LSK.key, k);
  $("keyStatus").className = "status okk";
  $("keyStatus").textContent = k ? "Clé enregistrée sur cet appareil." : "Clé retirée.";
});
$("sUseAi").addEventListener("change", () => lsSet(LSK.ai, $("sUseAi").checked ? "1" : ""));
$("sImport").addEventListener("change", async e => {
  const f = e.target.files?.[0]; if (!f) return;
  const st = $("importStatus"); st.className = "status"; st.textContent = "Import…";
  try {
    if (!window.JSZip) throw new Error("Le lecteur de .zip n’a pas chargé (connexion ?).");
    const zip = await window.JSZip.loadAsync(f);
    const dataFile = zip.file("data.json"); if (!dataFile) throw new Error("Ce .zip ne contient pas de data.json.");
    const data = JSON.parse(await dataFile.async("string"));
    if (!Array.isArray(data.expenses)) throw new Error("Fichier de sauvegarde non reconnu.");
    let files = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || entry.name === "data.json") continue;
      const path = "/" + entry.name.replace(/^\/+/, "");
      const blob = new Blob([await entry.async("arraybuffer")], { type: store.typeOf(path) });
      await store.putFile(path, blob); files++;
    }
    store.importData({ schema: 1, profile: data.profile || { name: "", updatedAt: "" }, employers: data.employers || [], expenses: data.expenses });
    st.className = "status okk"; st.textContent = `${data.expenses.length} ticket(s) et ${files} justificatif(s) importés.`;
    render();
  } catch (err) { st.className = "status err"; st.textContent = err.message || "Import impossible."; }
  finally { e.target.value = ""; }
});
function openSettings() {
  $("sName").value = store.profile().name || "";
  $("sKey").value = lsGet(LSK.key); $("sUseAi").checked = lsGet(LSK.ai) === "1"; $("keyStatus").textContent = "";
  $("versionText").textContent = `Version ${CONFIG.appVersion}`;
  renderDbx(); showOnly("setPanel");
}

/* ---------- boutons & filtres ---------- */
$("btnAdd").addEventListener("click", () => openForm(null));
$("btnCloseForm").addEventListener("click", () => { S.ocrCtl++; showOnly(null); });
$("btnExport").addEventListener("click", () => { fillSelects(); if (S.fEmp !== "all") $("eEmp").value = S.fEmp; $("eName").value = store.profile().name || ""; $("expStatus").textContent = ""; updateExpPreview(); showOnly("exportPanel"); });
$("btnCloseExp").addEventListener("click", () => showOnly(null));
$("btnEmps").addEventListener("click", () => { renderEmps(); $("empStatus").textContent = ""; showOnly("empPanel"); });
$("btnCloseEmp").addEventListener("click", () => showOnly(null));
$("btnSettings").addEventListener("click", openSettings);
$("syncChip").addEventListener("click", openSettings);
$("btnCloseSet").addEventListener("click", () => showOnly(null));
$("statusSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.fStatus = b.dataset.s; syncSeg(); render(); });
$("empFilter").addEventListener("change", e => { S.fEmp = e.target.value; render(); });

/* ---------- dans Régie : petite interface pour l'appli qui m'accueille ---------- */
const isEmbed = window.top !== window.self;
if (isEmbed) {
  window.fraisAPI = {
    expenses: () => store.expenses(),
    employers: () => store.employers(),
    save: x => store.saveExpense(x),
    onChange: f => store.onChange(f),
    // nouveau ticket pré-rempli à partir d'une opération du relevé, lié à elle
    openNew: (p = {}) => {
      openForm(null);
      if (p.date) $("fDate").value = p.date;
      if (p.amount) $("fAmount").value = String(p.amount).replace(".", ",");
      if (p.merchant) $("fMerchant").value = p.merchant;
      S.linkTx = p.txId || null;
    },
    open: id => { const x = store.expenses().find(e => e.id === id); if (x) openForm(x); },
  };
  window.parent.postMessage({ type: "frais-ready" }, location.origin);
}

/* ---------- démarrage ---------- */
let renderQueued = false;
store.onChange(() => {
  renderSync();
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // ne pas effacer un formulaire en cours : la liste se met à jour, le formulaire reste tel quel
    render();
    if (!$("empPanel").hidden && !$("empPanel").contains(document.activeElement)) renderEmps();
    if (!$("exportPanel").hidden) updateExpPreview();
  });
});
render(); renderSync();
(async () => {
  try { if (await store.finishRedirectIfAny()) { notice(""); } }
  catch (e) { notice(e.code === "denied" ? "Connexion à Dropbox annulée." : "La connexion à Dropbox n’a pas abouti. Réessaie depuis Réglages."); }
  store.sync();
})();

/* ---------- mise à jour de l'appli ---------- */
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
