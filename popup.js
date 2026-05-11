const API_INIT = "https://paninicollection.fifa.com/api/init";
const MANIFEST = "https://paninicollection.fifa.com/manifest_update.json";
const ASSET_HOST = "https://paninicollection.fifa.com/assets/";

const els = {
  refresh: document.querySelector("#refresh"),
  downloadJson: document.querySelector("#downloadJson"),
  syncStatus: document.querySelector("#syncStatus"),
  backendUrl: document.querySelector("#backendUrl"),
  backendUrlApp: document.querySelector("#backendUrlApp"),
  authLanding: document.querySelector("#authLanding"),
  appView: document.querySelector("#appView"),
  loginUser: document.querySelector("#loginUser"),
  loginPassword: document.querySelector("#loginPassword"),
  loginBtn: document.querySelector("#loginBtn"),
  registerBtn: document.querySelector("#registerBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  loginStatus: document.querySelector("#loginStatus"),
  status: document.querySelector("#status"),
  summary: document.querySelector(".summary"),
  listWrap: document.querySelector(".listWrap"),
  user: document.querySelector("#user"),
  album: document.querySelector("#album"),
  golden: document.querySelector("#golden"),
  tempCount: document.querySelector("#tempCount"),
  tempList: document.querySelector("#tempList")
};

const BACKEND_URL_KEY = "panini-2026-sync-backend-url";
const DEFAULT_BACKEND_URL = "https://panini2026digitalbackend.onrender.com";
const AUTH_KEY = "panini-2026-sync-auth";
let lastManagerPayload = null;
let lastSyncedProfile = localStorage.getItem("panini-2026-last-profile-id") || "";
let auth = loadAuth();

els.refresh.addEventListener("click", load);
els.downloadJson.addEventListener("click", downloadManagerJson);
els.syncStatus.addEventListener("click", syncStatus);
els.loginBtn.addEventListener("click", () => login("login"));
els.registerBtn.addEventListener("click", () => login("register"));
els.logoutBtn.addEventListener("click", logout);
els.backendUrl.value = localStorage.getItem(BACKEND_URL_KEY) || DEFAULT_BACKEND_URL;
els.backendUrlApp.value = els.backendUrl.value;
els.backendUrl.addEventListener("input", () => {
  saveBackendUrl(els.backendUrl.value);
});
els.backendUrlApp.addEventListener("input", () => {
  saveBackendUrl(els.backendUrlApp.value);
});
renderAuth();
if (auth?.token) load();

async function load() {
  setBusy(true);
  setStatus("Cargando...");

  try {
    const [init, catalog] = await Promise.all([fetchInit(), fetchCatalog()]);
    render(init, catalog);
    lastManagerPayload = managerPayload(init, catalog);
    els.downloadJson.disabled = false;
    els.syncStatus.disabled = false;
    setStatus("");
  } catch (error) {
    lastManagerPayload = null;
    els.downloadJson.disabled = true;
    els.syncStatus.disabled = true;
    els.summary.hidden = true;
    els.listWrap.hidden = true;
    setStatus(error.message || "No se pudo cargar la informacion.", true);
  } finally {
    setBusy(false);
  }
}

async function fetchInit() {
  const response = await fetch(API_INIT, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Panini respondio ${response.status}. Verifica que estes logueado en paninicollection.fifa.com.`);
  }

  const data = await response.json();
  const init = data.find((item) => item.action === "init");
  const user = data.find((item) => item.action === "own_user_info");

  if (!init || !user) {
    throw new Error("No encontre datos de album. Abri Panini en Chrome e inicia sesion.");
  }

  return { init, user: user.user_info };
}

async function fetchCatalog() {
  const [manifestResponse, managerBaseResponse] = await Promise.all([
    fetch(MANIFEST),
    fetch("cromos_base.json")
  ]);
  if (!manifestResponse.ok) throw new Error("No pude cargar el manifest de assets.");
  if (!managerBaseResponse.ok) throw new Error("No pude cargar cromos_base.json del plugin.");

  const manifest = await manifestResponse.json();
  const managerBase = await managerBaseResponse.json();
  const configPath = manifest["config/config.json"];
  if (!configPath) throw new Error("No encontre config/config.json en el manifest.");

  const configResponse = await fetch(`${ASSET_HOST}${configPath}`);
  if (!configResponse.ok) throw new Error("No pude cargar el catalogo de figuritas.");

  const config = await configResponse.json();
  const groups = new Map((config.groups || []).map((group) => [group.uid, group]));
  const stickers = new Map((config.stickers || []).map((sticker) => [sticker.id, sticker]));
  const managerCodes = new Set(
    Object.values(managerBase).flatMap((group) => (group.items || []).map((item) => item.codigo))
  );

  return { groups, stickers, managerCodes };
}

function render({ init, user }, catalog) {
  const album = init.stacks?.album || [];
  const temp = init.stacks?.temp || [];
  const completedGroups = init.completed_groups || [];

  els.summary.hidden = false;
  els.user.textContent = `${user.label || user.uid} (${user.country || "-"})`;
  els.album.textContent = `${user.album_collected_stickers}/${user.album_total_stickers} (${user.album_completion_perc}%)`;
  els.golden.textContent = `${user.golden_album_collected_stickers}/${user.golden_album_total_stickers} (${user.golden_album_completion_perc}%)`;
  els.tempCount.textContent = String(temp.length);

  els.tempList.replaceChildren();
  temp.forEach((id) => {
    const sticker = catalog.stickers.get(id);
    const group = sticker ? catalog.groups.get(sticker.group_uid) : null;
    const li = document.createElement("li");
    li.textContent = sticker
      ? `${id} - ${sticker.label} (${group?.label || sticker.group_uid})`
      : `${id} - desconocida`;
    els.tempList.append(li);
  });

  if (!temp.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No hay figuritas temporales.";
    els.tempList.append(li);
  }

  if (album.length || completedGroups.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = `Pegadas: ${album.length}. Grupos completos: ${completedGroups.length}.`;
    els.tempList.append(li);
  }

  els.listWrap.hidden = false;
}

function managerPayload({ init, user }, catalog) {
  const quantities = allManagerQuantities(catalog);
  const stacks = init.stacks || {};
  const perCode = new Map();

  addStackCounts(perCode, catalog, stacks.album || [], "album");
  addStackCounts(perCode, catalog, stacks.temp || [], "temp");
  addStackCounts(perCode, catalog, stacks.swap || [], "swap");

  for (const [code, counts] of perCode) {
    quantities[code] = counts.album + counts.temp + counts.swap;
  }

  return {
    app: "digital-panini-2026-manager",
    user: user.label || user.uid || "Panini",
    userId: user.uid || "",
    source: "plugin",
    exportedAt: new Date().toISOString(),
    quantities
  };
}

async function syncStatus() {
  if (!lastManagerPayload) return;
  const backendUrl = normalizedBackendUrl();
  if (!backendUrl) {
    setStatus("Configura la URL del backend antes de sincronizar.", true);
    els.backendUrl.focus();
    return;
  }

  setBusy(true);
  setStatus("Sincronizando con backend...");

  try {
    const payload = {
      ...lastManagerPayload,
      id: auth ? "" : lastSyncedProfile || lastManagerPayload.userId || "",
      source: "plugin"
    };
    const response = await fetch(`${backendUrl}/api/profiles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Backend respondio ${response.status}.`);
    lastSyncedProfile = data.profile?.id || lastSyncedProfile;
    if (lastSyncedProfile) localStorage.setItem("panini-2026-last-profile-id", lastSyncedProfile);
    setStatus(`Status sincronizado como ${data.profile?.user || lastManagerPayload.user}.`);
  } catch (error) {
    setStatus(error.message || "No pude sincronizar con el backend.", true);
  } finally {
    setBusy(false);
  }
}

async function login(mode) {
  const backendUrl = normalizedBackendUrl();
  const username = els.loginUser.value.trim();
  const password = els.loginPassword.value;
  if (!backendUrl || !username || !password) {
    setLoginStatus("Completa backend, usuario y clave.");
    return;
  }

  setLoginStatus(mode === "register" ? "Creando usuario..." : "Entrando...");
  try {
    const response = await fetch(`${backendUrl}/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName: username })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Backend respondio ${response.status}.`);
    auth = data;
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    els.loginPassword.value = "";
    renderAuth();
    setLoginStatus(`Logueado como ${auth.user.displayName}.`);
  } catch (error) {
    setLoginStatus(error.message || "No pude iniciar sesion.");
  }
}

function logout() {
  auth = null;
  lastManagerPayload = null;
  localStorage.removeItem(AUTH_KEY);
  els.summary.hidden = true;
  els.listWrap.hidden = true;
  els.downloadJson.disabled = true;
  els.syncStatus.disabled = true;
  renderAuth();
  setLoginStatus("Sesion cerrada.");
}

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY));
  } catch {
    return null;
  }
}

function renderAuth() {
  const logged = Boolean(auth?.token);
  els.authLanding.classList.toggle("hidden", logged);
  els.appView.classList.toggle("hidden", !logged);
  els.backendUrlApp.value = els.backendUrl.value.trim();
  if (logged) {
    els.loginUser.value = auth.user?.username || auth.user?.displayName || "";
    setLoginStatus(`Logueado como ${auth.user?.displayName || auth.user?.username}.`);
    load();
  }
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  return headers;
}

function setLoginStatus(message) {
  els.loginStatus.textContent = message;
}

function normalizedBackendUrl() {
  return saveBackendUrl(els.backendUrlApp.value || els.backendUrl.value);
}

function saveBackendUrl(value) {
  const normalized = (value || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
  localStorage.setItem(BACKEND_URL_KEY, normalized);
  els.backendUrl.value = normalized;
  els.backendUrlApp.value = normalized;
  return normalized;
}

function allManagerQuantities(catalog) {
  const quantities = {};
  for (const code of catalog.managerCodes) {
    quantities[code] = 0;
  }
  return quantities;
}

function addStackCounts(perCode, catalog, ids, key) {
  ids.forEach((entry) => {
    const id = Array.isArray(entry) ? entry[0] : entry;
    const sticker = catalog.stickers.get(id);
    const code = managerCodeFromSticker(sticker);
    if (!code || !catalog.managerCodes.has(code)) return;
    const counts = perCode.get(code) || { album: 0, temp: 0, swap: 0 };
    counts[key] += 1;
    perCode.set(code, counts);
  });
}

function managerCodeFromSticker(sticker) {
  if (!sticker) return "";
  const group = sticker.group_uid === "NZE" ? "NZL" : sticker.group_uid;
  const index = Number(sticker.index_in_group);

  if (group === "FWC") {
    return index === 0 ? "INTRO 00" : `INTRO FWC${index}`;
  }

  if (group === "Poster") {
    return `HOST CITY ${hostCityLabel(sticker.label)}`;
  }

  if (!group || !Number.isFinite(index)) return "";
  return `${group} ${index}`;
}

function hostCityLabel(label) {
  const value = String(label || "")
    .replace(/^Host City\s*-\s*/i, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  if (value === "NEW YORK NEW JERSEY") return "NEW YORK / NEW JERSEY";
  return value;
}

function downloadManagerJson() {
  if (!lastManagerPayload) return;

  const blob = new Blob([JSON.stringify(lastManagerPayload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${timestampForFile(lastManagerPayload.exportedAt)}-${fileSafeName(lastManagerPayload.user)}-panini-2026-progreso.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForFile(value) {
  const date = value ? new Date(value) : new Date();
  return [
    date.getFullYear() % 100,
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ].map((part) => String(part).padStart(2, "0")).join("");
}

function fileSafeName(value) {
  return String(value || "usuario")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "usuario";
}

function setBusy(busy) {
  els.refresh.disabled = busy;
  els.downloadJson.disabled = busy || !lastManagerPayload;
  els.syncStatus.disabled = busy || !lastManagerPayload;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.hidden = !message;
  els.status.classList.toggle("error", isError);
}
