// Calculs du budget : lecture des relevés, catégories, soldes, « reste à dépenser ».
// Aucune dépendance au navigateur : testable avec Node.

/* ---------- catégories ---------- */
// type : dep (dépense), rev (rentrée), epa (épargne, pas une dépense), int (virement entre mes comptes, ignoré)
export const CATS = [
  { id: "courses", name: "Courses", type: "dep" },
  { id: "logement", name: "Maison & prêt", type: "dep" },
  { id: "joint", name: "Part du compte joint", type: "dep" },
  { id: "factures", name: "Factures & abonnements", type: "dep" },
  { id: "transport", name: "Transport & carburant", type: "dep" },
  { id: "sante", name: "Santé", type: "dep" },
  { id: "enfants", name: "Enfants", type: "dep" },
  { id: "sorties", name: "Restos & sorties", type: "dep" },
  { id: "shopping", name: "Achats & maison", type: "dep" },
  { id: "musique", name: "Musique & beatmaking", type: "dep" },
  { id: "impots", name: "Impôts", type: "dep" },
  { id: "banque", name: "Frais bancaires", type: "dep" },
  { id: "especes", name: "Retraits d'espèces", type: "dep" },
  { id: "autre", name: "Autre dépense", type: "dep" },
  { id: "cachets", name: "Cachets & salaires", type: "rev" },
  { id: "are", name: "ARE (France Travail)", type: "rev" },
  { id: "ventes", name: "Ventes musique", type: "rev" },
  { id: "rembours", name: "Remboursements", type: "rev" },
  { id: "rev_autre", name: "Autre rentrée", type: "rev" },
  { id: "epargne", name: "Épargne", type: "epa" },
  { id: "interne", name: "Entre mes comptes", type: "int" },
];
export const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
export const catType = id => CAT[id]?.type || "dep";

// Mots repérés dans le libellé (après normalisation : majuscules, sans accents).
const DEFAULT_RULES = [
  ["UBER EATS|DELIVEROO|JUST EAT|RESTAURANT|RESTO|MCDO|MC DONALD|BURGER KING|KFC|BRASSERIE|PIZZ|SUSHI|KEBAB|CINEMA|PATHE|UGC|MK2|BOULANGERIE|PATISSERIE|STARBUCKS", "sorties"],
  ["CARREFOUR|LECLERC|LIDL|ALDI|AUCHAN|INTERMARCHE|MONOPRIX|FRANPRIX|CASINO|SUPER U|HYPER U|PICARD|BIOCOOP|NATURALIA|GRAND FRAIS|NETTO|CORA|SPAR|LA VIE CLAIRE|G20|DIA |LEADER PRICE", "courses"],
  ["THOMANN|WOODBRASS|MUSIC STORE|SPLICE|PLUGIN BOUTIQUE|NATIVE INSTRUMENTS|ABLETON|BANDCAMP|DISTROKID|BEATSTARS|KEYMUSIC|AUDIOFANZINE|FASTSPRING|WAVES|IZOTOPE|ARTURIA|ROLAND|LANDR|TUNECORE|SWEETWATER", "musique"],
  ["SNCF|RATP|NAVIGO|UBER|BOLT|BLABLACAR|TOTAL|ESSO|SHELL|AVIA|DYNEFF|PEAGE|APRR|SANEF|VINCI|COFIROUTE|PARKING|INDIGO|SAEMES|LIME|VELIB|NORAUTO|FEU VERT|SPEEDY|MIDAS|STATION", "transport"],
  ["EDF|ENGIE|TOTALENERGIES|EKWATEUR|ALTERNA|VATTENFALL|ENI |MINT ENERGIE|OHM ENERGIE|ORANGE|SFR|BOUYGUES|FREE|SOSH|RED BY|NETFLIX|SPOTIFY|DEEZER|DISNEY|CANAL|AMAZON PRIME|PRIME VIDEO|APPLE COM|ICLOUD|GOOGLE|DROPBOX|ADOBE|MICROSOFT|ASSURANCE|MAIF|MACIF|MAAF|MATMUT|AXA|ALLIANZ|GENERALI|APRIL|DIRECT ASSURANCE|VEOLIA|SUEZ|FRANCILIANE|EAU DE", "factures"],
  ["PHARMACIE|PHARMA|DOCTEUR|DR |MEDECIN|DENTISTE|LABORATOIRE|LABO |OPTIC|KINE|DOCTOLIB|HOPITAL|CLINIQUE|MUTUELLE|AUDIENS SANTE", "sante"],
  ["CRECHE|CANTINE|ECOLE|PERISCOLAIRE|NOUNOU|PAJEMPLOI|AUBERT|VERTBAUDET|CYRILLUS|OKAIDI|JACADI|TAPE A L OEIL|JOUE CLUB|KING JOUET|PICWICTOYS|BEBE", "enfants"],
  ["AMAZON|FNAC|DARTY|BOULANGER|DECATHLON|IKEA|LEROY MERLIN|CASTORAMA|BRICO|ZARA|H M|UNIQLO|KIABI|ACTION|CDISCOUNT|VINTED|LEBONCOIN|LA POSTE|GIFI|NOZ", "shopping"],
  ["DGFIP|IMPOT|FINANCES PUBLIQUES|TRESOR PUBLIC|AMENDE|ANTAI", "impots"],
  ["ECHEANCE PRET|ECH PRET|PRET IMMO|REMBOURSEMENT PRET|CREDIT IMMO|LOYER|SYNDIC|TAXE FONCIERE", "logement"],
  ["COTISATION|FRAIS DE TENUE|COMMISSION|AGIOS|FRAIS BANCAIRE|COTIS CARTE|OFFRE GROUPEE|FRAIS ", "banque"],
  ["RETRAIT|DAB", "especes"],
  ["LIVRET|LDDS|LDD|ASSURANCE VIE|EPARGNE", "epargne"],
  // rentrées
  ["FRANCE TRAVAIL|POLE EMPLOI|ARE ", "are"],
  ["PAYPAL|STRIPE|BEATSTARS|BANDCAMP|DISTROKID|TUNECORE|AIRBIT|SACEM|SPEDIDAM|ADAMI", "ventes"],
  ["CPAM|AMELI|ASSURANCE MALADIE|MUTUELLE|REMBOURSEMENT|REMB |AVOIR|ANNULATION", "rembours"],
  ["SALAIRE|PAIE|PAYE|CACHET|AUDIENS|CONGES SPECTACLES|PROD|PRODUCTION|SPECTACLE|THEATRE|FESTIVAL|ASSOCIATION|MOVINMOTION", "cachets"],
].map(([kw, cat]) => ({ re: new RegExp("(^| )(" + kw + ")", ""), cat }));

// Catégories de la Banque Populaire -> nos catégories.
const BANK_CATS = [
  [/transaction exclue|virement interne|entre mes comptes/, "interne"],
  [/epargne|placement/, "epargne"],
  [/salaire|revenus? d.activite|traitement/, "cachets"],
  [/chomage|pole emploi|france travail|indemnit/, "are"],
  [/remboursement|sante.*rembours/, "rembours"],
  [/aliment|courses|supermarch|hypermarch/, "courses"],
  [/restaur|bar|sortie|loisir|culture|vacance|voyage|spectacle/, "sorties"],
  [/carbur|transport|auto|vehicule|parking|peage|train/, "transport"],
  [/telecom|telephon|internet|abonnement|energie|electricite|gaz|eau|assurance|multimedia/, "factures"],
  [/sante|pharma|medec|mutuelle/, "sante"],
  [/enfant|scolar|garde|creche/, "enfants"],
  [/pret|credit|loyer|logement|immobilier|travaux|habitat/, "logement"],
  [/impot|taxe|amende/, "impots"],
  [/frais bancaire|banque|cotisation/, "banque"],
  [/retrait|especes/, "especes"],
  [/shopping|achat|habill|vetement|equipement|maison|high.tech|electromenager/, "shopping"],
];

/* ---------- textes ---------- */
const STOP = new Set("CB CARTE PRLV PRELEVEMENT PRELEVMT SEPA VIR VIREMENT VIRT FACT FACTURE PAIEMENT PAIEMT PAR DE DU DES LA LE LES L D EUR EURO INST INSTANTANE RECU EMIS EMISE VERS EN FAVEUR AU A ET POUR REF ECH MOTIF NO N X DU ACHAT".split(" "));
export const deaccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normLabel = s => " " + deaccent(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
// Mot-clé court qui identifie le marchand (sert aux règles, aux charges fixes et au repérage des prélèvements).
export function keyOf(label) {
  const words = deaccent(label).toUpperCase().replace(/[^A-Z ]+/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
  return words.slice(0, 2).join(" ");
}
export const matchesKey = (label, key) => !!key && normLabel(label).includes(" " + key.toUpperCase());

/* ---------- catégorie automatique ---------- */
export function categorize(tx, userRules = []) {
  const label = normLabel(tx.label + " " + (tx.detail || ""));
  const sign = tx.amount < 0 ? "dep" : "rev";
  const fits = cat => { const t = catType(cat); return t === "epa" || t === "int" || t === sign; };
  for (const r of userRules) if (r.key && label.includes(" " + r.key + " ") && fits(r.cat)) return r.cat;
  for (const r of userRules) if (r.key && label.includes(" " + r.key) && fits(r.cat)) return r.cat;
  // Ce qui part vers le compte joint finance la maison : c'est une dépense pour le compte perso.
  if (/ (COMPTE|CPTE|CPT) JOINT | JOINT /.test(label) && tx.amount < 0) return "joint";
  if (tx.bankCat) {
    const b = deaccent(tx.bankCat).toLowerCase();
    if (/transaction exclue/.test(b)) return "interne";
  }
  for (const r of DEFAULT_RULES) if (r.re.test(label) && fits(r.cat)) return r.cat;
  if (tx.bankCat) {
    const b = deaccent(tx.bankCat).toLowerCase();
    for (const [re, cat] of BANK_CATS) if (re.test(b) && fits(cat)) return cat;
  }
  return sign === "dep" ? "autre" : "rev_autre";
}

/* ---------- lecture des relevés ---------- */
export function decodeBytes(buf) {
  const u8 = new Uint8Array(buf);
  let s = new TextDecoder("utf-8").decode(u8);
  if (s.includes("�")) s = new TextDecoder("windows-1252").decode(u8);
  return s.replace(/^﻿/, "");
}
export function parseNumber(v) {
  if (v == null) return NaN;
  let s = String(v).replace(/[\s  €+]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s);
}
export function parseDate(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`; }
  m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function splitCsv(text, sep) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const hnorm = s => deaccent(s).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
function pickCol(heads, tests) {
  for (const t of tests) { const i = heads.findIndex(h => typeof t === "string" ? h === t : t.test(h)); if (i >= 0) return i; }
  return -1;
}
export function parseCsv(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = splitCsv(text, sep);
  const hi = rows.findIndex(r => r.some(c => /date/i.test(c)) && r.length > 2);
  if (hi < 0) throw new Error("Je ne trouve pas la ligne des titres de colonnes (Date, Libellé, Montant…).");
  const heads = rows[hi].map(hnorm);
  const col = {
    date: pickCol(heads, ["date operation", "date de l operation", "date comptable", "date de comptabilisation", /date/]),
    label: pickCol(heads, ["libelle simplifie", "libelle", /libelle/, /description|intitule|label|nature/]),
    detail: pickCol(heads, ["libelle operation", "informations complementaires", /information/]),
    amount: pickCol(heads, [/^montant/]),
    debit: pickCol(heads, [/^debit/]),
    credit: pickCol(heads, [/^credit/]),
    cat: pickCol(heads, ["categorie", /^categorie/]),
    sub: pickCol(heads, [/sous categorie/]),
  };
  if (col.detail === col.label) col.detail = -1;
  if (col.date < 0 || col.label < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0))
    throw new Error("Colonnes non reconnues. Il me faut au moins une date, un libellé et un montant (ou Débit / Crédit).");
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[col.date]);
    if (!date) continue;
    let amount;
    if (col.amount >= 0 && r[col.amount]?.trim()) amount = parseNumber(r[col.amount]);
    else {
      const d = col.debit >= 0 ? parseNumber(r[col.debit]) : NaN, c = col.credit >= 0 ? parseNumber(r[col.credit]) : NaN;
      amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
    }
    if (!amount || isNaN(amount)) continue;
    const label = (r[col.label] || "").trim() || (col.detail >= 0 ? r[col.detail] : "").trim();
    const detailParts = [col.detail >= 0 ? r[col.detail] : "", heads.includes("informations complementaires") && col.detail !== heads.indexOf("informations complementaires") ? r[heads.indexOf("informations complementaires")] : ""];
    const detail = detailParts.map(x => (x || "").trim()).filter(x => x && x !== label).join(" · ");
    const bankCat = [col.cat >= 0 ? r[col.cat] : "", col.sub >= 0 ? r[col.sub] : ""].map(x => (x || "").trim()).filter(Boolean).join(" / ");
    // raw : la ligne entière (avec la référence de la banque) pour repérer une ligne présente deux fois dans le fichier
    out.push({ date, amount: Math.round(amount * 100) / 100, label, detail, bankCat, raw: r.map(x => x.trim()).join("|") });
  }
  return { txs: out, balance: null, format: "CSV" };
}
export function parseOfx(text) {
  const tag = (blk, t) => { const m = blk.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
  const out = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const blk = b.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(tag(blk, "DTPOSTED"));
    const amount = parseNumber(tag(blk, "TRNAMT"));
    if (!date || !amount) continue;
    const name = tag(blk, "NAME"), memo = tag(blk, "MEMO");
    out.push({ date, amount: Math.round(amount * 100) / 100, label: name || memo, detail: name && memo && memo !== name ? memo : "", bankCat: "", fitid: tag(blk, "FITID") });
  }
  let balance = null;
  const lb = text.split(/<LEDGERBAL>/i)[1];
  if (lb) { const a = parseNumber(tag(lb, "BALAMT")), d = parseDate(tag(lb, "DTASOF")); if (!isNaN(a) && d) balance = { amount: a, date: d }; }
  return { txs: out, balance, format: "OFX" };
}
export function parseStatement(text) {
  return /<OFX>|<STMTTRN>/i.test(text) ? parseOfx(text) : parseCsv(text);
}

/* ---------- import : doublons et saisies à la main ---------- */
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
// Prépare l'import : renvoie les nouvelles opérations, les doublons ignorés et les saisies à la main remplacées.
export function planImport(parsed, accountId, existing, userRules) {
  const keys = new Set(existing.filter(t => t.accountId === accountId && t.key).map(t => t.key));
  const manual = existing.filter(t => t.accountId === accountId && t.manual);
  const usedManual = new Set();
  const seen = new Map(), rawSeen = new Set();
  const add = [], replaced = [];
  let dup = 0;
  for (const p of parsed) {
    // même ligne deux fois dans le fichier (exports qui se chevauchent) : on n'en garde qu'une
    if (p.raw) { if (rawSeen.has(p.raw)) { dup++; continue; } rawSeen.add(p.raw); }
    let key;
    if (p.fitid) key = accountId + "|" + p.fitid;
    else {
      const base = [accountId, p.date, p.amount.toFixed(2), normLabel(p.label).trim()].join("|");
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      key = base + "|" + n;
    }
    if (keys.has(key)) { dup++; continue; }
    keys.add(key);
    const tx = { accountId, date: p.date, amount: p.amount, label: p.label, detail: p.detail || "", bankCat: p.bankCat || "", key };
    const m = manual.find(t => !usedManual.has(t.id) && Math.abs(t.amount - p.amount) < 0.005 && dayDiff(t.date, p.date) <= 5);
    if (m) { usedManual.add(m.id); replaced.push(m); tx.cat = m.cat; tx.catManual = m.catManual; tx.note = m.note || m.label; }
    else tx.cat = categorize(tx, userRules);
    add.push(tx);
  }
  return { add, dup, replaced };
}

/* ---------- dates ---------- */
export const ym = d => d.slice(0, 7);
export const todayStr = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
export const lastDayOfMonth = ymStr => { const [y, m] = ymStr.split("-").map(Number); return new Date(y, m, 0).getDate(); };
export function prevMonths(ymStr, n) {
  let [y, m] = ymStr.split("-").map(Number); const out = [];
  for (let i = 0; i < n; i++) { m--; if (!m) { m = 12; y--; } out.push(`${y}-${String(m).padStart(2, "0")}`); }
  return out;
}

/* ---------- soldes ---------- */
// Solde = solde de référence (saisi ou lu dans le relevé) + opérations postérieures.
export function balanceOf(acc, txs) {
  if (!acc.ref || acc.ref.amount == null || acc.ref.amount === "") return null;
  if (acc.kind === "credit") return Number(acc.ref.amount);
  let b = Number(acc.ref.amount);
  for (const t of txs) {
    if (t.accountId !== acc.id) continue;
    if (t.date > acc.ref.date || (t.date === acc.ref.date && t.manual && (t.createdAt || "") > (acc.ref.at || ""))) b += t.amount;
  }
  return Math.round(b * 100) / 100;
}

/* ---------- charges fixes ---------- */
export function chargeMatch(ch, txs, month) {
  return txs.find(t => t.accountId === ch.accountId && t.amount < 0 && ym(t.date) === month &&
    ((ch.keyword && matchesKey(t.label + " " + (t.detail || ""), ch.keyword)) || Math.abs(-t.amount - ch.amount) < 0.01)) || null;
}

/* ---------- prélèvements réguliers repérés ---------- */
export function detectRecurring(txs, accounts, charges, dismissed = [], now = new Date()) {
  const courant = new Set(accounts.filter(a => a.kind === "courant").map(a => a.id));
  const months = new Set([ym(todayStr(now)), ...prevMonths(ym(todayStr(now)), 4)]);
  const groups = new Map();
  for (const t of txs) {
    if (t.amount >= 0 || !courant.has(t.accountId) || !months.has(ym(t.date))) continue;
    const k = keyOf(t.label);
    if (!k) continue;
    const g = groups.get(t.accountId + "|" + k) || { accountId: t.accountId, keyword: k, items: [] };
    g.items.push(t); groups.set(t.accountId + "|" + k, g);
  }
  const known = charges.map(c => c.accountId + "|" + c.keyword);
  const out = [];
  for (const [id, g] of groups) {
    if (known.includes(id) || dismissed.includes(id)) continue;
    if (charges.some(c => c.accountId === g.accountId && g.items.some(t => matchesKey(t.label, c.keyword) || Math.abs(-t.amount - c.amount) < 0.01))) continue;
    const byMonth = new Map();
    for (const t of g.items) byMonth.set(ym(t.date), (byMonth.get(ym(t.date)) || []).concat(t));
    if (byMonth.size < 2) continue;
    if ([...byMonth.values()].filter(a => a.length > 1).length > 1) continue; // achats fréquents, pas un prélèvement
    const amts = g.items.map(t => -t.amount).sort((a, b) => a - b);
    const med = amts[Math.floor(amts.length / 2)];
    if (amts[amts.length - 1] > med * 1.35 || amts[0] < med * 0.65) continue;
    const cat = g.items[g.items.length - 1].cat;
    // dans les postes d'achats courants, on ne garde que les montants vraiment fixes (abonnement)
    if (["courses", "sorties", "transport", "especes", "shopping", "sante", "autre"].includes(cat) && (byMonth.size < 3 || amts[amts.length - 1] > amts[0] * 1.1)) continue;
    const days = g.items.map(t => +t.date.slice(8)).sort((a, b) => a - b);
    out.push({ id, accountId: g.accountId, keyword: g.keyword, name: prettyName(g.items[0].label), amount: Math.round(med * 100) / 100, day: days[Math.floor(days.length / 2)], months: byMonth.size, cat });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
export const prettyName = label => {
  const k = deaccent(label).toUpperCase().replace(/[^A-Z ]+/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).slice(0, 3).join(" ") || String(label).trim();
  return k.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
};

/* ---------- le chiffre du mois ---------- */
export function monthSummary(data, now = new Date()) {
  const { accounts, txs, charges, settings } = data;
  const today = todayStr(now), month = ym(today);
  const main = accounts.find(a => a.main) || accounts.find(a => a.kind === "courant");
  const res = { month, today, daysLeft: lastDayOfMonth(month) - +today.slice(8) + 1, main };
  if (!main) return res;
  const mtx = txs.filter(t => t.accountId === main.id);
  res.balance = balanceOf(main, txs);
  // charges fixes encore à venir ce mois-ci
  res.upcoming = []; res.paid = [];
  for (const c of charges.filter(c => c.accountId === main.id)) {
    const m = chargeMatch(c, mtx, month);
    (m ? res.paid : res.upcoming).push({ ...c, tx: m });
  }
  res.upcoming.sort((a, b) => a.day - b.day);
  res.upcomingTotal = res.upcoming.reduce((s, c) => s + Number(c.amount || 0), 0);
  res.cushion = Number(settings.cushion || 0);
  res.left = res.balance == null ? null : Math.round((res.balance - res.upcomingTotal - res.cushion) * 100) / 100;
  res.perDay = res.left == null ? null : res.left / Math.max(1, res.daysLeft);
  // ce mois-ci
  const cur = mtx.filter(t => ym(t.date) === month);
  res.spent = -cur.filter(t => catType(t.cat) === "dep").reduce((s, t) => s + t.amount, 0);
  res.income = cur.filter(t => catType(t.cat) === "rev").reduce((s, t) => s + t.amount, 0);
  // par catégorie, comparé aux 3 mois précédents (ceux qui ont des opérations)
  const prev = prevMonths(month, 3).filter(m => mtx.some(t => ym(t.date) === m));
  res.history = prev.length;
  const byCat = new Map();
  for (const t of mtx) {
    if (catType(t.cat) !== "dep") continue;
    const m = ym(t.date);
    const e = byCat.get(t.cat) || { cat: t.cat, now: 0, before: 0 };
    if (m === month) e.now -= t.amount; else if (prev.includes(m)) e.before -= t.amount;
    byCat.set(t.cat, e);
  }
  res.cats = [...byCat.values()].map(e => {
    const avg = prev.length ? e.before / prev.length : null;
    return { ...e, avg, high: avg != null && e.now > avg * 1.3 && e.now - avg > 30 };
  }).filter(e => e.now > 0 || (e.avg || 0) > 0).sort((a, b) => b.now - a.now || (b.avg || 0) - (a.avg || 0));
  // grosses dépenses du mois (hors charges fixes)
  const paidIds = new Set(res.paid.map(c => c.tx?.id));
  res.big = cur.filter(t => catType(t.cat) === "dep" && -t.amount >= Number(settings.bigSpend || 150) && !paidIds.has(t.id)).sort((a, b) => a.amount - b.amount);
  // rentrées des 6 derniers mois
  res.incomeMonths = [...prevMonths(month, 5).reverse(), month].map(m => {
    const ts = mtx.filter(t => ym(t.date) === m && catType(t.cat) === "rev");
    const sum = c => ts.filter(t => c(t.cat)).reduce((s, t) => s + t.amount, 0);
    return { month: m, are: sum(c => c === "are"), cachets: sum(c => c === "cachets"), other: sum(c => c !== "are" && c !== "cachets"), has: mtx.some(t => ym(t.date) === m) };
  });
  // matelas : épargne disponible / ce qui sort en moyenne par mois
  const avgOut = prev.length ? prev.reduce((s, m) => s - mtx.filter(t => ym(t.date) === m && catType(t.cat) === "dep").reduce((a, t) => a + t.amount, 0), 0) / prev.length : null;
  res.avgOut = avgOut;
  res.savings = accounts.filter(a => a.matelas).reduce((s, a) => s + (balanceOf(a, txs) || 0), 0);
  res.months = avgOut ? res.savings / avgOut : null;
  return res;
}

// Identifiants fixes : deux appareils qui démarrent à vide ne créent pas de doublons.
export const defaultAccounts = () => [
  { id: "acc-perso", name: "Compte perso", kind: "courant", main: true },
  { id: "acc-joint", name: "Compte joint", kind: "courant" },
  { id: "acc-ldds", name: "LDDS", kind: "epargne", matelas: true },
  { id: "acc-livreta", name: "Livret A", kind: "epargne", matelas: true },
  { id: "acc-av", name: "Assurance vie", kind: "epargne" },
  { id: "acc-pret", name: "Prêt immobilier", kind: "credit" },
];
