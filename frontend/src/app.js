// Điều khiển giao diện mẫu: mỗi trang gọi đúng endpoint backend và hiển thị kết quả theo bộ thiết kế LegacyVault.
import {
  api,
  describeError,
  getBaseUrl,
  onLog,
  refreshSession,
  setAccessToken,
  setBaseUrl,
} from "./api.js";

const baseUrlKey = "legacyvault-demo-base-url";

// Dữ liệu đang hiển thị, dùng lại giữa các trang.
const data = {
  user: null,
  vault: null,
  assets: [],
  beneficiaries: [],
  containers: [],
  checkInEtag: null,
};

// Nhãn tiếng Việt và kiểu chip cho các trạng thái backend trả về.
const statusLabels = {
  DRAFT: ["Nháp", ""],
  READY: ["Sẵn sàng", "success"],
  ARCHIVED: ["Đã lưu trữ", ""],
  ACTIVE: ["Đang chạy", "success"],
  CHECKIN_OVERDUE: ["Quá hạn điểm danh", "warning"],
  AWAITING_CHECK: ["Chờ kiểm tra", "warning"],
  DEATH_CASE_OPEN: ["Có hồ sơ chứng tử", "danger"],
  HANDOVER_IN_PROGRESS: ["Đang bàn giao", "dark"],
  CLOSED: ["Đã đóng", "dark"],
  OPEN: ["Đang mở", "success"],
  FREE: ["Free", ""],
  PAID_ACTIVE: ["Đã trả phí", "success"],
  NOT_STARTED: ["Chưa bắt đầu", ""],
  PASSED: ["Đã xác minh", "success"],
  FAILED: ["Chưa đạt", "danger"],
  FILE: ["Tệp", ""],
  TEXT: ["Ghi chú", "warning"],
};

// ---------- Tiện ích ----------

function byId(id) {
  return document.getElementById(id);
}

function on(id, eventName, handler) {
  byId(id).addEventListener(eventName, handler);
}

function readForm(form) {
  const values = {};
  for (const element of form.elements) {
    if (!element.name) {
      continue;
    }
    if (element.type === "checkbox") {
      values[element.name] = element.checked;
    } else if (element.type === "file") {
      values[element.name] = null;
      if (element.files.length > 0) {
        values[element.name] = element.files[0];
      }
    } else {
      values[element.name] = element.value.trim();
    }
  }
  return values;
}

// Chuỗi rỗng gửi lên thành null để backend hiểu là "không có".
function emptyToNull(value) {
  if (value === "") {
    return null;
  }
  return value;
}

function toast(message, isError) {
  const box = document.createElement("div");
  box.className = "lv-toast lv-toast--success";
  box.setAttribute("role", "status");
  let title = "Thành công";
  if (isError) {
    box.className = "lv-toast lv-toast--error";
    box.setAttribute("role", "alert");
    title = "Chưa thực hiện được";
  }
  const icon = document.createElement("span");
  icon.className = "lv-toast__icon";
  icon.textContent = isError ? "!" : "✓";
  const text = document.createElement("div");
  text.className = "lv-toast__text";
  const titleLine = document.createElement("p");
  titleLine.className = "lv-toast__title";
  titleLine.textContent = title;
  const messageLine = document.createElement("p");
  messageLine.className = "lv-toast__msg";
  messageLine.textContent = message;
  text.appendChild(titleLine);
  text.appendChild(messageLine);
  box.appendChild(icon);
  box.appendChild(text);
  byId("toasts").appendChild(box);
  setTimeout(function () {
    box.remove();
  }, 4500);
}

// Báo kết quả một lần gọi API; trả true khi thành công.
function report(result, successMessage) {
  if (result.ok) {
    toast(successMessage, false);
    return true;
  }
  toast(describeError(result), true);
  return false;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("vi-VN");
}

function formatBytes(value) {
  if (value < 1024) {
    return value + " B";
  }
  if (value < 1024 * 1024) {
    return (value / 1024).toFixed(1) + " KiB";
  }
  return (value / 1024 / 1024).toFixed(1) + " MiB";
}

function chip(status) {
  const span = document.createElement("span");
  const known = statusLabels[status];
  let label = status;
  let variant = "";
  if (known) {
    label = known[0];
    variant = known[1];
  }
  span.className = "lv-chip";
  if (variant !== "") {
    span.className = "lv-chip lv-chip--" + variant;
  }
  span.textContent = label;
  return span;
}

function setChip(id, status) {
  const holder = byId(id);
  holder.innerHTML = "";
  holder.appendChild(chip(status));
}

function linkButton(text, handler, isDanger) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-btn";
  if (isDanger) {
    button.className = "link-btn danger";
  }
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

// Tạo bảng theo kiểu lv-table; dùng textContent để không chèn HTML lạ từ dữ liệu.
function renderTable(container, columns, rows, emptyText) {
  container.innerHTML = "";
  container.classList.remove("muted");
  if (rows.length === 0) {
    container.textContent = emptyText;
    container.classList.add("muted");
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "lv-table-wrap";
  const table = document.createElement("table");
  table.className = "lv-table";
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column.title;
    headRow.appendChild(th);
  }
  table.appendChild(headRow);

  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      const value = column.value(row);
      if (value instanceof Node) {
        td.appendChild(value);
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderFacts(container, facts) {
  container.innerHTML = "";
  container.classList.remove("muted");
  const list = document.createElement("dl");
  list.className = "facts";
  for (const fact of facts) {
    const term = document.createElement("dt");
    term.textContent = fact[0];
    const detail = document.createElement("dd");
    detail.textContent = fact[1];
    list.appendChild(term);
    list.appendChild(detail);
  }
  container.appendChild(list);
}

function renderStats(container, tiles) {
  container.innerHTML = "";
  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = "lv-stat";
    const label = document.createElement("p");
    label.className = "lv-stat__label";
    label.textContent = tile[0];
    const value = document.createElement("p");
    value.className = "lv-stat__value";
    value.textContent = tile[1];
    const sub = document.createElement("p");
    sub.className = "lv-stat__sub";
    sub.textContent = tile[2];
    box.appendChild(label);
    box.appendChild(value);
    box.appendChild(sub);
    container.appendChild(box);
  }
}

function fillSelect(select, items, labelOf) {
  select.innerHTML = "";
  if (items.length === 0) {
    const option = document.createElement("option");
    option.textContent = "(chưa có)";
    option.value = "";
    select.appendChild(option);
    return;
  }
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = labelOf(item);
    select.appendChild(option);
  }
}

function requireVault() {
  if (data.vault === null) {
    toast("Hãy tạo kho ở trang Tổng quan trước.", true);
    return false;
  }
  return true;
}

function vaultPath(suffix) {
  return "/vaults/" + data.vault.id + suffix;
}

// ---------- Chuyển màn hình ----------

function showAuth(panel) {
  byId("view-app").classList.add("hidden");
  byId("view-auth").classList.remove("hidden");
  showAuthPanel(panel || "login");
}

function showApp() {
  byId("view-auth").classList.add("hidden");
  byId("view-app").classList.remove("hidden");
  let page = window.location.hash.replace("#", "");
  if (document.querySelector('.page[data-page="' + page + '"]') === null) {
    page = "overview";
  }
  showPage(page);
}

function showAuthPanel(name) {
  const tabs = byId("auth-tabs").querySelectorAll(".lv-tab");
  for (const tab of tabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.auth === name));
  }
  const panels = document.querySelectorAll("[data-auth-panel]");
  for (const panel of panels) {
    panel.classList.toggle("hidden", panel.dataset.authPanel !== name);
  }
}

function showAssetPanel(name) {
  const tabs = byId("asset-tabs").querySelectorAll(".lv-tab");
  for (const tab of tabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.asset === name));
  }
  const panels = document.querySelectorAll("[data-asset-panel]");
  for (const panel of panels) {
    panel.classList.toggle("hidden", panel.dataset.assetPanel !== name);
  }
}

// Mỗi lần mở một trang thì tải lại dữ liệu của trang đó.
function showPage(name) {
  const links = byId("nav").querySelectorAll("a");
  for (const link of links) {
    if (link.dataset.page === name) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
  const pages = document.querySelectorAll(".page");
  for (const page of pages) {
    page.classList.toggle("hidden", page.dataset.page !== name);
  }

  if (name === "overview") {
    loadVault();
  } else if (name === "assets") {
    loadAssets();
  } else if (name === "beneficiaries") {
    loadBeneficiaries();
  } else if (name === "containers") {
    loadContainersPage();
  } else if (name === "checkin") {
    loadCheckIn();
  } else if (name === "ekyc") {
    loadEkyc();
  } else if (name === "settings") {
    renderSessionView();
  }
}

function renderUser() {
  if (data.user === null) {
    return;
  }
  byId("user-name").textContent = data.user.fullName;
  byId("user-avatar").textContent = data.user.fullName.trim().charAt(0).toUpperCase() || "?";
  byId("banner-verify").classList.toggle("hidden", data.user.emailVerified);
}

function renderSessionView() {
  if (data.user === null) {
    return;
  }
  let verified = "Chưa xác minh";
  if (data.user.emailVerified) {
    verified = "Đã xác minh";
  }
  renderFacts(byId("session-view"), [
    ["Họ tên", data.user.fullName],
    ["Email", data.user.email],
    ["Xác minh email", verified],
    ["Vai trò hệ thống", data.user.role],
    ["Trạng thái", data.user.status],
    ["Tạo lúc", formatDate(data.user.createdAt)],
  ]);
}

function startSession(result) {
  setAccessToken(result.data.accessToken);
  data.user = result.data.user;
  renderUser();
  showApp();
}

// ---------- Tài khoản ----------

async function register(event) {
  event.preventDefault();
  const values = readForm(event.target);
  if (values.password !== values.confirmPassword) {
    toast("Hai mật khẩu không khớp.", true);
    return;
  }
  const result = await api("POST", "/auth/register", { body: values });
  if (report(result, "Đã tạo tài khoản. Mở link xác minh trong email (khi dev: trong log backend).")) {
    byId("form-verify").elements.email.value = values.email;
    showAuthPanel("verify");
  }
}

async function verifyEmail(token) {
  const result = await api("POST", "/auth/verify-email", { body: { token: token } });
  if (report(result, "Đã xác minh email. Bạn có thể đăng nhập.")) {
    byId("form-login").elements.email.value = result.data.email;
    showAuthPanel("login");
  }
}

async function submitVerify(event) {
  event.preventDefault();
  await verifyEmail(readForm(event.target).token);
}

async function resend() {
  const email = byId("form-verify").elements.email.value.trim();
  const result = await api("POST", "/auth/resend-verification", { body: { email: email } });
  report(result, "Nếu email hợp lệ, link xác minh mới đã được gửi.");
}

async function login(event) {
  event.preventDefault();
  const values = readForm(event.target);
  const result = await api("POST", "/auth/login", {
    body: { email: values.email, password: values.password, rememberMe: values.rememberMe },
    csrf: true,
    useToken: false,
  });
  if (report(result, "Chào mừng trở lại, " + (result.ok ? result.data.user.fullName : "") + ".")) {
    startSession(result);
  }
}

async function refresh() {
  const result = await refreshSession();
  if (report(result, "Đã làm mới phiên.")) {
    data.user = result.data.user;
    renderUser();
    renderSessionView();
  }
}

async function logout(revokeAllDevices) {
  const result = await api("POST", "/auth/logout", {
    body: { revokeAllDevices: revokeAllDevices },
    csrf: true,
    useToken: false,
  });
  setAccessToken(null);
  data.user = null;
  data.vault = null;
  report(result, "Đã đăng xuất.");
  showAuth("login");
}

// ---------- Tổng quan và kho ----------

function renderVault() {
  const vault = data.vault;
  byId("form-vault-create").classList.add("hidden");
  byId("vault-area").classList.remove("hidden");
  setChip("plan-chip", vault.planStatus);

  renderStats(byId("vault-stats"), [
    ["Hạng dịch vụ", vault.serviceTier, statusLabels[vault.serviceStatus] ? statusLabels[vault.serviceStatus][0] : vault.serviceStatus],
    ["Dung lượng đã dùng", formatBytes(vault.storageUsedBytes), "trên " + formatBytes(vault.storageQuotaBytes)],
    ["Suất người nhận", vault.usedBeneficiarySlots + " / " + vault.beneficiarySlots, "đang dùng / tối đa"],
    ["Gói đang dùng", String(vault.activeContainerCount), "chưa tính gói đã lưu trữ"],
  ]);

  renderFacts(byId("vault-view"), [
    ["Tên kho", vault.name],
    ["Mô tả", vault.description || "—"],
    ["Trạng thái kho", statusLabels[vault.status] ? statusLabels[vault.status][0] : vault.status],
    ["Phiên bản cấu hình", "v" + vault.planConfigVersion],
    ["Hạn dịch vụ", formatDate(vault.serviceExpiresAt)],
    ["Tạo lúc", formatDate(vault.createdAt)],
  ]);

  const form = byId("form-vault-update");
  form.elements.name.value = vault.name;
  form.elements.description.value = vault.description || "";
}

async function loadVault() {
  const result = await api("GET", "/vaults/me");
  if (result.ok) {
    data.vault = result.data;
    renderVault();
    return;
  }
  data.vault = null;
  byId("vault-area").classList.add("hidden");
  if (result.status === 404) {
    // Chưa có kho: hiện màn hình chào mừng để tạo kho.
    byId("form-vault-create").classList.remove("hidden");
  } else {
    toast(describeError(result), true);
  }
}

async function createVault(event) {
  event.preventDefault();
  const values = readForm(event.target);
  const result = await api("POST", "/vaults", {
    body: { name: emptyToNull(values.name), description: emptyToNull(values.description) },
  });
  if (report(result, "Đã tạo kho của bạn.")) {
    data.vault = result.data;
    renderVault();
  }
}

async function updateVault(event) {
  event.preventDefault();
  if (!requireVault()) {
    return;
  }
  const values = readForm(event.target);
  const result = await api("PUT", vaultPath(""), {
    body: { etag: data.vault.etag, name: emptyToNull(values.name), description: emptyToNull(values.description) },
  });
  if (report(result, "Đã lưu thông tin kho.")) {
    data.vault = result.data;
    renderVault();
  }
}

// Chỉ dùng khi demo: nhờ máy chủ giao diện mẫu sửa hạng dịch vụ trong database (backend chưa có thanh toán).
async function upgradeTier() {
  if (data.user === null || !requireVault()) {
    return;
  }
  const response = await fetch("/demo/upgrade-tier", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Demo": "1" },
    body: JSON.stringify({ email: data.user.email, tier: byId("sel-tier").value }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { message: "Máy chủ giao diện mẫu không trả kết quả." };
  }
  toast(body.message, !response.ok);
  if (response.ok) {
    await loadVault();
  }
}

// ---------- Kho của tôi: tài sản ----------

async function loadAssets() {
  if (data.vault === null) {
    await loadVault();
  }
  if (data.vault === null) {
    return;
  }
  const result = await api("GET", vaultPath("/assets?pageSize=100"));
  if (!result.ok) {
    toast(describeError(result), true);
    return;
  }
  data.assets = result.data.items;
  byId("assets-count").textContent = data.assets.length + " mục";
  renderTable(byId("assets-view"), [
    { title: "Tên mục", value: function (a) { return a.name; } },
    { title: "Loại", value: function (a) { return chip(a.kind); } },
    { title: "Phiên bản", value: function (a) { return "v" + a.currentVersion.versionNumber; } },
    { title: "Kích thước", value: function (a) { return formatBytes(a.currentVersion.sizeBytes); } },
    { title: "Cập nhật", value: function (a) { return formatDate(a.updatedAt || a.createdAt); } },
  ], data.assets, "Chưa có tài sản. Thêm tệp hoặc ghi chú ở bên phải.");
}

async function uploadFile(event) {
  event.preventDefault();
  if (!requireVault()) {
    return;
  }
  const values = readForm(event.target);
  if (values.file === null) {
    toast("Hãy chọn một tệp.", true);
    return;
  }
  const form = new FormData();
  form.append("file", values.file);
  if (values.name !== "") {
    form.append("name", values.name);
  }
  if (values.description !== "") {
    form.append("description", values.description);
  }
  const result = await api("POST", vaultPath("/assets"), { form: form });
  if (report(result, "Đã lưu tệp vào kho.")) {
    event.target.reset();
    byId("drop-title").textContent = "Chọn hoặc kéo tệp vào đây";
    await loadAssets();
  }
}

async function createTextAsset(event) {
  event.preventDefault();
  if (!requireVault()) {
    return;
  }
  const values = readForm(event.target);
  const result = await api("POST", vaultPath("/assets/text"), {
    body: { name: values.name, description: emptyToNull(values.description), content: values.content },
  });
  if (report(result, "Đã lưu ghi chú vào kho.")) {
    event.target.reset();
    await loadAssets();
  }
}

// ---------- Người nhận ----------

async function loadBeneficiaries() {
  if (data.vault === null) {
    await loadVault();
  }
  if (data.vault === null) {
    return;
  }
  const result = await api("GET", vaultPath("/beneficiaries?pageSize=100"));
  if (!result.ok) {
    toast(describeError(result), true);
    return;
  }
  data.beneficiaries = result.data.items;
  byId("beneficiaries-count").textContent = data.beneficiaries.length + " người";
  renderTable(byId("beneficiaries-view"), [
    { title: "Họ tên", value: function (b) { return b.fullName; } },
    { title: "CCCD", value: function (b) { return "•••• " + b.citizenIdLast4; } },
    { title: "Ngày sinh", value: function (b) { return new Date(b.dateOfBirth).toLocaleDateString("vi-VN"); } },
    { title: "Liên hệ", value: function (b) { return b.email || b.phone || "—"; } },
    { title: "Số gói", value: function (b) { return String(b.containerIds.length); } },
    { title: "", value: function (b) { return linkButton("Xóa", function () { deleteBeneficiary(b); }, true); } },
  ], data.beneficiaries, "Chưa có người nhận. Kho Free chưa được thêm người nhận.");
}

async function createBeneficiary(event) {
  event.preventDefault();
  if (!requireVault()) {
    return;
  }
  const values = readForm(event.target);
  const result = await api("POST", vaultPath("/beneficiaries"), {
    body: {
      citizenId: values.citizenId,
      fullName: values.fullName,
      dateOfBirth: values.dateOfBirth,
      email: emptyToNull(values.email),
      phone: emptyToNull(values.phone),
      confirmMinor: values.confirmMinor,
    },
  });
  if (report(result, "Đã thêm người nhận.")) {
    event.target.reset();
    await loadBeneficiaries();
  }
}

async function deleteBeneficiary(beneficiary) {
  if (!confirm("Xóa người nhận " + beneficiary.fullName + "?")) {
    return;
  }
  const result = await api("DELETE", vaultPath("/beneficiaries/" + beneficiary.id));
  if (report(result, "Đã xóa người nhận.")) {
    await loadBeneficiaries();
  }
}

// ---------- Gói bàn giao ----------

function nameOfAsset(id) {
  for (const asset of data.assets) {
    if (asset.id === id) {
      return asset.name;
    }
  }
  return id.substring(0, 8);
}

function nameOfBeneficiary(id) {
  for (const beneficiary of data.beneficiaries) {
    if (beneficiary.id === id) {
      return beneficiary.fullName;
    }
  }
  return id.substring(0, 8);
}

function confirmQuery() {
  return "?confirmPlanDeactivation=" + byId("confirm-plan").checked;
}

function memberLine(text, removeHandler) {
  const line = document.createElement("div");
  line.className = "member";
  line.appendChild(document.createTextNode(text));
  line.appendChild(linkButton("Gỡ", removeHandler, false));
  return line;
}

function containerMembers(container) {
  const box = document.createElement("div");
  for (const assetId of container.assetIds) {
    box.appendChild(memberLine("Tài sản: " + nameOfAsset(assetId), function () {
      removeFromContainer(container, "/assets/" + assetId);
    }));
  }
  for (const beneficiaryId of container.beneficiaryIds) {
    box.appendChild(memberLine("Người nhận: " + nameOfBeneficiary(beneficiaryId), function () {
      removeFromContainer(container, "/beneficiaries/" + beneficiaryId);
    }));
  }
  if (container.assetIds.length === 0 && container.beneficiaryIds.length === 0) {
    box.textContent = "Chưa có gì";
    box.className = "muted";
  }
  return box;
}

async function loadContainersPage() {
  if (data.vault === null) {
    await loadVault();
  }
  if (data.vault === null) {
    return;
  }
  // Cần danh sách tài sản và người nhận để hiện tên và đổ vào ô chọn.
  const assets = await api("GET", vaultPath("/assets?pageSize=100"));
  if (assets.ok) {
    data.assets = assets.data.items;
  }
  const beneficiaries = await api("GET", vaultPath("/beneficiaries?pageSize=100"));
  if (beneficiaries.ok) {
    data.beneficiaries = beneficiaries.data.items;
  }
  fillSelect(byId("sel-asset"), data.assets, function (a) { return a.name; });
  fillSelect(byId("sel-beneficiary"), data.beneficiaries, function (b) { return b.fullName + " (•••• " + b.citizenIdLast4 + ")"; });
  await loadContainers();
}

async function loadContainers() {
  const archived = byId("include-archived").checked;
  const result = await api("GET", vaultPath("/containers?pageSize=100&includeArchived=" + archived));
  if (!result.ok) {
    toast(describeError(result), true);
    return;
  }
  data.containers = result.data.items;
  renderTable(byId("containers-view"), [
    { title: "Tên gói", value: function (c) { return c.name; } },
    { title: "Trạng thái", value: function (c) { return chip(c.status); } },
    { title: "Thành phần", value: containerMembers },
    { title: "", value: function (c) {
      if (c.status === "ARCHIVED") {
        return "";
      }
      return linkButton("Lưu trữ", function () { archiveContainer(c); }, true);
    } },
  ], data.containers, "Chưa có gói. Tạo gói ở bên phải.");

  const active = [];
  for (const container of data.containers) {
    if (container.status !== "ARCHIVED") {
      active.push(container);
    }
  }
  fillSelect(byId("sel-container"), active, function (c) { return c.name; });
}

async function createContainer(event) {
  event.preventDefault();
  if (!requireVault()) {
    return;
  }
  const values = readForm(event.target);
  const result = await api("POST", vaultPath("/containers"), {
    body: { name: values.name, description: emptyToNull(values.description) },
  });
  if (report(result, "Đã tạo gói.")) {
    event.target.reset();
    await loadContainers();
  }
}

async function addToContainer(kind) {
  if (!requireVault()) {
    return;
  }
  const containerId = byId("sel-container").value;
  if (containerId === "") {
    toast("Chưa có gói để chọn.", true);
    return;
  }
  let body = { beneficiaryId: byId("sel-beneficiary").value };
  if (kind === "assets") {
    body = { assetId: byId("sel-asset").value };
  }
  const result = await api("POST", vaultPath("/containers/" + containerId + "/" + kind), { body: body });
  if (report(result, "Đã thêm vào gói.")) {
    await loadContainers();
  }
}

async function removeFromContainer(container, suffix) {
  const result = await api("DELETE", vaultPath("/containers/" + container.id + suffix + confirmQuery()));
  if (report(result, "Đã gỡ khỏi gói.")) {
    await loadContainers();
  }
}

async function archiveContainer(container) {
  if (!confirm("Lưu trữ gói " + container.name + "? Gói sẽ bị gỡ hết tài sản và người nhận.")) {
    return;
  }
  const result = await api("DELETE", vaultPath("/containers/" + container.id + confirmQuery()));
  if (report(result, "Đã lưu trữ gói.")) {
    await loadContainers();
  }
}

// ---------- Điểm danh ----------

function renderCheckIn(status) {
  data.checkInEtag = status.settings.etag;
  setChip("checkin-chip", status.planStatus);
  renderStats(byId("checkin-stats"), [
    ["Lần điểm danh gần nhất", formatDate(status.lastCheckInAt), ""],
    ["Hạn điểm danh kế tiếp", formatDate(status.nextCheckInDueAt), ""],
    ["Chu kỳ", status.settings.cycleDays + " ngày", "thời gian chờ " + status.settings.graceDays + " ngày"],
  ]);
  let pending = "—";
  if (status.settings.pendingCycleDays) {
    pending = status.settings.pendingCycleDays + " ngày / chờ " + status.settings.pendingGraceDays + " ngày";
  }
  renderFacts(byId("checkin-view"), [
    ["Trạng thái điểm danh", statusLabels[status.status] ? statusLabels[status.status][0] : status.status],
    ["Hết thời gian chờ", formatDate(status.graceEndsAt)],
    ["Lịch mới áp dụng kỳ sau", pending],
  ]);
}

async function loadCheckIn() {
  const result = await api("GET", "/check-ins/me");
  if (result.ok) {
    renderCheckIn(result.data);
  } else {
    toast(describeError(result), true);
  }
}

async function checkIn() {
  const result = await api("POST", "/check-ins");
  if (report(result, "Đã điểm danh. Hẹn bạn ở kỳ sau.")) {
    renderCheckIn(result.data);
  }
}

async function updateCheckInSettings(event) {
  event.preventDefault();
  if (data.checkInEtag === null) {
    await loadCheckIn();
  }
  const values = readForm(event.target);
  const body = { etag: data.checkInEtag };
  if (values.cycleDays !== "") {
    body.cycleDays = Number(values.cycleDays);
  }
  if (values.graceDays !== "") {
    body.graceDays = Number(values.graceDays);
  }
  const result = await api("PATCH", "/vaults/me/check-in-settings", { body: body });
  if (report(result, "Đã lưu lịch, áp dụng từ kỳ sau.")) {
    renderCheckIn(result.data);
  }
}

// ---------- eKYC ----------

function renderEkyc(status) {
  setChip("ekyc-chip", status.status);
  let score = "—";
  if (status.faceMatchScore !== null && status.faceMatchScore !== undefined) {
    score = status.faceMatchScore.toFixed(3) + " (ngưỡng " + status.matchThreshold + ")";
  }
  renderFacts(byId("ekyc-view"), [
    ["Trạng thái", statusLabels[status.status] ? statusLabels[status.status][0] : status.status],
    ["4 số cuối CCCD", status.citizenIdLast4 || "—"],
    ["Điểm so khớp", score],
    ["Hoàn tất lúc", formatDate(status.completedAt)],
  ]);

  // Tô màu thanh tiến trình theo kết quả hiện có.
  let current = 1;
  if (status.citizenIdLast4) {
    current = 2;
  }
  if (status.status === "PASSED") {
    current = 4;
  }
  const steps = byId("ekyc-steps").querySelectorAll(".lv-step");
  for (const step of steps) {
    const number = Number(step.dataset.step);
    step.className = "lv-step";
    if (number < current) {
      step.className = "lv-step lv-step--done";
    } else if (number === current) {
      step.className = "lv-step lv-step--current";
    }
  }
}

async function loadEkyc() {
  const result = await api("GET", "/ekyc/me");
  if (result.ok) {
    renderEkyc(result.data);
  } else {
    toast(describeError(result), true);
  }
}

async function sendEkycImage(event, path, successMessage) {
  event.preventDefault();
  const values = readForm(event.target);
  const form = new FormData();
  form.append("file", values.file);
  const result = await api("POST", path, { form: form });
  if (report(result, successMessage)) {
    await loadEkyc();
  }
}

// ---------- Cấu hình và nhật ký ----------

function saveSettings(event) {
  event.preventDefault();
  setBaseUrl(readForm(event.target).baseUrl);
  try {
    localStorage.setItem(baseUrlKey, getBaseUrl());
  } catch {
    // Trình duyệt chặn lưu cục bộ thì vẫn dùng giá trị trong phiên này.
  }
  fillBaseUrlInputs();
  toast("Đã lưu địa chỉ backend.", false);
}

function fillBaseUrlInputs() {
  byId("form-settings").elements.baseUrl.value = getBaseUrl();
  byId("form-settings-auth").elements.baseUrl.value = getBaseUrl();
}

async function checkHealth() {
  const origin = new URL(getBaseUrl()).origin;
  try {
    const response = await fetch(origin + "/health/live");
    if (response.ok) {
      toast("Backend đang chạy tại " + origin, false);
    } else {
      toast("Backend trả lỗi " + response.status, true);
    }
  } catch {
    toast("Không kết nối được " + origin + ". Backend đã chạy chưa?", true);
  }
}

function appendLog(entry) {
  const line = document.createElement("div");
  line.className = "log-line";
  const status = document.createElement("span");
  status.className = "ok";
  if (entry.status >= 400) {
    status.className = "error";
  }
  status.textContent = entry.status + " ";
  line.appendChild(status);
  let text = entry.method + " " + entry.path;
  if (entry.body !== null && entry.body !== undefined) {
    let body = entry.body;
    if (typeof body !== "string") {
      body = JSON.stringify(body);
    }
    // Không hiện access token trong nhật ký.
    body = body.replace(/"accessToken":"[^"]*"/g, "\"accessToken\":\"(ẩn)\"");
    if (body.length > 300) {
      body = body.substring(0, 300) + "…";
    }
    text = text + "  " + body;
  }
  line.appendChild(document.createTextNode(text));
  byId("log").prepend(line);
}

// ---------- Khởi động ----------

function bindEvents() {
  const authTabs = byId("auth-tabs").querySelectorAll(".lv-tab");
  for (const tab of authTabs) {
    tab.addEventListener("click", function () { showAuthPanel(tab.dataset.auth); });
  }
  const assetTabs = byId("asset-tabs").querySelectorAll(".lv-tab");
  for (const tab of assetTabs) {
    tab.addEventListener("click", function () { showAssetPanel(tab.dataset.asset); });
  }
  const navLinks = byId("nav").querySelectorAll("a");
  for (const link of navLinks) {
    link.addEventListener("click", function () { showPage(link.dataset.page); });
  }
  const healthButtons = document.querySelectorAll("[data-health]");
  for (const button of healthButtons) {
    button.addEventListener("click", checkHealth);
  }

  on("form-login", "submit", login);
  on("form-register", "submit", register);
  on("form-verify", "submit", submitVerify);
  on("btn-resend", "click", resend);
  on("form-settings-auth", "submit", saveSettings);

  on("btn-logout", "click", function (event) { event.preventDefault(); logout(false); });
  on("btn-logout-all", "click", function () { logout(true); });
  on("btn-refresh", "click", refresh);
  on("form-settings", "submit", saveSettings);

  on("form-vault-create", "submit", createVault);
  on("form-vault-update", "submit", updateVault);
  on("btn-upgrade", "click", upgradeTier);

  on("form-asset-file", "submit", uploadFile);
  on("form-asset-text", "submit", createTextAsset);
  byId("form-asset-file").elements.file.addEventListener("change", function (event) {
    if (event.target.files.length > 0) {
      byId("drop-title").textContent = event.target.files[0].name;
    }
  });

  on("form-beneficiary", "submit", createBeneficiary);

  on("form-container", "submit", createContainer);
  on("include-archived", "change", loadContainers);
  on("btn-add-asset", "click", function () { addToContainer("assets"); });
  on("btn-add-beneficiary", "click", function () { addToContainer("beneficiaries"); });

  on("btn-checkin", "click", checkIn);
  on("form-checkin-settings", "submit", updateCheckInSettings);

  on("form-ekyc-document", "submit", function (event) { sendEkycImage(event, "/ekyc/document", "Đã đọc ảnh căn cước."); });
  on("form-ekyc-selfie", "submit", function (event) { sendEkycImage(event, "/ekyc/face-match", "Đã so khớp khuôn mặt."); });

  on("btn-clear-log", "click", function (event) { event.preventDefault(); byId("log").innerHTML = ""; });
}

async function start() {
  try {
    const saved = localStorage.getItem(baseUrlKey);
    if (saved) {
      setBaseUrl(saved);
    }
  } catch {
    // Không đọc được lưu cục bộ thì dùng địa chỉ mặc định.
  }
  fillBaseUrlInputs();
  onLog(appendLog);
  bindEvents();

  // Mở từ link xác minh email (/verify-email?token=...) thì xác minh ngay.
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (window.location.pathname.startsWith("/verify-email") && token) {
    history.replaceState(null, "", "/");
    showAuth("verify");
    byId("form-verify").elements.token.value = token;
    await verifyEmail(token);
    return;
  }

  // Cookie phiên còn hạn (ví dụ sau khi tải lại trang) thì vào thẳng ứng dụng.
  const restored = await refreshSession();
  if (restored.ok) {
    startSession(restored);
  } else {
    showAuth("login");
  }
}

start();
