// Stockage du budget : copie locale sur l'appareil (hors ligne) + synchronisation Dropbox.
// Même appli Dropbox et même connexion que « Frais de régie » (même site, même clé).
// Fichier dans Dropbox : /budget/budget.json (dossier d'appli).
import { CONFIG } from "../config.js";

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const nowIso = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Dropbox : connexion partagée avec Frais de régie ---------- */
const AUTH = "frais_dbx", PKCE = "budget_pkce";
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const isConnected = () => !!LS.get(AUTH, null)?.refresh;

// Connexion par code à copier (pas besoin d'ajouter une adresse de retour dans l'appli Dropbox).
export async function openCodePage() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  LS.set(PKCE, { verifier });
  const u = new URL("https://www.dropbox.com/oauth2/authorize");
  u.search = new URLSearchParams({ client_id: CONFIG.dropboxAppKey, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", token_access_type: "offline" });
  window.open(u.toString(), "_blank", "noopener");
}
export async function finishWithCode(code) {
  const saved = LS.get(PKCE, null);
  if (!saved) throw err("no_pkce");
  const t = await tokenReq({ code: code.trim(), grant_type: "authorization_code", code_verifier: saved.verifier });
  LS.set(AUTH, { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
  LS.del(PKCE);
  st.rev = null; st.dirty = true; persist(); scheduleSync(100);
}
async function tokenReq(params) {
  let r;
  try { r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({ ...params, client_id: CONFIG.dropboxAppKey }) }); }
  catch { throw err("offline"); }
  if (r.status === 400 || r.status === 401) throw err("auth_invalid");
  if (!r.ok) throw err("offline");
  return r.json();
}
async function accessToken(force) {
  const a = LS.get(AUTH, null);
  if (!a?.refresh) throw err("not_connected");
  if (!force && a.access && a.exp > Date.now()) return a.access;
  let t;
  try { t = await tokenReq({ grant_type: "refresh_token", refresh_token: a.refresh }); }
  catch (e) { if (e.code === "auth_invalid") { LS.del(AUTH); throw err("not_connected"); } throw e; }
  a.access = t.access_token; a.exp = Date.now() + (t.expires_in - 60) * 1000; LS.set(AUTH, a);
  return a.access;
}
const asciiJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
async function dbx(kind, endpoint, args, body, retried) {
  const tok = await accessToken(retried);
  const headers = { Authorization: "Bearer " + tok };
  const init = { method: "POST", headers };
  if (kind === "rpc") { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(args ?? null); }
  else { headers["Dropbox-API-Arg"] = asciiJson(args); if (body !== undefined) { headers["Content-Type"] = "application/octet-stream"; init.body = body; } }
  const host = kind === "rpc" ? "https://api.dropboxapi.com/2/" : "https://content.dropboxapi.com/2/";
  let r;
  try { r = await fetch(host + endpoint, init); } catch { throw err("offline"); }
  if (r.status === 401) {
    if (!retried) return dbx(kind, endpoint, args, body, true);
    LS.del(AUTH); throw err("not_connected");
  }
  if (r.status === 409) { const j = await r.json().catch(() => ({})); throw err("conflict", { summary: j.error_summary || "" }); }
  if (r.status === 507) throw err("dropbox_full");
  if (r.status === 429 || r.status >= 500) throw err("offline");
  if (!r.ok) throw err("http_" + r.status, { summary: await r.text().catch(() => "") });
  return r;
}

/* ---------- données ---------- */
const STATE = "budget_state", PATH = "/budget/budget.json";
const LISTS = ["accounts", "txs", "charges", "rules"];
export const defaultSettings = () => ({ cushion: 100, bigSpend: 150, updatedAt: "" });
const empty = () => ({ schema: 1, settings: defaultSettings(), accounts: [], txs: [], charges: [], rules: [] });
const st = Object.assign({ data: empty(), rev: null, dirty: false }, LS.get(STATE, {}));
for (const k of LISTS) st.data[k] ||= [];
st.data.settings = { ...defaultSettings(), ...(st.data.settings || {}) };
let status = isConnected() ? "sync" : "local", lastError = "";
const listeners = new Set();

function persist() { LS.set(STATE, { data: st.data, rev: st.rev, dirty: st.dirty }); }
function emit() { for (const f of listeners) try { f(); } catch {} }
function setStatus(s, e) { status = s; lastError = e || ""; emit(); }
export const onChange = f => listeners.add(f);
export const getStatus = () => ({ status, lastError, dirty: st.dirty, connected: isConnected() });

export const list = k => st.data[k].filter(x => !x.deleted);
export const settings = () => st.data.settings;
export const isEmpty = () => !st.data.accounts.length;

function mergeList(a = [], b = []) {
  const m = new Map();
  for (const x of [...a, ...b]) { const o = m.get(x.id); if (!o || (x.updatedAt || "") > (o.updatedAt || "")) m.set(x.id, x); }
  return [...m.values()];
}
function merge(a, b) {
  const out = { schema: 1 };
  const sa = a.settings || {}, sb = b.settings || {};
  out.settings = { ...defaultSettings(), ...((sb.updatedAt || "") > (sa.updatedAt || "") ? sb : sa) };
  for (const k of LISTS) out[k] = mergeList(a[k], b[k]);
  return out;
}
function commit() { st.dirty = true; persist(); emit(); scheduleSync(); }

// Enregistre un ou plusieurs éléments d'une liste (accounts, txs, charges, rules).
export function save(k, items) {
  const arr = Array.isArray(items) ? items : [items];
  const t = nowIso();
  const idx = new Map(st.data[k].map((x, i) => [x.id, i]));
  const out = arr.map(x => {
    const v = { ...x, id: x.id || uid(), updatedAt: t };
    const i = idx.get(v.id);
    if (i != null) st.data[k][i] = v; else { idx.set(v.id, st.data[k].length); st.data[k].push(v); }
    return v;
  });
  commit();
  return Array.isArray(items) ? out : out[0];
}
export function remove(k, items) {
  const arr = Array.isArray(items) ? items : [items];
  const t = nowIso();
  const idx = new Map(st.data[k].map((x, i) => [x.id, i]));
  for (const x of arr) {
    const tomb = { id: x.id, deleted: true, updatedAt: t };
    const i = idx.get(x.id);
    if (i != null) st.data[k][i] = tomb; else st.data[k].push(tomb);
  }
  commit();
}
export function saveSettings(s) { st.data.settings = { ...st.data.settings, ...s, updatedAt: nowIso() }; commit(); }
export function exportData() { return JSON.stringify(st.data, null, 1); }
export function importData(d) { st.data = merge(st.data, d); commit(); }

/* ---------- synchronisation ---------- */
let syncing = null, again = false, timer = null;
export function scheduleSync(delay = 800) { clearTimeout(timer); timer = setTimeout(() => sync(), delay); }
export function sync() {
  if (syncing) { again = true; return syncing; }
  syncing = doSync().finally(() => { syncing = null; if (again) { again = false; scheduleSync(300); } });
  return syncing;
}
async function downloadData() {
  let r;
  try { r = await dbx("content", "files/download", { path: PATH }); }
  catch (e) { if (e.code === "conflict" && /not_found/.test(e.summary)) return null; throw e; }
  let meta = null; try { meta = JSON.parse(r.headers.get("Dropbox-API-Result")); } catch {}
  const data = await r.json();
  let rev = meta?.rev;
  if (!rev) rev = (await (await dbx("rpc", "files/get_metadata", { path: PATH })).json()).rev;
  return { data, rev };
}
async function doSync() {
  if (!isConnected() || !CONFIG.dropboxAppKey) { setStatus("local"); return; }
  setStatus("sync");
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await downloadData();
      if (remote) {
        if (remote.rev !== st.rev) {
          const merged = merge(st.data, remote.data || empty());
          if (JSON.stringify(merged) !== JSON.stringify(remote.data)) st.dirty = true;
          st.data = merged; st.rev = remote.rev; persist(); emit();
        }
      } else { st.rev = null; st.dirty = true; }
      if (!st.dirty) break;
      try {
        const r = await dbx("content", "files/upload",
          { path: PATH, mode: st.rev ? { ".tag": "update", update: st.rev } : { ".tag": "add" }, autorename: false, mute: true },
          new Blob([JSON.stringify(st.data)], { type: "application/json" }));
        st.rev = (await r.json()).rev; st.dirty = false; persist();
        break;
      } catch (e) { if (e.code !== "conflict") throw e; }
    }
    setStatus(st.dirty ? "offline" : "ok");
  } catch (e) {
    persist();
    setStatus(e.code === "not_connected" ? "local" : e.code === "dropbox_full" ? "full" : "offline", e.code + (e.summary ? " : " + e.summary.slice(0, 200) : ""));
  }
}
addEventListener("online", () => scheduleSync(200));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(200); });
addEventListener("storage", e => { if (e.key === AUTH) scheduleSync(200); });
