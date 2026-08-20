const SESSION_KEY = "equiptrack_session";
const EQUIPMENT_CACHE_KEY = "power_suntrack_equipment_cache";
const CATEGORY_CACHE_KEY = "power_suntrack_category_cache";
const JOB_CACHE_KEY = "power_suntrack_job_cache";
const QUANTITY_ASSET_CACHE_KEY = "power_suntrack_quantity_asset_cache";
const QUANTITY_ASSET_HISTORY_CACHE_KEY = "power_suntrack_quantity_asset_history_cache";
const OFFLINE_QUEUE_KEY = "power_suntrack_offline_queue";
const HISTORY_PAGE_SIZE = 50;

const state = {
  user: null,
  token: "",
  equipment: [],
  assetHistory: [],
  jobAudits: [],
  savedJobAudits: [],
  auditHistory: [],
  currentAuditDetails: [],
  currentAuditDetailBatchId: "",
  currentAuditsMessage: "",
  auditHistoryMessage: "",
  lookupAssetId: "",
  lookupMasterNumber: "",
  lookupAssignmentType: "",
  inventoryAssetId: "",
  inventoryBaselineReady: false,
  users: [],
  categories: [],
  jobs: [],
  quantityAssets: [],
  quantityAssetHistory: [],
  search: "",
  jobFilter: "__all",
  mapJobFilter: "__all",
  mapZoomOffset: 0,
  mapSelectedId: "",
  historySearch: "",
  assetHistoryPage: 1,
  quantityHistoryPage: 1,
  page: "dashboard",
  syncing: false,
  serverOnline: navigator.onLine
};

const $ = (id) => document.getElementById(id);
const API_BASE_URL = (window.POWER_SUNTRACK_CONFIG && window.POWER_SUNTRACK_CONFIG.apiBaseUrl || "").replace(/\/$/, "");
const GOOGLE_MAPS_API_KEY = (window.POWER_SUNTRACK_CONFIG && window.POWER_SUNTRACK_CONFIG.googleMapsApiKey || "").trim();
const GROUPME_BOT_ID = (window.POWER_SUNTRACK_CONFIG && window.POWER_SUNTRACK_CONFIG.groupMeBotId || "").trim();
const MAX_ASSET_PHOTOS = 6;
const ASSET_PHOTO_MAX_DIMENSION = 1280;
const ASSET_PHOTO_JPEG_QUALITY = 0.72;
const GPS_TARGET_ACCURACY_METERS = 10;
const GPS_TIMEOUT_MS = 45000;
const YARD_JOB_NAME = "Big Spring Yard";
let qrStream = null;
let qrScanTimer = null;
let qrDetector = null;
let auditQrStream = null;
let auditQrScanTimer = null;
let historyQrStream = null;
let historyQrScanTimer = null;
let lookupQrStream = null;
let lookupQrScanTimer = null;
let lookupScanTarget = "search";
let inventoryQrStream = null;
let inventoryQrScanTimer = null;
let inventoryScanTarget = "search";
let qrAudioContext = null;
const inventoryBaselineYardAssetIds = new Set();
const inventoryScannedAssetIds = new Set();
const inventoryUnexpectedAssetIds = new Set();
let currentAssetPhotos = [];
let googleMap = null;
let googleMapInfoWindow = null;
let googleMapsLoadPromise = null;
const googleMapMarkers = new Map();
const qrCanvas = document.createElement("canvas");
const qrCanvasContext = qrCanvas.getContext("2d", { willReadFrequently: true });

const createId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const canEdit = () => state.user && ["Admin", "Manager"].includes(state.user.role);
const canDelete = () => state.user && state.user.role === "Admin";
const isAdmin = () => state.user && state.user.role === "Admin";
const isTrackerViewer = () => state.user && state.user.role === "Tracker Viewer";
const TRACKER_VIEWER_PAGES = new Set(["dashboard", "list", "asset-lookup", "maps"]);

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, user: state.user }));
}

function clearSession() {
  state.user = null;
  state.token = "";
  localStorage.removeItem(SESSION_KEY);
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    state.serverOnline = true;
    updateConnectionStatus();
  } catch (error) {
    state.serverOnline = false;
    updateConnectionStatus();
    error.isNetworkError = true;
    throw error;
  }

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(data && data.error ? data.error : "Request failed.");
  }
  return data;
}

function readLocal(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not save browser cache ${key}.`, error);
    return false;
  }
}

function getOfflineQueue() {
  return readLocal(OFFLINE_QUEUE_KEY, []);
}

function setOfflineQueue(queue) {
  writeLocal(OFFLINE_QUEUE_KEY, queue);
  updateConnectionStatus();
}

function isNetworkError(error) {
  return Boolean(error && (error.isNetworkError || error.name === "TypeError" || String(error.message).toLowerCase().includes("fetch")));
}

function cacheEquipment() {
  const compactEquipment = state.equipment.map((record) => ({ ...record, photos: [] }));
  if (!writeLocal(EQUIPMENT_CACHE_KEY, compactEquipment)) {
    localStorage.removeItem(EQUIPMENT_CACHE_KEY);
    writeLocal(EQUIPMENT_CACHE_KEY, compactEquipment);
  }
}

function renderEquipmentViews() {
  renderStats();
  renderEquipment();
  renderEquipmentMasterJobs();
  renderMapPoints();
  renderInventoryYardChecklist();
}

function updateConnectionStatus(message = "") {
  const status = $("connectionStatus");
  if (!status) return;

  const pending = getOfflineQueue().length;
  const connected = navigator.onLine && state.serverOnline;
  status.classList.toggle("offline", !connected);
  status.classList.toggle("syncing", state.syncing);

  if (state.syncing) {
    status.textContent = pending ? `Syncing ${pending} change${pending === 1 ? "" : "s"}` : "Syncing";
    return;
  }

  if (!connected) {
    status.textContent = pending ? `Offline - ${pending} pending` : "Offline";
    return;
  }

  status.textContent = message || (pending ? `Online - ${pending} pending` : "Online");
}

function queueOfflineChange(change) {
  const queue = getOfflineQueue();
  queue.push({ ...change, queuedAt: new Date().toISOString() });
  setOfflineQueue(queue);
}

function saveEquipmentOffline(record) {
  const offlineRecord = {
    ...record,
    updatedAt: record.updatedAt || new Date().toISOString()
  };
  const index = state.equipment.findIndex((item) => item.id === offlineRecord.id);
  if (index >= 0) {
    state.equipment[index] = offlineRecord;
  } else {
    state.equipment.unshift(offlineRecord);
  }
  cacheEquipment();
  queueOfflineChange({ type: "saveEquipment", payload: offlineRecord });
  renderEquipmentViews();
  updateConnectionStatus("Saved offline");
}

function deleteEquipmentOffline(id) {
  state.equipment = state.equipment.filter((item) => item.id !== id);
  cacheEquipment();
  queueOfflineChange({ type: "deleteEquipment", payload: { id } });
  renderEquipmentViews();
  updateConnectionStatus("Deleted offline");
}

async function syncOfflineQueue() {
  if (!state.token || isTrackerViewer() || state.syncing || !navigator.onLine) {
    updateConnectionStatus();
    return;
  }

  let queue = getOfflineQueue();
  if (!queue.length) {
    updateConnectionStatus();
    return;
  }

  state.syncing = true;
  updateConnectionStatus();

  try {
    while (queue.length) {
      const item = queue[0];
      if (item.type === "saveEquipment") {
        await api("/api/equipment", {
          method: "POST",
          body: JSON.stringify(item.payload)
        });
      } else if (item.type === "deleteEquipment") {
        await api(`/api/equipment/${encodeURIComponent(item.payload.id)}`, { method: "DELETE" });
      }
      queue = queue.slice(1);
      setOfflineQueue(queue);
    }
    await Promise.all([loadEquipment(), loadAssetHistory()]);
  } catch (error) {
    if (!isNetworkError(error)) {
      alert(error.message || "Could not sync offline changes.");
    }
  } finally {
    state.syncing = false;
    updateConnectionStatus();
  }
}

function init() {
  const session = readSession();
  if (session && session.token && session.user) {
    state.token = session.token;
    state.user = session.user;
    if (["Scheduler", "Technician", "Shop Viewer"].includes(session.user.role)) {
      window.location.replace("./sunwave-shop/");
      return;
    }
    if (session.user.role === "Admin" && window.location.hash === "#projects") state.page = "projects";
  }
  bindEvents();
  showCurrentView();
}

function bindEvents() {
  $("loginForm").addEventListener("submit", handleLogin);
  $("logoutBtn").addEventListener("click", handleLogout);
  $("equipmentForm").addEventListener("submit", handleSave);
  $("jobAuditForm").addEventListener("submit", handleJobAuditSave);
  $("categoryForm").addEventListener("submit", handleCategorySave);
  $("jobForm").addEventListener("submit", handleJobSave);
  $("quantityAssetSetupForm").addEventListener("submit", handleQuantityAssetSetupSave);
  $("quantityAssetAdjustForm").addEventListener("submit", handleQuantityAssetAdjustSave);
  $("quantityAssetAction").addEventListener("change", updateQuantityAssetJobVisibility);
  $("registerMasterNumber").addEventListener("change", updateRegisterMasterMode);
  $("registerMasterQuantity").addEventListener("input", updateRegisterMasterMode);
  $("refreshQuantityAssetsBtn").addEventListener("click", loadQuantityAssets);
  $("userForm").addEventListener("submit", handleUserSave);
  $("clearUserFormBtn").addEventListener("click", resetUserForm);
  $("clearFormBtn").addEventListener("click", resetForm);
  $("useLocationBtn").addEventListener("click", captureLocation);
  $("useAuditLocationBtn").addEventListener("click", captureAuditLocation);
  $("scanAssetBtn").addEventListener("click", startAssetScan);
  $("closeScannerBtn").addEventListener("click", stopAssetScan);
  $("assetPhotos").addEventListener("change", handleAssetPhotosSelected);
  $("scanAuditAssetBtn").addEventListener("click", startAuditAssetScan);
  $("closeAuditScannerBtn").addEventListener("click", stopAuditAssetScan);
  $("scanHistoryBtn").addEventListener("click", startHistoryScan);
  $("closeHistoryScannerBtn").addEventListener("click", stopHistoryScan);
  $("lookupSearchBtn").addEventListener("click", handleAssetLookup);
  $("lookupSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAssetLookup();
    }
  });
  $("lookupScanBtn").addEventListener("click", () => startLookupScan("search"));
  $("lookupQrScanBtn").addEventListener("click", () => startLookupScan("qr"));
  $("closeLookupScannerBtn").addEventListener("click", stopLookupScan);
  $("saveLookupQrBtn").addEventListener("click", handleLookupQrSave);
  $("saveLookupJobBtn").addEventListener("click", handleLookupJobSave);
  $("inventorySearchBtn").addEventListener("click", handleInventoryLookup);
  $("inventorySearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleInventoryLookup();
    }
  });
  $("inventoryScanBtn").addEventListener("click", () => startInventoryScan("search"));
  $("inventoryQrAssignScanBtn").addEventListener("click", () => startInventoryScan("qr"));
  $("closeInventoryScannerBtn").addEventListener("click", stopInventoryScan);
  $("saveInventoryJobBtn").addEventListener("click", handleInventoryJobSave);
  $("saveInventoryQrBtn").addEventListener("click", handleInventoryQrSave);
  $("inventoryMasterAction").addEventListener("change", updateInventoryMasterJobVisibility);
  $("saveInventoryMasterBtn").addEventListener("click", handleInventoryMasterSave);
  $("finishInventoryBtn").addEventListener("click", finishYardInventory);
  $("auditAssetNumber").addEventListener("input", clearAuditAssetMessage);
  $("auditMasterNumber").addEventListener("change", syncAuditType);
  $("auditMasterQuantity").addEventListener("input", syncAuditType);
  $("searchInput").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderEquipmentViews();
  });
  $("jobFilter").addEventListener("change", (event) => {
    state.jobFilter = event.target.value;
    renderEquipmentViews();
  });
  $("mapJobFilter").addEventListener("change", (event) => {
    state.mapJobFilter = event.target.value;
    state.mapZoomOffset = 0;
    renderMapPoints();
  });
  $("mapZoomInBtn").addEventListener("click", () => changeMapZoom(1));
  $("mapZoomOutBtn").addEventListener("click", () => changeMapZoom(-1));
  $("historySearchInput").addEventListener("input", (event) => {
    state.historySearch = event.target.value.trim().toLowerCase();
    state.assetHistoryPage = 1;
    state.quantityHistoryPage = 1;
    renderAssetHistory();
  });
  $("shareYardWhatsappBtn").addEventListener("click", shareYardSnapshotWhatsapp);
  document.querySelectorAll("[data-dashboard-counter]").forEach((counter) => {
    counter.addEventListener("click", () => showDashboardCounterDetails(counter.dataset.dashboardCounter));
    counter.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      showDashboardCounterDetails(counter.dataset.dashboardCounter);
    });
  });
  $("closeDashboardCounterDetails").addEventListener("click", () => {
    $("dashboardCounterDetails").hidden = true;
    document.querySelectorAll("[data-dashboard-counter]").forEach((counter) => counter.classList.remove("selected"));
  });
  $("exportBtn").addEventListener("click", exportCsv);
  $("refreshHistoryBtn").addEventListener("click", refreshHistoryPage);
  $("refreshJobAuditBtn").addEventListener("click", loadJobAudits);
  $("saveJobAuditListBtn").addEventListener("click", handleSaveJobAuditList);
  $("refreshCurrentAuditsBtn").addEventListener("click", loadCurrentAudits);
  $("refreshAuditHistoryBtn").addEventListener("click", loadAuditHistory);
  $("backToCurrentAuditsBtn").addEventListener("click", () => setPage("current-audits"));
  $("closeAssetPictureViewerBtn").addEventListener("click", closeAssetPictureViewer);
  $("assetPictureViewer").addEventListener("click", (event) => {
    if (event.target === $("assetPictureViewer")) closeAssetPictureViewer();
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest(".asset-picture-link");
    if (!link) return;
    event.preventDefault();
    openAssetPicture(link.dataset.assetId);
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  ["latitude", "longitude"].forEach((field) => {
    $(field).addEventListener("input", updateMapLink);
  });
  ["auditLatitude", "auditLongitude"].forEach((field) => {
    $(field).addEventListener("input", updateAuditMapLink);
  });
  window.addEventListener("online", () => {
    state.serverOnline = true;
    syncOfflineQueue();
  });
  window.addEventListener("offline", () => {
    state.serverOnline = false;
    updateConnectionStatus();
  });
  updateConnectionStatus();
  updateQuantityAssetJobVisibility();
  updateRegisterMasterMode();
}

async function handleLogin(event) {
  event.preventDefault();
  $("loginError").textContent = "";

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("loginUsername").value.trim(),
        password: $("loginPassword").value
      })
    });
    state.token = result.token;
    state.user = result.user;
    state.page = result.user.role === "Admin" ? "projects" : "dashboard";
    saveSession();
    $("loginForm").reset();
    if (["Scheduler", "Technician", "Shop Viewer"].includes(result.user.role)) {
      window.location.replace("./sunwave-shop/");
      return;
    }
    await showCurrentView();
  } catch (error) {
    $("loginError").textContent = error.message || "Username or password is incorrect.";
  }
}

async function handleLogout() {
  if (state.token) {
    api("/api/logout", { method: "POST" }).catch(() => {});
  }
  stopAssetScan();
  stopAuditAssetScan();
  stopHistoryScan();
  clearSession();
  state.equipment = [];
  state.assetHistory = [];
  state.jobAudits = [];
  state.savedJobAudits = [];
  state.auditHistory = [];
  state.currentAuditDetails = [];
  state.currentAuditDetailBatchId = "";
  state.currentAuditsMessage = "";
  state.auditHistoryMessage = "";
  state.users = [];
  state.categories = [];
  state.jobs = [];
  state.quantityAssets = [];
  state.quantityAssetHistory = [];
  state.page = "dashboard";
  await showCurrentView();
}

async function showCurrentView() {
  const signedIn = Boolean(state.user && state.token);
  $("loginView").hidden = signedIn;
  $("appView").hidden = !signedIn;
  document.body.classList.remove("booting");
  if (!signedIn) return;

  $("roleBadge").textContent = `${state.user.name} - ${state.user.role}`;
  configureAccess();
  resetForm();
  resetUserForm();
  resetJobAuditForm();
  configureAdminAccess();
  setPage(state.page);
  await Promise.all([
    loadCategories(),
    loadJobs(),
    loadQuantityAssets(),
    loadQuantityAssetHistory(),
    loadEquipment()
  ]);
  renderEquipmentViews();
  renderQuantityAssetDashboard();
  const secondaryLoads = [];
  if (!isTrackerViewer()) secondaryLoads.push(loadAssetHistory(), loadJobAudits());
  if (isAdmin()) secondaryLoads.push(loadUsers());
  await Promise.all(secondaryLoads);
  syncOfflineQueue();
}

function configureAccess() {
  const form = $("equipmentForm");
  const auditForm = $("jobAuditForm");
  const editable = canEdit();
  $("editorPanel").classList.toggle("readonly", !editable);
  $("formTitle").textContent = editable ? "Register equipment" : "Equipment details";
  [...form.elements].forEach((element) => {
    if (element.id !== "recordId") element.disabled = !editable;
  });
  [...auditForm.elements].forEach((element) => {
    element.disabled = !editable;
  });
  $("clearFormBtn").disabled = !editable;
  $("useLocationBtn").disabled = !editable;
  $("saveBtn").hidden = !editable;
  $("quantityAssetSetupForm").classList.toggle("readonly", !editable);
  $("quantityAssetAdjustForm").classList.toggle("readonly", !editable);
  [...$("quantityAssetSetupForm").elements].forEach((element) => {
    element.disabled = !editable;
  });
  [...$("quantityAssetAdjustForm").elements].forEach((element) => {
    element.disabled = !editable;
  });
  $("refreshQuantityAssetsBtn").disabled = !editable && !state.token;
  if ($("inventoryJobSelect")) $("inventoryJobSelect").disabled = !editable;
  if ($("saveInventoryJobBtn")) $("saveInventoryJobBtn").disabled = !editable;
  if ($("inventoryMasterNumber")) $("inventoryMasterNumber").disabled = !editable;
  if ($("inventoryMasterAction")) $("inventoryMasterAction").disabled = !editable;
  if ($("inventoryMasterQuantity")) $("inventoryMasterQuantity").disabled = !editable;
  if ($("inventoryMasterJob")) $("inventoryMasterJob").disabled = !editable;
  if ($("saveInventoryMasterBtn")) $("saveInventoryMasterBtn").disabled = !editable;
  if ($("lookupJobSelect")) $("lookupJobSelect").disabled = !editable;
  if ($("lookupMasterQuantity")) $("lookupMasterQuantity").disabled = !editable;
  if ($("saveLookupJobBtn")) $("saveLookupJobBtn").disabled = !editable;
  updateInventoryMasterJobVisibility();
}

function configureAdminAccess() {
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = !isAdmin();
  });
  document.querySelectorAll(".app-menu [data-page]").forEach((element) => {
    if (isTrackerViewer()) {
      element.hidden = !TRACKER_VIEWER_PAGES.has(element.dataset.page);
    } else if (!element.classList.contains("admin-only")) {
      element.hidden = false;
    }
  });
  $("exportBtn").hidden = isTrackerViewer();
  $("shareYardWhatsappBtn").hidden = isTrackerViewer();
  if (!isAdmin() && (["users", "categories", "jobs", "projects"].includes(state.page))) {
    state.page = "dashboard";
  }
  if (isTrackerViewer() && !TRACKER_VIEWER_PAGES.has(state.page)) state.page = "dashboard";
}

function setPage(page) {
  if (["users", "categories", "jobs", "projects"].includes(page) && !isAdmin()) page = "dashboard";
  if (isTrackerViewer() && !TRACKER_VIEWER_PAGES.has(page)) page = "dashboard";
  if (state.page !== page) {
    stopLookupScan();
    stopInventoryScan();
  }
  state.page = page;
  document.querySelectorAll(".page-view").forEach((section) => {
    section.hidden = section.dataset.pageView !== page;
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  if (page === "current-audits") loadCurrentAudits();
  if (page === "audit-history") loadAuditHistory();
}

async function loadCategories() {
  try {
    state.categories = await api("/api/categories");
    writeLocal(CATEGORY_CACHE_KEY, state.categories);
    renderCategoryOptions();
    renderCategories();
  } catch (error) {
    if (isNetworkError(error)) {
      state.categories = readLocal(CATEGORY_CACHE_KEY, []);
      renderCategoryOptions();
      renderCategories();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load categories.");
  }
}

function renderCategoryOptions(selectedValue = $("category").value) {
  const select = $("category");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    select.append(option);
  });
  select.value = selectedValue;
  renderQuantityAssetCategoryOptions();
}

async function loadJobs() {
  try {
    state.jobs = await api("/api/jobs");
    writeLocal(JOB_CACHE_KEY, state.jobs);
    renderJobOptions();
    renderJobs();
  } catch (error) {
    if (isNetworkError(error)) {
      state.jobs = readLocal(JOB_CACHE_KEY, []);
      renderJobOptions();
      renderJobs();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load job values.");
  }
}

function renderJobOptions(selectedValue = $("assignedTo").value) {
  const select = $("assignedTo");
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.jobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });
  if (selectedValue && !state.jobs.some((job) => job.name === selectedValue)) {
    const option = document.createElement("option");
    option.value = selectedValue;
    option.textContent = selectedValue;
    select.append(option);
  }
  select.value = selectedValue;
  renderAuditJobOptions();
  renderJobFilterOptions();
  renderMapJobOptions();
  renderQuantityAssetJobOptions();
  renderInventoryJobOptions();
  renderInventoryMasterJobOptions();
}

function renderInventoryJobOptions(selectedValue = $("inventoryJobSelect") ? $("inventoryJobSelect").value : "") {
  const select = $("inventoryJobSelect");
  if (!select) return;
  select.replaceChildren();
  const available = document.createElement("option");
  available.value = "";
  available.textContent = "Available";
  select.append(available);
  const yard = document.createElement("option");
  yard.value = YARD_JOB_NAME;
  yard.textContent = YARD_JOB_NAME;
  select.append(yard);
  state.jobs.forEach((job) => {
    if (!job.name || isYardJobName(job.name)) return;
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });
  if (selectedValue && ![...select.options].some((option) => option.value === selectedValue)) {
    const option = document.createElement("option");
    option.value = selectedValue;
    option.textContent = selectedValue;
    select.append(option);
  }
  select.value = selectedValue;
}

function renderInventoryMasterJobOptions(selectedValue = $("inventoryMasterJob") ? $("inventoryMasterJob").value : "") {
  const select = $("inventoryMasterJob");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.jobs.forEach((job) => {
    if (!job.name || isYardJobName(job.name)) return;
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });
  if (selectedValue && !isYardJobName(selectedValue) && selectedValue !== "Available" && ![...select.options].some((option) => option.value === selectedValue)) {
    const option = document.createElement("option");
    option.value = selectedValue;
    option.textContent = selectedValue;
    select.append(option);
  }
  select.value = selectedValue;
}

function renderQuantityAssetCategoryOptions(selectedValue = getSelectedQuantityCategories()) {
  const select = $("quantityAssetCategory");
  if (!select) return;
  const selectedValues = Array.isArray(selectedValue) ? selectedValue : [selectedValue].filter(Boolean);
  select.replaceChildren();
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    option.selected = selectedValues.includes(category.name);
    select.append(option);
  });
}

function renderQuantityAssetJobOptions(selectedValue = $("quantityAssetJob") ? $("quantityAssetJob").value : "") {
  const select = $("quantityAssetJob");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.jobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });
  select.value = selectedValue;
}

function renderAuditJobOptions(selectedValue = $("auditJob") ? $("auditJob").value : "") {
  const select = $("auditJob");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.jobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });
  select.value = selectedValue;
}

function renderJobFilterOptions(selectedValue = state.jobFilter) {
  const select = $("jobFilter");
  if (!select) return;

  select.replaceChildren();
  [
    ["__all", "All jobs"],
    ["__unassigned", "Unassigned"],
    ["Available", "Available"],
    [YARD_JOB_NAME, YARD_JOB_NAME]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });

  state.jobs.forEach((job) => {
    if (isYardJobName(job.name) || job.name.toLowerCase() === "available") return;
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });

  if (![...select.options].some((option) => option.value === selectedValue)) {
    state.jobFilter = "__all";
  } else {
    state.jobFilter = selectedValue;
  }
  select.value = state.jobFilter;
}

function renderMapJobOptions(selectedValue = state.mapJobFilter) {
  const select = $("mapJobFilter");
  if (!select) return;

  select.replaceChildren();
  [
    ["__all", "All jobs"],
    ["__unassigned", "Unassigned"],
    [YARD_JOB_NAME, YARD_JOB_NAME]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });

  state.jobs.forEach((job) => {
    if (isYardJobName(job.name)) return;
    const option = document.createElement("option");
    option.value = job.name;
    option.textContent = job.name;
    select.append(option);
  });

  if (![...select.options].some((option) => option.value === selectedValue)) {
    state.mapJobFilter = "__all";
  } else {
    state.mapJobFilter = selectedValue;
  }
  select.value = state.mapJobFilter;
}

async function loadUsers() {
  if (!isAdmin()) return;
  try {
    state.users = await api("/api/users");
    renderUsers();
  } catch (error) {
    alert(error.message || "Could not load users.");
  }
}

async function loadEquipment() {
  try {
    state.equipment = await api("/api/equipment");
    cacheEquipment();
    renderEquipmentViews();
  } catch (error) {
    if (String(error.message).toLowerCase().includes("session")) {
      clearSession();
      await showCurrentView();
      return;
    }
    if (isNetworkError(error)) {
      state.equipment = readLocal(EQUIPMENT_CACHE_KEY, []);
      renderEquipmentViews();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load equipment.");
  }
}

async function loadAssetHistory() {
  try {
    state.assetHistory = await api("/api/asset-history");
    renderAssetHistory();
  } catch (error) {
    if (isNetworkError(error)) {
      state.assetHistory = [];
      renderAssetHistory();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load asset history.");
  }
}

async function refreshHistoryPage() {
  await Promise.all([loadAssetHistory(), loadQuantityAssetHistory()]);
}

async function loadQuantityAssets() {
  try {
    state.quantityAssets = await api("/api/quantity-assets");
    writeLocal(QUANTITY_ASSET_CACHE_KEY, state.quantityAssets);
    renderQuantityAssets();
    renderQuantityAssetDashboard();
    renderQuantityAssetAdjustOptions();
    renderMasterUseOptions();
    renderInventoryMasterOptions();
    renderInventoryYardChecklist();
  } catch (error) {
    if (isNetworkError(error)) {
      state.quantityAssets = readLocal(QUANTITY_ASSET_CACHE_KEY, []);
      renderQuantityAssets();
      renderQuantityAssetDashboard();
      renderQuantityAssetAdjustOptions();
      renderMasterUseOptions();
      renderInventoryMasterOptions();
      renderInventoryYardChecklist();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load quantity assets.");
  }
}

async function loadQuantityAssetHistory() {
  try {
    state.quantityAssetHistory = await api("/api/quantity-asset-history");
    writeLocal(QUANTITY_ASSET_HISTORY_CACHE_KEY, state.quantityAssetHistory);
    renderStats();
    renderQuantityAssetDashboard();
    renderEquipmentMasterJobs();
    renderHistoryQuantityChanges();
    renderMasterUseOptions();
    renderInventoryMasterOptions();
    renderInventoryYardChecklist();
  } catch (error) {
    if (isNetworkError(error)) {
      state.quantityAssetHistory = readLocal(QUANTITY_ASSET_HISTORY_CACHE_KEY, []);
      renderStats();
      renderQuantityAssetDashboard();
      renderEquipmentMasterJobs();
      renderHistoryQuantityChanges();
      renderMasterUseOptions();
      renderInventoryMasterOptions();
      renderInventoryYardChecklist();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load master number changes.");
  }
}

async function loadJobAudits() {
  try {
    state.jobAudits = await api("/api/job-audits");
    renderJobAudits();
  } catch (error) {
    if (isNetworkError(error)) {
      state.jobAudits = [];
      renderJobAudits();
      updateConnectionStatus();
      return;
    }
    alert(error.message || "Could not load job audits.");
  }
}

async function loadCurrentAudits() {
  try {
    state.currentAuditsMessage = "";
    state.savedJobAudits = await api("/api/current-audits");
    renderCurrentAudits();
  } catch (error) {
    state.savedJobAudits = [];
    state.currentAuditsMessage = "";
    renderCurrentAudits();
    if (isNetworkError(error)) updateConnectionStatus();
  }
}

async function loadAuditHistory() {
  try {
    state.auditHistoryMessage = "";
    state.auditHistory = await api("/api/audit-history");
    renderAuditHistory();
  } catch (error) {
    state.auditHistory = [];
    state.auditHistoryMessage = "";
    renderAuditHistory();
    if (isNetworkError(error)) updateConnectionStatus();
  }
}

async function loadCurrentAuditDetail(batchId) {
  try {
    state.currentAuditDetailBatchId = batchId;
    state.currentAuditDetails = await api(`/api/current-audits/${encodeURIComponent(batchId)}`);
    renderCurrentAuditDetail();
    setPage("current-audit-detail");
  } catch (error) {
    state.currentAuditDetails = [];
    renderCurrentAuditDetail();
    alert(error.message || "Could not load current audit detail.");
  }
}

function getFormData() {
  const assignedTo = $("assignedTo").value.trim();
  return {
    id: $("recordId").value || createId(),
    name: $("equipmentName").value.trim(),
    assetTag: $("assetTag").value.trim(),
    category: $("category").value,
    status: isAvailableAssignment({ assignedTo }) ? "Available" : "Active",
    assignedTo,
    latitude: $("latitude").value.trim(),
    longitude: $("longitude").value.trim(),
    notes: $("notes").value.trim(),
    masterNumber: $("registerMasterNumber").value,
    masterQuantity: $("registerMasterQuantity").value,
    photos: currentAssetPhotos,
    photosProvided: true
  };
}

async function handleSave(event) {
  event.preventDefault();
  if (!canEdit()) return;

  const record = getFormData();
  const masterOnly = isRegisterMasterOnly(record);
  if ((record.masterNumber && !record.masterQuantity) || (!record.masterNumber && record.masterQuantity)) {
    alert("Select a master number and enter the quantity to add.");
    return;
  }
  if (record.masterNumber && record.masterQuantity && isAvailableAssignment({ assignedTo: record.assignedTo })) {
    alert("Select an Assigned to Job before adding a master quantity.");
    return;
  }

  try {
    await api("/api/equipment", {
      method: "POST",
      body: JSON.stringify(record)
    });
    if (!masterOnly) {
      const savedRecord = {
        ...record,
        status: isAvailableAssignment(record) ? "Available" : "Active",
        hasPicture: currentAssetPhotos.length > 0,
        updatedAt: new Date().toISOString()
      };
      state.equipment = [savedRecord, ...state.equipment.filter((item) => item.id !== savedRecord.id)];
      cacheEquipment();
      renderEquipmentViews();
    }
    resetForm();
    setPage(masterOnly ? "quantity-assets" : "list");

    Promise.all([
      loadEquipment(),
      loadAssetHistory(),
      loadQuantityAssets(),
      loadQuantityAssetHistory()
    ]).then(() => {
      renderEquipmentViews();
      renderQuantityAssetDashboard();
    });
  } catch (error) {
    if (isNetworkError(error)) {
      if (masterOnly) {
        alert("Adding a master quantity needs the database connection. Try again when the app is online.");
        return;
      }
      saveEquipmentOffline(record);
      resetForm();
      setPage("list");
      return;
    }
    alert(error.message || "Could not save equipment.");
  }
}

function isRegisterMasterOnly(record) {
  return Boolean(
    record.masterNumber &&
    record.masterQuantity &&
    !record.name &&
    !record.assetTag &&
    !record.category
  );
}

function resetForm() {
  $("equipmentForm").reset();
  stopAssetScan();
  $("recordId").value = "";
  $("assetTagMessage").textContent = "";
  currentAssetPhotos = [];
  renderAssetPhotoPreview();
  $("formTitle").textContent = canEdit() ? "Register equipment" : "Equipment details";
  updateMapLink();
  renderMasterUseOptions();
  updateRegisterMasterMode();
}

function readPhotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, ASSET_PHOTO_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve({
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          type: "image/jpeg",
          dataUrl: canvas.toDataURL("image/jpeg", ASSET_PHOTO_JPEG_QUALITY)
        });
      };
      image.onerror = () => reject(new Error("Could not process this picture."));
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleAssetPhotosSelected(event) {
  const files = [...event.target.files].filter((file) => file.type.startsWith("image/"));
  const slots = Math.max(0, MAX_ASSET_PHOTOS - currentAssetPhotos.length);
  if (!files.length || !slots) {
    event.target.value = "";
    return;
  }

  const photos = await Promise.all(files.slice(0, slots).map(readPhotoFile));
  currentAssetPhotos = [...currentAssetPhotos, ...photos];
  event.target.value = "";
  renderAssetPhotoPreview();
}

function renderAssetPhotoPreview() {
  const preview = $("assetPhotoPreview");
  preview.replaceChildren();

  currentAssetPhotos.forEach((photo, index) => {
    const item = document.createElement("div");
    item.className = "asset-photo-thumb";

    const image = document.createElement("img");
    image.src = photo.dataUrl;
    image.alt = photo.name || `Asset picture ${index + 1}`;
    item.append(image);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.disabled = !canEdit();
    button.addEventListener("click", () => {
      currentAssetPhotos = currentAssetPhotos.filter((_, photoIndex) => photoIndex !== index);
      renderAssetPhotoPreview();
    });
    item.append(button);

    preview.append(item);
  });
}

function resetJobAuditForm() {
  $("jobAuditForm").reset();
  stopAuditAssetScan();
  $("auditDate").value = new Date().toISOString().slice(0, 10);
  $("auditType").value = "Asset";
  $("jobAuditFormMessage").textContent = "";
  $("auditLocationMessage").textContent = "";
  clearAuditAssetMessage();
  renderMasterUseOptions();
  syncAuditType();
  updateAuditMapLink();
}

async function detectQrCodes(video) {
  if (qrDetector) return qrDetector.detect(video);
  if (typeof window.jsQR !== "function" || !qrCanvasContext) return [];

  qrCanvas.width = video.videoWidth;
  qrCanvas.height = video.videoHeight;
  qrCanvasContext.drawImage(video, 0, 0, qrCanvas.width, qrCanvas.height);
  const frame = qrCanvasContext.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
  const result = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
  return result && result.data ? [{ rawValue: result.data }] : [];
}

function prepareQrScanSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  qrAudioContext = qrAudioContext || new AudioContext();
  if (qrAudioContext.state === "suspended") qrAudioContext.resume().catch(() => {});
}

function playQrScanSound() {
  prepareQrScanSound();
  if (!qrAudioContext || qrAudioContext.state !== "running") return;

  const now = qrAudioContext.currentTime;
  const oscillator = qrAudioContext.createOscillator();
  const gain = qrAudioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.setValueAtTime(1175, now + 0.07);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  oscillator.connect(gain);
  gain.connect(qrAudioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.17);
}

async function startAssetScan() {
  prepareQrScanSound();
  $("assetTagMessage").textContent = "";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("qrScannerMessage").textContent = "Camera access is not available in this browser.";
    $("qrScanner").hidden = false;
    return;
  }

  try {
    $("qrScanner").hidden = false;
    $("qrScannerMessage").textContent = "Point the camera at the QR code.";
    if ("BarcodeDetector" in window) qrDetector = qrDetector || new BarcodeDetector({ formats: ["qr_code"] });
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("qrVideo").srcObject = qrStream;
    await $("qrVideo").play();
    qrScanTimer = window.setInterval(scanAssetFrame, 450);
  } catch (error) {
    $("qrScannerMessage").textContent = "Camera permission was not granted.";
    stopAssetScan(false);
  }
}

async function scanAssetFrame() {
  const video = $("qrVideo");
  if (!video.videoWidth) return;

  try {
    const codes = await detectQrCodes(video);
    if (!codes.length) return;
    const value = (codes[0].rawValue || "").trim();
    if (!value) return;
    playQrScanSound();
    const currentRecordId = $("recordId").value;
    const duplicate = state.equipment.find((item) => (
      item.id !== currentRecordId &&
      String(item.assetTag || "").trim().toLowerCase() === value.toLowerCase()
    ));
    if (duplicate) {
      resetForm();
      $("assetTagMessage").textContent = `Duplicate QR code. Already assigned to ${duplicate.name || duplicate.id}. Form cleared.`;
      return;
    }
    $("assetTagMessage").textContent = "";
    $("assetTag").value = value;
    if (!$("equipmentName").value.trim()) {
      $("equipmentName").value = value;
    }
    $("qrScannerMessage").textContent = "Asset tag scanned.";
    stopAssetScan();
  } catch {
    $("qrScannerMessage").textContent = "Could not read that QR code yet.";
  }
}

function stopAssetScan(hide = true) {
  if (qrScanTimer) {
    window.clearInterval(qrScanTimer);
    qrScanTimer = null;
  }
  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }
  if ($("qrVideo")) {
    $("qrVideo").pause();
    $("qrVideo").srcObject = null;
  }
  if (hide && $("qrScanner")) {
    $("qrScanner").hidden = true;
  }
}

async function startAuditAssetScan() {
  prepareQrScanSound();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("auditQrScannerMessage").textContent = "Camera access is not available in this browser.";
    $("auditQrScanner").hidden = false;
    return;
  }

  try {
    $("auditQrScanner").hidden = false;
    $("auditQrScannerMessage").textContent = "Point the camera at the QR code.";
    if ("BarcodeDetector" in window) qrDetector = qrDetector || new BarcodeDetector({ formats: ["qr_code"] });
    auditQrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("auditQrVideo").srcObject = auditQrStream;
    await $("auditQrVideo").play();
    auditQrScanTimer = window.setInterval(scanAuditAssetFrame, 450);
  } catch (error) {
    $("auditQrScannerMessage").textContent = "Camera permission was not granted.";
    stopAuditAssetScan(false);
  }
}

async function scanAuditAssetFrame() {
  const video = $("auditQrVideo");
  if (!video.videoWidth) return;

  try {
    const codes = await detectQrCodes(video);
    if (!codes.length) return;
    const value = codes[0].rawValue || "";
    if (!value) return;
    $("auditAssetNumber").value = value.trim();
    clearAuditAssetMessage();
    playQrScanSound();
    $("auditQrScannerMessage").textContent = "Asset number scanned.";
    stopAuditAssetScan();
  } catch {
    $("auditQrScannerMessage").textContent = "Could not read that QR code yet.";
  }
}

function stopAuditAssetScan(hide = true) {
  if (auditQrScanTimer) {
    window.clearInterval(auditQrScanTimer);
    auditQrScanTimer = null;
  }
  if (auditQrStream) {
    auditQrStream.getTracks().forEach((track) => track.stop());
    auditQrStream = null;
  }
  if ($("auditQrVideo")) {
    $("auditQrVideo").pause();
    $("auditQrVideo").srcObject = null;
  }
  if (hide && $("auditQrScanner")) {
    $("auditQrScanner").hidden = true;
  }
}

async function startHistoryScan() {
  prepareQrScanSound();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("historyQrScannerMessage").textContent = "Camera access is not available in this browser.";
    $("historyQrScanner").hidden = false;
    return;
  }

  try {
    $("historyQrScanner").hidden = false;
    $("historyQrScannerMessage").textContent = "Point the camera at the QR code.";
    if ("BarcodeDetector" in window) qrDetector = qrDetector || new BarcodeDetector({ formats: ["qr_code"] });
    historyQrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("historyQrVideo").srcObject = historyQrStream;
    await $("historyQrVideo").play();
    historyQrScanTimer = window.setInterval(scanHistoryFrame, 450);
  } catch (error) {
    $("historyQrScannerMessage").textContent = "Camera permission was not granted.";
    stopHistoryScan(false);
  }
}

async function scanHistoryFrame() {
  const video = $("historyQrVideo");
  if (!video.videoWidth) return;

  try {
    const codes = await detectQrCodes(video);
    if (!codes.length) return;
    const value = codes[0].rawValue || "";
    if (!value) return;
    $("historySearchInput").value = value.trim();
    state.historySearch = value.trim().toLowerCase();
    state.assetHistoryPage = 1;
    state.quantityHistoryPage = 1;
    renderAssetHistory();
    playQrScanSound();
    $("historyQrScannerMessage").textContent = "History search scanned.";
    stopHistoryScan();
  } catch {
    $("historyQrScannerMessage").textContent = "Could not read that QR code yet.";
  }
}

function stopHistoryScan(hide = true) {
  if (historyQrScanTimer) {
    window.clearInterval(historyQrScanTimer);
    historyQrScanTimer = null;
  }
  if (historyQrStream) {
    historyQrStream.getTracks().forEach((track) => track.stop());
    historyQrStream = null;
  }
  if ($("historyQrVideo")) {
    $("historyQrVideo").pause();
    $("historyQrVideo").srcObject = null;
  }
  if (hide && $("historyQrScanner")) {
    $("historyQrScanner").hidden = true;
  }
}

async function startLookupScan(target = "search") {
  prepareQrScanSound();
  lookupScanTarget = target;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("lookupQrScannerMessage").textContent = "Camera access is not available in this browser.";
    $("lookupQrScanner").hidden = false;
    return;
  }

  try {
    $("lookupQrScanner").hidden = false;
    $("lookupQrScannerMessage").textContent = "Point the camera at the QR code.";
    if ("BarcodeDetector" in window) qrDetector = qrDetector || new BarcodeDetector({ formats: ["qr_code"] });
    lookupQrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("lookupQrVideo").srcObject = lookupQrStream;
    await $("lookupQrVideo").play();
    lookupQrScanTimer = window.setInterval(scanLookupFrame, 450);
  } catch (error) {
    $("lookupQrScannerMessage").textContent = "Camera permission was not granted.";
    stopLookupScan(false);
  }
}

async function scanLookupFrame() {
  const video = $("lookupQrVideo");
  if (!video.videoWidth) return;

  try {
    const codes = await detectQrCodes(video);
    if (!codes.length) return;
    const value = (codes[0].rawValue || "").trim();
    if (!value) return;
    if (lookupScanTarget === "qr") {
      $("lookupQrInput").value = value;
    } else {
      $("lookupSearchInput").value = value;
      handleAssetLookup();
    }
    playQrScanSound();
    $("lookupQrScannerMessage").textContent = "Code scanned.";
    stopLookupScan();
  } catch {
    $("lookupQrScannerMessage").textContent = "Could not read that QR code yet.";
  }
}

function stopLookupScan(hide = true) {
  if (lookupQrScanTimer) {
    window.clearInterval(lookupQrScanTimer);
    lookupQrScanTimer = null;
  }
  if (lookupQrStream) {
    lookupQrStream.getTracks().forEach((track) => track.stop());
    lookupQrStream = null;
  }
  if ($("lookupQrVideo")) {
    $("lookupQrVideo").pause();
    $("lookupQrVideo").srcObject = null;
  }
  if (hide && $("lookupQrScanner")) {
    $("lookupQrScanner").hidden = true;
  }
}

async function startInventoryScan(target = "search") {
  prepareQrScanSound();
  inventoryScanTarget = target;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("inventoryQrScannerMessage").textContent = "Camera access is not available in this browser.";
    $("inventoryQrScanner").hidden = false;
    return;
  }

  try {
    $("inventoryQrScanner").hidden = false;
    $("inventoryQrScannerMessage").textContent = "Point the camera at the QR code.";
    if ("BarcodeDetector" in window) qrDetector = qrDetector || new BarcodeDetector({ formats: ["qr_code"] });
    inventoryQrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    $("inventoryQrVideo").srcObject = inventoryQrStream;
    await $("inventoryQrVideo").play();
    inventoryQrScanTimer = window.setInterval(scanInventoryFrame, 450);
  } catch (error) {
    $("inventoryQrScannerMessage").textContent = "Camera permission was not granted.";
    stopInventoryScan(false);
  }
}

async function scanInventoryFrame() {
  const video = $("inventoryQrVideo");
  if (!video.videoWidth) return;

  try {
    const codes = await detectQrCodes(video);
    if (!codes.length) return;
    const value = (codes[0].rawValue || "").trim();
    if (!value) return;
    if (inventoryScanTarget === "qr") {
      $("inventoryQrInput").value = value;
    } else {
      $("inventorySearchInput").value = value;
      handleInventoryLookup();
    }
    playQrScanSound();
    $("inventoryQrScannerMessage").textContent = "Code scanned.";
    stopInventoryScan();
  } catch {
    $("inventoryQrScannerMessage").textContent = "Could not read that QR code yet.";
  }
}

function stopInventoryScan(hide = true) {
  if (inventoryQrScanTimer) {
    window.clearInterval(inventoryQrScanTimer);
    inventoryQrScanTimer = null;
  }
  if (inventoryQrStream) {
    inventoryQrStream.getTracks().forEach((track) => track.stop());
    inventoryQrStream = null;
  }
  if ($("inventoryQrVideo")) {
    $("inventoryQrVideo").pause();
    $("inventoryQrVideo").srcObject = null;
  }
  if (hide && $("inventoryQrScanner")) {
    $("inventoryQrScanner").hidden = true;
  }
}

function findAssetByLookup(value) {
  return findAssetsByLookup(value)[0] || null;
}

function findRegisteredAsset(item) {
  if (!item) return null;
  if (Array.isArray(item.photos)) return item;

  const equipmentId = String(item.equipmentId || "").trim();
  if (equipmentId) {
    const byId = state.equipment.find((record) => String(record.id) === equipmentId);
    if (byId) return byId;
  }

  const values = [item.assetNumber, item.equipmentName, item.assetTag]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return state.equipment.find((record) => (
    values.includes(String(record.id || "").trim().toLowerCase()) ||
    values.includes(String(record.name || "").trim().toLowerCase()) ||
    values.includes(String(record.assetTag || "").trim().toLowerCase())
  )) || null;
}

function assetPictureLinkHtml(item) {
  const record = findRegisteredAsset(item);
  const hasPicture = record && (record.hasPicture || (Array.isArray(record.photos) && record.photos.some((photo) => photo && photo.dataUrl)));
  if (!hasPicture) return `<span class="no-picture">No picture</span>`;
  return `<a class="text-link asset-picture-link" href="#" data-asset-id="${escapeHtml(record.id)}">Open picture</a>`;
}

async function loadAssetPhotos(record) {
  if (!record || !record.hasPicture || (record.photos || []).some((photo) => photo && photo.dataUrl)) return record?.photos || [];
  const result = await api(`/api/equipment-photos/${encodeURIComponent(record.id)}`);
  record.photos = Array.isArray(result.photos) ? result.photos : [];
  return record.photos;
}

async function openAssetPicture(assetId) {
  const record = state.equipment.find((item) => String(item.id) === String(assetId));
  if (!record) return;
  try {
    await loadAssetPhotos(record);
  } catch (error) {
    alert(error.message || "Could not load the asset picture.");
    return;
  }
  const photo = record && Array.isArray(record.photos) ? record.photos.find((item) => item && item.dataUrl) : null;
  if (!photo) return;
  $("assetPictureViewerTitle").textContent = `${record.name || "Asset"} picture`;
  $("assetPictureViewerImage").src = photo.dataUrl;
  $("assetPictureViewerImage").alt = photo.name || `${record.name || "Asset"} picture`;
  $("assetPictureViewer").hidden = false;
}

function closeAssetPictureViewer() {
  $("assetPictureViewer").hidden = true;
  $("assetPictureViewerImage").removeAttribute("src");
}

function findAssetsByLookup(value) {
  const search = String(value || "").trim().toLowerCase();
  if (!search) return [];
  return state.equipment.filter((item) => {
    return [item.id, item.name, item.assetTag]
      .map((field) => String(field || "").trim().toLowerCase())
      .includes(search);
  }).sort((a, b) => String(a.category || "").localeCompare(String(b.category || "")));
}

function handleAssetLookup() {
  const records = findAssetsByLookup($("lookupSearchInput").value);
  const masterRecords = findMasterCodesByLookup($("lookupSearchInput").value);
  renderLookupResult(records, masterRecords);
}

function findMasterCodesByLookup(value) {
  const search = String(value || "").trim().replace(/^master\s*#?\s*/i, "").toLowerCase();
  if (!search) return [];
  return state.quantityAssets.filter((item) => String(item.masterNumber || "").trim().toLowerCase() === search);
}

function handleInventoryLookup() {
  const records = findAssetsByLookup($("inventorySearchInput").value);
  if (records.length) markInventoryRecords(records);
  renderInventoryResult(records);
}

function assetLookupCardsHtml(record) {
  return `
    <article>
      <span>Equipment number</span>
      <strong>${escapeHtml(record.name || record.id)}</strong>
    </article>
    <article>
      <span>QR / Asset tag</span>
      <strong>${escapeHtml(record.assetTag || "Not assigned")}</strong>
    </article>
    <article>
      <span>Category</span>
      <strong>${escapeHtml(record.category || "Not set")}</strong>
    </article>
    <article>
      <span>Assigned to Job</span>
      <strong>${escapeHtml(record.assignedTo || "Available")}</strong>
    </article>
    <article>
      <span>Picture</span>
      <strong>${assetPictureLinkHtml(record)}</strong>
    </article>
  `;
}

function lookupRecordHtml(record, actions = [], warning = "") {
  if (typeof actions === "string") actions = actions ? [{ label: actions, action: "select" }] : [];
  return `
    <section class="lookup-record">
      <div class="lookup-result">
        ${assetLookupCardsHtml(record)}
      </div>
      ${warning}
      ${actions.length ? `<div class="lookup-actions">${actions.map((item) => (
        `<button class="secondary lookup-action-btn" type="button" data-action="${escapeHtml(item.action)}" data-asset-id="${escapeHtml(record.id)}">${escapeHtml(item.label)}</button>`
      )).join("")}</div>` : ""}
    </section>
  `;
}

function masterLookupRecordHtml(record) {
  const available = Number(record.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(record.masterNumber);
  return `
    <section class="lookup-record">
      <div class="lookup-result">
        <article><span>Master code</span><strong>${escapeHtml(record.masterNumber)}</strong></article>
        <article><span>Categories</span><strong>${escapeHtml(getQuantityAssetCategoryText(record))}</strong></article>
        <article><span>Available quantity</span><strong>${available}</strong></article>
      </div>
      <div class="lookup-actions">
        <button class="secondary lookup-master-action-btn" type="button" data-master-number="${escapeHtml(record.masterNumber)}">Assign quantity to job</button>
      </div>
    </section>
  `;
}

function renderLookupResult(records, masterRecords = []) {
  if (!Array.isArray(records)) records = records ? [records] : [];
  if (!Array.isArray(masterRecords)) masterRecords = masterRecords ? [masterRecords] : [];
  const result = $("lookupResult");
  const assignPanel = $("lookupQrAssignPanel");
  const jobPanel = $("lookupJobAssignPanel");
  $("lookupMessage").textContent = "";
  state.lookupAssetId = "";
  state.lookupMasterNumber = "";
  state.lookupAssignmentType = "";
  result.replaceChildren();
  result.hidden = records.length === 0 && masterRecords.length === 0;
  assignPanel.hidden = true;
  jobPanel.hidden = true;
  $("lookupQrInput").value = "";
  $("lookupMasterQuantity").value = "";

  if (!records.length && !masterRecords.length) {
    $("lookupMessage").textContent = $("lookupSearchInput").value.trim()
      ? "No asset or master code found with that value."
      : "Enter an asset number, master code, or scan a QR code.";
    return;
  }

  result.innerHTML = records.map((record) => {
    const actions = [{ label: "Assign this asset to a job", action: "assign-job" }];
    if (!record.assetTag) actions.push({ label: "Add QR to this asset", action: "add-qr" });
    const warning = isRealJobName(record.assignedTo)
      ? `<p class="lookup-warning">Warning: this asset is currently assigned to ${escapeHtml(record.assignedTo)}, not ${escapeHtml(YARD_JOB_NAME)}.</p>`
      : "";
    return lookupRecordHtml(record, actions, warning);
  }).join("") + masterRecords.map(masterLookupRecordHtml).join("");

  result.querySelectorAll(".lookup-action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (!canEdit()) {
        $("lookupMessage").textContent = "Sign in as Admin or Manager to change assignments or QR codes.";
        return;
      }
      state.lookupAssetId = button.dataset.assetId;
      state.lookupMasterNumber = "";
      const record = state.equipment.find((item) => item.id === state.lookupAssetId);
      if (button.dataset.action === "assign-job") {
        state.lookupAssignmentType = "asset";
        assignPanel.hidden = true;
        prepareLookupJobAssignment(record);
        return;
      }
      assignPanel.hidden = false;
      jobPanel.hidden = true;
      $("lookupQrInput").value = "";
      $("lookupMessage").textContent = "Scan or type the QR code for the selected asset.";
    });
  });

  result.querySelectorAll(".lookup-master-action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (!canEdit()) {
        $("lookupMessage").textContent = "Sign in as Admin or Manager to assign master quantities.";
        return;
      }
      state.lookupAssignmentType = "master";
      state.lookupAssetId = "";
      state.lookupMasterNumber = button.dataset.masterNumber;
      assignPanel.hidden = true;
      prepareLookupMasterAssignment(state.lookupMasterNumber);
    });
  });

  const missingQr = records.filter((record) => !record.assetTag).length;
  if (missingQr) {
    $("lookupMessage").textContent = `Found ${records.length} asset record(s) and ${masterRecords.length} master code(s). ${missingQr} do not have QR codes.`;
  } else {
    $("lookupMessage").textContent = `Found ${records.length} asset record(s) and ${masterRecords.length} master code(s).`;
  }
}

function renderLookupJobOptions({ includeYard = false, selectedValue = "" } = {}) {
  const select = $("lookupJobSelect");
  select.replaceChildren(new Option("Select", ""));
  if (includeYard) select.add(new Option(YARD_JOB_NAME, YARD_JOB_NAME));
  state.jobs.forEach((job) => {
    if (!job.name || isYardJobName(job.name) || isAvailableJobName(job.name)) return;
    select.add(new Option(job.name, job.name));
  });
  if (selectedValue && ![...select.options].some((option) => option.value === selectedValue)) {
    select.add(new Option(selectedValue, selectedValue));
  }
  select.value = selectedValue;
}

function prepareLookupJobAssignment(record) {
  const panel = $("lookupJobAssignPanel");
  $("lookupAssignTitle").textContent = `Assign asset ${record?.name || record?.id || ""} to a job`;
  $("lookupMasterQuantityLabel").hidden = true;
  const warning = $("lookupAssignmentWarning");
  const hasOtherJob = record && isRealJobName(record.assignedTo);
  warning.hidden = !hasOtherJob;
  warning.textContent = hasOtherJob
    ? `Warning: this asset is currently assigned to ${record.assignedTo}, not ${YARD_JOB_NAME}. Saving will reassign it.`
    : "";
  renderLookupJobOptions({ includeYard: true, selectedValue: record?.assignedTo || YARD_JOB_NAME });
  panel.hidden = false;
  $("lookupMessage").textContent = "Choose the destination job for this asset.";
}

function prepareLookupMasterAssignment(masterNumber) {
  const panel = $("lookupJobAssignPanel");
  $("lookupAssignTitle").textContent = `Assign master code ${masterNumber} to a job`;
  $("lookupMasterQuantityLabel").hidden = false;
  $("lookupAssignmentWarning").hidden = true;
  renderLookupJobOptions();
  panel.hidden = false;
  $("lookupMessage").textContent = "Enter the quantity and choose its destination job.";
}

async function handleLookupJobSave() {
  if (!canEdit()) return;
  const jobName = $("lookupJobSelect").value;
  if (!jobName) {
    $("lookupMessage").textContent = "Select a job.";
    return;
  }

  if (state.lookupAssignmentType === "asset") {
    const record = state.equipment.find((item) => item.id === state.lookupAssetId);
    if (!record) {
      $("lookupMessage").textContent = "Find and select an asset first.";
      return;
    }
    if (isRealJobName(record.assignedTo) && record.assignedTo !== jobName && !confirm(`This asset is assigned to ${record.assignedTo}. Reassign it to ${jobName}?`)) return;
    try {
      await api("/api/equipment", {
        method: "POST",
        body: JSON.stringify({
          id: record.id, name: record.name, assetTag: record.assetTag, category: record.category,
          assignedTo: jobName, latitude: "", longitude: "",
          notes: record.notes, photos: record.photos || []
        })
      });
      await Promise.all([loadEquipment(), loadAssetHistory()]);
      renderLookupResult(findAssetsByLookup($("lookupSearchInput").value), findMasterCodesByLookup($("lookupSearchInput").value));
      $("lookupMessage").textContent = `Asset assigned to ${jobName}. Saved coordinates were removed.`;
    } catch (error) {
      $("lookupMessage").textContent = error.message || "Could not save the asset assignment.";
    }
    return;
  }

  if (state.lookupAssignmentType === "master") {
    const masterNumber = state.lookupMasterNumber;
    const quantity = Number($("lookupMasterQuantity").value || 0);
    if (!masterNumber || quantity <= 0) {
      $("lookupMessage").textContent = "Enter a quantity greater than zero.";
      return;
    }
    try {
      await api("/api/quantity-assets/adjust", {
        method: "POST",
        body: JSON.stringify({
          category: masterNumber,
          masterNumber,
          action: "Use",
          quantity,
          jobName
        })
      });
      await Promise.all([loadQuantityAssets(), loadQuantityAssetHistory()]);
      renderLookupResult(findAssetsByLookup($("lookupSearchInput").value), findMasterCodesByLookup($("lookupSearchInput").value));
      $("lookupMessage").textContent = `${quantity} from master code ${masterNumber} assigned to ${jobName}.`;
    } catch (error) {
      $("lookupMessage").textContent = error.message || "Could not save the master-code assignment.";
    }
  }
}

function renderInventoryResult(records) {
  if (!Array.isArray(records)) records = records ? [records] : [];
  const result = $("inventoryResult");
  const assignPanel = $("inventoryAssignPanel");
  const qrPanel = $("inventoryQrAssignPanel");
  $("inventoryMessage").textContent = "";
  state.inventoryAssetId = "";
  result.replaceChildren();
  result.hidden = records.length === 0;
  assignPanel.hidden = true;
  qrPanel.hidden = true;
  $("inventoryQrInput").value = "";

  if (!records.length) {
    $("inventoryMessage").textContent = $("inventorySearchInput").value.trim()
      ? "No asset found with that number or QR code."
      : "Enter an asset number or scan a QR code.";
    return;
  }

  result.innerHTML = records.map((record) => {
    const actions = [{ label: "Assign this asset", action: "assign-job" }];
    if (!record.assetTag) actions.push({ label: "Add QR", action: "add-qr" });
    return lookupRecordHtml(record, actions);
  }).join("");
  result.querySelectorAll(".lookup-action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const record = state.equipment.find((item) => item.id === button.dataset.assetId);
      if (!canEdit()) {
        $("inventoryMessage").textContent = "Sign in as Admin or Manager to change inventory.";
        return;
      }
      state.inventoryAssetId = button.dataset.assetId;
      if (button.dataset.action === "add-qr") {
        assignPanel.hidden = true;
        $("inventoryQrAssignPanel").hidden = false;
        $("inventoryQrInput").value = "";
        $("inventoryMessage").textContent = "Scan or type the QR code for the selected asset.";
        return;
      }
      $("inventoryQrAssignPanel").hidden = true;
      renderInventoryJobOptions(record ? record.assignedTo || "" : "");
      assignPanel.hidden = false;
      $("inventoryMessage").textContent = "Choose the job for the selected asset.";
    });
  });
  $("inventoryMessage").textContent = `Found ${records.length} asset record(s).`;
}

async function handleInventoryJobSave() {
  if (!canEdit()) return;
  const record = state.equipment.find((item) => item.id === state.inventoryAssetId);
  if (!record) {
    $("inventoryMessage").textContent = "Find an asset first.";
    return;
  }

  const assignedTo = $("inventoryJobSelect").value;
  try {
    await api("/api/equipment", {
      method: "POST",
      body: JSON.stringify({
        id: record.id,
        name: record.name,
        assetTag: record.assetTag,
        category: record.category,
        assignedTo,
        latitude: record.latitude,
        longitude: record.longitude,
        notes: record.notes,
        photos: record.photos || []
      })
    });
    await Promise.all([loadEquipment(), loadAssetHistory()]);
    const updated = state.equipment.find((item) => item.id === record.id);
    if ($("inventorySearchInput").value.trim()) $("inventorySearchInput").value = updated ? (updated.name || updated.id) : $("inventorySearchInput").value;
    renderInventoryResult(updated);
    $("inventoryMessage").textContent = assignedTo
      ? `Asset assigned to ${assignedTo}.`
      : "Asset marked Available.";
  } catch (error) {
    $("inventoryMessage").textContent = error.message || "Could not save assignment.";
  }
}

async function handleInventoryQrSave() {
  if (!canEdit()) {
    $("inventoryMessage").textContent = "Sign in as Admin or Manager to add QR codes.";
    return;
  }
  const record = state.equipment.find((item) => item.id === state.inventoryAssetId);
  const qrValue = $("inventoryQrInput").value.trim();
  if (!record) {
    $("inventoryMessage").textContent = "Find and select an asset first.";
    return;
  }
  if (record.assetTag) {
    $("inventoryMessage").textContent = "This asset already has a QR code assigned.";
    return;
  }
  if (!qrValue) {
    $("inventoryMessage").textContent = "Scan or type the QR code first.";
    return;
  }
  const duplicateQr = state.equipment.find((item) => (
    item.id !== record.id &&
    String(item.assetTag || "").trim().toLowerCase() === qrValue.toLowerCase()
  ));
  if (duplicateQr) {
    $("inventoryMessage").textContent = `That QR code is already assigned to ${duplicateQr.name || duplicateQr.id}.`;
    return;
  }

  try {
    await api("/api/equipment", {
      method: "POST",
      body: JSON.stringify({
        id: record.id,
        name: record.name,
        assetTag: qrValue,
        category: record.category,
        assignedTo: record.assignedTo,
        latitude: record.latitude,
        longitude: record.longitude,
        notes: record.notes,
        photos: record.photos || []
      })
    });
    await loadEquipment();
    const updated = state.equipment.find((item) => item.id === record.id);
    renderInventoryResult(updated);
    $("inventorySearchInput").value = updated ? (updated.name || updated.id) : $("inventorySearchInput").value;
    $("inventoryMessage").textContent = "QR code assigned to asset.";
  } catch (error) {
    $("inventoryMessage").textContent = error.message || "Could not save QR code.";
  }
}

function updateInventoryMasterJobVisibility() {
  const useJob = $("inventoryMasterAction").value === "Use";
  $("inventoryMasterJobLabel").hidden = !useJob;
  $("inventoryMasterJob").required = useJob;
}

async function handleInventoryMasterSave() {
  if (!canEdit()) {
    $("inventoryMasterMessage").textContent = "Sign in as Admin or Manager to change master quantities.";
    return;
  }

  const masterNumber = $("inventoryMasterNumber").value;
  const action = $("inventoryMasterAction").value;
  const quantity = $("inventoryMasterQuantity").value;
  const jobName = action === "Add" ? YARD_JOB_NAME : $("inventoryMasterJob").value;
  $("inventoryMasterMessage").textContent = "";

  if (!masterNumber) {
    $("inventoryMasterMessage").textContent = "Select a master number.";
    return;
  }
  if (!quantity || Number(quantity) <= 0) {
    $("inventoryMasterMessage").textContent = "Enter a quantity greater than zero.";
    return;
  }
  if (action === "Use" && (!jobName || isYardJobName(jobName) || isAvailableJobName(jobName))) {
    $("inventoryMasterMessage").textContent = "Select a job to reduce quantity.";
    return;
  }

  try {
    await api("/api/quantity-assets/adjust", {
      method: "POST",
      body: JSON.stringify({
        category: masterNumber,
        masterNumber,
        action,
        quantity,
        jobName
      })
    });
    $("inventoryMasterMessage").textContent = action === "Add" ? "Master quantity added to Big Spring Yard." : "Master quantity reduced.";
    $("inventoryMasterQuantity").value = "";
    await Promise.all([loadQuantityAssets(), loadQuantityAssetHistory()]);
    renderInventoryMasterOptions(masterNumber);
  } catch (error) {
    $("inventoryMasterMessage").textContent = error.message || "Could not save master quantity.";
  }
}

async function handleLookupQrSave() {
  if (!canEdit()) return;
  const record = state.equipment.find((item) => item.id === state.lookupAssetId);
  const qrValue = $("lookupQrInput").value.trim();
  if (!record) {
    $("lookupMessage").textContent = "Find an asset first.";
    return;
  }
  if (record.assetTag) {
    $("lookupMessage").textContent = "This asset already has a QR code assigned.";
    renderLookupResult(record);
    return;
  }
  if (!qrValue) {
    $("lookupMessage").textContent = "Scan or type the QR code first.";
    return;
  }
  const duplicateQr = state.equipment.find((item) => (
    item.id !== record.id &&
    String(item.assetTag || "").trim().toLowerCase() === qrValue.toLowerCase()
  ));
  if (duplicateQr) {
    $("lookupMessage").textContent = `That QR code is already assigned to ${duplicateQr.name || duplicateQr.id}.`;
    return;
  }

  try {
    await api("/api/equipment", {
      method: "POST",
      body: JSON.stringify({
        id: record.id,
        name: record.name,
        assetTag: qrValue,
        category: record.category,
        assignedTo: record.assignedTo,
        latitude: record.latitude,
        longitude: record.longitude,
        notes: record.notes,
        photos: record.photos || []
      })
    });
    await loadEquipment();
    const updated = findAssetByLookup(record.name) || findAssetByLookup(qrValue);
    $("lookupSearchInput").value = record.name;
    renderLookupResult(updated);
    $("lookupMessage").textContent = "QR code assigned to asset number.";
  } catch (error) {
    $("lookupMessage").textContent = error.message || "Could not save QR code.";
  }
}

async function editRecord(id) {
  const record = state.equipment.find((item) => item.id === id);
  if (!record) return;

  try {
    await loadAssetPhotos(record);
  } catch (error) {
    alert(error.message || "Could not load the asset pictures.");
    return;
  }

  $("recordId").value = record.id;
  $("equipmentName").value = record.name;
  $("assetTag").value = record.assetTag;
  renderCategoryOptions(record.category);
  renderJobOptions(record.assignedTo);
  $("latitude").value = record.latitude;
  $("longitude").value = record.longitude;
  $("notes").value = record.notes;
  currentAssetPhotos = Array.isArray(record.photos) ? [...record.photos] : [];
  renderAssetPhotoPreview();
  $("formTitle").textContent = canEdit() ? "Edit equipment" : "Equipment details";
  updateMapLink();
  setPage("register");
}

async function deleteRecord(id) {
  if (!canDelete()) return;
  const record = state.equipment.find((item) => item.id === id);
  if (!record) return;
  const confirmed = confirm(`Delete ${record.name} (${record.assetTag})?`);
  if (!confirmed) return;

  try {
    await api(`/api/equipment/${encodeURIComponent(id)}`, { method: "DELETE" });
    await Promise.all([loadEquipment(), loadAssetHistory()]);
    resetForm();
  } catch (error) {
    if (isNetworkError(error)) {
      deleteEquipmentOffline(id);
      resetForm();
      return;
    }
    alert(error.message || "Could not delete equipment.");
  }
}

function captureLocation() {
  captureCoordinates({
    latitudeId: "latitude",
    longitudeId: "longitude",
    buttonId: "useLocationBtn",
    messageId: "locationMessage",
    progressId: "locationProgress",
    onUpdate: updateMapLink
  });
}

function captureAuditLocation() {
  captureCoordinates({
    latitudeId: "auditLatitude",
    longitudeId: "auditLongitude",
    buttonId: "useAuditLocationBtn",
    messageId: "auditLocationMessage",
    progressId: "auditLocationProgress",
    onUpdate: updateAuditMapLink
  });
}

function startGpsProgress(progressId) {
  const element = $(progressId);
  const startedAt = Date.now();
  element.hidden = false;
  element.classList.remove("complete", "stopped");
  element.querySelector("i").style.width = "6%";
  element.setAttribute("aria-valuenow", "6");
  const interval = window.setInterval(() => {
    const elapsedRatio = Math.min(1, (Date.now() - startedAt) / GPS_TIMEOUT_MS);
    const value = Math.round(6 + elapsedRatio * 86);
    element.querySelector("i").style.width = `${value}%`;
    element.setAttribute("aria-valuenow", String(value));
  }, 500);
  return { element, interval };
}

function finishGpsProgress(progress, successful) {
  if (!progress) return;
  window.clearInterval(progress.interval);
  progress.element.classList.add(successful ? "complete" : "stopped");
  if (successful) {
    progress.element.querySelector("i").style.width = "100%";
    progress.element.setAttribute("aria-valuenow", "100");
  }
  window.setTimeout(() => {
    progress.element.hidden = true;
  }, successful ? 900 : 1800);
}

function captureCoordinates({ latitudeId, longitudeId, buttonId, messageId, progressId, onUpdate }) {
  $(messageId).textContent = "";
  const nativeGeolocation = window.Capacitor?.isNativePlatform?.()
    ? window.Capacitor?.Plugins?.Geolocation
    : null;

  if (!nativeGeolocation && !window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    $(messageId).textContent = "GPS is blocked because this link is not secure. On this computer, open the app with 127.0.0.1, or enter latitude and longitude manually.";
    return;
  }

  if (!nativeGeolocation && !navigator.geolocation) {
    $(messageId).textContent = "This browser does not support location capture.";
    return;
  }

  $(buttonId).textContent = "Locating...";
  $(messageId).textContent = `Waiting for GPS accuracy within ${GPS_TARGET_ACCURACY_METERS} meters...`;
  const progress = startGpsProgress(progressId);
  let bestPosition = null;
  let completed = false;
  let watchId = null;
  const clearLocationWatch = () => {
    if (watchId === null) return;
    if (nativeGeolocation) {
      nativeGeolocation.clearWatch({ id: watchId }).catch(() => {});
    } else {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  };

  const finish = (position, label = "Location added") => {
    if (completed || !position) return;
    completed = true;
    clearLocationWatch();
    finishGpsProgress(progress, true);
    $(latitudeId).value = position.coords.latitude.toFixed(6);
    $(longitudeId).value = position.coords.longitude.toFixed(6);
    $(buttonId).textContent = "Use current location";
    const accuracy = Math.round(position.coords.accuracy);
    const accuracyNote = accuracy <= GPS_TARGET_ACCURACY_METERS
      ? `Accuracy about ${accuracy} meters.`
      : `Best accuracy available was about ${accuracy} meters.`;
    $(messageId).textContent = `${label}. ${accuracyNote}`;
    onUpdate();
  };

  const timer = window.setTimeout(() => {
    finish(bestPosition, bestPosition ? "Best location added" : "");
    if (!bestPosition) {
      completed = true;
      clearLocationWatch();
      finishGpsProgress(progress, false);
      $(buttonId).textContent = "Use current location";
      $(messageId).textContent = "GPS timed out. Try again outside or enter latitude and longitude manually.";
    }
  }, GPS_TIMEOUT_MS);

  const handlePosition = (position) => {
    if (!position || completed) return;
      if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
        bestPosition = position;
        $(messageId).textContent = `Improving GPS accuracy... currently about ${Math.round(position.coords.accuracy)} meters. Target is ${GPS_TARGET_ACCURACY_METERS} meters.`;
      }
      if (position.coords.accuracy <= GPS_TARGET_ACCURACY_METERS) {
        window.clearTimeout(timer);
        finish(position);
      }
  };
  const handleError = (error) => {
      if (completed) return;
      window.clearTimeout(timer);
      completed = true;
      clearLocationWatch();
      finishGpsProgress(progress, false);
      $(buttonId).textContent = "Use current location";
      $(messageId).textContent = locationErrorMessage(error);
  };
  const options = { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 };

  if (nativeGeolocation) {
    nativeGeolocation.requestPermissions()
      .then(() => nativeGeolocation.watchPosition(options, handlePosition))
      .then((id) => {
        watchId = id;
        if (completed) clearLocationWatch();
      })
      .catch(handleError);
  } else {
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, options);
  }
}

function locationErrorMessage(error) {
  const errorText = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if ((error && error.code === error.PERMISSION_DENIED) || errorText.includes("permission") || errorText.includes("denied")) {
    return "Location permission was denied. Allow location for Sunwave Tracker in the phone or browser settings, then try again.";
  }
  if (error && error.code === error.POSITION_UNAVAILABLE) {
    return "The device could not find GPS right now. Move outside or enter latitude and longitude manually.";
  }
  if (error && error.code === error.TIMEOUT) {
    return "GPS timed out. Try again with better signal or enter latitude and longitude manually.";
  }
  return "Location could not be captured. Enter latitude and longitude manually.";
}

function updateMapLink() {
  const lat = $("latitude").value.trim();
  const lng = $("longitude").value.trim();
  const link = $("mapLink");
  const valid = lat && lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));
  link.href = valid ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}` : "#";
  link.setAttribute("aria-disabled", String(!valid));
}

function updateAuditMapLink() {
  const lat = $("auditLatitude").value.trim();
  const lng = $("auditLongitude").value.trim();
  const link = $("auditMapLink");
  const valid = lat && lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));
  link.href = valid ? `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}` : "#";
  link.setAttribute("aria-disabled", String(!valid));
}

function renderStats() {
  const equipmentAvailable = state.equipment.filter((item) => item.status === "Available").length;
  const equipmentYardAssigned = state.equipment.filter((item) => isYardAssignment(item)).length;
  const equipmentJobAssigned = state.equipment.filter((item) => {
    const value = (item.assignedTo || "").trim();
    return value && !isYardAssignment(item) && !isAvailableAssignment(item);
  }).length;
  const masterAvailable = getMasterQuantityAvailable();
  const masterAssignedAvailable = getMasterQuantityAssignedToAvailable();
  const masterJobAssigned = getMasterQuantityAssignedToJobs();
  const masterYardAssigned = getMasterQuantityAssignedToYard();
  const availableCount = equipmentAvailable + masterAvailable + masterAssignedAvailable;
  const jobAssigned = equipmentJobAssigned + masterJobAssigned;
  const yardAssigned = equipmentYardAssigned + masterYardAssigned;
  const totalAssets = state.equipment.length + masterAvailable + masterAssignedAvailable + masterJobAssigned + masterYardAssigned;

  $("totalCount").textContent = totalAssets;
  $("availableCount").textContent = availableCount;
  $("jobAssignedCount").textContent = jobAssigned;
  $("masterJobAssignedCount").textContent = masterJobAssigned;
  $("yardAssignedCount").textContent = yardAssigned;
  renderPieChart(availableCount, jobAssigned, yardAssigned);
}

function getDashboardMasterQuantityRows() {
  const grouped = new Map();
  const addRow = (masterNumber, category, assignedTo, quantity) => {
    const numericQuantity = Number(quantity || 0);
    if (!numericQuantity) return;
    const key = `${assignedTo}||${masterNumber}||${category}`;
    const current = grouped.get(key) || {
      type: "Master quantity",
      number: masterNumber,
      category: category || "Master quantity",
      assignedTo,
      quantity: 0
    };
    current.quantity += numericQuantity;
    grouped.set(key, current);
  };

  state.quantityAssets.forEach((item) => {
    addRow(item.masterNumber, getQuantityAssetCategoryText(item), "Available", item.quantity);
  });
  state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item))
    .forEach((item) => addRow(
      item.masterNumber,
      item.category,
      isAvailableJobName(item.jobName) ? "Available" : item.jobName,
      item.quantity
    ));

  return [...grouped.values()].filter((item) => item.quantity > 0);
}

function showDashboardCounterDetails(counterType) {
  const equipmentRows = state.equipment.map((item) => ({
    type: "Asset",
    number: item.name,
    category: item.category || "Uncategorized",
    assignedTo: item.assignedTo || "Available",
    quantity: 1,
    item
  }));
  const masterRows = getDashboardMasterQuantityRows();
  const definitions = {
    total: {
      title: "Total assets + master quantities",
      equipment: () => true,
      master: () => true
    },
    available: {
      title: "Available assets + master quantities",
      equipment: (row) => row.item.status === "Available",
      master: (row) => isAvailableJobName(row.assignedTo)
    },
    job: {
      title: "Assets and master quantities assigned to jobs",
      equipment: (row) => isRealJobName(row.item.assignedTo),
      master: (row) => isRealJobName(row.assignedTo)
    },
    "master-job": {
      title: "Master quantities assigned to jobs",
      equipment: () => false,
      master: (row) => isRealJobName(row.assignedTo)
    },
    yard: {
      title: "Assets and master quantities on Big Spring Yard",
      equipment: (row) => isYardAssignment(row.item),
      master: (row) => isYardJobName(row.assignedTo)
    }
  };
  const definition = definitions[counterType] || definitions.total;
  const rows = [
    ...equipmentRows.filter(definition.equipment),
    ...masterRows.filter(definition.master)
  ].sort((a, b) => String(a.assignedTo).localeCompare(String(b.assignedTo)) || String(a.number).localeCompare(String(b.number)));
  const tbody = $("dashboardCounterDetailsTable");
  tbody.replaceChildren();
  rows.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.type)}</td>
      <td><strong>${escapeHtml(item.type === "Master quantity" ? `Master #${item.number}` : item.number)}</strong></td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.assignedTo)}</td>
      <td>${Number(item.quantity)}</td>
    `;
    tbody.append(row);
  });
  $("dashboardCounterDetailsTitle").textContent = definition.title;
  $("dashboardCounterDetailsEmpty").hidden = rows.length > 0;
  $("dashboardCounterDetails").hidden = false;
  document.querySelectorAll("[data-dashboard-counter]").forEach((counter) => {
    counter.classList.toggle("selected", counter.dataset.dashboardCounter === counterType);
  });
  $("dashboardCounterDetails").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function getMasterQuantityAvailable() {
  return state.quantityAssets.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function getMasterQuantityAssignedToJobs() {
  return state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item) && isRealJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function getMasterQuantityAssignedToAvailable() {
  return state.quantityAssetHistory
    .filter((item) => item.changeType === "Use" && isAvailableJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function getMasterQuantityAssignedToYard() {
  return state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item) && isYardJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function isYardJobName(value = "") {
  return ["yard", YARD_JOB_NAME.toLowerCase()].includes(String(value).trim().toLowerCase());
}

function isAvailableJobName(value = "") {
  return !String(value || "").trim() || String(value).trim().toLowerCase() === "available";
}

function isRealJobName(value = "") {
  const trimmed = String(value || "").trim();
  return Boolean(trimmed) && !isYardJobName(trimmed) && !isAvailableJobName(trimmed);
}

function isAssignedMasterQuantityChange(item) {
  return item.changeType === "Use" || (item.changeType === "Add" && Boolean(String(item.jobName || "").trim()));
}

function isYardAssignment(item) {
  return isYardJobName(item.assignedTo);
}

function isAvailableAssignment(item) {
  return !(item.assignedTo || "").trim() || (item.assignedTo || "").trim().toLowerCase() === "available";
}

function getYardEquipment() {
  return state.equipment
    .filter((item) => isYardAssignment(item))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getYardQuantityAssets() {
  const grouped = new Map();
  state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item) && isYardJobName(item.jobName))
    .forEach((item) => {
      const key = `${item.masterNumber}||${item.category || "Master quantity"}`;
      const current = grouped.get(key) || {
        masterNumber: item.masterNumber,
        category: item.category || "Master quantity",
        quantity: 0
      };
      current.quantity += Number(item.quantity || 0);
      grouped.set(key, current);
    });
  return [...grouped.values()]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => String(a.masterNumber).localeCompare(String(b.masterNumber)));
}

function ensureInventoryBaseline() {
  if (state.inventoryBaselineReady) return;
  inventoryBaselineYardAssetIds.clear();
  getYardEquipment().forEach((item) => inventoryBaselineYardAssetIds.add(item.id));
  state.inventoryBaselineReady = true;
}

function markInventoryRecords(records) {
  ensureInventoryBaseline();
  records.forEach((record) => {
    inventoryScannedAssetIds.add(record.id);
    if (!inventoryBaselineYardAssetIds.has(record.id)) {
      inventoryUnexpectedAssetIds.add(record.id);
    }
  });
  renderInventoryYardChecklist();
}

function inventoryAssetLabel(item) {
  return `${item.name || item.id} - ${item.category || "Uncategorized"}`;
}

function renderInventoryYardChecklist() {
  const assetList = $("inventoryYardAssetList");
  const masterList = $("inventoryYardMasterList");
  if (!assetList || !masterList) return;

  ensureInventoryBaseline();
  const yardAssets = getYardEquipment();
  const yardMasters = getYardQuantityAssets();
  const unexpectedAssets = state.equipment
    .filter((item) => inventoryUnexpectedAssetIds.has(item.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  const foundCount = yardAssets.filter((item) => inventoryScannedAssetIds.has(item.id)).length;
  const missingCount = yardAssets.length - foundCount;
  const masterTotal = yardMasters.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  $("inventoryFoundCount").textContent = foundCount;
  $("inventoryMissingCount").textContent = missingCount;
  $("inventoryUnexpectedCount").textContent = unexpectedAssets.length;
  $("inventoryMasterYardCount").textContent = masterTotal;

  assetList.replaceChildren();
  if (!yardAssets.length) {
    assetList.innerHTML = `<p class="empty-state">No assets are assigned to Big Spring Yard.</p>`;
  } else {
    yardAssets.forEach((item) => {
      const found = inventoryScannedAssetIds.has(item.id);
      const row = document.createElement("article");
      row.className = `inventory-check-item${found ? " found" : ""}`;
      row.innerHTML = `
        <span class="inventory-checkmark">${found ? "✓" : ""}</span>
        <div>
          <strong>${escapeHtml(inventoryAssetLabel(item))}</strong>
          <small>${escapeHtml(item.assetTag ? `QR ${item.assetTag}` : "No QR assigned")}</small>
          <small>${assetPictureLinkHtml(item)}</small>
        </div>
      `;
      assetList.append(row);
    });
  }

  masterList.replaceChildren();
  if (!yardMasters.length) {
    masterList.innerHTML = `<p class="empty-state">No master quantities are assigned to Big Spring Yard.</p>`;
  } else {
    yardMasters.forEach((item) => {
      const row = document.createElement("article");
      row.className = "inventory-check-item master";
      row.innerHTML = `
        <span class="inventory-checkmark">#</span>
        <div>
          <strong>Master #${escapeHtml(item.masterNumber)}</strong>
          <small>${escapeHtml(item.category)}: ${Number(item.quantity || 0)}</small>
        </div>
      `;
      masterList.append(row);
    });
  }

  const unexpectedPanel = $("inventoryUnexpectedPanel");
  const unexpectedList = $("inventoryUnexpectedList");
  unexpectedPanel.hidden = unexpectedAssets.length === 0;
  unexpectedList.replaceChildren();
  unexpectedAssets.forEach((item) => {
    const row = document.createElement("article");
    row.className = "inventory-check-item warning";
    row.innerHTML = `
      <span class="inventory-checkmark">!</span>
      <div>
        <strong>${escapeHtml(inventoryAssetLabel(item))}</strong>
        <small>Was assigned to ${escapeHtml(item.assignedTo || "Available")} before inventory.</small>
        <small>${assetPictureLinkHtml(item)}</small>
      </div>
    `;
    unexpectedList.append(row);
  });
}

function yardInventorySnapshotText() {
  ensureInventoryBaseline();
  const yardAssets = getYardEquipment();
  const yardMasters = getYardQuantityAssets();
  const unexpectedAssets = state.equipment
    .filter((item) => inventoryUnexpectedAssetIds.has(item.id))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  const missingAssets = yardAssets.filter((item) => !inventoryScannedAssetIds.has(item.id));
  const foundAssets = yardAssets.filter((item) => inventoryScannedAssetIds.has(item.id));
  const masterTotal = yardMasters.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const date = new Date().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const lines = [
    "Sunwave Tracker Yard Inventory",
    date,
    `Found yard assets: ${foundAssets.length}`,
    `Not scanned yard assets: ${missingAssets.length}`,
    `Scanned not in Yard before inventory: ${unexpectedAssets.length}`,
    `Master quantity on Yard: ${masterTotal}`,
    ""
  ];

  lines.push("Yard assets:");
  if (!yardAssets.length) {
    lines.push("None");
  } else {
    yardAssets.forEach((item) => {
      const status = inventoryScannedAssetIds.has(item.id) ? "FOUND" : "NOT SCANNED";
      lines.push(`${status} - ${inventoryAssetLabel(item)}${item.assetTag ? ` - QR ${item.assetTag}` : ""}`);
    });
  }

  if (unexpectedAssets.length) {
    lines.push("", "Scanned but not in Yard before inventory:");
    unexpectedAssets.forEach((item) => {
      lines.push(`${inventoryAssetLabel(item)} - was assigned to ${item.assignedTo || "Available"}`);
    });
  }

  lines.push("", "Master numbers on Yard:");
  if (!yardMasters.length) {
    lines.push("None");
  } else {
    yardMasters.forEach((item) => {
      lines.push(`Master #${item.masterNumber} - ${item.category}: ${item.quantity}`);
    });
  }

  return lines.join("\n");
}

async function finishYardInventory() {
  const message = yardInventorySnapshotText();
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const links = $("inventoryFinishLinks");
  const finishButton = $("finishInventoryBtn");
  links.hidden = false;
  links.innerHTML = `
    <a class="text-link" href="${whatsappUrl}" target="_blank" rel="noreferrer">Open WhatsApp snapshot</a>
  `;
  finishButton.disabled = true;
  const originalText = finishButton.textContent;
  finishButton.textContent = "Sending...";
  $("inventoryFinishMessage").textContent = "Sending Yard inventory snapshot to GroupMe...";

  try {
    await api("/api/groupme/yard-inventory", {
      method: "POST",
      body: JSON.stringify({ text: message })
    });
    $("inventoryFinishMessage").textContent = "GroupMe Yard inventory snapshot sent. WhatsApp link is ready if needed.";
  } catch (error) {
    if (sendGroupMeFromBrowser(message)) {
      $("inventoryFinishMessage").textContent = "Server was blocked, so the snapshot was sent to GroupMe from this browser. WhatsApp backup link is ready if needed.";
    } else {
      $("inventoryFinishMessage").textContent = `${error.message || "Could not send GroupMe message."} WhatsApp backup link is ready if needed.`;
    }
  } finally {
    finishButton.disabled = false;
    finishButton.textContent = originalText;
  }
}

function sendGroupMeFromBrowser(message) {
  if (!GROUPME_BOT_ID) return false;
  const frameName = "groupmePostFrame";
  let frame = document.querySelector(`iframe[name="${frameName}"]`);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.name = frameName;
    frame.hidden = true;
    document.body.append(frame);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://api.groupme.com/v3/bots/post";
  form.target = frameName;
  form.hidden = true;

  [
    ["bot_id", GROUPME_BOT_ID],
    ["text", message]
  ].forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  });

  document.body.append(form);
  form.submit();
  form.remove();
  return true;
}

function yardSnapshotText() {
  const yardItems = getYardEquipment();
  const yardQuantityAssets = getYardQuantityAssets();
  const yardQuantityTotal = yardQuantityAssets.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const date = new Date().toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const lines = [
    `Big Spring Yard Snapshot`,
    date,
    `${yardItems.length} - Assets on Big Spring Yard`,
    `${yardQuantityTotal} - Master quantity on Big Spring Yard`,
    ""
  ];

  if (!yardItems.length && !yardQuantityAssets.length) {
    lines.push("No assets or master quantities are assigned to Big Spring Yard.");
    return lines.join("\n");
  }

  if (yardItems.length) {
    lines.push("Equipment:");
    const counts = new Map();
    yardItems.forEach((item) => {
      const category = item.category || "Uncategorized";
      counts.set(category, (counts.get(category) || 0) + 1);
    });

    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([category, count]) => {
        lines.push(`${count} - ${category}`);
      });
  }

  if (yardQuantityAssets.length) {
    if (yardItems.length) lines.push("");
    lines.push("Master quantities:");
    yardQuantityAssets.forEach((item) => {
      lines.push(`${item.quantity} - ${item.category} - Master #${item.masterNumber}`);
    });
  }

  return lines.join("\n");
}

function shareYardSnapshotWhatsapp() {
  const message = yardSnapshotText();
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderPieChart(availableCount, jobAssigned, yardAssigned) {
  const total = availableCount + jobAssigned + yardAssigned;
  $("legendAvailableCount").textContent = availableCount;
  $("legendJobCount").textContent = jobAssigned;
  $("legendYardCount").textContent = yardAssigned;

  if (!total) {
    $("assetPieChart").style.background = "#eee8dc";
    $("assetPieChart").setAttribute("aria-label", "No asset summary data yet");
    return;
  }

  const segments = [
    { label: "Available", count: availableCount, color: "#1d4f91" },
    { label: "Assigned to Job", count: jobAssigned, color: "#7b1e3a" },
    { label: "Assigned to Big Spring Yard", count: yardAssigned, color: "#b6552d" }
  ];
  let start = 0;
  const gradient = segments
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      const end = start + (segment.count / total) * 100;
      const slice = `${segment.color} ${start}% ${end}%`;
      start = end;
      return slice;
    })
    .join(", ");
  $("assetPieChart").style.background = `conic-gradient(${gradient})`;
  $("assetPieChart").setAttribute("aria-label", `Available ${availableCount}, assigned to job ${jobAssigned}, assigned to Big Spring Yard ${yardAssigned}`);
}

function renderQuantityAssetDashboard() {
  const container = $("quantityAssetChart");
  if (!container) return;

  container.replaceChildren();
  const availableTotal = state.quantityAssets.reduce((sum, item) => {
    return sum + Number(item.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(item.masterNumber);
  }, 0);
  const usedTotal = getQuantityAssetUsedTotal();
  $("quantityAssetTotal").textContent = `${availableTotal} available / ${usedTotal} used`;
  $("quantityAssetDashboardEmpty").hidden = state.quantityAssets.length > 0;

  if (!state.quantityAssets.length) return;
  const maxQuantity = Math.max(1, ...state.quantityAssets.map((item) => {
    return Number(item.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(item.masterNumber) + getQuantityAssetUsedQuantity(item.masterNumber);
  }));
  state.quantityAssets
    .slice()
    .sort((a, b) => String(a.masterNumber).localeCompare(String(b.masterNumber)))
    .forEach((item) => {
      const available = Number(item.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(item.masterNumber);
      const used = getQuantityAssetUsedQuantity(item.masterNumber);
      const combined = available + used;
      const availableWidth = combined ? (available / maxQuantity) * 100 : 0;
      const usedWidth = combined ? (used / maxQuantity) * 100 : 0;
      const categories = getQuantityAssetCategoryText(item);
      const row = document.createElement("article");
      row.className = "quantity-bar-row";
      row.innerHTML = `
        <div>
          <strong>Master # ${escapeHtml(item.masterNumber)}</strong>
          <span>${escapeHtml(categories)}</span>
        </div>
        <div class="quantity-bar-track">
          <i class="quantity-available" style="width: ${availableWidth}%"></i>
          <i class="quantity-used" style="width: ${usedWidth}%"></i>
        </div>
        <b><span>${available} available</span><span>${used} used</span></b>
      `;
      container.append(row);
    });
}

function getQuantityAssetUsedQuantity(masterNumber) {
  return state.quantityAssetHistory
    .filter((item) => item.masterNumber === masterNumber && isAssignedMasterQuantityChange(item) && isRealJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function getQuantityAssetUsedTotal() {
  return state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item) && isRealJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function getQuantityAssetAvailableAssignmentQuantity(masterNumber) {
  return state.quantityAssetHistory
    .filter((item) => {
      return item.masterNumber === masterNumber &&
        isAssignedMasterQuantityChange(item) &&
        (isAvailableJobName(item.jobName) || isYardJobName(item.jobName));
    })
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function renderQuantityAssetAdjustOptions(selectedValue = $("quantityAssetAdjustCategory") ? $("quantityAssetAdjustCategory").value : "") {
  const select = $("quantityAssetAdjustCategory");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.quantityAssets.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.masterNumber;
    option.textContent = `${item.masterNumber} - ${getQuantityAssetCategoryText(item)}`;
    select.append(option);
  });
  if (![...select.options].some((option) => option.value === selectedValue)) selectedValue = "";
  select.value = selectedValue;
}

function renderInventoryMasterOptions(selectedValue = $("inventoryMasterNumber") ? $("inventoryMasterNumber").value : "") {
  const select = $("inventoryMasterNumber");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select";
  select.append(placeholder);
  state.quantityAssets
    .slice()
    .sort((a, b) => String(a.masterNumber).localeCompare(String(b.masterNumber)))
    .forEach((item) => {
      const option = document.createElement("option");
      const available = Number(item.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(item.masterNumber);
      option.value = item.masterNumber;
      option.textContent = `${item.masterNumber} - ${getQuantityAssetCategoryText(item)} (${available} available)`;
      select.append(option);
    });
  if ([...select.options].some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function renderMasterUseOptions() {
  ["registerMasterNumber", "auditMasterNumber"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const selectedValue = select.value;
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "None";
    select.append(placeholder);
    state.quantityAssets.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.masterNumber;
      const available = Number(item.quantity || 0) + getQuantityAssetAvailableAssignmentQuantity(item.masterNumber);
      option.textContent = `${item.masterNumber} - ${getQuantityAssetCategoryText(item)} (${available} available)`;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === selectedValue)) {
      select.value = selectedValue;
    }
  });
  updateRegisterMasterMode();
}

function updateRegisterMasterMode() {
  const masterMode = Boolean($("registerMasterNumber").value || $("registerMasterQuantity").value);
  $("equipmentName").required = !masterMode;
  $("assetTag").required = false;
  $("category").required = false;
  $("assignedTo").required = masterMode;
}

function renderQuantityAssets() {
  const tbody = $("quantityAssetsTable");
  if (!tbody) return;

  tbody.replaceChildren();
  $("quantityAssetsEmptyState").hidden = state.quantityAssets.length > 0;
  state.quantityAssets
    .slice()
    .sort((a, b) => String(a.masterNumber).localeCompare(String(b.masterNumber)))
    .forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><strong>${escapeHtml(item.masterNumber)}</strong></td>
        <td>${escapeHtml(getQuantityAssetCategoryText(item))}</td>
        <td>${Number(item.quantity || 0)}</td>
        <td>${escapeHtml(formatDateTime(item.updatedAt))}</td>
        <td><div class="row-actions"></div></td>
      `;
      if (canEdit()) {
        const deleteButton = actionButton("Delete", () => deleteQuantityAsset(item.masterNumber));
        deleteButton.classList.add("delete");
        row.querySelector(".row-actions").append(deleteButton);
      }
      tbody.append(row);
    });
}

function getSelectedQuantityCategories() {
  const select = $("quantityAssetCategory");
  if (!select) return [];
  return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
}

function getQuantityAssetCategoryText(item) {
  const categories = Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category];
  return categories.filter(Boolean).join(", ");
}

function updateQuantityAssetJobVisibility() {
  const useJob = $("quantityAssetAction").value === "Use";
  $("quantityAssetJobLabel").hidden = !useJob;
  $("quantityAssetJob").required = useJob;
}

function renderEquipment() {
  const tbody = $("equipmentTable");
  tbody.replaceChildren();
  const filtered = getFilteredEquipment();

  renderEquipmentTypeCounts(filtered);
  $("emptyState").hidden = filtered.length > 0;

  filtered.forEach((item) => {
    const row = document.createElement("tr");
    const locationText = item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : "Not set";
    row.innerHTML = `
      <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.category)}</small></td>
      <td>${escapeHtml(item.assetTag)}</td>
      <td><span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.assignedTo || "Unassigned")}</td>
      <td>${escapeHtml(locationText)}</td>
      <td><div class="row-actions"></div></td>
    `;

    const actions = row.querySelector(".row-actions");
    actions.append(actionButton(canEdit() ? "Edit" : "View", () => editRecord(item.id)));
    if (item.latitude && item.longitude) {
      actions.append(actionLink("Map", `https://www.google.com/maps?q=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`));
    }
    actions.insertAdjacentHTML("beforeend", assetPictureLinkHtml(item));
    if (canDelete()) {
      const button = actionButton("Delete", () => deleteRecord(item.id));
      button.classList.add("delete");
      actions.append(button);
    }
    tbody.append(row);
  });
}

function renderEquipmentMasterJobs() {
  const tbody = $("equipmentMasterJobTable");
  if (!tbody) return;

  tbody.replaceChildren();
  const filtered = getFilteredEquipmentMasterJobs();
  $("equipmentMasterJobEmptyState").hidden = filtered.length > 0;

  filtered.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.jobName || "Not set")}</td>
      <td><strong>${escapeHtml(item.masterNumber)}</strong></td>
      <td>${escapeHtml(item.category || "Master quantity")}</td>
      <td>${Number(item.quantity || 0)}</td>
    `;
    tbody.append(row);
  });
}

function getFilteredEquipmentMasterJobs() {
  const grouped = new Map();
  state.quantityAssets.forEach((item) => {
    const availableQuantity = Number(item.quantity || 0) + getQuantityAssetAssignedToAvailableOnly(item.masterNumber);
    if (availableQuantity <= 0) return;
    const category = getQuantityAssetCategoryText(item) || "Master quantity";
    grouped.set(`Available||${item.masterNumber}||${category}`, {
      jobName: "Available",
      masterNumber: item.masterNumber,
      category,
      quantity: availableQuantity
    });
  });
  state.quantityAssetHistory
    .filter((item) => isAssignedMasterQuantityChange(item) && (item.jobName || "").trim())
    .forEach((item) => {
      const key = `${item.jobName}||${item.masterNumber}||${item.category}`;
      const current = grouped.get(key) || {
        jobName: item.jobName,
        masterNumber: item.masterNumber,
        category: item.category,
        quantity: 0
      };
      current.quantity += Number(item.quantity || 0);
      grouped.set(key, current);
    });

  return [...grouped.values()].filter((item) => {
    const haystack = [
      item.masterNumber,
      item.category,
      item.quantity,
      item.jobName
    ].join(" ").toLowerCase();
    return haystack.includes(state.search) && matchesEquipmentMasterJobFilter(item);
  }).sort((a, b) => String(a.jobName).localeCompare(String(b.jobName)) || String(a.masterNumber).localeCompare(String(b.masterNumber)));
}

function getQuantityAssetAssignedToAvailableOnly(masterNumber) {
  return state.quantityAssetHistory
    .filter((item) => item.masterNumber === masterNumber && item.changeType === "Use" && isAvailableJobName(item.jobName))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function matchesEquipmentMasterJobFilter(item) {
  const value = (item.jobName || "").trim();
  if (state.jobFilter === "__all") return true;
  if (state.jobFilter === "__unassigned") return !value;
  if (isYardJobName(state.jobFilter)) return isYardJobName(value);
  return value === state.jobFilter;
}

function getFilteredEquipment() {
  return state.equipment.filter((item) => {
    const haystack = [item.name, item.assetTag, item.category, item.status, item.assignedTo]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.search) && matchesJobFilter(item);
  });
}

function matchesJobFilter(item) {
  return matchesAssignmentFilter(item, state.jobFilter);
}

function matchesAssignmentFilter(item, filter) {
  const value = (item.assignedTo || "").trim();
  if (filter === "__all") return true;
  if (filter === "__unassigned") return !value;
  if (isYardJobName(filter)) return isYardJobName(value);
  return value === filter;
}

function renderEquipmentTypeCounts(filtered) {
  const container = $("equipmentTypeCounts");
  if (!container) return;
  container.replaceChildren();

  const counts = new Map();
  filtered.forEach((item) => {
    const category = item.category || "Uncategorized";
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const filteredMasterQuantities = getFilteredEquipmentMasterJobs();
  const masterTotal = filteredMasterQuantities.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  filteredMasterQuantities.forEach((item) => {
    const category = item.category || "Master quantity";
    counts.set(category, (counts.get(category) || 0) + Number(item.quantity || 0));
  });

  const totalCard = equipmentCountCard("Total", filtered.length + masterTotal);
  container.append(totalCard);

  [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([category, count]) => {
      container.append(equipmentCountCard(category, count));
    });
}

function equipmentCountCard(label, count) {
  const article = document.createElement("article");
  article.innerHTML = `<span>${count}</span><strong>${escapeHtml(label)}</strong>`;
  return article;
}

function renderAssetHistory() {
  const tbody = $("historyTable");
  if (!tbody) return;

  tbody.replaceChildren();
  const filtered = getFilteredAssetHistory();
  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  state.assetHistoryPage = Math.min(state.assetHistoryPage, pageCount);
  const start = (state.assetHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const visible = filtered.slice(start, start + HISTORY_PAGE_SIZE);
  $("historyEmptyState").hidden = filtered.length > 0;

  visible.forEach((item) => {
    const row = document.createElement("tr");
    const locationText = item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : "Not set";
    row.innerHTML = `
      <td>${escapeHtml(formatDateTime(item.changedAt))}</td>
      <td><strong>${escapeHtml(item.equipmentName)}</strong></td>
      <td>${escapeHtml(item.assetTag)}<br>${assetPictureLinkHtml(item)}</td>
      <td>${escapeHtml(item.assignedTo || "Unassigned")}</td>
      <td>${escapeHtml(locationText)}</td>
      <td>${escapeHtml(item.changedBy || "Unknown")}</td>
    `;
    tbody.append(row);
  });
  renderHistoryPager("assetHistoryPager", state.assetHistoryPage, pageCount, filtered.length, (page) => {
    state.assetHistoryPage = page;
    renderAssetHistory();
  });
  renderHistoryQuantityChanges();
}

function getFilteredAssetHistory() {
  if (!state.historySearch) return state.assetHistory;
  return state.assetHistory.filter((item) => {
    const haystack = [
      item.equipmentName,
      item.assetTag,
      item.equipmentId,
      item.assignedTo,
      item.changedBy
    ].join(" ").toLowerCase();
    return haystack.includes(state.historySearch);
  });
}

function renderHistoryQuantityChanges() {
  const tbody = $("historyQuantityHistoryTable");
  if (!tbody) return;

  tbody.replaceChildren();
  const filtered = getFilteredHistoryQuantityChanges();
  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  state.quantityHistoryPage = Math.min(state.quantityHistoryPage, pageCount);
  const start = (state.quantityHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const visible = filtered.slice(start, start + HISTORY_PAGE_SIZE);
  $("historyQuantityHistoryEmptyState").hidden = filtered.length > 0;

  visible.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(formatDateTime(item.changedAt))}</td>
      <td><strong>${escapeHtml(item.masterNumber)}</strong></td>
      <td>${escapeHtml(item.category || "Master quantity")}</td>
      <td>${escapeHtml(item.changeType)}</td>
      <td>${Number(item.quantity || 0)}</td>
      <td>${escapeHtml(item.jobName || "Not set")}</td>
      <td>${Number(item.balanceAfter || 0)}</td>
      <td>${escapeHtml(item.changedBy || "Unknown")}</td>
    `;
    tbody.append(row);
  });
  renderHistoryPager("quantityHistoryPager", state.quantityHistoryPage, pageCount, filtered.length, (page) => {
    state.quantityHistoryPage = page;
    renderHistoryQuantityChanges();
  });
}

function renderHistoryPager(elementId, currentPage, pageCount, totalRows, onPageChange) {
  const pager = $(elementId);
  if (!pager) return;

  pager.hidden = totalRows === 0;
  pager.replaceChildren();
  if (totalRows === 0) return;

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "ghost";
  previous.textContent = "Previous";
  previous.disabled = currentPage <= 1;
  previous.addEventListener("click", () => onPageChange(currentPage - 1));

  const summary = document.createElement("span");
  summary.textContent = `Page ${currentPage} of ${pageCount} (${totalRows} rows)`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "ghost";
  next.textContent = "Next";
  next.disabled = currentPage >= pageCount;
  next.addEventListener("click", () => onPageChange(currentPage + 1));

  pager.append(previous, summary, next);
}

function getFilteredHistoryQuantityChanges() {
  if (!state.historySearch) return state.quantityAssetHistory;
  return state.quantityAssetHistory.filter((item) => {
    const haystack = [
      item.masterNumber,
      item.category,
      item.changeType,
      item.quantity,
      item.jobName,
      item.balanceAfter,
      item.changedBy
    ].join(" ").toLowerCase();
    return haystack.includes(state.historySearch);
  });
}

function renderJobAudits() {
  const tbody = $("jobAuditTable");
  if (!tbody) return;

  tbody.replaceChildren();
  $("jobAuditEmptyState").hidden = state.jobAudits.length > 0;

  const counts = {
    Asset: 0,
    Crossing: 0,
    Pump: 0,
    "Pig Around": 0,
    "Master Quantity": 0
  };

  state.jobAudits.forEach((item) => {
    counts[item.itemType] = (counts[item.itemType] || 0) + 1;
    const row = document.createElement("tr");
    const locationText = item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : "Not set";
    const locationHtml = item.latitude && item.longitude
      ? `${escapeHtml(locationText)}<br><a class="text-link" href="${googleMapUrl(item)}" target="_blank" rel="noreferrer">Open map</a>`
      : escapeHtml(locationText);
    row.innerHTML = `
      <td>${escapeHtml(item.auditDate)}</td>
      <td>${escapeHtml(item.jobName)}</td>
      <td>${escapeHtml(item.itemType)}</td>
      <td>${escapeHtml(item.assetNumber || "Not required")}<br>${item.itemType === "Asset" ? assetPictureLinkHtml(item) : ""}</td>
      <td>${locationHtml}</td>
    `;
    tbody.append(row);
  });

  $("auditAssetCount").textContent = counts.Asset || 0;
  $("auditCrossingCount").textContent = counts.Crossing || 0;
  $("auditPumpCount").textContent = counts.Pump || 0;
  $("auditPigAroundCount").textContent = counts["Pig Around"] || 0;
  $("auditMasterQuantityCount").textContent = counts["Master Quantity"] || 0;
  syncJobAuditHeaderFields();
}

function renderCurrentAudits() {
  const tbody = $("currentAuditsTable");
  if (!tbody) return;

  tbody.replaceChildren();
  $("currentAuditsEmptyState").hidden = state.savedJobAudits.length > 0;
  $("currentAuditsMessage").textContent = state.currentAuditsMessage || "";

  state.savedJobAudits.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <select class="audit-status-select" data-batch-id="${escapeHtml(item.batchId)}">
          ${auditStatusOptions(item.status || "Running")}
        </select>
      </td>
      <td>${escapeHtml(formatDateTime(item.savedAt))}</td>
      <td>${escapeHtml(item.auditDate)}</td>
      <td>${escapeHtml(item.jobName)}</td>
      <td>${escapeHtml(item.savedBy || "Unknown")}</td>
      <td>${escapeHtml(String(item.itemCount || 0))}</td>
      <td><button class="ghost open-current-audit-btn" type="button" data-batch-id="${escapeHtml(item.batchId)}">Open</button></td>
    `;
    row.querySelector(".open-current-audit-btn").addEventListener("click", () => loadCurrentAuditDetail(item.batchId));
    row.querySelector(".audit-status-select").addEventListener("change", (event) => updateCurrentAuditStatus(item.batchId, event.target.value));
    tbody.append(row);
  });
}

function renderAuditHistory() {
  const tbody = $("auditHistoryTable");
  if (!tbody) return;

  tbody.replaceChildren();
  $("auditHistoryEmptyState").hidden = state.auditHistory.length > 0;
  $("auditHistoryMessage").textContent = state.auditHistoryMessage || "";

  state.auditHistory.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="status-pill">${escapeHtml(item.status || "Job Done")}</span></td>
      <td>${escapeHtml(formatDateTime(item.savedAt))}</td>
      <td>${escapeHtml(item.auditDate)}</td>
      <td>${escapeHtml(item.jobName)}</td>
      <td>${escapeHtml(item.savedBy || "Unknown")}</td>
      <td>${escapeHtml(String(item.itemCount || 0))}</td>
      <td><button class="ghost open-audit-history-btn" type="button" data-batch-id="${escapeHtml(item.batchId)}">Open</button></td>
    `;
    row.querySelector(".open-audit-history-btn").addEventListener("click", () => loadCurrentAuditDetail(item.batchId));
    tbody.append(row);
  });
}

function auditStatusOptions(selectedStatus) {
  return ["Running", "Rigging Down", "Job Done"].map((status) => (
    `<option value="${escapeHtml(status)}"${status === selectedStatus ? " selected" : ""}>${escapeHtml(status)}</option>`
  )).join("");
}

async function updateCurrentAuditStatus(batchId, status) {
  try {
    await api(`/api/current-audits/${encodeURIComponent(batchId)}/status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    state.savedJobAudits = status === "Job Done"
      ? state.savedJobAudits.filter((item) => item.batchId !== batchId)
      : state.savedJobAudits.map((item) => (
        item.batchId === batchId ? { ...item, status } : item
      ));
    state.currentAuditDetails = state.currentAuditDetails.map((item) => (
      item.batchId === batchId ? { ...item, status } : item
    ));
    renderCurrentAudits();
    if (status === "Job Done" || state.page === "audit-history") await loadAuditHistory();
    if (state.page === "current-audit-detail") renderCurrentAuditDetail();
  } catch (error) {
    alert(error.message || "Could not update audit status.");
    await loadCurrentAudits();
  }
}

function renderCurrentAuditDetail() {
  const tbody = $("currentAuditDetailTable");
  if (!tbody) return;

  tbody.replaceChildren();
  $("currentAuditDetailEmptyState").hidden = state.currentAuditDetails.length > 0;

  const first = state.currentAuditDetails[0];
  $("currentAuditDetailTitle").textContent = first ? `${first.jobName} audit` : "Current audit detail";
  $("currentAuditDetailMeta").textContent = first
    ? `Status ${first.status || "Running"} - saved by ${first.savedBy || "Unknown"} on ${formatDateTime(first.savedAt)}`
    : "";

  state.currentAuditDetails.forEach((item) => {
    const row = document.createElement("tr");
    const locationText = item.latitude && item.longitude ? `${item.latitude}, ${item.longitude}` : "Not set";
    const locationHtml = item.latitude && item.longitude
      ? `${escapeHtml(locationText)}<br><a class="text-link" href="${googleMapUrl(item)}" target="_blank" rel="noreferrer">Open map</a>`
      : escapeHtml(locationText);
    row.innerHTML = `
      <td><span class="status-pill">${escapeHtml(item.status || "Running")}</span></td>
      <td>${escapeHtml(item.auditDate)}</td>
      <td>${escapeHtml(item.jobName)}</td>
      <td>${escapeHtml(item.itemType)}</td>
      <td>${escapeHtml(item.assetNumber || "Not required")}<br>${item.itemType === "Asset" ? assetPictureLinkHtml(item) : ""}</td>
      <td>${locationHtml}</td>
    `;
    tbody.append(row);
  });
}

function getLocatedEquipment() {
  return state.equipment.filter((item) => {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    return item.latitude && item.longitude && !Number.isNaN(lat) && !Number.isNaN(lng) && matchesAssignmentFilter(item, state.mapJobFilter);
  }).map((item) => ({ ...item, mapKind: "Equipment" }));
}

function getLocatedMasterQuantityPoints() {
  return state.quantityAssetHistory
    .filter((item) => {
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      return isAssignedMasterQuantityChange(item) &&
        item.latitude &&
        item.longitude &&
        !Number.isNaN(lat) &&
        !Number.isNaN(lng) &&
        matchesAssignmentFilter({ assignedTo: item.jobName }, state.mapJobFilter);
    })
    .map((item) => ({
      id: `master-${item.id}`,
      name: `Master #${item.masterNumber} x ${Number(item.quantity || 0)}`,
      assetTag: item.masterNumber,
      assignedTo: item.jobName,
      category: item.category || "Master quantity",
      latitude: item.latitude,
      longitude: item.longitude,
      mapKind: "Master Quantity",
      quantity: Number(item.quantity || 0)
    }));
}

function getLocatedMapPoints() {
  return [...getLocatedEquipment(), ...getLocatedMasterQuantityPoints()]
    .sort((a, b) => String(a.assignedTo || "").localeCompare(String(b.assignedTo || "")) || String(a.name).localeCompare(String(b.name)));
}

function googleMapUrl(item) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`;
}

function getGoogleMapZoom() {
  return Math.max(3, Math.min(19, 15 + state.mapZoomOffset));
}

function loadGoogleMaps() {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("Google Maps API key is missing."));
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const callbackName = `initSunwaveGoogleMap_${Date.now()}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };
    window.gm_authFailure = () => {
      setMapMessage(`Google Maps key is not authorized for ${window.location.origin}. Add this URL in Google Cloud API key restrictions.`);
      reject(new Error("Google Maps key is not authorized for this app URL."));
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&callback=${callbackName}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error("Google Maps could not load."));
    };
    document.head.append(script);
  });

  return googleMapsLoadPromise;
}

function changeMapZoom(delta) {
  state.mapZoomOffset = Math.max(-4, Math.min(4, state.mapZoomOffset + delta));
  const located = getLocatedMapPoints();
  const activeItem = located.find((item) => item.id === state.mapSelectedId) || located[0];
  if (activeItem) selectMapPoint(activeItem);
}

function selectMapPoint(item) {
  state.mapSelectedId = item.id;
  $("selectedMapLink").href = googleMapUrl(item);
  $("selectedMapLink").setAttribute("aria-disabled", "false");
  document.querySelectorAll(".map-point").forEach((button) => {
    button.classList.toggle("active", button.dataset.id === item.id);
  });
  updateGoogleMapSelection(item);
}

function openMapPoint(item) {
  selectMapPoint(item);
  window.open(googleMapUrl(item), "_blank", "noopener,noreferrer");
}

function renderMapPoints() {
  const container = $("mapPoints");
  const empty = $("mapEmptyState");
  const stageEmpty = $("assetMapEmptyState");
  if (!container || !empty || !stageEmpty) return;

  container.replaceChildren();
  const located = getLocatedMapPoints();
  empty.hidden = located.length > 0;
  stageEmpty.hidden = located.length > 0;

  if (located.length === 0) {
    clearGoogleMapMarkers();
    setMapMessage("");
    state.mapSelectedId = "";
    $("selectedMapLink").href = "#";
    $("selectedMapLink").setAttribute("aria-disabled", "true");
    return;
  }

  located.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "map-point-entry";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-point";
    button.dataset.id = item.id;
    button.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.assignedTo || "Unassigned")}</span>
      <span>${escapeHtml(item.category)}</span>
      <span>${escapeHtml(item.mapKind || "Equipment")}</span>
      <small>${escapeHtml(item.latitude)}, ${escapeHtml(item.longitude)}</small>
    `;
    button.addEventListener("click", () => openMapPoint(item));
    entry.append(button);
    if ((item.mapKind || "Equipment") === "Equipment") {
      entry.insertAdjacentHTML("beforeend", `<div class="map-point-picture">${assetPictureLinkHtml(item)}</div>`);
    }
    container.append(entry);
  });

  renderGoogleAssetMap(located);
  selectMapPoint(located.find((item) => item.id === state.mapSelectedId) || located[0]);
}

function renderGoogleAssetMap(items) {
  setMapMessage("");
  loadGoogleMaps()
    .then(() => {
      const canvas = $("googleMapCanvas");
      if (!canvas) return;
      if (!googleMap) {
        googleMap = new google.maps.Map(canvas, {
          center: mapPosition(items[0]),
          zoom: getGoogleMapZoom(),
          fullscreenControl: true,
          mapTypeControl: true,
          streetViewControl: false
        });
        googleMapInfoWindow = new google.maps.InfoWindow();
      }
      syncGoogleMapMarkers(items);
    })
    .catch((error) => {
      clearGoogleMapMarkers();
      const message = error.message === "Google Maps API key is missing."
        ? "Add your Google Maps API key in config.js to show the live Google map."
        : error.message === "Google Maps key is not authorized for this app URL."
          ? `Google Maps key is not authorized for ${window.location.origin}. Add this URL in Google Cloud API key restrictions.`
        : "Google Maps could not load. Check the internet connection and API key.";
      setMapMessage(message);
    });
}

function syncGoogleMapMarkers(items) {
  clearGoogleMapMarkers();
  const bounds = new google.maps.LatLngBounds();

  items.forEach((item) => {
    const marker = new google.maps.Marker({
      position: mapPosition(item),
      map: googleMap,
      title: `${item.name} - ${item.assignedTo || "Unassigned"}`,
      icon: googleMarkerIcon(false, item.mapKind)
    });
    marker.addListener("click", () => selectMapPoint(item));
    googleMapMarkers.set(item.id, marker);
    bounds.extend(marker.getPosition());
  });

  if (items.length === 1) {
    googleMap.setCenter(mapPosition(items[0]));
    googleMap.setZoom(getGoogleMapZoom());
    return;
  }

  googleMap.fitBounds(bounds, 64);
}

function updateGoogleMapSelection(item) {
  if (!googleMap) return;

  googleMapMarkers.forEach((marker, id) => {
    const markerItem = getLocatedMapPoints().find((point) => point.id === id);
    marker.setIcon(googleMarkerIcon(id === item.id, markerItem ? markerItem.mapKind : ""));
  });

  const position = mapPosition(item);
  googleMap.panTo(position);
  googleMap.setZoom(getGoogleMapZoom());
  if (googleMapInfoWindow) {
    googleMapInfoWindow.setContent(`
      <strong>${escapeHtml(item.name)}</strong><br>
      ${escapeHtml(item.mapKind || "Equipment")}<br>
      ${escapeHtml(item.assignedTo || "Unassigned")}<br>
      ${escapeHtml(item.category || "")}<br>
      ${escapeHtml(item.latitude)}, ${escapeHtml(item.longitude)}<br>
      ${(item.mapKind || "Equipment") === "Equipment" ? assetPictureLinkHtml(item) : ""}
    `);
    googleMapInfoWindow.open({ map: googleMap, anchor: googleMapMarkers.get(item.id) });
  }
}

function clearGoogleMapMarkers() {
  googleMapMarkers.forEach((marker) => marker.setMap(null));
  googleMapMarkers.clear();
}

function setMapMessage(message) {
  const messageElement = $("assetMapMessage");
  if (!messageElement) return;
  messageElement.textContent = message;
  messageElement.hidden = !message;
}

function mapPosition(item) {
  return {
    lat: Number(item.latitude),
    lng: Number(item.longitude)
  };
}

function googleMarkerIcon(active, mapKind = "") {
  if (!window.google || !window.google.maps) return undefined;
  const color = active ? "#7b1e3a" : mapKind === "Master Quantity" ? "#b6552d" : "#176058";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    scale: active ? 10 : 8
  };
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function actionLink(label, href) {
  const link = document.createElement("a");
  link.className = "text-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function syncAuditType() {
  const type = $("auditType").value;
  const masterMode = Boolean($("auditMasterNumber").value || $("auditMasterQuantity").value);
  const isAsset = type === "Asset" && !masterMode;
  $("auditAssetLabel").hidden = !isAsset;
  $("auditAssetNumber").required = isAsset;
  $("auditAssetNumber").disabled = !isAsset || !canEdit();
  if (masterMode) {
    $("auditType").value = "Asset";
  }
  if (!isAsset) {
    $("auditAssetNumber").value = "";
    clearAuditAssetMessage();
  }
}

function clearAuditAssetMessage() {
  if (!$("auditAssetMessage")) return;
  $("auditAssetMessage").textContent = "";
  $("auditAssetNumber").setCustomValidity("");
}

function showAuditAssetMessage(message) {
  $("auditAssetMessage").textContent = message;
  $("auditAssetNumber").setCustomValidity(message);
  $("auditAssetNumber").reportValidity();
}

function isRegisteredAuditAsset(assetNumber) {
  const value = String(assetNumber || "").trim().toLowerCase();
  if (!value) return false;
  return state.equipment.some((item) => {
    return [item.id, item.name, item.assetTag]
      .map((field) => String(field || "").trim().toLowerCase())
      .includes(value);
  });
}

function syncJobAuditHeaderFields() {
  const hasEntries = state.jobAudits.length > 0;
  const first = hasEntries
    ? [...state.jobAudits].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
    : null;

  if (first) {
    $("auditDate").value = first.auditDate;
    $("auditJob").value = first.jobName;
  }

  $("auditJob").disabled = hasEntries || !canEdit();
}

function getJobAuditData() {
  const masterNumber = $("auditMasterNumber").value;
  const masterQuantity = $("auditMasterQuantity").value;
  return {
    auditDate: $("auditDate").value,
    jobName: $("auditJob").value,
    itemType: masterNumber && masterQuantity ? "Master Quantity" : $("auditType").value,
    assetNumber: $("auditAssetNumber").value.trim(),
    masterNumber: $("auditMasterNumber").value,
    masterQuantity: $("auditMasterQuantity").value,
    hoseSize: "",
    totalHose: "",
    latitude: $("auditLatitude").value.trim(),
    longitude: $("auditLongitude").value.trim(),
    notes: ""
  };
}

async function handleJobAuditSave(event) {
  event.preventDefault();
  if (!canEdit()) return;

  const payload = getJobAuditData();
  $("jobAuditFormMessage").textContent = "";
  clearAuditAssetMessage();

  if ((payload.masterNumber && !payload.masterQuantity) || (!payload.masterNumber && payload.masterQuantity)) {
    $("jobAuditFormMessage").textContent = "Select a master number and enter the quantity used.";
    return;
  }

  if (payload.itemType === "Asset" && !isRegisteredAuditAsset(payload.assetNumber)) {
    const message = "This asset is not registered yet. Register it before adding it to a job audit.";
    $("jobAuditFormMessage").textContent = message;
    showAuditAssetMessage(message);
    return;
  }

  try {
    await api("/api/job-audits", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    $("jobAuditFormMessage").textContent = "Audit entry added.";
    const selectedJob = $("auditJob").value;
    const selectedType = $("auditType").value;
    resetJobAuditForm();
    $("auditJob").value = selectedJob;
    $("auditType").value = selectedType;
    renderMasterUseOptions();
    syncAuditType();
    await Promise.all([loadJobAudits(), loadQuantityAssets(), loadQuantityAssetHistory()]);
  } catch (error) {
    const message = error.message || "Could not save job audit.";
    $("jobAuditFormMessage").textContent = message;
    if (message.toLowerCase().includes("not registered")) {
      showAuditAssetMessage(message);
    }
  }
}

async function handleSaveJobAuditList() {
  if (!canEdit()) return;
  const button = $("saveJobAuditListBtn");
  $("jobAuditFormMessage").textContent = "";

  if (!state.jobAudits.length) {
    $("jobAuditFormMessage").textContent = "There are no audit entries to save.";
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Saving...";

  try {
    const result = await api("/api/job-audits/save-list", {
      method: "POST",
      body: JSON.stringify({})
    });
    $("jobAuditFormMessage").textContent = `Saved ${result.count} audit entr${result.count === 1 ? "y" : "ies"} with status Running by ${result.savedBy || state.user.username}.`;
    await Promise.all([loadJobAudits(), loadCurrentAudits()]);
    setPage("current-audits");
  } catch (error) {
    $("jobAuditFormMessage").textContent = error.message || "Could not save the audit list.";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleCategorySave(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  try {
    await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: $("categoryName").value.trim() })
    });
    $("categoryFormMessage").textContent = "Category saved.";
    $("categoryForm").reset();
    await loadCategories();
  } catch (error) {
    $("categoryFormMessage").textContent = error.message || "Could not save category.";
  }
}

async function handleJobSave(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  try {
    await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ name: $("jobName").value.trim() })
    });
    $("jobFormMessage").textContent = "Job value saved.";
    $("jobForm").reset();
    await loadJobs();
  } catch (error) {
    $("jobFormMessage").textContent = error.message || "Could not save job value.";
  }
}

async function handleQuantityAssetSetupSave(event) {
  event.preventDefault();
  if (!canEdit()) return;

  try {
    await api("/api/quantity-assets", {
      method: "POST",
      body: JSON.stringify({
        categories: getSelectedQuantityCategories(),
        masterNumber: $("quantityAssetMasterNumber").value.trim()
      })
    });
    $("quantityAssetSetupMessage").textContent = "Master categories saved.";
    $("quantityAssetSetupForm").reset();
    await loadQuantityAssets();
  } catch (error) {
    $("quantityAssetSetupMessage").textContent = error.message || "Could not save quantity category.";
  }
}

async function handleQuantityAssetAdjustSave(event) {
  event.preventDefault();
  if (!canEdit()) return;

  try {
    await api("/api/quantity-assets/adjust", {
      method: "POST",
      body: JSON.stringify({
        category: $("quantityAssetAdjustCategory").value,
        masterNumber: $("quantityAssetAdjustCategory").value,
        action: $("quantityAssetAction").value,
        quantity: $("quantityAssetAmount").value,
        jobName: $("quantityAssetJob").value
      })
    });
    $("quantityAssetAdjustMessage").textContent = "Quantity updated.";
    $("quantityAssetAdjustForm").reset();
    updateQuantityAssetJobVisibility();
    await Promise.all([loadQuantityAssets(), loadQuantityAssetHistory()]);
  } catch (error) {
    $("quantityAssetAdjustMessage").textContent = error.message || "Could not update quantity.";
  }
}

async function deleteQuantityAsset(masterNumber) {
  if (!canEdit()) return;
  if (!confirm(`Delete master #${masterNumber} from quantity assets?`)) return;

  try {
    await api(`/api/quantity-assets/${encodeURIComponent(masterNumber)}`, { method: "DELETE" });
    $("quantityAssetAdjustMessage").textContent = "Master number deleted.";
    await Promise.all([loadQuantityAssets(), loadQuantityAssetHistory()]);
  } catch (error) {
    alert(error.message || "Could not delete master number.");
  }
}

async function deleteJob(name) {
  if (!isAdmin()) return;
  if (!confirm(`Delete job value ${name}?`)) return;

  try {
    await api(`/api/jobs/${encodeURIComponent(name)}`, { method: "DELETE" });
    await loadJobs();
  } catch (error) {
    alert(error.message || "Could not delete job value.");
  }
}

function renderJobs() {
  const list = $("jobsList");
  if (!list) return;
  list.replaceChildren();
  $("jobsEmptyState").hidden = state.jobs.length > 0;

  state.jobs.forEach((job) => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `<strong>${escapeHtml(job.name)}</strong><div class="row-actions"></div>`;
    row.querySelector(".row-actions").append(actionButton("Delete", () => deleteJob(job.name)));
    list.append(row);
  });
}

async function deleteCategory(name) {
  if (!isAdmin()) return;
  if (!confirm(`Delete category ${name}?`)) return;

  try {
    await api(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
    await loadCategories();
  } catch (error) {
    alert(error.message || "Could not delete category.");
  }
}

function renderCategories() {
  const list = $("categoriesList");
  if (!list) return;
  list.replaceChildren();
  $("categoriesEmptyState").hidden = state.categories.length > 0;

  state.categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `<strong>${escapeHtml(category.name)}</strong><div class="row-actions"></div>`;
    row.querySelector(".row-actions").append(actionButton("Delete", () => deleteCategory(category.name)));
    list.append(row);
  });
}

async function handleUserSave(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const username = $("userUsername").value.trim();
  const originalUsername = $("userOriginalUsername").value.trim();
  const password = $("userPassword").value;
  const payload = {
    username,
    originalUsername,
    name: $("userName").value.trim(),
    role: $("userRole").value,
    password
  };

  if (!originalUsername && !password) {
    $("userFormMessage").textContent = "Password is required for a new user.";
    return;
  }

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    $("userFormMessage").textContent = "User saved.";
    await loadUsers();
    resetUserForm();
  } catch (error) {
    $("userFormMessage").textContent = error.message || "Could not save user.";
  }
}

function resetUserForm() {
  if (!$("userForm")) return;
  $("userForm").reset();
  $("userOriginalUsername").value = "";
  $("userUsername").disabled = false;
  $("userFormTitle").textContent = "Add user";
  $("userFormMessage").textContent = "";
}

function editUser(username) {
  const user = state.users.find((item) => item.username === username);
  if (!user) return;
  $("userOriginalUsername").value = user.username;
  $("userUsername").value = user.username;
  $("userUsername").disabled = true;
  $("userName").value = user.name;
  $("userRole").value = user.role;
  $("userPassword").value = "";
  $("userFormTitle").textContent = "Edit user";
  $("userFormMessage").textContent = "";
}

function renderUsers() {
  const tbody = $("usersTable");
  tbody.replaceChildren();
  $("usersEmptyState").hidden = state.users.length > 0;

  state.users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td><div class="row-actions"></div></td>
    `;
    row.querySelector(".row-actions").append(actionButton("Edit", () => editUser(user.username)));
    tbody.append(row);
  });
}

async function exportCsv() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/equipment.csv`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error("Could not export equipment.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `equipment-register-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message || "Could not export equipment.");
  }
}

function escapeHtml(value = "") {
  return String(value)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#039;");
}

function formatDateTime(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

init();
