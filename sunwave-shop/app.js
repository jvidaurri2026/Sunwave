const sessionKey = "equiptrack_session";
let unitTypes = [];
let repairCodes = [];
let repairOrders = [];
let inventoryParts = [];
let serviceSchedules = [];
let serviceDayStatuses = [];
let outOfServiceReports = [];
let shopPartOrders = [];
let badTires = [];
let editingPartNumber = "";
let editingRepairCode = "";
let editingUnitId = null;
let dashboardExpenseMode = "month";
let dashboardSelectedMonth = "";
let activeScheduleRepairId = null;
let smartPartScanStream = null;
let smartPartScanFrame = 0;
let smartPartBarcodeDetector = null;
let smartPartScanCanvas = null;
let smartPartScanContext = null;
let smartPartAudioContext = null;

function populateFuelTypeOptions() {
  ["partFuelType", "unitFuelType"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(
      new Option("Select fuel type", ""),
      new Option("Diesel", "Diesel"),
      new Option("Gasoline", "Gasoline"),
      new Option("Diesel and Gasoline", "Diesel and Gasoline"),
      new Option("None", "None")
    );
    if (["Diesel", "Gasoline", "Diesel and Gasoline", "None"].includes(selected)) select.value = selected;
  });
}

populateFuelTypeOptions();

function readShopSession() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey));
    return session && session.token && session.user && ["Admin", "Scheduler", "Technician", "Shop Viewer"].includes(session.user.role) ? session : null;
  } catch {
    return null;
  }
}

const session = readShopSession();
const isShopAdmin = Boolean(session && session.user.role === "Admin");
const isShopScheduler = Boolean(session && session.user.role === "Scheduler");
const isShopTechnician = Boolean(session && session.user.role === "Technician");
const isShopViewer = Boolean(session && session.user.role === "Shop Viewer");
const canEditMechanicName = isShopAdmin || String(session?.user?.username || "").trim().toLowerCase() === "chicho";
document.getElementById("shopWorkspace").hidden = !session;
document.getElementById("shopDenied").hidden = Boolean(session);
if (session) {
  document.getElementById("shopUser").textContent = `${session.user.name} - ${session.user.role}`;
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    const viewerCanRead = isShopViewer && element.hasAttribute("data-shop-readable");
    const technicianCanRead = isShopTechnician && element.hasAttribute("data-technician-readable");
    element.hidden = !isShopAdmin && !viewerCanRead && !technicianCanRead;
  });
  document.querySelectorAll("[data-shop-admin-action]").forEach((element) => {
    const technicianCanUse = isShopTechnician && element.hasAttribute("data-technician-action");
    element.hidden = !isShopAdmin && !technicianCanUse;
  });
  document.querySelectorAll("[data-scheduler-only]").forEach((element) => {
    element.hidden = isShopTechnician;
  });
  if (!isShopAdmin) {
    const exitLink = document.getElementById("shopExitLink");
    exitLink.textContent = "Sign out";
    exitLink.href = "../index.html";
    exitLink.addEventListener("click", signOutShop);
  }
  document.getElementById("partForm").addEventListener("submit", savePart);
  document.getElementById("partCancelButton").addEventListener("click", resetPartForm);
  document.getElementById("partUnitType").addEventListener("change", updatePartFuelTypeField);
  document.getElementById("smartPartLookupForm").addEventListener("submit", lookupSmartPart);
  document.getElementById("smartPartForm").addEventListener("submit", saveSmartPart);
  document.getElementById("smartPartScanButton").addEventListener("click", startSmartPartScan);
  document.getElementById("smartPartStopScanButton").addEventListener("click", stopSmartPartScan);
  document.getElementById("smartPartClearButton").addEventListener("click", resetSmartPartForm);
  document.getElementById("smartPartCompatibilitySearchButton").addEventListener("click", openSmartPartCompatibilitySearch);
  document.getElementById("smartPartYears").addEventListener("change", renderSmartPartUnitTypeOptions);
  document.getElementById("smartPartUnitType").addEventListener("change", updateSmartPartFuelTypeField);
  document.getElementById("smartPartIsTire").addEventListener("change", renderSmartTireInventory);
  document.getElementById("smartPartNumber").addEventListener("input", updateSmartTireDuplicateStatus);
  document.getElementById("unitTypeForm").addEventListener("submit", saveUnitType);
  document.getElementById("unitTypeCancelButton").addEventListener("click", resetUnitTypeForm);
  document.getElementById("repairCodeForm").addEventListener("submit", saveRepairCode);
  document.getElementById("repairCodeCancelButton").addEventListener("click", resetRepairCodeForm);
  document.getElementById("addRepairCodeOptionButton").addEventListener("click", () => addRepairCodeOptionRow());
  document.getElementById("repairOrderForm").addEventListener("submit", saveRepairOrder);
  document.getElementById("repairOrderAsset").addEventListener("change", updateRepairOrderUsageRequirements);
  document.getElementById("serviceScheduleForm").addEventListener("submit", saveServiceSchedule);
  document.getElementById("serviceScheduleStatusFilter").addEventListener("change", renderServiceSchedules);
  document.getElementById("serviceAvailabilityDate").addEventListener("change", renderServiceAvailability);
  document.getElementById("repairOrderAssetFilter").addEventListener("change", renderRepairOrders);
  document.getElementById("unitRepairHistoryAsset").addEventListener("change", renderUnitRepairHistory);
  document.getElementById("shareTodayRepairsWhatsapp").addEventListener("click", shareTodayRepairsWhatsapp);
  document.getElementById("shareDashboardWhatsapp").addEventListener("click", shareDashboardWhatsappReport);
  document.getElementById("shareTireInventoryWhatsapp").addEventListener("click", shareTireInventoryWhatsappReport);
  document.getElementById("whatsappSettingsForm").addEventListener("submit", saveWhatsAppSettings);
  document.getElementById("testWhatsappConnectionButton").addEventListener("click", testWhatsAppConnection);
  document.getElementById("outOfServiceForm").addEventListener("submit", saveOutOfServiceReport);
  document.getElementById("outOfServiceStatus").addEventListener("change", updateOutOfServiceThirdPartyFields);
  document.getElementById("outOfServiceNoEta").addEventListener("change", updateOutOfServiceEtaRequirement);
  document.getElementById("dashboardPartOrderForm").addEventListener("submit", saveDashboardPartOrder);
  document.getElementById("dashboardPartPickedUp").addEventListener("change", updateDashboardPartPickupFields);
  document.getElementById("dashboardPartPurchaseType").addEventListener("change", updateDashboardPartPurchaseFields);
  ["ordersHistorySearch", "ordersHistoryStatus", "ordersHistoryType", "ordersHistoryFrom", "ordersHistoryTo"].forEach((id) => {
    document.getElementById(id).addEventListener(id === "ordersHistorySearch" ? "input" : "change", renderOrdersHistory);
  });
  document.getElementById("repairOrderTechnician").value = session.user.name;
  document.getElementById("repairOrderTechnician").readOnly = !canEditMechanicName;
  document.getElementById("repairOrderDate").value = localDateValue();
  document.getElementById("serviceScheduleDate").value = localDateValue();
  document.getElementById("serviceAvailabilityDate").value = localDateValue();
  document.getElementById("outOfServiceDate").value = localDateValue();
  document.getElementById("dashboardPartOrderDate").value = localDateValue();
  document.getElementById("dashboardPartPickupDate").value = localDateValue();
  updateDashboardPartPurchaseFields();
  document.getElementById("partYear").addEventListener("change", renderPartUnitTypeOptions);
  document.getElementById("dashboardExpenseMonthTab").addEventListener("click", () => setDashboardExpenseMode("month"));
  document.getElementById("dashboardExpenseVendorTab").addEventListener("click", () => setDashboardExpenseMode("vendor"));
  document.getElementById("dashboardExpenseInventoryTab").addEventListener("click", () => setDashboardExpenseMode("inventory"));
  document.querySelectorAll("[data-shop-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.shopPage;
      if (page === "repair-orders") prepareManualRepairOrder();
      setShopPage(page);
    });
  });
  if (isShopAdmin) {
    setShopPage("dashboard");
    Promise.all([loadUnitTypes(), loadRepairCodes(), loadRepairOrders(), loadServiceSchedules(), loadServiceDayStatuses(), loadOutOfServiceReports(), loadShopPartOrders(), loadShopBadTires(), loadWhatsAppSettings()]).then(loadParts);
  } else if (isShopViewer) {
    setShopPage("dashboard");
    Promise.all([loadUnitTypes(), loadRepairCodes(), loadRepairOrders(), loadServiceSchedules(), loadServiceDayStatuses(), loadOutOfServiceReports(), loadShopPartOrders(), loadShopBadTires()]).then(loadParts);
  } else if (isShopScheduler) {
    setShopPage("schedule-service");
    Promise.all([loadUnitTypes(), loadRepairCodes(), loadServiceSchedules(), loadServiceDayStatuses()]);
  } else {
    setShopPage("dashboard");
    Promise.all([loadUnitTypes(), loadRepairCodes(), loadRepairOrders(), loadServiceSchedules(), loadServiceDayStatuses(), loadOutOfServiceReports(), loadShopPartOrders(), loadShopBadTires(), loadWhatsAppSettings()]).then(loadParts);
  }
}

function prepareManualRepairOrder() {
  activeScheduleRepairId = null;
  const form = document.getElementById("repairOrderForm");
  if (!form) return;
  form.reset();
  document.getElementById("repairOrderTechnician").value = session.user.name;
  document.getElementById("repairOrderDate").value = localDateValue();
  document.getElementById("repairOrderMessage").textContent = "New repair order. This order will be saved as Completed.";
  updateRepairOrderUsageRequirements();
  renderRepairOrderParts();
}

function updateDashboardPartPickupFields() {
  const pickedUp = document.getElementById("dashboardPartPickedUp").checked;
  const label = document.getElementById("dashboardPartPickupDateLabel");
  const input = document.getElementById("dashboardPartPickupDate");
  label.hidden = !pickedUp;
  input.required = pickedUp;
  if (pickedUp && !input.value) input.value = localDateValue();
}

function updateDashboardPartPurchaseFields() {
  const purchaseType = document.getElementById("dashboardPartPurchaseType").value;
  const isMaterial = purchaseType === "Job Material";
  const isTireInventory = purchaseType === "Tire Inventory";
  const unitLabel = document.getElementById("dashboardPartOrderUnitLabel");
  const partNumberLabel = document.getElementById("dashboardPartOrderNumberLabel");
  const unitSelect = document.getElementById("dashboardPartOrderUnit");
  const partNumber = document.getElementById("dashboardPartOrderNumber");
  unitLabel.hidden = isMaterial || isTireInventory;
  partNumberLabel.hidden = isMaterial;
  unitSelect.required = !isMaterial && !isTireInventory;
  partNumber.required = !isMaterial;
  document.getElementById("dashboardPartDescriptionLabel").textContent = isMaterial ? "Material description" : isTireInventory ? "Tire description" : "Part description";
  if (isMaterial || isTireInventory) {
    unitSelect.value = "";
  }
  if (isMaterial) {
    partNumber.value = "";
  }
}

function renderDashboardPartOrderUnitOptions() {
  const select = document.getElementById("dashboardPartOrderUnit");
  if (!select) return;
  const selected = select.value;
  select.replaceChildren(new Option("Select unit", ""));
  unitTypes.forEach((unit) => select.add(new Option(`${unit.assetNumber} - ${unit.unitType}`, unit.assetNumber)));
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function loadShopPartOrders() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  const message = document.getElementById("dashboardPartOrderMessage");
  try {
    shopPartOrders = await shopApi("/api/shop-part-orders");
    renderShopPartOrders();
    renderOrdersHistory();
    renderShopDashboard();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function loadShopBadTires() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  try {
    badTires = await shopApi("/api/shop-bad-tires");
    renderTireInventoryPage();
    renderShopPartOrders();
  } catch (error) {
    const message = document.getElementById("badTiresMessage");
    if (message) message.textContent = error.message;
  }
}

async function saveDashboardPartOrder(event) {
  event.preventDefault();
  const message = document.getElementById("dashboardPartOrderMessage");
  message.textContent = "Saving";
  try {
    const pickedUp = document.getElementById("dashboardPartPickedUp").checked;
    const result = await shopApi("/api/shop-part-orders", {
      method: "POST",
      body: JSON.stringify({
        partNumber: document.getElementById("dashboardPartOrderNumber").value.trim(),
        description: document.getElementById("dashboardPartOrderDescription").value.trim(),
        vendor: document.getElementById("dashboardPartOrderVendor").value.trim(),
        quantity: Number(document.getElementById("dashboardPartOrderQuantity").value),
        purchaseType: document.getElementById("dashboardPartPurchaseType").value,
        assetNumber: document.getElementById("dashboardPartOrderUnit").value,
        unitPrice: document.getElementById("dashboardPartOrderPrice").value,
        orderDate: document.getElementById("dashboardPartOrderDate").value,
        pickedUp,
        pickupDate: pickedUp ? document.getElementById("dashboardPartPickupDate").value : ""
      })
    });
    document.getElementById("dashboardPartOrderForm").reset();
    document.getElementById("dashboardPartOrderQuantity").value = "1";
    document.getElementById("dashboardPartOrderPrice").value = "0.00";
    document.getElementById("dashboardPartOrderDate").value = localDateValue();
    document.getElementById("dashboardPartPickupDate").value = localDateValue();
    updateDashboardPartPickupFields();
    updateDashboardPartPurchaseFields();
    message.textContent = result.inventoryUpdated
      ? `${result.partNumber} already existed. Added ${result.inventoryAddedQuantity}; inventory increased from ${result.inventoryPreviousQuantity} to ${result.inventoryQuantity}. No duplicate was created.`
      : result.inventoryPartMissing
        ? `${result.partNumber} was received, but it is not registered in Parts Inventory yet.`
        : pickedUp ? "Received part saved." : "Part saved as Waiting for Order.";
    await Promise.all([loadShopPartOrders(), ...(result.purchaseType === "Tire Inventory" ? [loadShopBadTires(), loadParts()] : [])]);
  } catch (error) {
    message.textContent = error.message;
  }
}

function renderShopPartOrders() {
  const linkedTireOrderIds = new Set(
    badTires.map((item) => Number(item.partOrderId || 0)).filter(Boolean)
  );
  const olderTakenTires = badTires
    .filter((item) => item.status === "Taken for Repair" && !linkedTireOrderIds.has(Number(item.partOrderId || 0)) && !item.partOrderId)
    .map((item) => ({
      id: `bad-tire-${item.id}`,
      purchaseType: "Tire Repair",
      assetNumber: item.assetNumber,
      partNumber: item.partNumber,
      description: `${item.serviceType || "Tire repair"} - ${item.description || "Tire"}`,
      vendor: item.vendor,
      quantity: item.quantity,
      totalPrice: item.totalPrice || "0.00",
      orderDate: item.takenForRepairDate || item.createdAt?.slice(0, 10) || "",
      createdBy: item.updatedBy || item.createdBy || "",
      status: "Waiting for Order",
      legacyTireRepair: true
    }));
  const waiting = [...shopPartOrders.filter((item) => item.status === "Waiting for Order"), ...olderTakenTires];
  const today = localDateValue();
  const received = shopPartOrders.filter((item) => item.status === "Order Received" && item.pickupDate === today);
  const waitingBody = document.getElementById("dashboardWaitingParts");
  const receivedBody = document.getElementById("dashboardReceivedParts");
  waitingBody.replaceChildren();
  receivedBody.replaceChildren();
  waiting.forEach((item) => {
    const row = document.createElement("tr");
    const itemName = item.purchaseType === "Job Material" ? item.description : `${item.partNumber} - ${item.description}`;
    const tireRepair = item.purchaseType === "Tire Repair" || linkedTireOrderIds.has(Number(item.id));
    const receiveAction = item.legacyTireRepair
      ? "Recorded in Tire Inventory"
      : isShopAdmin
      ? `<div class="receive-part-action"><input class="receive-part-date" type="date" value="${localDateValue()}" aria-label="Pickup date"><button class="table-action" type="button">Order Received</button></div>`
      : "Read only";
    const typeLabel = tireRepair ? "Tire Repair" : item.purchaseType === "Job Material" ? "Other Expense" : item.purchaseType === "Tire Inventory" ? "Tire Inventory" : "Unit Part";
    row.innerHTML = `<td>${escapeHtml(typeLabel)}</td><td>${escapeHtml(item.assetNumber || "Not applicable")}</td><td><strong>${escapeHtml(itemName)}</strong></td><td>${escapeHtml(item.vendor || "Unspecified")}</td><td>${item.quantity}</td><td>$${escapeHtml(item.totalPrice)}</td><td>${escapeHtml(item.orderDate)}</td><td>${escapeHtml(item.createdBy)}</td><td>${receiveAction}</td>`;
    row.querySelector("button")?.addEventListener("click", () => receiveDashboardPartOrder(item, row));
    waitingBody.append(row);
  });
  received.forEach((item) => {
    const row = document.createElement("tr");
    const itemName = item.purchaseType === "Job Material" ? item.description : `${item.partNumber} - ${item.description}`;
    const typeLabel = linkedTireOrderIds.has(Number(item.id)) ? "Tire Repair" : item.purchaseType === "Job Material" ? "Other Expense" : item.purchaseType === "Tire Inventory" ? "Tire Inventory" : "Unit Part";
    row.innerHTML = `<td><strong>${escapeHtml(item.pickupDate)}</strong></td><td>${escapeHtml(typeLabel)}</td><td>${escapeHtml(item.assetNumber || "Not applicable")}</td><td>${escapeHtml(itemName)}</td><td>${escapeHtml(item.vendor || "Unspecified")}</td><td>${item.quantity}</td><td>$${escapeHtml(item.totalPrice)}</td><td>${escapeHtml(item.orderDate)}</td><td>${escapeHtml(item.updatedBy)}</td>`;
    receivedBody.append(row);
  });
  const dashboardRecordCount = waiting.length + received.length;
  document.getElementById("dashboardPartOrderTotal").textContent = `${dashboardRecordCount} record${dashboardRecordCount === 1 ? "" : "s"}`;
  document.getElementById("dashboardWaitingPartsTotal").textContent = `${waiting.length} waiting`;
  document.getElementById("dashboardReceivedPartsTotal").textContent = `${received.length} received`;
  document.getElementById("dashboardWaitingPartsEmpty").hidden = waiting.length > 0;
  document.getElementById("dashboardReceivedPartsEmpty").hidden = received.length > 0;
}

function renderOrdersHistory() {
  if (!isShopAdmin && !isShopViewer) return;
  const search = document.getElementById("ordersHistorySearch").value.trim().toLowerCase();
  const status = document.getElementById("ordersHistoryStatus").value;
  const purchaseType = document.getElementById("ordersHistoryType").value;
  const fromDate = document.getElementById("ordersHistoryFrom").value;
  const toDate = document.getElementById("ordersHistoryTo").value;
  const records = shopPartOrders.filter((item) => {
    const searchable = [item.partNumber, item.description, item.vendor, item.assetNumber, item.createdBy, item.updatedBy].join(" ").toLowerCase();
    const activityDate = item.status === "Order Received" ? item.pickupDate || item.orderDate : item.orderDate;
    return (!search || searchable.includes(search))
      && (status === "__all" || item.status === status)
      && (purchaseType === "__all" || item.purchaseType === purchaseType)
      && (!fromDate || activityDate >= fromDate)
      && (!toDate || activityDate <= toDate);
  });
  const body = document.getElementById("ordersHistoryList");
  body.replaceChildren();
  records.forEach((item) => {
    const row = document.createElement("tr");
    row.className = item.status === "Order Received" ? "schedule-row status-completed" : "schedule-row status-scheduled";
    row.innerHTML = `
      <td><strong>${escapeHtml(item.status)}</strong></td>
      <td>${escapeHtml(item.purchaseType === "Job Material" ? "Material for Jobs" : item.purchaseType === "Tire Inventory" ? "Tire Inventory" : "For a Unit")}</td>
      <td>${escapeHtml(item.assetNumber || "Not applicable")}</td>
      <td>${escapeHtml(item.partNumber || "Not applicable")}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.vendor || "Unspecified")}</td>
      <td>${Number(item.quantity)}</td>
      <td>$${escapeHtml(item.unitPrice)}</td>
      <td><strong>$${escapeHtml(item.totalPrice)}</strong></td>
      <td>${escapeHtml(item.orderDate)}</td>
      <td>${escapeHtml(item.pickupDate || "Not received")}</td>
      <td>${escapeHtml(item.createdBy)}</td>
      <td>${escapeHtml(item.updatedBy)}</td>
    `;
    body.append(row);
  });
  const waiting = records.filter((item) => item.status === "Waiting for Order").length;
  const received = records.filter((item) => item.status === "Order Received").length;
  const totalValue = records.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  document.getElementById("ordersHistoryCount").textContent = records.length;
  document.getElementById("ordersHistoryWaiting").textContent = waiting;
  document.getElementById("ordersHistoryReceived").textContent = received;
  document.getElementById("ordersHistoryValue").textContent = `$${totalValue.toFixed(2)}`;
  document.getElementById("ordersHistoryTotal").textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;
  document.getElementById("ordersHistoryUpdatedAt").textContent = `Updated ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  document.getElementById("ordersHistoryEmpty").hidden = records.length > 0;
}

async function receiveDashboardPartOrder(item, row) {
  const message = document.getElementById("dashboardPartOrderMessage");
  const pickupDate = row.querySelector(".receive-part-date").value;
  message.textContent = "Saving received part";
  try {
    const result = await shopApi(`/api/shop-part-orders/${item.id}/received`, {
      method: "POST",
      body: JSON.stringify({ pickupDate })
    });
    message.textContent = result.inventoryUpdated
      ? `${item.partNumber} already existed. Added ${result.inventoryAddedQuantity}; inventory increased from ${result.inventoryPreviousQuantity} to ${result.inventoryQuantity}. No duplicate was created.`
      : result.inventoryPartMissing
        ? `${item.partNumber} was received, but it is not registered in Parts Inventory yet.`
        : `${item.partNumber || "Material"} moved to Received Parts.`;
    await Promise.all([loadShopPartOrders(), ...(item.purchaseType === "Tire Inventory" ? [loadShopBadTires(), loadParts()] : [])]);
  } catch (error) {
    message.textContent = error.message;
  }
}

async function signOutShop(event) {
  event.preventDefault();
  try {
    await shopApi("/api/logout", { method: "POST" });
  } catch {
    // Local sign-out still proceeds if the server session has already expired.
  }
  localStorage.removeItem(sessionKey);
  window.location.replace("../index.html");
}

async function shopApi(path, options = {}) {
  const headers = options.headers || {};
  headers.Authorization = `Bearer ${session.token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 401) {
    localStorage.removeItem(sessionKey);
    window.location.replace("../index.html");
    throw new Error("Session expired. Please sign in again.");
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`The app server returned an invalid response${response.status ? ` (HTTP ${response.status})` : ""}. Refresh and try again.`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadWhatsAppSettings() {
  if (!isShopAdmin && !isShopTechnician) return;
  const message = document.getElementById("whatsappSettingsMessage");
  try {
    const settings = await shopApi("/api/shop-whatsapp-settings");
    document.getElementById("whatsappRecipientNumber").value = settings.recipientNumber || "";
    if (isShopTechnician) return;
    document.getElementById("whatsappEnabled").checked = Boolean(settings.enabled);
    document.getElementById("whatsappPhoneNumberId").value = settings.phoneNumberId || "";
    document.getElementById("whatsappApiVersion").value = settings.apiVersion || "v23.0";
    document.getElementById("whatsappCallbackUrl").value = `${window.location.origin}/api/whatsapp/webhook`;
    document.getElementById("whatsappAccessToken").value = "";
    document.getElementById("whatsappVerifyToken").value = "";
    document.getElementById("whatsappTokenStatus").textContent = settings.accessTokenConfigured ? "Token configured" : "Token not configured";
    document.getElementById("whatsappVerifyTokenStatus").textContent = settings.verifyTokenConfigured ? "Verify token configured" : "Verify token not configured";
    message.textContent = "";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function saveWhatsAppSettings(event) {
  event.preventDefault();
  const message = document.getElementById("whatsappSettingsMessage");
  message.textContent = "Saving";
  try {
    const result = await shopApi("/api/shop-whatsapp-settings", {
      method: "POST",
      body: JSON.stringify({
        enabled: document.getElementById("whatsappEnabled").checked,
        accessToken: document.getElementById("whatsappAccessToken").value.trim(),
        phoneNumberId: document.getElementById("whatsappPhoneNumberId").value.trim(),
        recipientNumber: document.getElementById("whatsappRecipientNumber").value.trim(),
        apiVersion: document.getElementById("whatsappApiVersion").value.trim(),
        verifyToken: document.getElementById("whatsappVerifyToken").value.trim()
      })
    });
    document.getElementById("whatsappAccessToken").value = "";
    document.getElementById("whatsappVerifyToken").value = "";
    document.getElementById("whatsappTokenStatus").textContent = result.accessTokenConfigured ? "Token configured" : "Token not configured";
    document.getElementById("whatsappVerifyTokenStatus").textContent = result.verifyTokenConfigured ? "Verify token configured" : "Verify token not configured";
    message.textContent = "WhatsApp settings saved.";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function testWhatsAppConnection() {
  const message = document.getElementById("whatsappSettingsMessage");
  message.textContent = "Sending test message";
  try {
    const result = await shopApi("/api/shop-whatsapp-settings/test", { method: "POST" });
    message.textContent = result.messageId ? `Test message sent. ID: ${result.messageId}` : "Test message sent.";
  } catch (error) {
    message.textContent = error.message;
  }
}

async function loadParts() {
  try {
    inventoryParts = await shopApi("/api/shop-parts");
    renderParts(inventoryParts);
    renderCurrentInventoryPage();
    renderTireInventoryPage();
    renderSmartTireInventory();
    renderRepairOrderParts();
    renderShopDashboard();
  } catch (error) {
    document.getElementById("partMessage").textContent = error.message;
  }
}

function renderSmartPartOptions() {
  const years = document.getElementById("smartPartYears");
  if (!years) return;
  const selectedYears = new Set([...years.selectedOptions].map((option) => option.value));
  const yearValues = [...new Set(unitTypes.map((item) => item.year).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  years.replaceChildren(...yearValues.map((year) => new Option(year, year, false, selectedYears.has(year))));
  renderSmartPartUnitTypeOptions();
  const serviceCode = document.getElementById("smartPartServiceCode");
  const selectedCode = serviceCode.value;
  serviceCode.replaceChildren(new Option("Select service code", ""));
  repairCodes.forEach((item) => serviceCode.add(new Option(`${item.code} - ${item.description}`, item.code)));
  if (repairCodes.some((item) => item.code === selectedCode)) serviceCode.value = selectedCode;
}

function isTirePart(part) {
  return Boolean(part.isTire) || String(part.serviceCode || "").trim() === "500" || String(part.description || "").toLowerCase().includes("tire");
}

function normalizedTirePartNumber(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchingExistingTire(partNumber) {
  const normalized = normalizedTirePartNumber(partNumber);
  if (!normalized) return null;
  return inventoryParts.find((part) => isTirePart(part) && normalizedTirePartNumber(part.partNumber) === normalized) || null;
}

function updateSmartTireDuplicateStatus() {
  if (!document.getElementById("smartPartIsTire").checked) return null;
  const match = matchingExistingTire(document.getElementById("smartPartNumber").value);
  const status = document.getElementById("smartPartExistingStatus");
  if (match) status.textContent = `${match.partNumber} already exists - ${match.quantity} in stock`;
  return match;
}

function renderSmartTireInventory() {
  const panel = document.getElementById("smartPartTireInventory");
  const checked = document.getElementById("smartPartIsTire").checked;
  panel.hidden = !checked;
  if (!checked) return;
  const tires = inventoryParts.filter(isTirePart).sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
  document.getElementById("smartPartTireCount").textContent = `${tires.length} tire part${tires.length === 1 ? "" : "s"}`;
  const list = document.getElementById("smartPartTireList");
  list.replaceChildren();
  tires.forEach((part) => {
    const item = document.createElement("article");
    item.className = "smart-tire-item";
    item.innerHTML = `<div><strong>${escapeHtml(part.partNumber)}</strong><span>${escapeHtml(part.description || "Tire")}</span><small>${escapeHtml(part.unitType || "Unassigned")}</small></div><strong>Qty ${Number(part.quantity || 0)}</strong><button class="secondary-button" type="button">Use existing</button>`;
    item.querySelector("button").addEventListener("click", () => {
      applySmartPartRecord(part, true);
      document.getElementById("smartPartQuantity").focus();
      document.getElementById("smartPartSaveMessage").textContent = `Adding quantity to existing tire ${part.partNumber}.`;
    });
    list.append(item);
  });
  if (!tires.length) list.innerHTML = `<p class="empty-state">No tire parts are stored yet.</p>`;
  updateSmartTireDuplicateStatus();
}

function renderSmartPartUnitTypeOptions() {
  const years = [...document.getElementById("smartPartYears").selectedOptions].map((option) => option.value);
  const select = document.getElementById("smartPartUnitType");
  const selected = select.value;
  const options = [...new Set(unitTypes.filter((item) => !years.length || years.includes(item.year)).map((item) => item.unitType).filter(Boolean))].sort();
  select.replaceChildren(new Option("Select unit type", ""));
  options.forEach((unitType) => select.add(new Option(unitType, unitType)));
  if (options.includes(selected)) select.value = selected;
  updateSmartPartFuelTypeField();
}

function updateSmartPartFuelTypeField() {
  const isTruck = document.getElementById("smartPartUnitType").value.trim().toLowerCase() === "truck";
  const field = document.getElementById("smartPartFuelTypeField");
  const select = document.getElementById("smartPartFuelType");
  field.hidden = !isTruck;
  select.disabled = !isTruck;
  select.required = isTruck;
  if (!isTruck) select.value = "";
}

function applySmartPartRecord(part, existing = false) {
  document.getElementById("smartPartNumber").value = part.partNumber || "";
  document.getElementById("smartPartDescription").value = part.description || "";
  document.getElementById("smartPartVendor").value = part.vendor || "";
  document.getElementById("smartPartPrice").value = part.price || "";
  const selectedYears = new Set(part.years || []);
  [...document.getElementById("smartPartYears").options].forEach((option) => { option.selected = selectedYears.has(option.value); });
  renderSmartPartUnitTypeOptions();
  document.getElementById("smartPartUnitType").value = part.unitType || "";
  updateSmartPartFuelTypeField();
  document.getElementById("smartPartFuelType").value = part.fuelType || "";
  document.getElementById("smartPartServiceCode").value = part.serviceCode || "";
  document.getElementById("smartPartIsTire").checked = isTirePart(part);
  renderSmartTireInventory();
  document.getElementById("smartPartExistingStatus").textContent = existing ? `${part.quantity} currently in stock` : "New part";
}

async function lookupSmartPart(event) {
  event.preventDefault();
  stopSmartPartScan();
  const query = document.getElementById("smartPartLookupInput").value.trim();
  const message = document.getElementById("smartPartLookupMessage");
  const matches = document.getElementById("smartPartMatches");
  if (!query) return;
  document.getElementById("smartPartLookupState").textContent = "Searching";
  message.textContent = "Checking inventory and online product data";
  matches.replaceChildren();
  const existing = inventoryParts.find((part) => part.partNumber.trim().toLowerCase() === query.toLowerCase());
  if (existing) {
    applySmartPartRecord(existing, true);
    message.textContent = `${existing.partNumber} is already registered. Saving will add to its quantity.`;
  } else {
    resetSmartPartForm(false);
    document.getElementById("smartPartNumber").value = query;
  }
  try {
    const result = await shopApi(`/api/shop-part-lookup?q=${encodeURIComponent(query)}`);
    renderSmartPartMatches(result.results || [], query);
    if (!existing) message.textContent = result.results.length ? "Select the best online match, then verify compatibility before registering." : "No online match was found. Complete the part information manually.";
    document.getElementById("smartPartLookupState").textContent = result.results.length ? `${result.results.length} matches` : "No match";
  } catch (error) {
    if (!existing) message.textContent = `${error.message} You can still complete the form manually.`;
    document.getElementById("smartPartLookupState").textContent = existing ? "Inventory match" : "Manual entry";
  }
}

function renderSmartPartMatches(results, query) {
  const container = document.getElementById("smartPartMatches");
  container.replaceChildren();
  results.forEach((result) => {
    const item = document.createElement("article");
    item.className = "smart-part-match";
    item.innerHTML = `<div><strong>${escapeHtml(result.description || query)}</strong><span>${escapeHtml(result.vendor || "Unspecified")}${result.category ? ` - ${escapeHtml(result.category)}` : ""}</span></div><span>${result.price ? `$${escapeHtml(result.price)}` : "Price unavailable"}</span><button type="button">Use result</button>`;
    item.querySelector("button").addEventListener("click", () => applySmartPartRecord({ ...result, partNumber: query }, false));
    container.append(item);
  });
}

function resetSmartPartForm(clearLookup = true) {
  document.getElementById("smartPartForm").reset();
  document.getElementById("smartPartQuantity").value = "1";
  document.getElementById("smartPartExistingStatus").textContent = "New part";
  document.getElementById("smartPartSaveMessage").textContent = "";
  renderSmartPartOptions();
  renderSmartTireInventory();
  if (clearLookup) {
    document.getElementById("smartPartLookupForm").reset();
    document.getElementById("smartPartMatches").replaceChildren();
    document.getElementById("smartPartLookupMessage").textContent = "";
    document.getElementById("smartPartLookupState").textContent = "Ready";
  }
}

async function saveSmartPart(event) {
  event.preventDefault();
  const message = document.getElementById("smartPartSaveMessage");
  const isTire = document.getElementById("smartPartIsTire").checked;
  const enteredPartNumber = document.getElementById("smartPartNumber").value.trim();
  const existingTire = isTire ? matchingExistingTire(enteredPartNumber) : null;
  if (existingTire && existingTire.partNumber.toLowerCase() !== enteredPartNumber.toLowerCase()) {
    applySmartPartRecord(existingTire, true);
    message.textContent = `${enteredPartNumber} matches existing tire ${existingTire.partNumber}. Enter the quantity to add to the existing tire.`;
    return;
  }
  message.textContent = "Saving";
  try {
    const result = await shopApi("/api/shop-parts", { method: "POST", body: JSON.stringify({
      partNumber: document.getElementById("smartPartNumber").value.trim(),
      description: document.getElementById("smartPartDescription").value.trim(),
      vendor: document.getElementById("smartPartVendor").value.trim(),
      price: document.getElementById("smartPartPrice").value,
      years: [...document.getElementById("smartPartYears").selectedOptions].map((option) => option.value),
      unitType: document.getElementById("smartPartUnitType").value,
      fuelType: document.getElementById("smartPartFuelType").value,
      serviceCode: document.getElementById("smartPartServiceCode").value,
      isTire,
      quantity: document.getElementById("smartPartQuantity").value,
      replaceQuantity: false
    }) });
    await loadParts();
    resetSmartPartForm();
    message.textContent = `${result.partNumber} now has ${result.quantity} in stock.`;
  } catch (error) {
    message.textContent = error.message;
  }
}

function openSmartPartCompatibilitySearch() {
  const partNumber = document.getElementById("smartPartNumber").value.trim() || document.getElementById("smartPartLookupInput").value.trim();
  const description = document.getElementById("smartPartDescription").value.trim();
  if (!partNumber) {
    document.getElementById("smartPartSaveMessage").textContent = "Enter or scan a part number first.";
    return;
  }
  window.open(`https://www.google.com/search?q=${encodeURIComponent(`${partNumber} ${description} fitment compatible models years`)}`, "_blank", "noopener,noreferrer");
}

async function startSmartPartScan() {
  const message = document.getElementById("smartPartLookupMessage");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    message.textContent = "Camera access is not available in this browser. Enter the barcode or part number manually.";
    return;
  }
  try {
    prepareSmartPartScanSound();
    if ("BarcodeDetector" in window) {
      smartPartBarcodeDetector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] });
    } else if (typeof window.jsQR !== "function") {
      message.textContent = "Barcode scanning is not supported in this browser. Enter the barcode or part number manually.";
      return;
    }
    smartPartScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = document.getElementById("smartPartScanVideo");
    video.srcObject = smartPartScanStream;
    await video.play();
    document.getElementById("smartPartScanner").hidden = false;
    document.getElementById("smartPartScanButton").hidden = true;
    document.getElementById("smartPartStopScanButton").hidden = false;
    message.textContent = "Point the camera at the barcode on the box.";
    let lastCheck = 0;
    const scan = async (time) => {
      if (!smartPartScanStream) return;
      if (time - lastCheck > 350) {
        lastCheck = time;
        const codes = await detectSmartPartCodes(video);
        if (codes.length) {
          playSmartPartScanSound();
          document.getElementById("smartPartLookupInput").value = codes[0].rawValue;
          stopSmartPartScan();
          document.getElementById("smartPartLookupForm").requestSubmit();
          return;
        }
      }
      smartPartScanFrame = requestAnimationFrame(scan);
    };
    smartPartScanFrame = requestAnimationFrame(scan);
  } catch (error) {
    stopSmartPartScan();
    message.textContent = error.name === "NotAllowedError" ? "Camera permission was denied." : "The camera could not start. Enter the part number manually.";
  }
}

async function detectSmartPartCodes(video) {
  if (smartPartBarcodeDetector) return smartPartBarcodeDetector.detect(video);
  if (typeof window.jsQR !== "function" || !video.videoWidth) return [];
  smartPartScanCanvas = smartPartScanCanvas || document.createElement("canvas");
  smartPartScanContext = smartPartScanContext || smartPartScanCanvas.getContext("2d", { willReadFrequently: true });
  smartPartScanCanvas.width = video.videoWidth;
  smartPartScanCanvas.height = video.videoHeight;
  smartPartScanContext.drawImage(video, 0, 0, smartPartScanCanvas.width, smartPartScanCanvas.height);
  const frame = smartPartScanContext.getImageData(0, 0, smartPartScanCanvas.width, smartPartScanCanvas.height);
  const result = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
  return result && result.data ? [{ rawValue: result.data }] : [];
}

function prepareSmartPartScanSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  smartPartAudioContext = smartPartAudioContext || new AudioContext();
  if (smartPartAudioContext.state === "suspended") smartPartAudioContext.resume().catch(() => {});
}

function playSmartPartScanSound() {
  prepareSmartPartScanSound();
  if (!smartPartAudioContext || smartPartAudioContext.state !== "running") return;
  const now = smartPartAudioContext.currentTime;
  const oscillator = smartPartAudioContext.createOscillator();
  const gain = smartPartAudioContext.createGain();
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.setValueAtTime(1175, now + 0.07);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  oscillator.connect(gain);
  gain.connect(smartPartAudioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.17);
}

function stopSmartPartScan() {
  cancelAnimationFrame(smartPartScanFrame);
  smartPartScanFrame = 0;
  if (smartPartScanStream) smartPartScanStream.getTracks().forEach((track) => track.stop());
  smartPartScanStream = null;
  smartPartBarcodeDetector = null;
  const video = document.getElementById("smartPartScanVideo");
  if (video) video.srcObject = null;
  document.getElementById("smartPartScanner").hidden = true;
  document.getElementById("smartPartScanButton").hidden = false;
  document.getElementById("smartPartStopScanButton").hidden = true;
}

function renderCurrentInventoryPage() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  const parts = inventoryParts
    .map((part) => {
      const quantity = Number(part.quantity || 0);
      const unitPrice = Number(part.price || 0);
      return { ...part, quantity, unitPrice, value: quantity * unitPrice };
    })
    .sort((a, b) => b.value - a.value || b.quantity - a.quantity);
  const totalQuantity = parts.reduce((sum, part) => sum + part.quantity, 0);
  const totalValue = parts.reduce((sum, part) => sum + part.value, 0);
  const quantityMax = Math.max(1, ...parts.map((part) => part.quantity));
  const valueMax = Math.max(1, ...parts.map((part) => part.value));

  document.getElementById("currentInventoryPartCount").textContent = parts.length;
  document.getElementById("currentInventoryQuantity").textContent = totalQuantity;
  document.getElementById("currentInventoryValue").textContent = `$${totalValue.toFixed(2)}`;
  document.getElementById("currentInventoryUpdatedAt").textContent = `Updated ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  document.getElementById("currentInventoryTableTotal").textContent = `${parts.length} part${parts.length === 1 ? "" : "s"}`;

  const chart = document.getElementById("currentInventoryChart");
  chart.innerHTML = parts.length ? parts.map((part) => `
    <section class="inventory-part-row" title="${escapeHtml(part.partNumber)} - ${escapeHtml(part.description || "No description")}">
      <div class="inventory-part-label"><strong>${escapeHtml(part.partNumber)}</strong><span>${escapeHtml(part.description || "No description")}</span></div>
      <div class="inventory-measures">
        <div><span>Qty ${part.quantity}</span><div class="chart-track"><div class="inventory-quantity-bar" style="width:${(part.quantity / quantityMax) * 100}%"></div></div></div>
        <div><span>$${part.value.toFixed(2)}</span><div class="chart-track"><div class="inventory-value-bar" style="width:${(part.value / valueMax) * 100}%"></div></div></div>
      </div>
    </section>
  `).join("") : `<p class="expense-empty">No parts are currently in inventory.</p>`;

  const table = document.getElementById("currentInventoryTable");
  table.innerHTML = parts.map((part) => `
    <tr>
      <td><strong>${escapeHtml(part.partNumber)}</strong></td>
      <td class="table-cell-lines">${escapeHtml(part.description || "No description")}</td>
      <td>${escapeHtml(part.vendor || "Unspecified")}</td>
      <td>$${part.unitPrice.toFixed(2)}</td>
      <td>${part.quantity}</td>
      <td><strong>$${part.value.toFixed(2)}</strong></td>
    </tr>
  `).join("");
  document.getElementById("currentInventoryEmpty").hidden = parts.length > 0;
}

function renderTireInventoryPage() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  const tires = inventoryParts
    .filter(isTirePart)
    .map((part) => {
      const quantity = Number(part.quantity || 0);
      const unitPrice = Number(part.price || 0);
      return { ...part, quantity, unitPrice, value: quantity * unitPrice };
    })
    .sort((a, b) => String(a.unitType || "Unassigned").localeCompare(String(b.unitType || "Unassigned")) || b.quantity - a.quantity || a.partNumber.localeCompare(b.partNumber));
  const totalQuantity = tires.reduce((sum, part) => sum + part.quantity, 0);
  const totalValue = tires.reduce((sum, part) => sum + part.value, 0);
  const groupedTires = [...tires.reduce((groups, part) => {
    const unitType = String(part.unitType || "Unassigned").trim() || "Unassigned";
    if (!groups.has(unitType)) groups.set(unitType, []);
    groups.get(unitType).push(part);
    return groups;
  }, new Map()).entries()].map(([unitType, parts]) => ({
    unitType,
    parts,
    quantity: parts.reduce((sum, part) => sum + part.quantity, 0),
    value: parts.reduce((sum, part) => sum + part.value, 0)
  }));
  const quantityMax = Math.max(1, ...groupedTires.map((group) => group.quantity));
  const valueMax = Math.max(1, ...groupedTires.map((group) => group.value));

  document.getElementById("tireInventoryPartCount").textContent = tires.length;
  document.getElementById("tireInventoryQuantity").textContent = totalQuantity;
  document.getElementById("tireInventoryValue").textContent = `$${totalValue.toFixed(2)}`;
  document.getElementById("tireInventoryChartTotal").textContent = `${totalQuantity} tire${totalQuantity === 1 ? "" : "s"}`;
  document.getElementById("tireInventoryTableTotal").textContent = `${tires.length} part${tires.length === 1 ? "" : "s"}`;
  document.getElementById("tireInventoryUpdatedAt").textContent = `Updated ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;

  document.getElementById("tireInventoryChart").innerHTML = groupedTires.length ? groupedTires.map((group) => `
    <section class="inventory-part-row">
      <div class="inventory-part-label"><strong>${escapeHtml(group.unitType)}</strong><span>${group.parts.length} tire part number${group.parts.length === 1 ? "" : "s"}</span></div>
      <div class="inventory-measures">
        <div><span>Qty ${group.quantity}</span><div class="chart-track"><div class="inventory-quantity-bar" style="width:${(group.quantity / quantityMax) * 100}%"></div></div></div>
        <div><span>$${group.value.toFixed(2)}</span><div class="chart-track"><div class="inventory-value-bar" style="width:${(group.value / valueMax) * 100}%"></div></div></div>
      </div>
    </section>
  `).join("") : `<p class="expense-empty">No tire parts have been added.</p>`;

  document.getElementById("tireInventoryTable").innerHTML = groupedTires.map((group) => `
    <tr class="inventory-group-row"><th colspan="7">${escapeHtml(group.unitType)}<span>${group.quantity} tires - $${group.value.toFixed(2)}</span></th></tr>
    ${group.parts.map((part) => `
      <tr>
        <td><strong>${escapeHtml(part.partNumber)}</strong></td>
        <td class="table-cell-lines">${escapeHtml(part.description || "No description")}</td>
        <td>${escapeHtml(part.vendor || "Unspecified")}</td>
        <td>${escapeHtml((part.years || []).join(", ") || part.year || "All")}</td>
        <td>$${part.unitPrice.toFixed(2)}</td>
        <td><strong>${part.quantity}</strong></td>
        <td><strong>$${part.value.toFixed(2)}</strong></td>
      </tr>
    `).join("")}
  `).join("");
  document.getElementById("tireInventoryEmpty").hidden = tires.length > 0;
  renderBadTires();
}

function renderBadTires() {
  const waiting = badTires.filter((item) => item.status === "Waiting to Be Taken for Repair");
  const taken = badTires.filter((item) => item.status === "Taken for Repair");
  const waitingQuantity = waiting.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  document.getElementById("badTiresWaitingQuantity").textContent = waitingQuantity;
  document.getElementById("badTiresWaitingTotal").textContent = `${waiting.length} record${waiting.length === 1 ? "" : "s"}`;
  document.getElementById("badTiresTakenTotal").textContent = `${taken.length} record${taken.length === 1 ? "" : "s"}`;

  const waitingTable = document.getElementById("badTiresWaitingTable");
  waitingTable.innerHTML = waiting.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.assetNumber)}</strong></td>
      <td>${escapeHtml(item.partNumber)}</td>
      <td class="table-cell-lines">${escapeHtml(item.description || "No description")}</td>
      <td><strong>${Number(item.quantity)}</strong></td>
      <td>${escapeHtml(item.mechanic || "Unassigned")}</td>
      <td><span class="bad-tire-status waiting">${escapeHtml(item.status)}</span></td>
      <td>${isShopAdmin || isShopTechnician ? `
        <div class="bad-tire-repair-form">
          <select aria-label="Tire repair type"><option value="">Select service</option><option>Fix Flat</option><option>Replace Tire</option></select>
          <input type="text" placeholder="Repair shop / vendor" aria-label="Repair shop or vendor">
          <input type="number" min="0.01" step="0.01" placeholder="Cost each" aria-label="Cost per tire">
          <input type="date" value="${localDateValue()}" aria-label="Date taken for repair">
          <button class="table-action" type="button" data-bad-tire-id="${item.id}">Take for Repair</button>
        </div>` : "View only"}</td>
    </tr>
  `).join("");
  waitingTable.querySelectorAll("button[data-bad-tire-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest(".bad-tire-repair-form");
      takeBadTireForRepair(button.dataset.badTireId, {
        serviceType: form.querySelector("select").value,
        vendor: form.querySelector("input[type='text']").value.trim(),
        unitPrice: form.querySelector("input[type='number']").value,
        takenForRepairDate: form.querySelector("input[type='date']").value
      }, button);
    });
  });

  document.getElementById("badTiresTakenTable").innerHTML = taken.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.takenForRepairDate || "Not recorded")}</strong></td>
      <td><strong>${escapeHtml(item.assetNumber)}</strong></td>
      <td>${escapeHtml(item.partNumber)}</td>
      <td>${escapeHtml(item.serviceType || "Not recorded")}</td>
      <td>${escapeHtml(item.vendor || "Unspecified")}</td>
      <td><strong>${Number(item.quantity)}</strong></td>
      <td><strong>$${escapeHtml(item.totalPrice || "0.00")}</strong></td>
      <td><span class="bad-tire-status ${item.partOrderStatus === "Order Received" ? "received" : "waiting"}">${escapeHtml(item.partOrderStatus === "Order Received" ? "Repair Received" : "Waiting for Repair Return")}</span></td>
      <td>${escapeHtml(item.updatedBy || "")}</td>
    </tr>
  `).join("");
  document.getElementById("badTiresWaitingEmpty").hidden = waiting.length > 0;
  document.getElementById("badTiresTakenEmpty").hidden = taken.length > 0;
}

async function takeBadTireForRepair(recordId, details, button) {
  const message = document.getElementById("badTiresMessage");
  if (!details.serviceType || !details.vendor || !details.unitPrice || !details.takenForRepairDate) {
    message.textContent = "Select the service and enter the repair shop, cost, and date.";
    return;
  }
  button.disabled = true;
  message.textContent = "Updating bad tire status...";
  try {
    await shopApi(`/api/shop-bad-tires/${encodeURIComponent(recordId)}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "Taken for Repair", ...details })
    });
    message.textContent = "Tires moved to Taken for Repair and added to Parts Ordered.";
    await Promise.all([loadShopBadTires(), loadShopPartOrders()]);
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
}

async function savePart(event) {
  event.preventDefault();
  const message = document.getElementById("partMessage");
  message.textContent = "Saving";
  try {
    const saved = await shopApi("/api/shop-parts", {
      method: "POST",
      body: JSON.stringify({
        partNumber: document.getElementById("partNumber").value.trim(),
        description: document.getElementById("partDescription").value.trim(),
        vendor: document.getElementById("partVendor").value.trim(),
        price: document.getElementById("partPrice").value,
        years: [...document.getElementById("partYear").selectedOptions].map((option) => option.value),
        unitType: document.getElementById("partUnitType").value,
        fuelType: isTruckPartUnitType() ? document.getElementById("partFuelType").value : "",
        serviceCode: document.getElementById("partServiceCode").value,
        quantity: document.getElementById("partQuantity").value,
        replaceQuantity: Boolean(editingPartNumber)
      })
    });
    const wasEditing = Boolean(editingPartNumber);
    resetPartForm();
    message.textContent = wasEditing
      ? `${saved.partNumber} was updated with ${saved.quantity} in stock.`
      : saved.wasExisting
        ? `${saved.partNumber} already existed. Added ${saved.quantityAdded}; inventory increased from ${saved.previousQuantity} to ${saved.quantity}. No duplicate was created.`
        : `${saved.partNumber} was added with ${saved.quantity} in stock.`;
    await loadParts();
  } catch (error) {
    message.textContent = error.message;
  }
}

function renderParts(parts) {
  const tbody = document.getElementById("partsTable");
  tbody.replaceChildren();
  parts.forEach((part) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(part.partNumber)}</strong></td>
      <td class="table-cell-lines">${escapeHtml(part.description || "Not set")}</td>
      <td>${escapeHtml(part.vendor || "Unspecified")}</td>
      <td>$${escapeHtml(part.price)}</td>
      <td>${escapeHtml((part.years || [part.year]).filter(Boolean).join(", ") || "Not set")}</td>
      <td>${escapeHtml(part.unitType || "Not set")}</td>
      <td>${escapeHtml(part.fuelType || "Not set")}</td>
      <td>${escapeHtml(part.serviceCode || "Not set")}</td>
      <td>${Number(part.quantity || 0)}</td>
      <td>${escapeHtml(part.updatedBy || "Unknown")}</td>
      <td class="table-actions">
        <button class="table-action edit-part" type="button">Edit</button>
        <button class="table-action danger-action delete-part" type="button">Delete</button>
      </td>
    `;
    row.querySelector(".edit-part").addEventListener("click", () => editPart(part));
    row.querySelector(".delete-part").addEventListener("click", () => deletePart(part));
    tbody.append(row);
  });
  document.getElementById("partsTotal").textContent = `${parts.length} part${parts.length === 1 ? "" : "s"}`;
  document.getElementById("partsEmpty").hidden = parts.length > 0;
}

async function deletePart(part) {
  if (!confirm(`Delete part ${part.partNumber}? This cannot be undone.`)) return;
  const message = document.getElementById("partMessage");
  message.textContent = "Deleting";
  try {
    await shopApi(`/api/shop-parts/${encodeURIComponent(part.partNumber)}`, { method: "DELETE" });
    if (editingPartNumber.toLowerCase() === part.partNumber.toLowerCase()) resetPartForm();
    message.textContent = `${part.partNumber} was deleted.`;
    await loadParts();
  } catch (error) {
    message.textContent = error.message;
  }
}

function editPart(part) {
  editingPartNumber = part.partNumber;
  document.getElementById("partNumber").value = part.partNumber;
  document.getElementById("partNumber").readOnly = true;
  document.getElementById("partDescription").value = part.description || "";
  document.getElementById("partVendor").value = part.vendor || "Unspecified";
  document.getElementById("partPrice").value = part.price;
  const selectedYears = new Set(part.years || [part.year]);
  [...document.getElementById("partYear").options].forEach((option) => { option.selected = selectedYears.has(option.value); });
  renderPartUnitTypeOptions();
  document.getElementById("partUnitType").value = part.unitType;
  document.getElementById("partFuelType").value = part.fuelType || "";
  updatePartFuelTypeField();
  document.getElementById("partServiceCode").value = part.serviceCode;
  document.getElementById("partQuantity").value = part.quantity;
  document.getElementById("partQuantity").min = "0";
  document.getElementById("partSubmitButton").textContent = "Update part";
  document.getElementById("partCancelButton").hidden = false;
  document.getElementById("partMessage").textContent = `Editing ${part.partNumber}`;
  document.getElementById("partForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetPartForm() {
  editingPartNumber = "";
  document.getElementById("partForm").reset();
  document.getElementById("partNumber").readOnly = false;
  document.getElementById("partQuantity").min = "1";
  document.getElementById("partSubmitButton").textContent = "Save part";
  document.getElementById("partCancelButton").hidden = true;
  renderPartUnitTypeOptions();
}

function isTruckPartUnitType() {
  return document.getElementById("partUnitType").value.trim().toLowerCase() === "truck";
}

function updatePartFuelTypeField() {
  const field = document.getElementById("partFuelTypeField");
  const select = document.getElementById("partFuelType");
  const isTruck = isTruckPartUnitType();
  field.hidden = !isTruck;
  select.required = isTruck;
  select.disabled = !isTruck;
  if (!isTruck) select.value = "";
}

function updateOutOfServiceThirdPartyFields() {
  const isThirdParty = ["Needs 3rd Party", "Repairing at 3rd Party"].includes(document.getElementById("outOfServiceStatus").value);
  const fields = document.getElementById("outOfServiceThirdPartyFields");
  const shop = document.getElementById("outOfServiceThirdPartyShop");
  const date = document.getElementById("outOfServiceThirdPartyDate");
  fields.hidden = !isThirdParty;
  shop.required = isThirdParty;
  date.required = isThirdParty;
  if (!isThirdParty) {
    shop.value = "";
    date.value = "";
  }
}

function renderOutOfServiceAssetOptions() {
  const select = document.getElementById("outOfServiceAsset");
  const selected = select.value;
  const activeAssets = new Set(
    outOfServiceReports
      .filter((report) => report.status !== "Fixed")
      .map((report) => report.assetNumber.toLowerCase())
  );
  select.replaceChildren(new Option("Select unit", ""));
  unitTypes
    .filter((unit) => !activeAssets.has(String(unit.assetNumber).toLowerCase()))
    .sort((a, b) => String(a.assetNumber).localeCompare(String(b.assetNumber), undefined, { numeric: true }))
    .forEach((unit) => {
      const details = [unit.unitType, unit.make, unit.model].filter(Boolean).join(" ");
      select.add(new Option(`${unit.assetNumber} - ${details}`, unit.assetNumber));
    });
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

async function loadOutOfServiceReports() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  const message = document.getElementById("outOfServiceMessage");
  try {
    outOfServiceReports = await shopApi("/api/shop-out-of-service");
    renderOutOfServiceReports();
    renderOutOfServiceAssetOptions();
    renderShopDashboard();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function saveOutOfServiceReport(event) {
  event.preventDefault();
  const message = document.getElementById("outOfServiceMessage");
  message.textContent = "Saving";
  try {
    const saved = await shopApi("/api/shop-out-of-service", {
      method: "POST",
      body: JSON.stringify({
        assetNumber: document.getElementById("outOfServiceAsset").value,
        outDate: document.getElementById("outOfServiceDate").value,
        etaDate: document.getElementById("outOfServiceEta").value,
        noEta: document.getElementById("outOfServiceNoEta").checked,
        issue: document.getElementById("outOfServiceIssue").value.trim(),
        status: document.getElementById("outOfServiceStatus").value,
        thirdPartyShop: document.getElementById("outOfServiceThirdPartyShop").value.trim(),
        thirdPartySendDate: document.getElementById("outOfServiceThirdPartyDate").value
      })
    });
    document.getElementById("outOfServiceForm").reset();
    document.getElementById("outOfServiceDate").value = localDateValue();
    document.getElementById("outOfServiceStatus").value = "Diagnosing";
    updateOutOfServiceEtaRequirement();
    updateOutOfServiceThirdPartyFields();
    message.textContent = `${saved.assetNumber} is now out of service.`;
    await loadOutOfServiceReports();
  } catch (error) {
    message.textContent = error.message;
  }
}

function updateOutOfServiceEtaRequirement() {
  const noEta = document.getElementById("outOfServiceNoEta").checked;
  const etaInput = document.getElementById("outOfServiceEta");
  etaInput.required = !noEta;
  etaInput.disabled = noEta;
  if (noEta) etaInput.value = "";
}

function outOfServiceStatusClass(status) {
  return `status-${String(status).toLowerCase().replaceAll(" ", "-")}`;
}

function renderOutOfServiceReports() {
  const list = document.getElementById("outOfServiceList");
  list.replaceChildren();
  outOfServiceReports.forEach((report) => {
    const row = document.createElement("tr");
    row.className = `schedule-row ${outOfServiceStatusClass(report.status)}`;
    const thirdPartyDetails = isShopAdmin && ["Needs 3rd Party", "Repairing at 3rd Party"].includes(report.status)
      ? `<div class="table-field-stack"><input class="report-third-party-shop" value="${escapeHtml(report.thirdPartyShop)}" aria-label="Third-party shop" placeholder="Shop name"><input class="report-third-party-date" type="date" value="${escapeHtml(report.thirdPartySendDate)}" aria-label="Date to be sent"></div>`
      : report.status === "Fixed" && report.fixedAt
        ? `<div class="table-cell-lines"><strong>Completed ${escapeHtml(report.completedDate || report.fixedAt.slice(0, 10))}</strong>\nRepair cost: $${escapeHtml(report.repairCost || "0.00")}\n${escapeHtml(report.repairNotes || "No repair notes")}\nRO #${escapeHtml(report.repairOrderId || "Not linked")}</div>`
        : "Not required";
    row.innerHTML = `
      <td><strong>${escapeHtml(report.assetNumber)}</strong></td>
      <td>${escapeHtml(report.outDate)}</td>
      <td>${report.status === "Fixed" || !isShopAdmin ? escapeHtml(report.noEta ? "No ETA" : report.etaDate || "Not set") : `<div class="table-field-stack"><input class="report-eta-date table-date-input" type="date" value="${escapeHtml(report.etaDate || "")}" aria-label="ETA to fix" ${report.noEta ? "disabled" : ""}><label class="compact-switch"><input class="report-no-eta" type="checkbox" role="switch" ${report.noEta ? "checked" : ""}> No ETA</label></div>`}</td>
      <td class="table-cell-lines">${escapeHtml(report.issue)}</td>
      <td>${report.status === "Fixed" ? `<strong>Fix Completed</strong>` : isShopAdmin ? `<select class="table-status-select report-status" aria-label="Repair status"></select>` : escapeHtml(report.status)}</td>
      <td class="report-third-party-cell">${thirdPartyDetails}</td>
      <td>${escapeHtml(report.updatedBy || "Unknown")}</td>
      <td>${report.status === "Fixed" ? "Back in service" : isShopAdmin ? `<button class="table-action update-out-of-service" type="button">Update</button>` : "View only"}</td>
    `;
    if (report.status !== "Fixed" && isShopAdmin) {
      const statusSelect = row.querySelector(".report-status");
      ["Diagnosing", "Waiting for Parts", "Needs 3rd Party", "Repairing at 3rd Party", "Sent to Auction"].forEach((status) => statusSelect.add(new Option(status, status)));
      statusSelect.add(new Option("Fix Completed", "Fixed"));
      statusSelect.value = report.status;
      statusSelect.addEventListener("change", () => renderOutOfServiceRowThirdParty(row, statusSelect.value, report));
      row.querySelector(".report-no-eta").addEventListener("change", (event) => {
        const etaInput = row.querySelector(".report-eta-date");
        etaInput.disabled = event.target.checked;
        if (event.target.checked) etaInput.value = "";
      });
      row.querySelector(".update-out-of-service").addEventListener("click", () => updateOutOfServiceReport(report, row));
    }
    list.append(row);
  });
  document.getElementById("outOfServiceTotal").textContent = `${outOfServiceReports.length} report${outOfServiceReports.length === 1 ? "" : "s"}`;
  document.getElementById("outOfServiceEmpty").hidden = outOfServiceReports.length > 0;
}

function renderOutOfServiceRowThirdParty(row, status, report) {
  const cell = row.querySelector(".report-third-party-cell");
  if (["Needs 3rd Party", "Repairing at 3rd Party"].includes(status)) {
    cell.innerHTML = `<div class="table-field-stack"><input class="report-third-party-shop" value="${escapeHtml(report.thirdPartyShop || "")}" aria-label="Third-party shop" placeholder="Shop name"><input class="report-third-party-date" type="date" value="${escapeHtml(report.thirdPartySendDate || "")}" aria-label="Date to be sent"></div>`;
  } else if (status === "Fixed") {
    cell.innerHTML = `<div class="table-field-stack"><label>Repair cost<input class="report-repair-cost" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(report.repairCost || "0.00")}"></label><label>Repair notes<textarea class="report-repair-notes" rows="3" aria-label="Completed repair notes"></textarea></label><small>Completion date will be saved automatically.</small></div>`;
  } else {
    cell.textContent = "Not required";
  }
}

async function updateOutOfServiceReport(report, row) {
  const message = document.getElementById("outOfServiceMessage");
  const status = row.querySelector(".report-status").value;
  const etaDate = row.querySelector(".report-eta-date")?.value || report.etaDate || "";
  const noEta = row.querySelector(".report-no-eta")?.checked || false;
  const shop = row.querySelector(".report-third-party-shop")?.value.trim() || "";
  const sendDate = row.querySelector(".report-third-party-date")?.value || "";
  const repairCost = row.querySelector(".report-repair-cost")?.value || "0";
  const repairNotes = row.querySelector(".report-repair-notes")?.value.trim() || "";
  message.textContent = "Updating";
  try {
    await shopApi(`/api/shop-out-of-service/${report.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status, etaDate, noEta, thirdPartyShop: shop, thirdPartySendDate: sendDate, repairCost, repairNotes })
    });
    message.textContent = status === "Fixed"
      ? `${report.assetNumber} is back in service and a saved repair order was created.`
      : `${report.assetNumber} status was updated.`;
    await Promise.all([loadOutOfServiceReports(), ...(status === "Fixed" ? [loadRepairOrders()] : [])]);
  } catch (error) {
    message.textContent = error.message;
  }
}

function setShopPage(page) {
  if (page !== "smart-part-intake") stopSmartPartScan();
  if (isShopTechnician && !["dashboard", "current-inventory", "tire-inventory", "smart-part-intake", "unit-types", "repair-orders", "out-of-service", "saved-repair-orders", "unit-repair-history", "scheduled-repairs"].includes(page)) page = "dashboard";
  else if (isShopViewer && !["dashboard", "orders-history", "current-inventory", "tire-inventory", "saved-repair-orders", "unit-repair-history", "scheduled-repairs"].includes(page)) page = "dashboard";
  else if (!isShopAdmin && !isShopViewer && !isShopTechnician && !["schedule-service", "scheduled-repairs"].includes(page)) page = "schedule-service";
  document.querySelectorAll("[data-shop-page-view]").forEach((section) => {
    section.hidden = section.dataset.shopPageView !== page;
  });
  document.querySelectorAll("[data-shop-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shopPage === page);
  });
}

function setDashboardExpenseMode(mode) {
  dashboardExpenseMode = ["month", "vendor", "inventory"].includes(mode) ? mode : "month";
  if (dashboardExpenseMode !== "month") dashboardSelectedMonth = "";
  const monthTab = document.getElementById("dashboardExpenseMonthTab");
  const vendorTab = document.getElementById("dashboardExpenseVendorTab");
  const inventoryTab = document.getElementById("dashboardExpenseInventoryTab");
  monthTab.classList.toggle("active", dashboardExpenseMode === "month");
  vendorTab.classList.toggle("active", dashboardExpenseMode === "vendor");
  inventoryTab.classList.toggle("active", dashboardExpenseMode === "inventory");
  monthTab.setAttribute("aria-selected", String(dashboardExpenseMode === "month"));
  vendorTab.setAttribute("aria-selected", String(dashboardExpenseMode === "vendor"));
  inventoryTab.setAttribute("aria-selected", String(dashboardExpenseMode === "inventory"));
  renderShopDashboard();
}

function renderMonthPartsDrilldown(month) {
  const panel = document.getElementById("dashboardPartsDrilldown");
  const chart = document.getElementById("dashboardPartsDrilldownChart");
  if (!month || dashboardExpenseMode !== "month") {
    panel.hidden = true;
    return;
  }
  const partTotals = new Map();
  repairOrders.forEach((order) => {
    if (String(order.date || "").slice(0, 7) !== month.key) return;
    (order.partsUsed || []).forEach((part) => {
      const partNumber = String(part.partNumber || "Unknown");
      partTotals.set(partNumber, (partTotals.get(partNumber) || 0) + Number(part.quantity || 0));
    });
  });
  const parts = [...partTotals.entries()].filter(([, quantity]) => quantity > 0).sort((a, b) => b[1] - a[1]);
  const maxQuantity = Math.max(1, ...parts.map(([, quantity]) => quantity));
  const totalQuantity = parts.reduce((sum, [, quantity]) => sum + quantity, 0);
  document.getElementById("dashboardPartsDrilldownTitle").textContent = `Parts used in ${month.fullLabel}`;
  document.getElementById("dashboardPartsDrilldownTotal").textContent = `${totalQuantity} total part${totalQuantity === 1 ? "" : "s"}`;
  chart.innerHTML = parts.length ? parts.map(([partNumber, quantity]) => `
    <div class="parts-quantity-row" title="${escapeHtml(partNumber)}: ${quantity}">
      <span>${escapeHtml(partNumber)}</span>
      <div class="chart-track"><div class="parts-quantity-bar" style="width:${(quantity / maxQuantity) * 100}%"></div></div>
      <strong>${quantity}</strong>
    </div>
  `).join("") : `<p class="expense-empty">No parts were recorded for this month.</p>`;
  panel.hidden = false;
}

function isRepairOrderForDate(order, date) {
  const status = order.status || "Completed";
  if (status === "Completed") {
    return order.completedDate === date || (!order.completedDate && order.date === date);
  }
  if (status === "Working on it") {
    return true;
  }
  return false;
}

function renderShopDashboard() {
  if (!isShopAdmin && !isShopViewer && !isShopTechnician) return;
  const scheduled = serviceSchedules.filter((item) => item.status === "Scheduled").length;
  const working = serviceSchedules.filter((item) => item.status === "Working on it").length;
  const completed = repairOrders.filter((item) => (item.status || "Completed") === "Completed").length;
  const cancelled = repairOrders.filter((item) => item.status === "Cancelled").length;
  const activeOutOfService = outOfServiceReports.filter((report) => report.status !== "Fixed");
  const receivedPurchases = shopPartOrders.filter((item) => item.status === "Order Received");
  const unitPurchaseExpense = receivedPurchases.filter((item) => item.purchaseType === "Unit Part" || item.purchaseType === "Tire Inventory").reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const otherExpense = receivedPurchases.filter((item) => item.purchaseType === "Job Material").reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const partsExpense = repairOrders.reduce((sum, item) => sum + Number(item.partsTotal || 0), 0) + unitPurchaseExpense;
  const statusCounts = [
    ["Scheduled", scheduled, "scheduled"],
    ["Working", working, "working"],
    ["Completed", completed, "completed"],
    ["Cancelled", cancelled, "cancelled"]
  ];
  const statusTotal = statusCounts.reduce((sum, [, count]) => sum + count, 0);
  const statusMax = Math.max(1, ...statusCounts.map(([, count]) => count));

  document.getElementById("dashboardOpenServices").textContent = scheduled + working;
  document.getElementById("dashboardScheduled").textContent = scheduled;
  document.getElementById("dashboardWorking").textContent = working;
  document.getElementById("dashboardCompleted").textContent = completed;
  document.getElementById("dashboardCancelled").textContent = cancelled;
  document.getElementById("dashboardOutOfService").textContent = activeOutOfService.length;
  document.getElementById("dashboardPartsExpense").textContent = `$${partsExpense.toFixed(2)}`;
  document.getElementById("dashboardOtherExpense").textContent = `$${otherExpense.toFixed(2)}`;
  document.getElementById("dashboardServiceTotal").textContent = `${statusTotal} service${statusTotal === 1 ? "" : "s"}`;
  document.getElementById("dashboardUpdatedAt").textContent = `Updated ${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  document.getElementById("dashboardStatusChart").innerHTML = statusCounts.map(([label, count, className]) => `
    <div class="chart-row">
      <span>${label}</span>
      <div class="chart-track"><div class="chart-bar ${className}" style="width:${(count / statusMax) * 100}%"></div></div>
      <strong>${count}</strong>
    </div>
  `).join("");

  const today = new Date();
  const months = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString([], { month: "short" }),
      fullLabel: date.toLocaleDateString([], { month: "long", year: "numeric" }),
      total: 0
    });
  }
  repairOrders.forEach((order) => {
    const month = months.find((item) => item.key === String(order.date || "").slice(0, 7));
    if (month) month.total += Number(order.partsTotal || 0);
  });
  receivedPurchases.forEach((purchase) => {
    const month = months.find((item) => item.key === String(purchase.pickupDate || "").slice(0, 7));
    if (month) month.total += Number(purchase.totalPrice || 0);
  });
  const expenseChart = document.getElementById("dashboardExpenseChart");
  if (dashboardExpenseMode === "inventory") {
    const currentParts = inventoryParts
      .map((part) => {
        const quantity = Number(part.quantity || 0);
        const value = quantity * Number(part.price || 0);
        return { partNumber: part.partNumber, description: part.description || "No description", quantity, value };
      })
      .sort((a, b) => b.value - a.value || b.quantity - a.quantity);
    const totalQuantity = currentParts.reduce((sum, part) => sum + part.quantity, 0);
    const totalValue = currentParts.reduce((sum, part) => sum + part.value, 0);
    const quantityMax = Math.max(1, ...currentParts.map((part) => part.quantity));
    const valueMax = Math.max(1, ...currentParts.map((part) => part.value));
    expenseChart.className = "inventory-value-chart";
    expenseChart.innerHTML = `
      <div class="inventory-value-summary">
        <article><span>Units in stock</span><strong>${totalQuantity}</strong></article>
        <article><span>Inventory value</span><strong>$${totalValue.toFixed(2)}</strong></article>
      </div>
      <div class="inventory-chart-legend"><span><i class="quantity-key"></i>Quantity</span><span><i class="value-key"></i>Value</span></div>
      <div class="inventory-part-rows">
        ${currentParts.length ? currentParts.map((part) => `
          <section class="inventory-part-row" title="${escapeHtml(part.partNumber)} - ${escapeHtml(part.description)}: ${part.quantity} units, $${part.value.toFixed(2)}">
            <div class="inventory-part-label">
              <strong>${escapeHtml(part.partNumber)}</strong>
              <span>${escapeHtml(part.description)}</span>
            </div>
            <div class="inventory-measures">
              <div><span>Qty ${part.quantity}</span><div class="chart-track"><div class="inventory-quantity-bar" style="width:${(part.quantity / quantityMax) * 100}%"></div></div></div>
              <div><span>$${part.value.toFixed(2)}</span><div class="chart-track"><div class="inventory-value-bar" style="width:${(part.value / valueMax) * 100}%"></div></div></div>
            </div>
          </section>
        `).join("") : `<p class="expense-empty">No parts are currently in inventory.</p>`}
      </div>
    `;
    document.getElementById("dashboardExpenseCaption").textContent = `${currentParts.length} part number${currentParts.length === 1 ? "" : "s"}`;
    renderMonthPartsDrilldown(null);
  } else if (dashboardExpenseMode === "vendor") {
    const vendorMonths = new Map();
    repairOrders.forEach((order) => {
      const monthKey = String(order.date || "").slice(0, 7);
      if (!months.some((month) => month.key === monthKey)) return;
      (order.partsUsed || []).forEach((part) => {
        const vendor = part.vendor || "Unspecified";
        const expense = Number(part.totalPrice || 0) || Number(part.unitPrice || 0) * Number(part.quantity || 0);
        const key = `${monthKey}\u0000${vendor}`;
        vendorMonths.set(key, (vendorMonths.get(key) || 0) + expense);
      });
    });
    receivedPurchases.forEach((purchase) => {
      const monthKey = String(purchase.pickupDate || "").slice(0, 7);
      if (!months.some((month) => month.key === monthKey)) return;
      const vendor = purchase.vendor || "Unspecified";
      const key = `${monthKey}\u0000${vendor}`;
      vendorMonths.set(key, (vendorMonths.get(key) || 0) + Number(purchase.totalPrice || 0));
    });
    const vendorMax = Math.max(1, ...vendorMonths.values());
    const monthGroups = months.map((month) => ({
      ...month,
      vendors: [...vendorMonths.entries()]
        .filter(([key]) => key.startsWith(`${month.key}\u0000`))
        .map(([key, total]) => [key.split("\u0000")[1], total])
        .sort((a, b) => b[1] - a[1])
    }));
    const vendorCount = new Set([...vendorMonths.keys()].map((key) => key.split("\u0000")[1])).size;
    expenseChart.className = "vendor-month-chart";
    expenseChart.innerHTML = vendorMonths.size ? monthGroups.map((month) => `
      <section class="vendor-month-group">
        <h3>${month.label}</h3>
        ${month.vendors.length ? `<div class="vendor-expense-columns">${month.vendors.map(([vendor, total]) => `
          <div class="vendor-expense-column" title="${escapeHtml(vendor)}: $${total.toFixed(2)}">
            <strong>$${total.toFixed(2)}</strong>
            <div class="vendor-expense-track"><div class="vendor-expense-bar" style="height:${(total / vendorMax) * 100}%"></div></div>
            <span>${escapeHtml(vendor)}</span>
          </div>
        `).join("")}</div>` : `<span class="vendor-month-empty">No expense</span>`}
      </section>
    `).join("") : `<p class="expense-empty">No vendor expenses recorded.</p>`;
    document.getElementById("dashboardExpenseCaption").textContent = `Last 6 months - ${vendorCount} vendor${vendorCount === 1 ? "" : "s"}`;
    renderMonthPartsDrilldown(null);
  } else {
    const expenseMax = Math.max(1, ...months.map((month) => month.total));
    expenseChart.className = "expense-chart";
    expenseChart.innerHTML = months.map((month) => `
      <button class="expense-column${dashboardSelectedMonth === month.key ? " selected" : ""}" type="button" data-expense-month="${month.key}" aria-label="Show parts used in ${month.fullLabel}">
        <strong>$${month.total.toFixed(0)}</strong>
        <div class="expense-bar-space"><div class="expense-bar" style="height:${Math.max(2, (month.total / expenseMax) * 100)}%"></div></div>
        <span>${month.label}</span>
      </button>
    `).join("");
    expenseChart.querySelectorAll("[data-expense-month]").forEach((button) => {
      button.addEventListener("click", () => {
        dashboardSelectedMonth = button.dataset.expenseMonth;
        renderShopDashboard();
      });
    });
    document.getElementById("dashboardExpenseCaption").textContent = "Last 6 months";
    renderMonthPartsDrilldown(months.find((month) => month.key === dashboardSelectedMonth));
  }

  const outOfServiceBody = document.getElementById("dashboardOutOfServiceList");
  outOfServiceBody.replaceChildren();
  activeOutOfService.forEach((report) => {
    const row = document.createElement("tr");
    row.className = `schedule-row ${outOfServiceStatusClass(report.status)}`;
    row.innerHTML = `
      <td><strong>${escapeHtml(report.assetNumber)}</strong></td>
      <td>${escapeHtml(report.outDate)}</td>
      <td>${escapeHtml(report.noEta ? "No ETA" : report.etaDate || "Not set")}</td>
      <td>${escapeHtml(report.status)}</td>
      <td class="table-cell-lines">${escapeHtml(report.issue)}</td>
      <td>${escapeHtml(report.thirdPartyShop || "Not required")}</td>
      <td>${escapeHtml(report.thirdPartySendDate || "Not required")}</td>
    `;
    outOfServiceBody.append(row);
  });
  document.getElementById("dashboardOutOfServiceTotal").textContent = `${activeOutOfService.length} active`;
  document.getElementById("dashboardOutOfServiceEmpty").hidden = activeOutOfService.length > 0;

  const dashboardDate = localDateValue();
  const recent = repairOrders.filter((order) => isRepairOrderForDate(order, dashboardDate));
  const recentBody = document.getElementById("dashboardRecentOrders");
  recentBody.replaceChildren();
  recent.forEach((order) => {
    const row = document.createElement("tr");
    const status = order.status || "Completed";
    const codes = (order.repairCodes || [])
      .map((code) => `${code.code} - ${code.description || "No description"}`)
      .join("\n") || "None";
    const parts = (order.partsUsed || [])
      .map((part) => `${part.partNumber} - ${part.description || "No description"} (Qty ${part.quantity})`)
      .join("\n") || "None";
    row.className = `schedule-row status-${status.toLowerCase().replaceAll(" ", "-")}`;
    row.innerHTML = `
      <td><strong>#${Number(order.id)}</strong></td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(order.originalScheduledDate || "Not scheduled")}</td>
      <td>${escapeHtml(order.currentScheduledDate || "Not scheduled")}</td>
      <td>${escapeHtml(order.workingStartedDate || "Not recorded")}</td>
      <td>${escapeHtml(order.completedDate || "Not completed")}</td>
      <td>${escapeHtml(order.assetNumber)}</td>
      <td>${escapeHtml(order.technicianName)}</td>
      <td class="table-cell-lines">${escapeHtml(codes)}</td>
      <td class="table-cell-lines">${escapeHtml(parts)}</td>
      <td>$${escapeHtml(order.partsTotal || "0.00")}</td>
    `;
    recentBody.append(row);
  });
  const openCount = recent.filter((order) => order.status === "Working on it").length;
  const todayCount = recent.length - openCount;
  document.getElementById("dashboardRecentTotal").textContent = `${todayCount} today, ${openCount} working`;
  document.getElementById("dashboardRecentEmpty").hidden = recent.length > 0;
}

async function loadUnitTypes() {
  try {
    unitTypes = await shopApi("/api/shop-unit-types");
    renderUnitTypes();
    renderPartYearOptions();
    renderRepairOrderAssetOptions();
    renderServiceScheduleAssetOptions();
    renderOutOfServiceAssetOptions();
    renderUnitHistoryAssetOptions();
    renderDashboardPartOrderUnitOptions();
    renderSmartPartOptions();
  } catch (error) {
    document.getElementById("unitTypeMessage").textContent = error.message;
  }
}

async function saveUnitType(event) {
  event.preventDefault();
  const message = document.getElementById("unitTypeMessage");
  message.textContent = "Saving";
  try {
    await shopApi("/api/shop-unit-types", {
      method: "POST",
      body: JSON.stringify({
        year: document.getElementById("unitYear").value,
        unitType: document.getElementById("unitTypeName").value.trim(),
        make: document.getElementById("unitMake").value.trim(),
        fuelType: document.getElementById("unitFuelType").value.trim(),
        model: document.getElementById("unitModel").value.trim(),
        assetNumber: document.getElementById("unitAssetNumber").value.trim(),
        vin: document.getElementById("unitVin").value.trim(),
        tireSize: document.getElementById("unitTireSize").value.trim()
      })
    });
    const wasEditing = editingUnitId !== null;
    resetUnitTypeForm();
    message.textContent = wasEditing ? "Unit updated." : "Unit saved.";
    await loadUnitTypes();
  } catch (error) {
    message.textContent = error.message;
  }
}

function editUnitType(item) {
  editingUnitId = Number(item.id);
  document.getElementById("unitAssetNumber").value = item.assetNumber;
  document.getElementById("unitAssetNumber").readOnly = true;
  document.getElementById("unitMake").value = item.make || "";
  document.getElementById("unitFuelType").value = item.fuelType || "";
  document.getElementById("unitYear").value = item.year || "";
  document.getElementById("unitTypeName").value = item.unitType || "";
  document.getElementById("unitModel").value = item.model || "";
  document.getElementById("unitVin").value = item.vin || "";
  document.getElementById("unitTireSize").value = item.tireSize || "";
  document.getElementById("unitTypeFormTitle").textContent = `Update Unit ${item.assetNumber}`;
  document.getElementById("unitTypeSubmitButton").textContent = "Update unit";
  document.getElementById("unitTypeCancelButton").hidden = false;
  document.getElementById("unitTypeMessage").textContent = `Editing ${item.assetNumber}`;
  document.getElementById("unitTireSize").focus();
}

function resetUnitTypeForm() {
  editingUnitId = null;
  document.getElementById("unitTypeForm").reset();
  document.getElementById("unitAssetNumber").readOnly = false;
  document.getElementById("unitTypeFormTitle").textContent = "Add Unit";
  document.getElementById("unitTypeSubmitButton").textContent = "Save unit";
  document.getElementById("unitTypeCancelButton").hidden = true;
}

async function deleteUnitType(item) {
  if (!confirm(`Delete asset ${item.assetNumber}?`)) return;
  try {
    await shopApi(`/api/shop-unit-types/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (editingUnitId === Number(item.id)) resetUnitTypeForm();
    await loadUnitTypes();
  } catch (error) {
    document.getElementById("unitTypeMessage").textContent = error.message;
  }
}

function renderUnitTypes() {
  const list = document.getElementById("unitTypesList");
  list.replaceChildren();
  unitTypes.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(item.assetNumber)}</strong></td>
      <td>${escapeHtml(item.make)}</td>
      <td>${escapeHtml(item.fuelType)}</td>
      <td>${escapeHtml(item.year)}</td>
      <td>${escapeHtml(item.unitType)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${escapeHtml(item.vin)}</td>
      <td>${escapeHtml(item.tireSize || "Not set")}</td>
      <td class="table-actions">${isShopAdmin ? `
        <button class="table-action edit-unit" type="button">Edit</button>
        <button class="table-action danger-action delete-unit" type="button">Delete</button>` : "Admin only"}
      </td>
    `;
    row.querySelector(".edit-unit")?.addEventListener("click", () => editUnitType(item));
    row.querySelector(".delete-unit")?.addEventListener("click", () => deleteUnitType(item));
    list.append(row);
  });
  document.getElementById("unitTypesTotal").textContent = `${unitTypes.length} unit${unitTypes.length === 1 ? "" : "s"}`;
  document.getElementById("unitTypesEmpty").hidden = unitTypes.length > 0;
}

function renderPartYearOptions() {
  const yearSelect = document.getElementById("partYear");
  const selected = new Set([...yearSelect.selectedOptions].map((option) => option.value));
  const years = [...new Set(unitTypes.map((item) => item.year))].sort((a, b) => b.localeCompare(a));
  yearSelect.replaceChildren();
  years.forEach((year) => yearSelect.add(new Option(year, year)));
  [...yearSelect.options].forEach((option) => { option.selected = selected.has(option.value); });
  renderPartUnitTypeOptions();
}

function renderPartUnitTypeOptions() {
  const years = [...document.getElementById("partYear").selectedOptions].map((option) => option.value);
  const select = document.getElementById("partUnitType");
  const selected = select.value;
  const options = [...new Set(unitTypes.map((item) => item.unitType))]
    .filter((unitType) => !years.length || unitTypes.some((item) => years.includes(item.year) && item.unitType === unitType))
    .sort();
  select.innerHTML = `<option value="">Select unit type</option>`;
  options.forEach((unitType) => select.add(new Option(unitType, unitType)));
  if (options.includes(selected)) select.value = selected;
  updatePartFuelTypeField();
}

async function loadRepairCodes() {
  try {
    repairCodes = await shopApi("/api/shop-repair-codes");
    renderRepairCodes(repairCodes);
    renderRepairOrderCodeOptions();
    renderPartServiceCodeOptions();
    renderSmartPartOptions();
  } catch (error) {
    document.getElementById("repairCodeMessage").textContent = error.message;
  }
}

function renderPartServiceCodeOptions() {
  const select = document.getElementById("partServiceCode");
  const selected = select.value;
  select.innerHTML = `<option value="">Select service code</option>`;
  repairCodes.forEach((item) => {
    select.add(new Option(`${item.code} - ${item.description}`, item.code));
  });
  if (repairCodes.some((item) => item.code === selected)) select.value = selected;
}

async function saveRepairCode(event) {
  event.preventDefault();
  const message = document.getElementById("repairCodeMessage");
  message.textContent = "Saving";
  try {
    await shopApi("/api/shop-repair-codes", {
      method: "POST",
      body: JSON.stringify({
        code: document.getElementById("repairCode").value.trim(),
        description: document.getElementById("repairCodeDescription").value.trim(),
        laborHours: document.getElementById("repairCodeLaborHours").value,
        requiresPosition: document.getElementById("repairCodeRequiresPosition").checked,
        options: [...document.querySelectorAll(".repair-code-option-row")].map((row) => ({
          name: row.querySelector("[data-option-name]").value.trim(),
          laborHours: row.querySelector("[data-option-labor]").value
        })).filter((option) => option.name)
      })
    });
    const wasEditing = Boolean(editingRepairCode);
    resetRepairCodeForm();
    message.textContent = wasEditing ? "Repair code updated." : "Repair code saved.";
    await loadRepairCodes();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function deleteRepairCode(code) {
  if (!confirm(`Delete repair code ${code}?`)) return;
  try {
    await shopApi(`/api/shop-repair-codes/${encodeURIComponent(code)}`, { method: "DELETE" });
    if (editingRepairCode.toLowerCase() === code.toLowerCase()) resetRepairCodeForm();
    await loadRepairCodes();
  } catch (error) {
    document.getElementById("repairCodeMessage").textContent = error.message;
  }
}

function editRepairCode(item) {
  editingRepairCode = item.code;
  document.getElementById("repairCode").value = item.code;
  document.getElementById("repairCode").readOnly = true;
  document.getElementById("repairCodeDescription").value = item.description || "";
  document.getElementById("repairCodeLaborHours").value = item.laborHours || "0.00";
  document.getElementById("repairCodeRequiresPosition").checked = Boolean(item.requiresPosition);
  renderRepairCodeOptionRows(item.options || []);
  document.getElementById("repairCodeFormTitle").textContent = `Update Repair Code ${item.code}`;
  document.getElementById("repairCodeSubmitButton").textContent = "Update repair code";
  document.getElementById("repairCodeCancelButton").hidden = false;
  document.getElementById("repairCodeMessage").textContent = `Editing ${item.code}`;
  document.getElementById("repairCodeLaborHours").focus();
}

function resetRepairCodeForm() {
  editingRepairCode = "";
  document.getElementById("repairCodeForm").reset();
  document.getElementById("repairCode").readOnly = false;
  document.getElementById("repairCodeFormTitle").textContent = "Add Repair Code";
  document.getElementById("repairCodeSubmitButton").textContent = "Save repair code";
  document.getElementById("repairCodeCancelButton").hidden = true;
  renderRepairCodeOptionRows([]);
}

function addRepairCodeOptionRow(option = {}) {
  const row = document.createElement("div");
  row.className = "repair-code-option-row";
  row.innerHTML = `
    <label>Option name<input data-option-name autocomplete="off" value="${escapeHtml(option.name || "")}" required></label>
    <label>Labor hours<input data-option-labor type="number" min="0" step="0.25" inputmode="decimal" value="${escapeHtml(option.laborHours == null ? "" : option.laborHours)}"></label>
    <button class="table-action danger-action" type="button" aria-label="Remove checkbox option">Remove</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  document.getElementById("repairCodeOptionRows").append(row);
}

function renderRepairCodeOptionRows(options) {
  const container = document.getElementById("repairCodeOptionRows");
  container.replaceChildren();
  (options || []).forEach((option) => addRepairCodeOptionRow(option));
}

function renderRepairCodes(codes) {
  const list = document.getElementById("repairCodesList");
  list.replaceChildren();
  codes.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${escapeHtml(item.code)}</strong></td>
      <td class="table-cell-lines">${escapeHtml(item.description)}${(item.options || []).length ? `\n${escapeHtml(item.options.map((option) => `${option.name} - ${option.laborHours == null ? "Labor pending" : `${option.laborHours}h`}`).join("\n"))}` : ""}</td>
      <td>${escapeHtml(item.laborHours)}</td>
      <td>${item.requiresPosition ? "Required" : "Not required"}</td>
      <td class="table-actions">
        <button class="table-action edit-code" type="button">Edit</button>
        <button class="table-action danger-action delete-code" type="button">Delete</button>
      </td>
    `;
    row.querySelector(".edit-code").addEventListener("click", () => editRepairCode(item));
    row.querySelector(".delete-code").addEventListener("click", () => deleteRepairCode(item.code));
    list.append(row);
  });
  document.getElementById("repairCodesTotal").textContent = `${codes.length} code${codes.length === 1 ? "" : "s"}`;
  document.getElementById("repairCodesEmpty").hidden = codes.length > 0;
}

function renderRepairOrderAssetOptions() {
  const select = document.getElementById("repairOrderAsset");
  const selected = select.value;
  select.innerHTML = `<option value="">Select asset</option>`;
  unitTypes.forEach((item) => {
    const label = `${item.assetNumber} - ${item.make} ${item.year} ${item.unitType} ${item.model}`.trim();
    select.add(new Option(label, item.assetNumber));
  });
  if (unitTypes.some((item) => item.assetNumber === selected)) select.value = selected;
  updateRepairOrderUsageRequirements();
}

function updateRepairOrderUsageRequirements() {
  const assetNumber = document.getElementById("repairOrderAsset").value;
  const unit = unitTypes.find((item) => item.assetNumber === assetNumber);
  const unitType = String(unit?.unitType || "").trim().toLowerCase();
  const usageNotRequired = unitType === "cdl trailer" || unitType === "single trailer";
  ["repairOrderMileage", "repairOrderHours"].forEach((id) => {
    const input = document.getElementById(id);
    input.required = !usageNotRequired;
    input.disabled = usageNotRequired;
    if (usageNotRequired) input.value = "0";
  });
}

function renderRepairOrderCodeOptions() {
  const container = document.getElementById("repairOrderCodes");
  container.replaceChildren();
  const positions = ["Front Left", "Front Right", "Rear Left", "Rear Right"];
  repairCodes.forEach((item) => {
    const row = document.createElement("article");
    row.className = "repair-code-position-item";
    row.innerHTML = `
      <label class="repair-code-choice">
        <input type="checkbox" data-repair-code value="${escapeHtml(item.code)}">
        <span><strong>${escapeHtml(item.code)}</strong>${escapeHtml(item.description)}${isShopAdmin && item.laborHours ? ` - ${escapeHtml(item.laborHours)} labor hours` : ""}</span>
      </label>
      ${item.requiresPosition ? `
        <div class="asset-position-options" hidden>
          ${positions.map((position) => `<label><input type="checkbox" data-position-for="${escapeHtml(item.code)}" value="${position}">${position}</label>`).join("")}
        </div>
      ` : ""}
      ${(item.options || []).length ? `
        <div class="repair-task-options" hidden>
          ${(item.options || []).map((option) => `
            <label>
              <input type="checkbox" data-option-for="${escapeHtml(item.code)}" value="${escapeHtml(option.name)}">
              <span>${escapeHtml(option.name)}${isShopAdmin ? `<small>${option.laborHours == null ? "Labor pending" : `${escapeHtml(option.laborHours)} labor hours`}</small>` : ""}</span>
            </label>
          `).join("")}
        </div>
      ` : ""}
    `;
    const codeInput = row.querySelector("input[data-repair-code]");
    codeInput.addEventListener("change", () => {
      const positionOptions = row.querySelector(".asset-position-options");
      if (positionOptions) {
        positionOptions.hidden = !codeInput.checked;
        if (!codeInput.checked) positionOptions.querySelectorAll("input").forEach((input) => { input.checked = false; });
      }
      const taskOptions = row.querySelector(".repair-task-options");
      if (taskOptions) {
        taskOptions.hidden = !codeInput.checked;
        if (!codeInput.checked) taskOptions.querySelectorAll("input").forEach((input) => { input.checked = false; });
      }
      renderRepairOrderParts();
    });
    container.append(row);
  });
  if (!repairCodes.length) container.innerHTML = `<p class="empty-state">Add repair codes before creating an order.</p>`;
}

async function loadRepairOrders() {
  try {
    repairOrders = await shopApi("/api/shop-repair-orders");
    renderRepairOrderFilterOptions();
    renderRepairOrders();
    renderUnitHistoryAssetOptions();
    renderUnitRepairHistory();
    renderShopDashboard();
  } catch (error) {
    document.getElementById("repairOrderMessage").textContent = error.message;
  }
}

async function saveRepairOrder(event) {
  event.preventDefault();
  const message = document.getElementById("repairOrderMessage");
  const selectedCodes = [...document.querySelectorAll("#repairOrderCodes input[data-repair-code]:checked")].map((input) => input.value);
  const positionInputs = [...document.querySelectorAll("#repairOrderCodes input[data-position-for]:checked")];
  const repairCodePositions = Object.fromEntries(selectedCodes.map((code) => [
    code,
    positionInputs.filter((input) => input.dataset.positionFor === code).map((input) => input.value)
  ]));
  const optionInputs = [...document.querySelectorAll("#repairOrderCodes input[data-option-for]:checked")];
  const repairCodeOptions = Object.fromEntries(selectedCodes.map((code) => [
    code,
    optionInputs.filter((input) => input.dataset.optionFor === code).map((input) => input.value)
  ]));
  const partsUsed = [...document.querySelectorAll("#repairOrderParts input[data-part-number]")]
    .map((input) => ({ partNumber: input.dataset.partNumber, quantity: Number(input.value || 0) }))
    .filter((part) => part.quantity > 0);
  message.textContent = "Saving";
  try {
    const result = await shopApi("/api/shop-repair-orders", {
      method: "POST",
      body: JSON.stringify({
        date: document.getElementById("repairOrderDate").value,
        location: document.getElementById("repairOrderLocation").value.trim(),
        technicianName: document.getElementById("repairOrderTechnician").value.trim(),
        driverName: document.getElementById("repairOrderDriverName").value.trim(),
        assetNumber: document.getElementById("repairOrderAsset").value,
        assetMileage: document.getElementById("repairOrderMileage").value,
        assetHours: document.getElementById("repairOrderHours").value,
        repairCodes: selectedCodes,
        repairCodePositions,
        repairCodeOptions,
        partsUsed,
        scheduleId: activeScheduleRepairId,
        jobDescription: document.getElementById("repairOrderDescription").value.trim()
      })
    });
    document.getElementById("repairOrderForm").reset();
    document.getElementById("repairOrderTechnician").value = session.user.name;
    document.getElementById("repairOrderDate").value = localDateValue();
    updateRepairOrderUsageRequirements();
    message.textContent = activeScheduleRepairId
      ? `Repair order #${result.id} saved as Working on it.`
      : "Repair order saved as Completed.";
    activeScheduleRepairId = null;
    renderRepairOrderParts();
    await Promise.all([loadParts(), loadServiceSchedules(), ...(isShopAdmin ? [loadRepairOrders()] : [])]);
    if (isShopTechnician) setShopPage("scheduled-repairs");
  } catch (error) {
    message.textContent = error.message;
  }
}

function renderRepairOrderFilterOptions() {
  const select = document.getElementById("repairOrderAssetFilter");
  const selected = select.value || "__all";
  const assets = [...new Set(repairOrders.map((order) => order.assetNumber))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="__all">All assets</option>`;
  assets.forEach((asset) => select.add(new Option(asset, asset)));
  select.value = selected === "__all" || assets.includes(selected) ? selected : "__all";
}

function renderRepairOrders() {
  const filter = document.getElementById("repairOrderAssetFilter").value;
  const orders = filter === "__all"
    ? repairOrders
    : repairOrders.filter((order) => order.assetNumber === filter);
  const list = document.getElementById("repairOrdersList");
  list.replaceChildren();
  orders.forEach((order) => {
    const item = document.createElement("tr");
    item.className = `schedule-row status-${(order.status || "Completed").toLowerCase().replaceAll(" ", "-")}`;
    const codes = (order.repairCodes || []).map((code) => {
      const positions = (code.positions || []).length ? ` - ${code.positions.join(", ")}` : "";
      const options = (code.options || []).length
        ? `\n${code.options.map((option) => `  ${option.name} - ${option.laborHours == null ? "Labor pending" : `${option.laborHours}h`}`).join("\n")}`
        : "";
      return `${code.code} - ${code.description || "No description"}${positions} (${code.laborHours || "0.00"}h)${options}`;
    }).join("\n") || "None";
    const codeSummary = (order.repairCodes || []).map((code) => {
      const positions = (code.positions || []).length ? ` (${code.positions.join(", ")})` : "";
      return `${code.code} - ${code.description || "No description"}${positions}`;
    }).join("; ") || "None";
    const partsDetail = (order.partsUsed || []).map((part) => `${part.partNumber} - ${part.description || "No description"}\nQty ${part.quantity} - ${part.vendor || "Unspecified"}`).join("\n\n") || "None";
    const partsSummary = (order.partsUsed || []).map((part) => `${part.partNumber} - ${part.description || "No description"} (Qty ${part.quantity})`).join("; ") || "None";
    item.innerHTML = `
      <td><strong>#${Number(order.id)}</strong></td>
      <td><strong>${escapeHtml(order.status || "Completed")}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(order.originalScheduledDate || "Not scheduled")}</td>
      <td>${escapeHtml(order.currentScheduledDate || "Not scheduled")}</td>
      <td>${escapeHtml(order.workingStartedDate || "Not recorded")}</td>
      <td>${escapeHtml(order.completedDate || "Not completed")}</td>
      <td><strong>${escapeHtml(order.assetNumber)}</strong></td>
      <td>${escapeHtml(order.location)}</td>
      <td>${escapeHtml(order.technicianName)}</td>
      <td>${escapeHtml(order.driverName || "Not set")}</td>
      <td>${escapeHtml(order.assetMileage)}</td>
      <td>${escapeHtml(order.assetHours)}</td>
      <td><div class="repair-code-summary" title="${escapeHtml(codes)}">${escapeHtml(codeSummary)}</div></td>
      <td><div class="repair-code-summary" title="${escapeHtml(partsDetail)}">${escapeHtml(partsSummary)}</div></td>
      <td>$${escapeHtml(order.partsTotal || "0.00")}</td>
      <td>$${escapeHtml(order.repairCost || "0.00")}</td>
      <td>$${escapeHtml(order.totalCost || order.partsTotal || "0.00")}</td>
      <td>${escapeHtml(order.source || "Repair Order")}</td>
      <td><div class="repair-code-summary" title="${escapeHtml(order.jobDescription || "")}">${escapeHtml(order.jobDescription || "")}</div></td>
    `;
    list.append(item);
  });
  document.getElementById("repairOrdersTotal").textContent = `${orders.length} order${orders.length === 1 ? "" : "s"}`;
  document.getElementById("repairOrdersEmpty").hidden = orders.length > 0;
}

function renderUnitHistoryAssetOptions() {
  const select = document.getElementById("unitRepairHistoryAsset");
  const selected = select.value;
  const assets = [...new Set([
    ...unitTypes.map((unit) => unit.assetNumber),
    ...repairOrders.map((order) => order.assetNumber)
  ])].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  select.replaceChildren(new Option("Select unit", ""));
  assets.forEach((asset) => {
    const unit = unitTypes.find((item) => item.assetNumber === asset);
    const details = unit ? ` - ${[unit.unitType, unit.make, unit.model].filter(Boolean).join(" ")}` : "";
    select.add(new Option(`${asset}${details}`, asset));
  });
  if (assets.includes(selected)) select.value = selected;
}

function printRepairOrderInvoice(orderId) {
  const order = repairOrders.find((item) => Number(item.id) === Number(orderId));
  if (!order) return;
  const unit = unitTypes.find((item) => item.assetNumber === order.assetNumber) || {};
  const codes = (order.repairCodes || []).map((code) => {
    const positions = (code.positions || []).length ? ` (${code.positions.join(", ")})` : "";
    const options = (code.options || []).map((option) => `<li>${escapeHtml(option.name)}${isShopAdmin && option.laborHours != null ? ` - ${escapeHtml(option.laborHours)} hr` : ""}</li>`).join("");
    return `<tr><td>${escapeHtml(code.code)}</td><td>${escapeHtml(code.description || "No description")}${escapeHtml(positions)}${options ? `<ul>${options}</ul>` : ""}</td>${isShopAdmin ? `<td>${escapeHtml(code.laborHours || "0.00")}</td>` : ""}</tr>`;
  }).join("") || `<tr><td colspan="${isShopAdmin ? 3 : 2}">No repair codes recorded</td></tr>`;
  const parts = (order.partsUsed || []).map((part) => `<tr><td>${escapeHtml(part.partNumber)}</td><td>${escapeHtml(part.description || "No description")}</td><td>${Number(part.quantity || 0)}</td><td>$${escapeHtml(part.unitPrice || "0.00")}</td><td>$${escapeHtml(part.totalPrice || "0.00")}</td></tr>`).join("") || `<tr><td colspan="5">No parts recorded</td></tr>`;
  const invoice = window.open("", "_blank", "width=980,height=760");
  if (!invoice) {
    window.alert("Allow pop-ups for Sunwave Shop to print this repair order.");
    return;
  }
  invoice.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Repair Order ${Number(order.id)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#202124;font:14px Arial,sans-serif}.invoice{max-width:900px;margin:0 auto;padding:32px}.header{display:flex;justify-content:space-between;gap:24px;border-bottom:4px solid #7a1731;padding-bottom:18px}.brand h1{margin:0;color:#7a1731;font-size:28px}.brand p,.invoice-title p{margin:5px 0 0;color:#5f6368}.invoice-title{text-align:right}.invoice-title h2{margin:0;font-size:24px}.status{display:inline-block;margin-top:8px;padding:5px 10px;border:1px solid #7a1731;color:#7a1731;font-weight:700}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.detail{border:1px solid #d8dadd;padding:10px;min-height:58px}.detail span{display:block;color:#666;font-size:11px;text-transform:uppercase;margin-bottom:5px}.section{margin-top:22px}.section h3{margin:0 0 8px;color:#7a1731;font-size:15px;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8dadd;padding:8px;text-align:left;vertical-align:top}th{background:#f2f3f4;font-size:12px}.money{text-align:right}.job{border:1px solid #d8dadd;padding:12px;white-space:pre-wrap;min-height:72px}.totals{width:330px;margin:20px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #ddd}.totals .grand{font-size:17px;font-weight:700;color:#7a1731}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:54px}.signature{border-top:1px solid #333;padding-top:6px;color:#666}.actions{display:flex;justify-content:flex-end;margin-bottom:16px}.actions button{background:#7a1731;color:white;border:0;padding:10px 16px;font-weight:700;cursor:pointer}@media print{.actions{display:none}.invoice{max-width:none;padding:0}@page{margin:0.45in}}
  </style></head><body><main class="invoice"><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div><header class="header"><div class="brand"><h1>Sunwave Shop</h1><p>Maintenance and Repair Services</p></div><div class="invoice-title"><h2>Repair Order Invoice</h2><p>RO #${Number(order.id)}</p><span class="status">${escapeHtml(order.status || "Completed")}</span></div></header><section class="details"><div class="detail"><span>Unit number</span><strong>${escapeHtml(order.assetNumber)}</strong></div><div class="detail"><span>Unit type</span><strong>${escapeHtml(unit.unitType || "Not recorded")}</strong></div><div class="detail"><span>Date</span><strong>${escapeHtml(order.date)}</strong></div><div class="detail"><span>Make / Model</span><strong>${escapeHtml([unit.make, unit.model].filter(Boolean).join(" ") || "Not recorded")}</strong></div><div class="detail"><span>Location</span><strong>${escapeHtml(order.location || "Not recorded")}</strong></div><div class="detail"><span>Mechanic</span><strong>${escapeHtml(order.technicianName || "Not recorded")}</strong></div><div class="detail"><span>Driver</span><strong>${escapeHtml(order.driverName || "Not recorded")}</strong></div><div class="detail"><span>Mileage</span><strong>${escapeHtml(order.assetMileage || "Not recorded")}</strong></div><div class="detail"><span>Hours</span><strong>${escapeHtml(order.assetHours || "Not recorded")}</strong></div></section><section class="section"><h3>Description of job done</h3><div class="job">${escapeHtml(order.jobDescription || "No description recorded")}</div></section><section class="section"><h3>Repair codes</h3><table><thead><tr><th>Code</th><th>Description / position</th>${isShopAdmin ? "<th>Labor hours</th>" : ""}</tr></thead><tbody>${codes}</tbody></table></section><section class="section"><h3>Parts used</h3><table><thead><tr><th>Part number</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${parts}</tbody></table></section><div class="totals"><div><span>Parts total</span><strong>$${escapeHtml(order.partsTotal || "0.00")}</strong></div><div><span>Other repair cost</span><strong>$${escapeHtml(order.repairCost || "0.00")}</strong></div><div class="grand"><span>Total</span><strong>$${escapeHtml(order.totalCost || order.partsTotal || "0.00")}</strong></div></div><div class="signatures"><div class="signature">Mechanic signature</div><div class="signature">Authorized signature</div></div></main></body></html>`);
  invoice.document.close();
  invoice.focus();
}

function renderUnitRepairHistory() {
  const assetNumber = document.getElementById("unitRepairHistoryAsset").value;
  const orders = assetNumber ? repairOrders.filter((order) => order.assetNumber === assetNumber) : [];
  const partsQuantity = orders.reduce(
    (total, order) => total + (order.partsUsed || []).reduce((sum, part) => sum + Number(part.quantity || 0), 0),
    0
  );
  const partsExpense = orders.reduce((total, order) => total + Number(order.partsTotal || 0), 0);
  const repairCost = orders.reduce((total, order) => total + Number(order.repairCost || 0), 0);
  document.getElementById("unitHistoryOrderCount").textContent = orders.length;
  document.getElementById("unitHistoryPartsQuantity").textContent = partsQuantity;
  document.getElementById("unitHistoryPartsExpense").textContent = `$${partsExpense.toFixed(2)}`;
  document.getElementById("unitHistoryRepairCost").textContent = `$${repairCost.toFixed(2)}`;
  document.getElementById("unitHistoryTotal").textContent = assetNumber
    ? `${orders.length} order${orders.length === 1 ? "" : "s"} for ${assetNumber}`
    : "Select a unit";

  const list = document.getElementById("unitRepairHistoryList");
  list.replaceChildren();
  orders.forEach((order) => {
    const codes = (order.repairCodes || []).map((code) => `${code.code} - ${code.description}`).join("\n") || "None";
    const parts = (order.partsUsed || []).map((part) => `${part.partNumber} - ${part.description || "No description"}\nQty ${part.quantity}`).join("\n\n") || "None";
    const quantity = (order.partsUsed || []).reduce((sum, part) => sum + Number(part.quantity || 0), 0);
    const row = document.createElement("tr");
    row.className = `schedule-row status-${String(order.status || "Completed").toLowerCase().replaceAll(" ", "-")}`;
    row.innerHTML = `
      <td><strong>#${Number(order.id)}</strong></td>
      <td>${escapeHtml(order.date)}</td>
      <td>${escapeHtml(order.status || "Completed")}</td>
      <td>${escapeHtml(order.technicianName)}</td>
      <td>${escapeHtml(order.source || "Repair Order")}</td>
      <td class="table-cell-lines">${escapeHtml(codes)}</td>
      <td class="table-cell-lines">${escapeHtml(parts)}</td>
      <td>${quantity}</td>
      <td>$${escapeHtml(order.partsTotal || "0.00")}</td>
      <td>$${escapeHtml(order.repairCost || "0.00")}</td>
      <td>$${escapeHtml(order.totalCost || order.partsTotal || "0.00")}</td>
      <td class="table-cell-lines">${escapeHtml(order.jobDescription || "No description recorded")}</td>
      <td><button class="print-order-button" type="button" aria-label="Print repair order ${Number(order.id)}">Print</button></td>
    `;
    row.querySelector(".print-order-button").addEventListener("click", () => printRepairOrderInvoice(order.id));
    list.append(row);
  });
  const empty = document.getElementById("unitRepairHistoryEmpty");
  empty.hidden = orders.length > 0;
  empty.textContent = assetNumber ? "No saved repair orders were found for this unit." : "Select a unit to view its repair history.";
}

function shareTodayRepairsWhatsapp() {
  const today = localDateValue();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateValue(yesterdayDate);
  const selectedOrders = repairOrders.filter((order) => order.date === yesterday || order.date === today);
  const status = document.getElementById("repairOrdersShareMessage");
  if (!selectedOrders.length) {
    status.textContent = "There are no saved repair orders for yesterday or today.";
    return;
  }
  const lines = ["Repair Orders Report"];
  [["Yesterday", yesterday], ["Today", today]].forEach(([label, reportDate]) => {
    const dayOrders = selectedOrders.filter((order) => order.date === reportDate);
    lines.push("", `${label} - ${reportDate}`, `Repair Orders: ${dayOrders.length}`);
    if (!dayOrders.length) {
      lines.push("No repair orders saved.");
      return;
    }
    dayOrders.forEach((order) => {
      const unit = unitTypes.find((item) => item.assetNumber === order.assetNumber);
      lines.push("", `${[unit?.make, unit?.unitType].filter(Boolean).join(" ") || "Unknown unit"} - ${order.assetNumber}`);
      lines.push(`Driver: ${order.driverName || "Not set"}`);
      (order.repairCodes || []).forEach((code) => {
        const positions = (code.positions || []).length ? ` (${code.positions.join(", ")})` : "";
        lines.push(`- ${code.description || code.code}${positions}`);
        (code.options || []).forEach((option) => lines.push(`  - ${option.name}`));
      });
      const parts = (order.partsUsed || []).filter((part) => Number(part.quantity || 0) > 0);
      if (parts.length) {
        lines.push("Parts used:");
        parts.forEach((part) => lines.push(`- ${part.partNumber} - ${part.description || "No description"}: Qty ${part.quantity}`));
      }
    });
  });
  status.textContent = `${selectedOrders.length} repair order${selectedOrders.length === 1 ? "" : "s"} ready to share.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener,noreferrer");
}

function buildDashboardWhatsappReport() {
  const today = localDateValue();
  const todaysOrders = repairOrders.filter((order) => isRepairOrderForDate(order, today));
  const activeOutOfService = outOfServiceReports.filter((report) => report.status !== "Fixed");
  const orderedToday = shopPartOrders.filter((item) => item.orderDate === today && item.status === "Waiting for Order");
  const pickedUpToday = shopPartOrders.filter((item) => item.status === "Order Received" && item.pickupDate === today);
  const lines = [`Sunwave Shop Daily Report - ${today}`, "", "Today's Repair Orders"];
  const unitLabel = (assetNumber) => {
    const unit = unitTypes.find((item) => String(item.assetNumber).trim() === String(assetNumber || "").trim());
    return `${[unit?.make, unit?.unitType].filter(Boolean).join(" ") || "Unknown unit"} - ${assetNumber || "No unit number"}`;
  };

  if (todaysOrders.length) {
    todaysOrders.forEach((order) => {
      const unit = unitTypes.find((item) => item.assetNumber === order.assetNumber);
      lines.push("", `${[unit?.make, unit?.unitType].filter(Boolean).join(" ") || "Unknown unit"} - ${order.assetNumber}`);
      if (order.status === "Working on it") lines.push("Status: Working on it");
      lines.push(`Driver: ${order.driverName || "Not set"}`);
      const repairCodes = order.repairCodes || [];
      if (repairCodes.length) {
        repairCodes.forEach((code) => {
          const positions = (code.positions || []).length ? ` (${code.positions.join(", ")})` : "";
          lines.push(`- ${code.description || code.code}${positions}`);
          (code.options || []).forEach((option) => lines.push(`  - ${option.name}`));
        });
      } else {
        lines.push(`- ${order.jobDescription || "No repair description"}`);
      }
      const parts = (order.partsUsed || []).filter((part) => Number(part.quantity || 0) > 0);
      if (parts.length) {
        lines.push("Parts used:");
        parts.forEach((part) => lines.push(`- ${part.partNumber} - ${part.description || "No description"}: Qty ${part.quantity}`));
      }
    });
  } else {
    lines.push("No repair orders saved today.");
  }

  lines.push("", `Units Out of Service: ${activeOutOfService.length}`);
  if (activeOutOfService.length) {
    activeOutOfService.forEach((report) => {
      lines.push("", `${unitLabel(report.assetNumber)} - ${report.status}`);
      lines.push(`Issue: ${report.issue}`);
      lines.push(`ETA to fix: ${report.noEta ? "No ETA" : report.etaDate || "Not set"}`);
      if (report.thirdPartyShop) lines.push(`Third-party shop: ${report.thirdPartyShop}`);
      if (report.thirdPartySendDate) lines.push(`Date to be sent: ${report.thirdPartySendDate}`);
    });
  } else {
    lines.push("No units are currently out of service.");
  }

  lines.push("", "Parts Ordered Today");
  if (orderedToday.length) {
    orderedToday.forEach((item) => {
      const name = item.purchaseType === "Job Material"
        ? item.description
        : `${item.partNumber} - ${item.description}`;
      lines.push("", `${name} - Qty ${item.quantity}`);
      lines.push(`Vendor: ${item.vendor || "Unspecified"}`);
      lines.push(item.purchaseType === "Job Material" ? "Expense: Other Expenses" : item.purchaseType === "Tire Inventory" ? "Expense: Tire Inventory" : unitLabel(item.assetNumber));
      lines.push(`Status: ${item.status === "Order Received" ? "Order Picked Up" : item.status}`);
    });
  } else {
    lines.push("No parts or materials were ordered today.");
  }

  lines.push("", "Parts Picked Up Today");
  if (pickedUpToday.length) {
    pickedUpToday.forEach((item) => {
      const name = item.purchaseType === "Job Material"
        ? item.description
        : `${item.partNumber} - ${item.description}`;
      lines.push("", `${name} - Qty ${item.quantity}`);
      lines.push(`Vendor: ${item.vendor || "Unspecified"}`);
      lines.push(item.purchaseType === "Job Material" ? "Expense: Other Expenses" : item.purchaseType === "Tire Inventory" ? "Expense: Tire Inventory" : unitLabel(item.assetNumber));
      lines.push(`Order date: ${item.orderDate}`);
    });
  } else {
    lines.push("No parts or materials were picked up today.");
  }

  return lines.join("\n");
}

function shareDashboardWhatsappReport() {
  const recipient = document.getElementById("whatsappRecipientNumber").value.replace(/\D/g, "");
  const baseUrl = recipient ? `https://wa.me/${recipient}` : "https://wa.me/";
  const report = buildDashboardWhatsappReport();
  document.getElementById("dashboardWhatsappMessage").textContent = recipient
    ? `Today's operations report is ready for WhatsApp recipient ending in ${recipient.slice(-4)}.`
    : "Today's operations report is ready. Select a WhatsApp recipient.";
  window.open(`${baseUrl}?text=${encodeURIComponent(report)}`, "_blank", "noopener,noreferrer");
}

function buildTireInventoryWhatsappReport() {
  const tireInventory = inventoryParts.filter(isTirePart).filter((part) => Number(part.quantity || 0) > 0);
  const waiting = badTires.filter((item) => item.status === "Waiting to Be Taken for Repair");
  const taken = badTires.filter((item) => item.status === "Taken for Repair");
  const tireOrders = shopPartOrders.filter((item) => item.purchaseType === "Tire Inventory");
  const lines = [`Sunwave Shop Tire Report - ${localDateValue()}`];

  lines.push("", "Current Tire Inventory");
  if (tireInventory.length) {
    tireInventory.forEach((part) => lines.push(`${Number(part.quantity)} - ${part.partNumber} - ${part.description || "Tire"}`));
  } else lines.push("No usable tires in inventory.");

  lines.push("", "Bad Tires Waiting to Be Taken for Repair");
  if (waiting.length) {
    waiting.forEach((item) => lines.push(`${Number(item.quantity)} - ${item.partNumber} - Unit ${item.assetNumber} - ${item.description || "Tire"}`));
  } else lines.push("No bad tires waiting.");

  lines.push("", "Tires Taken for Repair");
  if (taken.length) {
    taken.forEach((item) => lines.push(`${Number(item.quantity)} - ${item.partNumber} - Unit ${item.assetNumber} - ${item.serviceType} - ${item.vendor} - $${item.totalPrice} - ${item.partOrderStatus === "Order Received" ? "Repair Received" : "Waiting for Repair Return"}`));
  } else lines.push("No tires have been taken for repair.");

  lines.push("", "Tire Parts Ordered / Repair Expenses");
  if (tireOrders.length) {
    tireOrders.forEach((item) => lines.push(`${Number(item.quantity)} - ${item.partNumber} - ${item.description} - ${item.vendor || "Unspecified"} - $${item.totalPrice} - ${item.status === "Order Received" ? "Received" : "Waiting"}`));
  } else lines.push("No tire repair or replacement orders.");
  return lines.join("\n");
}

function shareTireInventoryWhatsappReport() {
  const recipient = document.getElementById("whatsappRecipientNumber").value.replace(/\D/g, "");
  const baseUrl = recipient ? `https://wa.me/${recipient}` : "https://wa.me/";
  const report = buildTireInventoryWhatsappReport();
  document.getElementById("badTiresMessage").textContent = recipient
    ? `Tire report is ready for WhatsApp recipient ending in ${recipient.slice(-4)}.`
    : "Tire report is ready. Select a WhatsApp recipient.";
  window.open(`${baseUrl}?text=${encodeURIComponent(report)}`, "_blank", "noopener,noreferrer");
}

function renderRepairOrderParts() {
  const container = document.getElementById("repairOrderParts");
  const quantities = new Map(
    [...container.querySelectorAll("input[data-part-number]")]
      .map((input) => [input.dataset.partNumber, input.value])
  );
  const selectedCodes = new Set(
    [...document.querySelectorAll("#repairOrderCodes input[data-repair-code]:checked")]
      .map((input) => input.value.toLowerCase())
  );
  const availableParts = inventoryParts.filter((part) => {
    const isAvailable = Number(part.quantity || 0) > 0;
    const matchesCode = selectedCodes.has(String(part.serviceCode || "").toLowerCase());
    return isAvailable && matchesCode;
  });
  container.replaceChildren();
  availableParts.forEach((part) => {
    const row = document.createElement("article");
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(part.partNumber)}</strong>
        <span>${escapeHtml(part.description || "No description")}</span>
        <span>${escapeHtml(part.vendor || "Unspecified")} - ${escapeHtml(part.serviceCode || "No service code")} - $${escapeHtml(part.price)} each - ${Number(part.quantity)} available</span>
      </div>
      <label>
        Qty
        <input type="number" min="0" max="${Number(part.quantity)}" step="1" value="${escapeHtml(quantities.get(part.partNumber) || "0")}"
          data-part-number="${escapeHtml(part.partNumber)}" data-unit-price="${escapeHtml(part.price)}">
      </label>
    `;
    row.querySelector("input").addEventListener("input", updateRepairOrderPartsTotal);
    container.append(row);
  });
  if (!container.children.length) {
    container.innerHTML = `<p class="empty-state">${selectedCodes.size ? "No available parts are associated with the selected repair code." : "Select a repair code to see its available parts."}</p>`;
  }
  updateRepairOrderPartsTotal();
}

function updateRepairOrderPartsTotal() {
  const total = [...document.querySelectorAll("#repairOrderParts input[data-unit-price]")]
    .reduce((sum, input) => sum + Number(input.value || 0) * Number(input.dataset.unitPrice || 0), 0);
  document.getElementById("repairOrderPartsTotal").textContent = `$${total.toFixed(2)}`;
}

function renderServiceScheduleAssetOptions() {
  const select = document.getElementById("serviceScheduleAsset");
  const selected = select.value;
  select.innerHTML = `<option value="">Select asset</option>`;
  unitTypes.forEach((item) => {
    const label = `${item.assetNumber} - ${item.make} ${item.year} ${item.unitType} ${item.model}`.trim();
    select.add(new Option(label, item.assetNumber));
  });
  if (unitTypes.some((item) => item.assetNumber === selected)) select.value = selected;
}

async function saveServiceSchedule(event) {
  event.preventDefault();
  const message = document.getElementById("serviceScheduleMessage");
  message.textContent = "Scheduling";
  try {
    const result = await shopApi("/api/shop-service-schedules", {
      method: "POST",
      body: JSON.stringify({
        date: document.getElementById("serviceScheduleDate").value,
        time: "07:00",
        shift: document.getElementById("serviceScheduleShift").value,
        assetNumber: document.getElementById("serviceScheduleAsset").value,
        driverName: document.getElementById("serviceScheduleDriverName").value.trim(),
        location: document.getElementById("serviceScheduleLocation").value.trim(),
        priority: document.getElementById("serviceSchedulePriority").value,
        notes: document.getElementById("serviceScheduleNotes").value.trim()
      })
    });
    document.getElementById("serviceScheduleForm").reset();
    document.getElementById("serviceScheduleDate").value = localDateValue();
    message.textContent = `Service #${result.id} was scheduled.`;
    await loadServiceSchedules();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function loadServiceSchedules() {
  try {
    serviceSchedules = await shopApi("/api/shop-service-schedules");
    renderServiceSchedules();
    renderServiceAvailability();
    renderShopDashboard();
  } catch (error) {
    document.getElementById("serviceSchedulesMessage").textContent = error.message;
  }
}

async function loadServiceDayStatuses() {
  try {
    serviceDayStatuses = await shopApi("/api/shop-service-day-statuses");
    renderServiceAvailability();
  } catch (error) {
    document.getElementById("serviceSchedulesMessage").textContent = error.message;
  }
}

function renderServiceAvailability() {
  const selectedDate = document.getElementById("serviceAvailabilityDate").value;
  const container = document.getElementById("serviceAvailableDays");
  container.replaceChildren();
  if (!selectedDate) return;
  const weekStart = new Date(`${selectedDate}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  let weeklyServiceCount = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + offset);
    const date = dateInputValue(day);
    const scheduledCount = serviceSchedules.filter((schedule) =>
      schedule.date === date && (schedule.status === "Scheduled" || schedule.status === "Working on it")
    ).length;
    weeklyServiceCount += scheduledCount;
    const dayStatus = serviceDayStatuses.find((item) => item.date === date)?.status || "Available";
    const dayPanel = document.createElement("article");
    dayPanel.innerHTML = `
      <strong>${day.toLocaleDateString(undefined, { weekday: "long" })}</strong>
      <span>${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      <em>${scheduledCount} service${scheduledCount === 1 ? "" : "s"}</em>
      <div class="day-workload-actions"></div>
    `;
    const actions = dayPanel.querySelector(".day-workload-actions");
    const scheduleButton = document.createElement("button");
    scheduleButton.type = "button";
    scheduleButton.textContent = dayStatus === "Unavailable" ? "Closed" : "Schedule service";
    scheduleButton.disabled = dayStatus === "Unavailable";
    if (dayStatus !== "Unavailable") scheduleButton.addEventListener("click", () => selectAvailableServiceDay(date));
    actions.append(scheduleButton);
    if (isShopAdmin) {
      const statusSelect = document.createElement("select");
      ["Available", "Unavailable"].forEach((status) => statusSelect.add(new Option(status, status)));
      statusSelect.value = dayStatus;
      statusSelect.setAttribute("aria-label", `Status for ${date}`);
      statusSelect.addEventListener("change", () => updateServiceDayStatus(date, statusSelect.value));
      actions.append(statusSelect);
    }
    container.append(dayPanel);
  }
  document.getElementById("serviceAvailableDaysTotal").textContent = `${weeklyServiceCount} service${weeklyServiceCount === 1 ? "" : "s"} this week`;
  document.getElementById("serviceAvailableDaysEmpty").hidden = true;
}

async function updateServiceDayStatus(date, status) {
  const message = document.getElementById("serviceSchedulesMessage");
  message.textContent = "Updating day status";
  try {
    await shopApi("/api/shop-service-day-statuses", {
      method: "POST",
      body: JSON.stringify({ date, status })
    });
    message.textContent = `${date} is now ${status}.`;
    await loadServiceDayStatuses();
  } catch (error) {
    message.textContent = error.message;
    await loadServiceDayStatuses();
  }
}

function selectAvailableServiceDay(date) {
  document.getElementById("serviceScheduleDate").value = date;
  setShopPage("schedule-service");
  document.getElementById("serviceScheduleAsset").focus();
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderServiceSchedules() {
  const filter = document.getElementById("serviceScheduleStatusFilter").value;
  const visibleSchedules = isShopTechnician
    ? serviceSchedules.filter((schedule) => schedule.date === localDateValue())
    : serviceSchedules;
  const schedules = filter === "__all"
    ? visibleSchedules
    : visibleSchedules.filter((schedule) => schedule.status === filter);
  const list = document.getElementById("serviceSchedulesList");
  list.replaceChildren();
  schedules.forEach((schedule) => {
    const item = document.createElement("tr");
    item.className = `schedule-row status-${schedule.status.toLowerCase().replaceAll(" ", "-")}`;
    const canChangeStatus = isShopAdmin || isShopTechnician;
    const statusOptions = ["Scheduled", "Working on it", "Completed", "Cancelled"];
    const statusControl = canChangeStatus ? `
        <select class="table-status-select" data-schedule-id="${Number(schedule.id)}">
          ${statusOptions.map((status) =>
            `<option${status === schedule.status ? " selected" : ""}>${status}</option>`
          ).join("")}
        </select>
    ` : escapeHtml(schedule.status);
    item.innerHTML = `
      <td><strong>#${Number(schedule.id)}</strong></td>
      <td>${escapeHtml(new Date(`${schedule.originalScheduledDate || schedule.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }))}</td>
      <td>${escapeHtml(new Date(`${schedule.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }))}</td>
      <td>${escapeHtml(schedule.shift || "Day")}</td>
      <td><strong>${escapeHtml(schedule.assetNumber)}</strong></td>
      <td>${escapeHtml(schedule.driverName || "Not set")}</td>
      <td>${escapeHtml(schedule.location)}</td>
      <td>${escapeHtml(schedule.technicianName || "Unassigned")}</td>
      <td><span class="schedule-priority priority-${escapeHtml(schedule.priority.toLowerCase())}">${escapeHtml(schedule.priority)}</span></td>
      <td class="table-cell-lines">${escapeHtml(schedule.notes || "None")}</td>
      <td>${escapeHtml(schedule.updatedBy)}</td>
      <td>${statusControl}</td>
      <td>${isShopAdmin ? `<button class="table-action danger-action delete-booking-button" type="button">Delete</button>` : ""}</td>
    `;
    item.querySelector("select[data-schedule-id]")?.addEventListener("change", (event) => updateServiceScheduleStatus(schedule.id, event.target.value));
    item.querySelector(".delete-booking-button")?.addEventListener("click", () => deleteServiceSchedule(schedule));
    list.append(item);
  });
  document.getElementById("serviceSchedulesTotal").textContent = isShopTechnician
    ? `${schedules.length} repair${schedules.length === 1 ? "" : "s"} today`
    : `${schedules.length} scheduled repair${schedules.length === 1 ? "" : "s"}`;
  document.getElementById("serviceSchedulesEmpty").hidden = schedules.length > 0;
}

async function deleteServiceSchedule(schedule) {
  if (!confirm(`Delete service booking #${schedule.id} for asset ${schedule.assetNumber}?`)) return;
  const message = document.getElementById("serviceSchedulesMessage");
  message.textContent = "Deleting booking";
  try {
    const result = await shopApi(`/api/shop-service-schedules/${schedule.id}`, { method: "DELETE" });
    message.textContent = result.savedRepairOrderPreserved
      ? `Booking #${schedule.id} was deleted. Its saved repair order was preserved.`
      : `Booking #${schedule.id} was deleted.`;
    await loadServiceSchedules();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function updateServiceScheduleStatus(scheduleId, status) {
  const message = document.getElementById("serviceSchedulesMessage");
  message.textContent = "Updating status";
  try {
    const selectedSchedule = serviceSchedules.find((schedule) => Number(schedule.id) === Number(scheduleId));
    const result = await shopApi(`/api/shop-service-schedules/${scheduleId}/status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    message.textContent = status === "Completed" && result.repairOrderId
      ? `Service #${scheduleId} is complete and saved as repair order #${result.repairOrderId}.`
      : `Service #${scheduleId} is now ${status}.`;
    await loadServiceSchedules();
    if (status === "Working on it" && selectedSchedule) {
      openScheduledRepairOrder({ ...selectedSchedule, status, technicianName: session.user.name });
    } else if (isShopAdmin) {
      await loadRepairOrders();
    }
  } catch (error) {
    message.textContent = error.message;
    await loadServiceSchedules();
  }
}

function openScheduledRepairOrder(schedule) {
  activeScheduleRepairId = Number(schedule.id);
  setShopPage("repair-orders");
  document.getElementById("repairOrderForm").reset();
  document.getElementById("repairOrderDate").value = schedule.date;
  document.getElementById("repairOrderLocation").value = schedule.location || "";
  document.getElementById("repairOrderTechnician").value = session.user.name;
  document.getElementById("repairOrderDriverName").value = schedule.driverName || "";
  document.getElementById("repairOrderAsset").value = schedule.assetNumber || "";
  updateRepairOrderUsageRequirements();
  document.getElementById("repairOrderDescription").value = schedule.notes || "";
  document.querySelectorAll("#repairOrderCodes input").forEach((input) => {
    input.checked = false;
  });
  renderRepairOrderParts();
  document.getElementById("repairOrderMessage").textContent = `Scheduled service #${schedule.id}. Review the service notes, then select repair codes and parts used.`;
  const mileageInput = document.getElementById("repairOrderMileage");
  (mileageInput.disabled ? document.getElementById("repairOrderDescription") : mileageInput).focus();
}

function localDateValue(date = new Date()) {
  const now = date;
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
