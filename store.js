// Stockage : copie locale sur l'appareil (fonctionne hors ligne) + synchronisation avec Dropbox.
// Dans Dropbox (dossier d'appli « Applications/<nom de l'appli> ») :
//   /data.json                     tous les tickets, employeurs et réglages
//   /justificatifs/AAAA/…          photos et PDF des tickets
//   /apercus/<id>.jpg              aperçu de la 1re page des PDF
//   /notes-de-frais/…              copie des notes de frais exportées
import { CONFIG } from "./config.js";

/* ---------- petites aides ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const nowIso = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- fichiers sur l'appareil (IndexedDB) ---------- */
let dbP = null;
function idb() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open("frais-de-regie", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("blobs", mode); const req = fn(tx.objectStore("blobs"));
    tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
const blobGet = k => idbDo("readonly", s => s.get(k)).catch(() => null);
const blobPut = (k, v) => idbDo("readwrite", s => s.put(v, k));
const blobDel = k => idbDo("readwrite", s => s.delete(k)).catch(() => {});

const TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", json: "application/json", csv: "text/csv" };
export const typeOf = path => TYPES[String(path).split(".").pop().toLowerCase()] || "application/octet-stream";

/* ---------- Dropbox : connexion (OAuth PKCE, sans secret) ---------- */
const AUTH = "frais_dbx", PKCE = "frais_pkce";
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const redirectUri = () => location.origin + location.pathname;
export const hasAppKey = () => !!CONFIG.dropboxAppKey;
export const isConnected = () => !!LS.get(AUTH, null)?.refresh;
// Sur iPhone, une appli installée sur l'écran d'accueil ne revient pas toujours d'une redirection :
// on passe alors par un code à copier-coller.
export const useCodeFlow = () => !!navigator.standalone;

async function authUrl(withRedirect) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  LS.set(PKCE, { verifier, state, withRedirect });
  const u = new URL("https://www.dropbox.com/oauth2/authorize");
  const p = { client_id: CONFIG.dropboxAppKey, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", token_access_type: "offline" };
  if (withRedirect) { p.redirect_uri = redirectUri(); p.state = state; }
  u.search = new URLSearchParams(p);
  return u.toString();
}
export async function connectWithRedirect() { location.assign(await authUrl(true)); }
export async function openCodePage() { const url = await authUrl(false); window.open(url, "_blank", "noopener"); return url; }
export async function finishWithCode(code) {
  const saved = LS.get(PKCE, null);
  if (!saved) throw err("no_pkce");
  await exchange(code.trim(), saved.verifier, null);
}
export async function finishRedirectIfAny() {
  const p = new URLSearchParams(location.search);
  if (!p.has("code") && !p.has("error")) return false;
  history.replaceState(null, "", redirectUri());
  if (p.has("error")) throw err("denied");
  const saved = LS.get(PKCE, null);
  if (!saved || saved.state !== p.get("state")) throw err("state");
  await exchange(p.get("code"), saved.verifier, redirectUri());
  return true;
}
async function tokenReq(params) {
  let r;
  try { r = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({ ...params, client_id: CONFIG.dropboxAppKey }) }); }
  catch { throw err("offline"); }
  if (r.status === 400 || r.status === 401) throw err("auth_invalid", { body: await r.text().catch(() => "") });
  if (!r.ok) throw err("offline");
  return r.json();
}
async function exchange(code, verifier, redirect) {
  const params = { code, grant_type: "authorization_code", code_verifier: verifier };
  if (redirect) params.redirect_uri = redirect;
  const t = await tokenReq(params);
  LS.set(AUTH, { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 });
  LS.del(PKCE);
  // Un nouvel appareil connecté : on repart de ce qui est dans Dropbox, fusionné avec ce qui est ici.
  st.rev = null; st.dirty = true; persist();
}
export function disconnect() {
  const a = LS.get(AUTH, null);
  LS.del(AUTH);
  if (a?.access) fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: "Bearer " + a.access } }).catch(() => {});
  setStatus("local");
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
  if (r.status === 401 && !retried) return dbx(kind, endpoint, args, body, true);
  if (r.status === 401) { LS.del(AUTH); throw err("not_connected"); }
  if (r.status === 409) { const j = await r.json().catch(() => ({})); throw err("conflict", { summary: j.error_summary || "" }); }
  if (r.status === 507) throw err("dropbox_full");
  if (r.status === 429 || r.status >= 500) throw err("offline");
  if (!r.ok) throw err("http_" + r.status, { summary: await r.text().catch(() => "") });
  return r;
}
async function upload(path, blob, mode) {
  const r = await dbx("content", "files/upload", { path, mode: mode || "overwrite", autorename: false, mute: true }, blob);
  return r.json();
}

/* ---------- données ---------- */
const STATE = "frais_state", PENDING = "frais_pending";
const empty = () => ({ schema: 1, profile: { name: "", updatedAt: "" }, employers: [], expenses: [] });
const st = Object.assign({ data: empty(), rev: null, dirty: false }, LS.get(STATE, {}));
const pending = Object.assign({ up: [], del: [] }, LS.get(PENDING, {}));
let status = isConnected() ? "sync" : "local", lastError = "";
const listeners = new Set();

function persist() { LS.set(STATE, { data: st.data, rev: st.rev, dirty: st.dirty }); }
function savePending() { LS.set(PENDING, pending); }
function emit() { for (const f of listeners) try { f(); } catch {} }
function setStatus(s, e) { status = s; lastError = e || ""; emit(); }
export const onChange = f => listeners.add(f);
export const getStatus = () => ({ status, lastError, pendingFiles: pending.up.length, dirty: st.dirty, connected: isConnected() });

export const employers = () => st.data.employers.filter(e => !e.deleted);
export const expenses = () => st.data.expenses.filter(x => !x.deleted);
export const profile = () => st.data.profile || { name: "" };

function mergeList(a = [], b = []) {
  const m = new Map();
  for (const x of [...a, ...b]) { const o = m.get(x.id); if (!o || (x.updatedAt || "") > (o.updatedAt || "")) m.set(x.id, x); }
  return [...m.values()];
}
function merge(a, b) {
  const pa = a.profile || {}, pb = b.profile || {};
  return { schema: 1, profile: (pb.updatedAt || "") > (pa.updatedAt || "") ? pb : pa,
    employers: mergeList(a.employers, b.employers), expenses: mergeList(a.expenses, b.expenses) };
}
function commit() { st.dirty = true; persist(); emit(); scheduleSync(); }

export function saveExpense(x) {
  const v = { ...x, updatedAt: nowIso() };
  const i = st.data.expenses.findIndex(o => o.id === v.id);
  if (i >= 0) st.data.expenses[i] = v; else st.data.expenses.push(v);
  commit(); return v;
}
export function deleteExpense(x) {
  for (const p of [x.receipt?.path, x.preview].filter(Boolean)) removeFile(p);
  const i = st.data.expenses.findIndex(o => o.id === x.id);
  const tomb = { id: x.id, deleted: true, updatedAt: nowIso() };
  if (i >= 0) st.data.expenses[i] = tomb; else st.data.expenses.push(tomb);
  commit();
}
export function saveEmployer(e) {
  const v = { ...e, updatedAt: nowIso() };
  const i = st.data.employers.findIndex(o => o.id === v.id);
  if (i >= 0) st.data.employers[i] = v; else st.data.employers.push(v);
  commit(); return v;
}
export function setName(name) { st.data.profile = { name, updatedAt: nowIso() }; commit(); }
export function importData(data) { st.data = merge(st.data, data); commit(); }

/* ---------- justificatifs ---------- */
export async function putFile(path, blob) {
  await blobPut(path, blob);
  if (!pending.up.includes(path)) pending.up.push(path);
  pending.del = pending.del.filter(p => p !== path);
  savePending(); scheduleSync();
}
export function removeFile(path) {
  pending.up = pending.up.filter(p => p !== path);
  if (!pending.del.includes(path)) pending.del.push(path);
  blobDel(path); savePending();
}
const inflight = new Map();
export function getFile(path) {
  if (!inflight.has(path)) inflight.set(path, (async () => {
    const b = await blobGet(path);
    if (b) return b;
    const r = await dbx("content", "files/download", { path });
    const out = new Blob([await r.arrayBuffer()], { type: typeOf(path) });
    blobPut(path, out).catch(() => {});
    return out;
  })().finally(() => inflight.delete(path)));
  return inflight.get(path);
}

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
  try { r = await dbx("content", "files/download", { path: "/data.json" }); }
  catch (e) { if (e.code === "conflict" && /not_found/.test(e.summary)) return null; throw e; }
  let meta = null; try { meta = JSON.parse(r.headers.get("Dropbox-API-Result")); } catch {}
  const data = await r.json();
  let rev = meta?.rev;
  if (!rev) rev = (await (await dbx("rpc", "files/get_metadata", { path: "/data.json" })).json()).rev;
  return { data, rev };
}
async function doSync() {
  if (!isConnected()) { setStatus("local"); return; }
  if (!hasAppKey()) { setStatus("local"); return; }
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
      // justificatifs en attente d'envoi
      for (const p of [...pending.up]) {
        const b = await blobGet(p);
        if (b) await upload(p, b, "overwrite");
        pending.up = pending.up.filter(x => x !== p); savePending(); emit();
      }
      if (!st.dirty) break;
      try {
        const meta = await upload("/data.json", new Blob([JSON.stringify(st.data)], { type: "application/json" }),
          st.rev ? { ".tag": "update", update: st.rev } : { ".tag": "add" });
        st.rev = meta.rev; st.dirty = false; persist();
        break;
      } catch (e) { if (e.code !== "conflict") throw e; /* modifié ailleurs entre-temps : on refusionne */ }
    }
    for (const p of [...pending.del]) {
      try { await dbx("rpc", "files/delete_v2", { path: p }); }
      catch (e) { if (e.code !== "conflict") throw e; }
      pending.del = pending.del.filter(x => x !== p); savePending();
    }
    setStatus(st.dirty ? "offline" : "ok");
  } catch (e) {
    persist();
    setStatus(e.code === "not_connected" ? "local" : e.code === "dropbox_full" ? "full" : "offline", e.code);
  }
}
addEventListener("online", () => scheduleSync(200));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(200); });
addEventListener("storage", e => { if (e.key === AUTH) scheduleSync(200); });
