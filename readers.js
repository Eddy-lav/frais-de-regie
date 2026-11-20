// Lecture des justificatifs : PDF lus sur l'appareil (sans IA), photos lues par Claude si une clé API est réglée.
export const CATS = ["Taxi / VTC", "Transports en commun", "Train / avion", "Péage / parking", "Carburant", "Repas", "Hôtel", "Matériel", "Location véhicule", "Autre"];

/* ---------- PDF (pdf.js chargé à la demande) ---------- */
let pdfjsP = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }
function loadPdfJs() {
  if (!pdfjsP) {
    pdfjsP = loadScript("lib/pdf-3.11.174.min.js").then(() => {
      const lib = window.pdfjsLib; if (!lib) throw new Error("pdfjs");
      lib.GlobalWorkerOptions.workerSrc = new URL("lib/pdf.worker-3.11.174.min.js", location.href).href;
      return lib;
    }).catch(e => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}
async function openPdf(blob) {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
}
async function renderPage(pdf, n, maxPx = 1600) {
  const page = await pdf.getPage(n); const vp = page.getViewport({ scale: 1 });
  const v = page.getViewport({ scale: Math.min(2, maxPx / Math.max(vp.width, vp.height)) });
  const c = document.createElement("canvas"); c.width = Math.round(v.width); c.height = Math.round(v.height);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: v }).promise;
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
}
export async function pdfPages(blob, max) {
  const pdf = await openPdf(blob); const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) pages.push(await renderPage(pdf, i));
  return { pages, total: pdf.numPages };
}
export async function readPdf(blob) {
  const pdf = await openPdf(blob); let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) { const tc = await (await pdf.getPage(i)).getTextContent(); text += tc.items.map(t => t.str).join(" ") + "\n"; }
  return { text: text.replace(/\s+/g, " ").trim(), img: await renderPage(pdf, 1) };
}

/* ---------- photos : réduction avant envoi ---------- */
export async function shrink(file, max = 1600) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.85));
  } catch { return file; }
}

/* ---------- lecture sans IA : règles simples sur le texte ---------- */
const MONTHS = { janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12,
  jan: 1, "fév": 2, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, may: 5, jun: 6, jui: 7, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, "déc": 12, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const MERCHANTS = [
  ["Uber Eats", "Repas"], ["Uber", "Taxi / VTC"], ["Bolt", "Taxi / VTC"], ["Heetch", "Taxi / VTC"], ["G7", "Taxi / VTC"], ["FreeNow", "Taxi / VTC"], ["Taxi", "Taxi / VTC"],
  ["SNCF Connect", "Train / avion"], ["SNCF", "Train / avion"], ["Ouigo", "Train / avion"], ["Trainline", "Train / avion"], ["Eurostar", "Train / avion"], ["Air France", "Train / avion"], ["easyJet", "Train / avion"], ["Transavia", "Train / avion"], ["Ryanair", "Train / avion"], ["Vueling", "Train / avion"],
  ["RATP", "Transports en commun"], ["Navigo", "Transports en commun"], ["Île-de-France Mobilités", "Transports en commun"],
  ["Sanef", "Péage / parking"], ["Vinci", "Péage / parking"], ["APRR", "Péage / parking"], ["Cofiroute", "Péage / parking"], ["Ulys", "Péage / parking"], ["Bip&Go", "Péage / parking"], ["Indigo", "Péage / parking"], ["Saemes", "Péage / parking"], ["Onepark", "Péage / parking"], ["Zenpark", "Péage / parking"],
  ["TotalEnergies", "Carburant"], ["Total Access", "Carburant"], ["Esso", "Carburant"], ["Shell", "Carburant"], ["Avia", "Carburant"],
  ["Getaround", "Location véhicule"], ["Hertz", "Location véhicule"], ["Europcar", "Location véhicule"], ["Sixt", "Location véhicule"], ["Avis", "Location véhicule"], ["Ada", "Location véhicule"], ["Rent A Car", "Location véhicule"], ["Leasys", "Location véhicule"],
  ["Ibis", "Hôtel"], ["Novotel", "Hôtel"], ["Mercure", "Hôtel"], ["Campanile", "Hôtel"], ["Kyriad", "Hôtel"], ["B&B Hotels", "Hôtel"], ["Accor", "Hôtel"], ["Airbnb", "Hôtel"], ["Booking.com", "Hôtel"],
  ["Deliveroo", "Repas"], ["McDonald", "Repas"], ["Burger King", "Repas"], ["Pret A Manger", "Repas"],
  ["Thomann", "Matériel"], ["Woodbrass", "Matériel"], ["Amazon", "Matériel"], ["Boulanger", "Matériel"], ["Fnac", "Matériel"], ["Leroy Merlin", "Matériel"], ["Castorama", "Matériel"], ["Gear4music", "Matériel"], ["Sonovente", "Matériel"]];
const KEYWORDS = [[/p[ée]age|autoroute/i, "Péage / parking"], [/parking|stationnement/i, "Péage / parking"], [/h[ôo]tel|nuit[ée]e|h[ée]bergement/i, "Hôtel"],
  [/location|v[ée]hicule de location/i, "Location véhicule"],
  [/restaurant|repas|menu|brasserie|boulangerie/i, "Repas"], [/gazole|gasoil|sp ?95|sp ?98|e10|carburant|litres?/i, "Carburant"], [/billet|train|vol |a[ée]roport|tgv/i, "Train / avion"],
  [/course|chauffeur|vtc|taxi/i, "Taxi / VTC"]];
const pad = n => String(n).padStart(2, "0");
function okDate(y, m, d) { y = +y; if (y < 100) y += 2000; m = +m; d = +d; if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null; return `${y}-${pad(m)}-${pad(d)}`; }
function findDate(t) {
  let m;
  if ((m = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/))) { const r = okDate(m[3], m[2], m[1]); if (r) return r; }
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const r = okDate(m[1], m[2], m[3]); if (r) return r; }
  const re = /\b(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ]{3,9})\.?\s+(\d{4})\b/g;
  while ((m = re.exec(t))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) { const r = okDate(m[3], mo, m[1]); if (r) return r; } }
  const re2 = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
  while ((m = re2.exec(t))) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) { const r = okDate(m[3], mo, m[2]); if (r) return r; } }
  return null;
}
const num = s => { s = s.replace(/[\s  ]/g, ""); if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); const n = parseFloat(s); return isFinite(n) ? n : null; };
function findAmount(t) {
  const AMT = "(\\d{1,3}(?:[\\s\\u00a0\\u202f.,]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2})";
  const keyed = new RegExp("(total(?:\\s*(?:ttc|pay[ée]|à payer|a payer|factur[ée]))?|montant\\s*(?:total|ttc|pay[ée])|net\\s*à\\s*payer|à\\s*payer|amount\\s*(?:paid|charged)|you\\s*paid|vous\\s*avez\\s*pay[ée])[^0-9€]{0,30}(?:€\\s*)?" + AMT, "gi");
  let m, best = null;
  while ((m = keyed.exec(t))) { const v = num(m[2]); if (v != null && v > 0 && (best == null || v >= best)) best = v; }
  if (best != null) return best;
  const euro = new RegExp("(?:€\\s*" + AMT + "|" + AMT + "\\s*(?:€|eur\\b))", "gi");
  while ((m = euro.exec(t))) { const v = num(m[1] || m[2]); if (v != null && v > 0 && (best == null || v > best)) best = v; }
  return best;
}
/* ---------- TVA ---------- */
export const VAT_RATES = [20, 10, 5.5, 2.1, 0];
// Taux le plus courant par catégorie en France (à vérifier sur le ticket)
export const USUAL_VAT = { "Taxi / VTC": 10, "Transports en commun": 10, "Train / avion": 10, "Péage / parking": 20, "Carburant": 20, "Repas": 10, "Hôtel": 10, "Matériel": 20, "Location véhicule": 20 };
export const vatFromTtc = (ttc, rate) => Math.round(ttc * rate / (100 + rate) * 100) / 100;
export function findVat(text, ttc) {
  if (/TVA non applicable|art(icle)?\.?\s*293\s*B|exon[ée]r[ée] de TVA/i.test(text)) return { tva: 0, taux_tva: 0 };
  const AMT = /(\d{1,3}(?:[\s\u00a0\u202f.]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g;
  const RATE = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g;
  const found = [], rates = new Set();
  const re = /\b(?:TVA|T\.V\.A\.?|VAT)\b/gi; let m;
  while ((m = re.exec(text))) {
    const win = text.slice(m.index, m.index + 70);
    for (const a of win.matchAll(AMT)) { const v = num(a[1]); if (v != null && v > 0 && (ttc == null || v < ttc)) found.push(v); }
    for (const r of win.matchAll(RATE)) { const v = parseFloat(r[1].replace(",", ".")); if (VAT_RATES.includes(v) && v > 0) rates.add(v); }
  }
  if (ttc != null) {
    for (const a of found) for (const r of VAT_RATES.filter(x => x > 0)) {
      if (Math.abs(a - vatFromTtc(ttc, r)) <= Math.max(0.02, 0.01 * a)) return { tva: a, taux_tva: r };
    }
    if (rates.size === 1) { const r = [...rates][0]; return { tva: vatFromTtc(ttc, r), taux_tva: r }; }
  }
  if (rates.size > 1 && found.length) {
    return { tva: null, taux_tva: "multi" };
  }
  return { tva: null, taux_tva: null };
}

export function localParse(text, filename) {
  const t = text + " " + (filename || "");
  const out = { date: findDate(text), montant: findAmount(text), marchand: null, categorie: null };
  Object.assign(out, findVat(text, out.montant));
  for (const [name, cat] of MERCHANTS) {
    const re = new RegExp("(^|[^a-z])" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z]|$)", "i");
    if (re.test(t)) { out.marchand = name; out.categorie = cat; break; }
  }
  if (!out.categorie) for (const [re, cat] of KEYWORDS) { if (re.test(text)) { out.categorie = cat; break; } }
  return out;
}

/* ---------- lecture par Claude (clé API personnelle, optionnelle) ---------- */
let sdkP = null;
const loadSdk = () => (sdkP ??= import("./lib/anthropic-sdk-1.5.0.min.mjs").then(m => m.default).catch(e => { sdkP = null; throw e; }));
const nullable = t => ({ anyOf: [{ type: t }, { type: "null" }] });
const SCHEMA = {
  type: "object",
  properties: {
    date: { ...nullable("string"), description: "Date du paiement au format AAAA-MM-JJ" },
    marchand: { ...nullable("string"), description: "Nom court du commerçant" },
    montant: { ...nullable("number"), description: "Montant total TTC payé" },
    devise: { type: "string", description: "Code ISO de la devise, EUR le plus souvent" },
    categorie: { type: "string", enum: CATS },
    detail: { type: "string", description: "5 mots maximum, ou chaîne vide" },
    tva: { ...nullable("number"), description: "Montant total de la TVA indiqué sur le ticket, null s'il n'est pas indiqué" },
    taux_tva: { anyOf: [{ type: "number", enum: VAT_RATES }, { type: "string", enum: ["multi"] }, { type: "null" }], description: "Taux de TVA en %, \"multi\" s'il y a plusieurs taux, null s'il n'est pas indiqué" },
  },
  required: ["date", "marchand", "montant", "devise", "categorie", "detail", "tva", "taux_tva"],
  additionalProperties: false,
};
async function toB64(blob) { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); }

export async function readWithClaude({ apiKey, text, image }) {
  const Anthropic = await loadSdk().catch(() => { throw Object.assign(new Error("sdk"), { code: "offline" }); });
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const instructions = `Tu lis ${text ? "le texte extrait d'une facture ou d'un reçu au format PDF" : "la photo d'un ticket de caisse, d'une facture ou d'un reçu"}. Contexte : France, un technicien du spectacle qui fait ses notes de frais (taxi/VTC, péage, parking, carburant, repas, hôtel, train, location de véhicule, matériel).
Donne la date du paiement, le commerçant, le montant total TTC payé, la devise, la catégorie et un détail très court (par exemple « Paris → Lyon » ou « course de nuit »). Si l'année n'est pas lisible, prends ${new Date().getFullYear()}. Donne aussi la TVA telle qu'elle est écrite sur le ticket (montant total de TVA et taux) ; ne la calcule pas si elle n'est pas indiquée. Mets null pour ce qui est illisible.`;
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.type || "image/jpeg", data: await toB64(image) } });
  content.push({ type: "text", text: instructions + (text ? "\n\nTexte du document :\n" + text.slice(0, 20000) : "") });
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") throw Object.assign(new Error("refusal"), { code: "refusal" });
    const block = res.content.find(b => b.type === "text");
    return JSON.parse(block?.text || "{}");
  } catch (e) {
    if (e.code) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw Object.assign(e, { code: "bad_key" });
    if (e instanceof Anthropic.RateLimitError) throw Object.assign(e, { code: "rate_limited" });
    if (e instanceof Anthropic.APIConnectionError) throw Object.assign(e, { code: "offline" });
    if (e instanceof Anthropic.APIError && e.status === 400 && /credit|billing/i.test(e.message)) throw Object.assign(e, { code: "no_credit" });
    throw Object.assign(e, { code: "failed" });
  }
}
