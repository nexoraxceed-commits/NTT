const apiBaseUrl = window.NTT_CONFIG?.apiBaseUrl ?? "http://localhost:8000";
const sessionKey = "ntt_auth_session";
const persistentSessionKey = "ntt_auth_persistent_session";
const authActiveKey = "ntt_auth_active";
const historyLogoutKey = "ntt_history_logout";
let activeUsersPromise = null;
const authPages = new Set([
  "/",
  "/index.html",
  "/Pages/index.html",
  "/signup",
  "/signup.html",
  "/Pages/signup.html",
  "/forgot-password",
  "/forgot-password.html",
  "/Pages/forgot-password.html",
]);
const dashboardPages = new Set([
  "/post-login",
  "/post-login.html",
  "/Pages/post-login.html",
  "/projects",
  "/projects.html",
  "/Pages/projects.html",
  "/tasks",
  "/tasks.html",
  "/Pages/tasks.html",
  "/create-project",
  "/create-project.html",
  "/Pages/create-project.html",
  "/edit-project",
  "/edit-project.html",
  "/Pages/edit-project.html",
  "/create-task",
  "/create-task.html",
  "/Pages/create-task.html",
  "/project",
  "/project.html",
  "/Pages/project.html",
  "/task",
  "/task.html",
  "/Pages/task.html",
]);

function normalizePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function getSession() {
  const rawSession = window.sessionStorage.getItem(sessionKey);
  const rawPersistentSession = window.localStorage.getItem(persistentSessionKey);

  try {
    if (rawSession) {
      return JSON.parse(rawSession);
    }

    if (rawPersistentSession) {
      const session = JSON.parse(rawPersistentSession);
      window.sessionStorage.setItem(sessionKey, rawPersistentSession);
      return session;
    }

    return null;
  } catch (_error) {
    window.sessionStorage.removeItem(sessionKey);
    window.localStorage.removeItem(persistentSessionKey);
    return null;
  }
}

function isAuthActive() {
  return window.localStorage.getItem(authActiveKey) === "true";
}

function saveSession(data) {
  clearHistoryLogout();
  window.localStorage.setItem(authActiveKey, "true");
  const session = JSON.stringify({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId: data.user_id,
    email: data.email,
  });

  window.sessionStorage.setItem(sessionKey, session);
  window.localStorage.setItem(persistentSessionKey, session);
}

function clearSession() {
  window.sessionStorage.removeItem(sessionKey);
  window.localStorage.removeItem(persistentSessionKey);
  window.localStorage.removeItem(authActiveKey);
}

function logout() {
  clearSession();
  clearHistoryLogout();
  window.location.replace("/");
}

function markHistoryLogout() {
  window.sessionStorage.setItem(historyLogoutKey, "true");
}

function wasLoggedOutByHistory() {
  return window.sessionStorage.getItem(historyLogoutKey) === "true";
}

function clearHistoryLogout() {
  window.sessionStorage.removeItem(historyLogoutKey);
  window.localStorage.removeItem(historyLogoutKey);
}

function redirectToSignedOut() {
  window.location.replace("/signed-out");
}

function redirectToSignIn() {
  clearSession();
  clearHistoryLogout();
  window.location.replace("/");
}

function isExpiredSessionResponse(response, data) {
  const detail = String(data?.detail ?? "").toLowerCase();
  return (
    response.status === 401 ||
    detail.includes("session expired") ||
    detail.includes("invalid authorization") ||
    detail.includes("missing authorization")
  );
}

function isBackForwardNavigation(event) {
  if (event?.persisted) {
    return true;
  }

  const navigation = window.performance?.getEntriesByType?.("navigation")?.[0];
  return navigation?.type === "back_forward";
}

function guardPageAccess(event) {
  const path = normalizePath(window.location.pathname);
  const session = getSession();
  const cameFromHistory = isBackForwardNavigation(event);

  if (authPages.has(path) && session?.accessToken) {
    if (cameFromHistory && path !== "/") {
      clearSession();
      markHistoryLogout();
      redirectToSignedOut();
      return;
    }

    window.location.replace("/post-login");
    return;
  }

  if (authPages.has(path) && isAuthActive()) {
    clearSession();
    clearHistoryLogout();
    return;
  }

  if (dashboardPages.has(path) && wasLoggedOutByHistory()) {
    if (session?.accessToken) {
      clearHistoryLogout();
      return;
    }

    clearSession();
    redirectToSignedOut();
    return;
  }

  if (dashboardPages.has(path) && (!session?.accessToken || !isAuthActive())) {
    window.location.replace(wasLoggedOutByHistory() ? "/signed-out" : "/");
  }
}

function getFormValues(form) {
  const formData = new FormData(form);

  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

function setMessage(messageElement, text, isError = false) {
  if (!messageElement) {
    return;
  }

  messageElement.textContent = text;
  messageElement.classList.toggle("is-error", isError);
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatAssignee(user) {
  if (!user) {
    return "Unassigned";
  }

  if (user.user_name && user.email) {
    return `${user.user_name} (${user.email})`;
  }

  return user.user_name || user.email || "Unassigned";
}

function getTaskAssigneeList(task) {
  const candidates = Array.isArray(task.assignees) && task.assignees.length
    ? task.assignees
    : [task];
  const assignees = candidates
    .map((assignee) => ({
      name:
        assignee.assigned_to_name ||
        assignee.name ||
        assignee.user_name ||
        assignee.assigned_to_email ||
        assignee.email ||
        null,
      email: assignee.assigned_to_email || assignee.email || null,
    }))
    .filter((assignee) => assignee.name || assignee.email);

  if (!assignees.length) {
    return [{ name: "Unassigned", email: null }];
  }

  return assignees;
}

function formatTaskAssignees(task) {
  return getTaskAssigneeList(task)
    .map((assignee) => assignee.name || assignee.email)
    .join(", ");
}

function formatProjectMembers(members = []) {
  if (!members.length) {
    return "No assignees";
  }

  return members
    .map((member) => {
      const name = member.user_name || member.email || "Unknown user";
      return `${name} - ${member.role}`;
    })
    .join(", ");
}

function formatWatchers(watchers = []) {
  if (!watchers.length) {
    return "No watchers";
  }

  return watchers
    .map((watcher) => watcher.user_name || watcher.email || "Unknown user")
    .join(", ");
}

function normalizeExternalUrl(url) {
  const trimmedUrl = String(url ?? "").trim();
  if (!trimmedUrl) {
    return "";
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  return `https://${trimmedUrl}`;
}

function createTextLink(url, text) {
  const link = document.createElement("a");
  link.href = normalizeExternalUrl(url);
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function createStatusBadge(status) {
  const normalizedStatus = String(status || "OPEN").toUpperCase();
  const badge = document.createElement("span");
  badge.className = `status-badge status-${normalizedStatus
    .toLowerCase()
    .replaceAll(" ", "-")}`;
  badge.textContent = normalizedStatus;
  return badge;
}

function formatDisplayDate(value) {
  if (!value) {
    return "Not set";
  }

  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return String(value);
  }

  return dateValue.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function postJson(path, payload) {
  let response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error("Could not reach the backend. Please try again in a moment.");
  }

  const data = await response.json().catch(() => ({
    detail: response.ok ? "" : `Backend returned ${response.status}.`,
  }));

  if (!response.ok) {
    throw new Error(data.detail ?? "Request failed. Please try again.");
  }

  return data;
}

async function authorizedJson(path, options = {}) {
  const session = getSession();
  if (!session?.accessToken) {
    redirectToSignIn();
    throw new Error("Session expired. Redirecting to sign in.");
  }

  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    ...(options.headers || {}),
  };

  let response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error("Could not reach the backend. Please try again in a moment.");
  }

  const data = await response.json().catch(() => ({
    detail: response.ok ? "" : `Backend returned ${response.status}.`,
  }));

  if (!response.ok) {
    if (isExpiredSessionResponse(response, data)) {
      redirectToSignIn();
      throw new Error("Session expired. Redirecting to sign in.");
    }

    throw new Error(data.detail ?? "Request failed. Please try again.");
  }

  return data;
}

async function postAuthorizedJson(path, payload) {
  return authorizedJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function getAuthorizedJson(path) {
  return authorizedJson(path, { method: "GET" });
}

async function getActiveUsers() {
  if (!activeUsersPromise) {
    activeUsersPromise = getAuthorizedJson("/users").catch((error) => {
      activeUsersPromise = null;
      throw error;
    });
  }

  return activeUsersPromise;
}

async function populateUserSelect(selectElement, options = {}) {
  if (!selectElement) {
    return;
  }

  const { includeCurrentUser = false } = options;
  const users = await getActiveUsers();
  const session = getSession();
  let optionCount = 0;

  selectElement
    .querySelectorAll("option[data-generated='true']")
    .forEach((option) => option.remove());

  const fragment = document.createDocumentFragment();

  users.forEach((user) => {
    if (!user.email || (!includeCurrentUser && user.email === session?.email)) {
      return;
    }

    const option = document.createElement("option");
    option.value = user.email;
    option.textContent = formatAssignee(user);
    option.dataset.generated = "true";
    fragment.append(option);
    optionCount += 1;
  });

  if (optionCount === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.disabled = true;
    option.textContent = "No other active users found";
    option.dataset.generated = "true";
    fragment.append(option);
  }

  selectElement.append(fragment);
}

async function populateUserMultiSelect(selectElement, selectedEmails = []) {
  if (!selectElement) {
    return;
  }

  const users = await getActiveUsers();
  const selected = new Set(selectedEmails.filter(Boolean));
  selectElement
    .querySelectorAll("option[data-generated='true']")
    .forEach((option) => option.remove());

  const fragment = document.createDocumentFragment();
  users.forEach((user) => {
    if (!user.email) {
      return;
    }

    const option = document.createElement("option");
    option.value = user.email;
    option.textContent = formatAssignee(user);
    option.selected = selected.has(user.email);
    option.dataset.generated = "true";
    fragment.append(option);
  });

  selectElement.append(fragment);
}

async function populateUserCheckboxList(containerElement, selectedEmails = []) {
  if (!containerElement) {
    return;
  }

  const users = await getActiveUsers();
  const selected = new Set(selectedEmails.filter(Boolean));
  containerElement.innerHTML = "";

  if (!users.length) {
    renderEmptyState(containerElement, "No active users found.");
    return;
  }

  const fragment = document.createDocumentFragment();
  users.forEach((user) => {
    if (!user.email) {
      return;
    }

    const label = document.createElement("label");
    label.className = "checkbox-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = user.email;
    input.checked = selected.has(user.email);

    const text = document.createElement("span");
    text.textContent = formatAssignee(user);

    label.append(input, text);
    fragment.append(label);
  });

  containerElement.append(fragment);
}

function getSelectedValues(selectElement) {
  if (!selectElement) {
    return [];
  }

  return Array.from(selectElement.selectedOptions)
    .map((option) => option.value.trim())
    .filter(Boolean);
}

function getCheckedValues(containerElement) {
  if (!containerElement) {
    return [];
  }

  return Array.from(containerElement.querySelectorAll("input:checked"))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function setupLogoutButtons() {
  document.querySelectorAll("[data-logout-button]").forEach((button) => {
    button.addEventListener("click", logout);
  });
}

function setupWorkspaceNavigation() {
  const shell = document.querySelector(".workspace-shell");

  if (!shell || document.querySelector(".workspace-nav")) {
    return;
  }
  const header = shell.querySelector(".workspace-header");
  const titleBlock = header?.querySelector(":scope > div:first-child");
  const actions = header?.querySelector(":scope > .header-actions");
  const eyebrow = titleBlock?.querySelector(".eyebrow");

  const path = normalizePath(window.location.pathname);
  const navPath = path.replace(/^\/Pages/, "").replace(/\.html$/, "");
  const activeKey = (() => {
    if (["/projects", "/project", "/create-project", "/edit-project"].includes(navPath)) {
      return "projects";
    }
    if (["/tasks", "/task", "/create-task"].includes(navPath)) {
      return "tasks";
    }
    return "dashboard";
  })();
  const icons = {
    dashboard:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4Zm9 0A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13 9.5v-4Zm-9 9A1.5 1.5 0 0 1 5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4Zm9 0a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z"/></svg>',
    projects:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4.1c.62 0 1.22.24 1.66.68l1.06 1.06c.16.17.39.26.62.26h3.56A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-10Zm2.5-.5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-3.56c-.76 0-1.49-.3-2.03-.84L10.85 6.1A.36.36 0 0 0 10.6 6H6.5Z"/></svg>',
    tasks:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.1 7.9 4.7 6.5 3.3 7.9l2.8 2.8 4.8-4.8-1.4-1.4-3.4 3.4ZM13 7h8v2h-8V7Zm-6.9 8.9-1.4-1.4-1.4 1.4 2.8 2.8 4.8-4.8-1.4-1.4-3.4 3.4ZM13 15h8v2h-8v-2Z"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h8a2 2 0 0 1 2 2v2h-2V6H5v12h8v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm12.6 4.4L22.2 13l-4.6 4.6-1.4-1.4 2.2-2.2H10v-2h8.4l-2.2-2.2 1.4-1.4Z"/></svg>',
  };
  const links = [
    { href: "/post-login", label: "Dashboard", key: "dashboard" },
    { href: "/projects", label: "Projects", key: "projects" },
    { href: "/tasks", label: "Tasks", key: "tasks" },
  ];
  const nav = document.createElement("nav");
  nav.className = "workspace-nav";
  nav.setAttribute("aria-label", "Workspace navigation");

  const trigger = document.createElement("button");
  trigger.className = "nav-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-label", "Open workspace navigation");
  trigger.innerHTML =
    "<span class=\"hamburger-icon\" aria-hidden=\"true\"><span></span><span></span><span></span></span>";

  const panel = document.createElement("div");
  panel.className = "nav-panel";

  const list = document.createElement("div");
  list.className = "nav-links";

  links.forEach((link) => {
    const item = document.createElement("a");
    item.href = link.href;
    item.className = "nav-link";
    item.innerHTML = `<span class="nav-link-icon">${icons[link.key]}</span><span>${link.label}</span>`;
    if (link.key === activeKey) {
      item.classList.add("is-active");
    }
    list.append(item);
  });

  const logoutButton = document.createElement("button");
  logoutButton.className = "nav-logout";
  logoutButton.type = "button";
  logoutButton.dataset.logoutButton = "true";
  logoutButton.innerHTML = `<span class="nav-link-icon">${icons.logout}</span><span>Log out</span>`;

  panel.append(list, logoutButton);
  nav.append(trigger, panel);

  if (header && titleBlock) {
    const topbar = document.createElement("div");
    topbar.className = "workspace-topbar";

    const brand = document.createElement("div");
    brand.className = "workspace-brand-lockup";

    const brandText = document.createElement("p");
    brandText.className = "workspace-brand-text";
    brandText.textContent = eyebrow?.textContent?.trim() || "Nexora";
    eyebrow?.remove();

    titleBlock.classList.add("workspace-title-block");
    brand.append(nav, brandText);
    topbar.append(brand);

    if (actions) {
      topbar.append(actions);
    }

    header.prepend(topbar);
    return;
  }

  shell.prepend(nav);
}

function setupLoginForm() {
  const form = document.querySelector("#login-form");
  const messageElement = document.querySelector("#form-message");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setMessage(messageElement, "Signing in...");

    try {
      const data = await postJson("/auth/login", getFormValues(form));
      saveSession(data);
      window.location.replace("/post-login");
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });
}

function setupSignupForm() {
  const form = document.querySelector("#signup-form");
  const messageElement = document.querySelector("#form-message");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setMessage(messageElement, "Creating account...");

    try {
      await postJson("/auth/signup", getFormValues(form));
      setMessage(messageElement, "Signup successful. Redirecting to sign in...");
      window.setTimeout(() => {
        window.location.replace("/");
      }, 900);
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });
}

function setupForgotPasswordForm() {
  const form = document.querySelector("#forgot-password-form");
  const messageElement = document.querySelector("#form-message");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setMessage(messageElement, "Sending reset link...");

    try {
      const data = await postJson("/auth/forgot-password", {
        email: getFormValues(form).email,
      });
      setMessage(messageElement, data.detail);
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });
}

function setupCreateProjectForm() {
  const form = document.querySelector("#create-project-form");
  const messageElement = document.querySelector("#form-message");
  const assigneeSelect = document.querySelector("#assigned_to_email");
  const stakeholderSelect = document.querySelector("#project_stakeholder_email");
  const watcherSelect = document.querySelector("#project_watcher_emails");

  if (!form) {
    return;
  }

  if (assigneeSelect) {
    populateUserSelect(assigneeSelect)
      .catch((error) => {
        setMessage(messageElement, error.message, true);
      });
  }
  if (stakeholderSelect) {
    populateUserSelect(stakeholderSelect, { includeCurrentUser: true }).catch(
      (error) => {
        setMessage(messageElement, error.message, true);
      }
    );
  }
  populateUserMultiSelect(watcherSelect).catch((error) => {
    setMessage(messageElement, error.message, true);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const payload = {
      project_name: String(formData.get("project_name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      document_name: String(formData.get("document_name") ?? "").trim() || null,
      document_url: String(formData.get("document_url") ?? "").trim() || null,
      assigned_to_email:
        String(formData.get("assigned_to_email") ?? "").trim() || null,
      stakeholder_email:
        String(formData.get("stakeholder_email") ?? "").trim() || null,
      watcher_emails: getSelectedValues(watcherSelect),
    };

    setMessage(messageElement, "Creating project...");

    try {
      const data = await postAuthorizedJson("/projects", payload);
      form.reset();
      setMessage(messageElement, data.detail || "Project created successfully.");
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });
}

function renderEmptyState(container, text) {
  container.innerHTML = "";
  const emptyState = document.createElement("p");
  emptyState.className = "empty-state";
  emptyState.textContent = text;
  container.append(emptyState);
}

function setupDashboardProjects() {
  const projectList = document.querySelector("#project-list");
  const taskList = document.querySelector("#all-task-list");
  const messageElement =
    document.querySelector("#dashboard-message") ||
    document.querySelector("#projects-message") ||
    document.querySelector("#tasks-message");
  const refreshButton = document.querySelector("#refresh-projects-button");
  const analyticsElement = document.querySelector("#dashboard-analytics");
  const downloadButton = document.querySelector("#download-analytics-button");
  const deleteAccessLogButton = document.querySelector("#delete-access-log-button");
  const projectCountElement = document.querySelector("#project-count");
  let dashboardProjects = [];
  let dashboardDetails = [];

  if (!projectList && !taskList && !analyticsElement && !downloadButton) {
    return;
  }

  function getTaskAssignees(task) {
    return getTaskAssigneeList(task);
  }

  function getTaskAssigneeLabel(task) {
    return formatTaskAssignees(task);
  }

  function getProjectAssignees(project) {
    if (project.assigned_to_name || project.assigned_to_email) {
      return [
        {
          name: project.assigned_to_name || project.assigned_to_email,
          email: project.assigned_to_email || null,
        },
      ];
    }

    return [{ name: "Unassigned", email: null }];
  }

  function getProjectAssigneeLabel(project) {
    return getProjectAssignees(project)
      .map((assignee) => assignee.name || assignee.email)
      .join(", ");
  }

  function incrementMetric(metricMap, label, amount = 1) {
    metricMap.set(label, (metricMap.get(label) || 0) + amount);
  }

  function isInCurrentWeek(dateValue) {
    if (!dateValue) {
      return false;
    }
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return date >= weekStart && date < weekEnd;
  }

  function appendBarRow(container, label, value, maxValue, suffix = "") {
    const row = document.createElement("div");
    row.className = "bar-row";

    const labelElement = document.createElement("span");
    labelElement.textContent = label;

    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max((value / maxValue) * 100, 8)}%`;
    track.append(fill);

    const valueElement = document.createElement("span");
    valueElement.textContent = `${value}${suffix}`;

    row.append(labelElement, track, valueElement);
    container.append(row);
  }

  function renderAnalytics(projects, details) {
    if (!analyticsElement) {
      return;
    }

    const tasks = details.flatMap((project) => project.tasks || []);
    const openTasks = tasks.filter((task) => task.status === "OPEN").length;
    const inProgressTasks = tasks.filter(
      (task) => task.status === "IN PROGRESS"
    ).length;
    const closedTasks = tasks.filter((task) => task.status === "CLOSED").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueTasks = tasks.filter((task) => {
      if (!task.end_date || task.status === "CLOSED") {
        return false;
      }
      const endDate = new Date(task.end_date);
      endDate.setHours(0, 0, 0, 0);
      return endDate < today;
    }).length;

    const workload = new Map();
    tasks.forEach((task) => {
      getTaskAssignees(task).forEach((assignee) => {
        incrementMetric(workload, assignee.name || assignee.email || "Unassigned");
      });
    });
    const maxWorkload = Math.max(...workload.values(), 1);

    const weeklyHours = new Map();
    tasks.forEach((task) => {
      (task.work_logs || []).forEach((workLog) => {
        if (!isInCurrentWeek(workLog.work_date)) {
          return;
        }
        const loggedBy =
          workLog.logged_by_name || workLog.logged_by_email || "Unknown";
        incrementMetric(weeklyHours, loggedBy, Number(workLog.hours || 0));
      });
    });
    const maxWeeklyHours = Math.max(...weeklyHours.values(), 1);

    analyticsElement.innerHTML = "";
    [
      ["Open tasks", openTasks, "Ready for assignment or action", "metric-open"],
      ["In progress", inProgressTasks, "Currently being worked", "metric-progress"],
      ["Overdue", overdueTasks, "Past end date and not closed", "metric-overdue"],
      ["Closed", closedTasks, "Completed tasks", "metric-closed"],
    ].forEach(([label, value, caption, className]) => {
      const card = document.createElement("article");
      card.className = `analytics-card metric-card ${className}`;
      card.innerHTML = `<p>${label}</p><strong>${value}</strong><span>${caption}</span>`;
      analyticsElement.append(card);
    });

    const workloadCard = document.createElement("article");
    workloadCard.className = "analytics-card analytics-chart-card";
    const title = document.createElement("p");
    title.className = "chart-title";
    title.textContent = "Tasks by assignee";
    const bars = document.createElement("div");
    bars.className = "bar-list";
    const workloadEntries = Array.from(workload.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    if (!workloadEntries.length) {
      const emptyState = document.createElement("span");
      emptyState.className = "empty-state compact";
      emptyState.textContent = "No assigned tasks yet.";
      bars.append(emptyState);
    }
    workloadEntries.slice(0, 8).forEach(([name, count]) => {
      appendBarRow(bars, name, count, maxWorkload);
    });
    workloadCard.append(title, bars);
    analyticsElement.append(workloadCard);

    const weeklyHoursCard = document.createElement("article");
    weeklyHoursCard.className = "analytics-card analytics-chart-card";
    const weeklyHoursTitle = document.createElement("p");
    weeklyHoursTitle.className = "chart-title";
    weeklyHoursTitle.textContent = "Work log by assignee";
    const weeklyHoursBars = document.createElement("div");
    weeklyHoursBars.className = "bar-list";
    const weeklyHourEntries = Array.from(weeklyHours.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    if (!weeklyHourEntries.length) {
      const emptyState = document.createElement("span");
      emptyState.className = "empty-state compact";
      emptyState.textContent = "No work hours logged this week.";
      weeklyHoursBars.append(emptyState);
    }
    weeklyHourEntries.slice(0, 8).forEach(([name, hours]) => {
      appendBarRow(
        weeklyHoursBars,
        name,
        Number(hours.toFixed(2)),
        maxWeeklyHours,
        "h"
      );
    });
    weeklyHoursCard.append(weeklyHoursTitle, weeklyHoursBars);
    analyticsElement.append(weeklyHoursCard);
  }

  function renderProjectRows(projects, activeFilters = {}) {
    if (!projectList) {
      return;
    }

    projectList.innerHTML = "";
    if (projectCountElement) {
      const count = dashboardProjects.length;
      projectCountElement.textContent = `${count} project${count === 1 ? "" : "s"}`;
    }

    const assignees = Array.from(
      new Set(
        dashboardProjects.flatMap((project) =>
          getProjectAssignees(project).map(
            (assignee) => assignee.name || assignee.email || "Unassigned"
          )
        )
      )
    ).sort();
    const stakeholders = Array.from(
      new Set(
        dashboardProjects.map(
          (project) =>
            project.stakeholder_name || project.stakeholder_email || "No stakeholder"
        )
      )
    ).sort();

    const tableWrap = document.createElement("div");
    tableWrap.className = "data-table-wrap";

    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    [
      { label: "Project title" },
      { label: "Assignee", filter: "assignee", options: assignees },
      { label: "Stakeholder", filter: "stakeholder", options: stakeholders },
    ].forEach((column) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column.label;
      if (column.filter) {
        const select = document.createElement("select");
        select.className = "table-filter";
        select.dataset.projectFilter = column.filter;
        select.innerHTML = `<option value="">All</option>`;
        column.options.forEach((optionValue) => {
          const option = document.createElement("option");
          option.value = optionValue;
          option.textContent = optionValue;
          option.selected = activeFilters[column.filter] === optionValue;
          select.append(option);
        });
        cell.append(select);
      }
      headerRow.append(cell);
    });
    thead.append(headerRow);

    const tbody = document.createElement("tbody");

    if (!projects.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.textContent = "No projects found.";
      row.append(cell);
      tbody.append(row);
    }

    projects.forEach((project) => {
      const row = document.createElement("tr");
      row.addEventListener("click", () => {
        window.location.href = `/project?id=${project.id}`;
      });

      const titleCell = document.createElement("td");
      const projectLink = document.createElement("a");
      projectLink.href = `/project?id=${project.id}`;
      projectLink.textContent = project.project_name;
      titleCell.append(projectLink);

      const assigneeCell = document.createElement("td");
      assigneeCell.textContent = getProjectAssigneeLabel(project);

      const stakeholderCell = document.createElement("td");
      stakeholderCell.textContent =
        project.stakeholder_name || project.stakeholder_email || "No stakeholder";

      row.append(titleCell, assigneeCell, stakeholderCell);
      tbody.append(row);
    });

    table.append(thead, tbody);
    tableWrap.append(table);
    projectList.append(tableWrap);

    table.querySelectorAll("[data-project-filter]").forEach((filter) => {
      filter.addEventListener("change", () => {
        const activeFilters = Object.fromEntries(
          Array.from(table.querySelectorAll("[data-project-filter]")).map((select) => [
            select.dataset.projectFilter,
            select.value,
          ])
        );
        const filtered = dashboardProjects.filter((project) => {
          const assignees = getProjectAssignees(project).map(
            (assignee) => assignee.name || assignee.email || "Unassigned"
          );
          const stakeholder =
            project.stakeholder_name || project.stakeholder_email || "No stakeholder";
          return (
            (!activeFilters.assignee || assignees.includes(activeFilters.assignee)) &&
            (!activeFilters.stakeholder || stakeholder === activeFilters.stakeholder)
          );
        });
        renderProjectRows(filtered, activeFilters);
      });
    });
  }

  function renderGlobalTaskRows(tasks, activeFilters = {}) {
    if (!taskList) {
      return;
    }

    taskList.innerHTML = "";
    const sourceTasks = dashboardDetails.flatMap((project) =>
      (project.tasks || []).map((task) => ({
        ...task,
        project_name: project.project_name,
      }))
    );
    const filterSourceTasks = sourceTasks.length ? sourceTasks : tasks;

    if (!tasks.length && !filterSourceTasks.length) {
      renderEmptyState(taskList, "No tasks found.");
      return;
    }

    const projects = Array.from(
      new Set(filterSourceTasks.map((task) => task.project_name || "No project"))
    ).sort();
    const assignees = Array.from(
      new Set(
        filterSourceTasks.flatMap((task) =>
          getTaskAssignees(task).map(
            (assignee) => assignee.name || assignee.email || "Unassigned"
          )
        )
      )
    ).sort();
    const statuses = Array.from(
      new Set(filterSourceTasks.map((task) => task.status || "OPEN"))
    ).sort();

    const tableWrap = document.createElement("div");
    tableWrap.className = "data-table-wrap";

    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    [
      { label: "Task title", filter: "title", type: "search" },
      { label: "Project", filter: "project", options: projects },
      { label: "Assignee", filter: "assignee", options: assignees },
      { label: "Status", filter: "status", options: statuses },
      { label: "End date" },
    ].forEach((column) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column.label;
      if (column.type === "search") {
        const input = document.createElement("input");
        input.className = "table-filter";
        input.type = "search";
        input.placeholder = "Search title";
        input.dataset.globalTaskFilter = column.filter;
        input.value = activeFilters[column.filter] || "";
        cell.append(input);
      } else if (column.filter) {
        const select = document.createElement("select");
        select.className = "table-filter";
        select.dataset.globalTaskFilter = column.filter;
        select.innerHTML = `<option value="">All</option>`;
        column.options.forEach((optionValue) => {
          const option = document.createElement("option");
          option.value = optionValue;
          option.textContent = optionValue;
          option.selected = activeFilters[column.filter] === optionValue;
          select.append(option);
        });
        cell.append(select);
      }
      headerRow.append(cell);
    });
    thead.append(headerRow);

    const tbody = document.createElement("tbody");

    if (!tasks.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "No tasks found.";
      row.append(cell);
      tbody.append(row);
    }

    tasks.forEach((task) => {
      const row = document.createElement("tr");
      row.addEventListener("click", () => {
        window.location.href = `/task?id=${task.id}`;
      });

      const titleCell = document.createElement("td");
      const taskLink = document.createElement("a");
      taskLink.href = `/task?id=${task.id}`;
      taskLink.textContent = task.task_title;
      titleCell.append(taskLink);

      const projectCell = document.createElement("td");
      projectCell.textContent = task.project_name || "No project";

      const assigneeCell = document.createElement("td");
      assigneeCell.textContent = getTaskAssigneeLabel(task);

      const statusCell = document.createElement("td");
      statusCell.append(createStatusBadge(task.status));

      const endDateCell = document.createElement("td");
      endDateCell.textContent = formatDisplayDate(task.end_date);

      row.append(titleCell, projectCell, assigneeCell, statusCell, endDateCell);
      tbody.append(row);
    });

    table.append(thead, tbody);
    tableWrap.append(table);
    taskList.append(tableWrap);

    table.querySelectorAll("[data-global-task-filter]").forEach((filter) => {
      filter.addEventListener("input", () => {
        const nextFilters = Object.fromEntries(
          Array.from(table.querySelectorAll("[data-global-task-filter]")).map(
            (control) => [control.dataset.globalTaskFilter, control.value]
          )
        );
        const filtered = sourceTasks.filter((task) => {
          const title = String(task.task_title || "").toLowerCase();
          const projectName = task.project_name || "No project";
          const taskAssignees = getTaskAssignees(task).map(
            (assignee) => assignee.name || assignee.email || "Unassigned"
          );
          const status = task.status || "OPEN";
          return (
            (!nextFilters.title ||
              title.includes(nextFilters.title.toLowerCase())) &&
            (!nextFilters.project || projectName === nextFilters.project) &&
            (!nextFilters.assignee ||
              taskAssignees.includes(nextFilters.assignee)) &&
            (!nextFilters.status || status === nextFilters.status)
          );
        });
        renderGlobalTaskRows(filtered, nextFilters);
      });
    });
  }

  async function loadProjects() {
    setMessage(messageElement, "Loading workspace data...");
    try {
      const dashboardData = await getAuthorizedJson("/dashboard");
      const projects = dashboardData.projects || [];
      dashboardProjects = projects;
      dashboardDetails = dashboardData.project_details || [];
      const tasks = dashboardDetails.flatMap((project) =>
        (project.tasks || []).map((task) => ({
          ...task,
          project_name: project.project_name,
        }))
      );
      renderAnalytics(projects, dashboardDetails);
      renderProjectRows(projects);
      renderGlobalTaskRows(tasks);
      setMessage(messageElement, "");
    } catch (error) {
      if (projectList) {
        renderEmptyState(projectList, "Projects could not be loaded.");
      }
      if (taskList) {
        renderEmptyState(taskList, "Tasks could not be loaded.");
      }
      setMessage(messageElement, error.message, true);
    }
  }

  downloadButton?.addEventListener("click", () => {
    const tasks = dashboardDetails.flatMap((project) =>
      (project.tasks || []).map((task) => ({ ...task, project }))
    );
    const workLogRows = tasks.flatMap(({ project, ...task }) =>
      (task.work_logs || []).map((workLog) => [
        workLog.work_date || "",
        project.project_name,
        task.task_title,
        workLog.logged_by_name || workLog.logged_by_email || "",
        workLog.hours ?? "",
        workLog.work_note || "",
        workLog.created_at || "",
      ])
    );
    const accessLogRows = tasks.flatMap(({ project, ...task }) =>
      (task.access_logs || []).map((accessLog) => [
        accessLog.created_at || "",
        project.project_name,
        task.task_title,
        accessLog.event_type || "",
        accessLog.actor_name || accessLog.actor_email || "",
        accessLog.previous_status || "",
        accessLog.new_status || "",
        accessLog.previous_assignee_name ||
          accessLog.previous_assignee_email ||
          "",
        accessLog.new_assignee_name || accessLog.new_assignee_email || "",
        accessLog.event_note || "",
      ])
    );
    const overdueTasks = tasks.filter(({ status, end_date }) => {
      if (!end_date || status === "CLOSED") {
        return false;
      }
      const endDate = new Date(end_date);
      endDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return endDate < today;
    });
    const weeklyHours = workLogRows
      .filter((row) => isInCurrentWeek(row[0]))
      .reduce((total, row) => total + Number(row[4] || 0), 0);
    const reportRows = [
      ["NTT Analytics Report"],
      ["Generated At", new Date().toISOString()],
      [],
      ["Executive Summary"],
      ["Projects", dashboardProjects.length],
      ["Tasks", tasks.length],
      ["Open Tasks", tasks.filter((task) => task.status === "OPEN").length],
      [
        "In Progress Tasks",
        tasks.filter((task) => task.status === "IN PROGRESS").length,
      ],
      ["Overdue Tasks", overdueTasks.length],
      ["Closed Tasks", tasks.filter((task) => task.status === "CLOSED").length],
      ["Work Hours Logged This Week", Number(weeklyHours.toFixed(2))],
      [],
      ["Project Register"],
      ["Project", "Description", "Assignee", "Stakeholder", "Status"],
      ...dashboardProjects.map((project) => [
        project.project_name,
        project.description || "",
        getProjectAssigneeLabel(project),
        project.stakeholder_name || project.stakeholder_email || "",
        project.status || "",
      ]),
      [],
      ["Task Register"],
      [
        "Project",
        "Project Assignee",
        "Project Stakeholder",
        "Task",
        "Task Assignee",
        "Task Stakeholder",
        "Task Status",
        "Start Date",
        "End Date",
      ],
      ...tasks.map(({ project, ...task }) => [
        project.project_name,
        getProjectAssigneeLabel(project),
        project.stakeholder_name || project.stakeholder_email || "",
        task.task_title,
        getTaskAssigneeLabel(task),
        task.stakeholder_name || task.stakeholder_email || "",
        task.status || "",
        task.start_date || "",
        task.end_date || "",
      ]),
      [],
      ["Work Log Register"],
      ["Work Date", "Project", "Task", "Logged By", "Hours", "Note", "Created At"],
      ...workLogRows,
      [],
      ["Access Log"],
      [
        "Event At",
        "Project",
        "Task",
        "Event",
        "Actor",
        "Previous Status",
        "New Status",
        "Previous Assignee",
        "New Assignee",
        "Note",
      ],
      ...accessLogRows,
    ];
    downloadCsv("ntt-manager-report.csv", reportRows);
  });

  deleteAccessLogButton?.addEventListener("click", async () => {
    if (!window.confirm("Delete all task access logs?")) {
      return;
    }
    try {
      await authorizedJson("/access-logs", { method: "DELETE" });
      await loadProjects();
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });

  refreshButton?.addEventListener("click", loadProjects);
  loadProjects();
}

function fillSelectsForProjectPage() {
  const projectAssigneeSelect = document.querySelector("#edit_assigned_to_email");
  const taskAssigneeSelect = document.querySelector("#task_assigned_to_email");

  populateUserSelect(projectAssigneeSelect).catch(() => {});
  populateUserSelect(taskAssigneeSelect, { includeCurrentUser: true }).catch(() => {});
}

function renderProjectDetail(project) {
  const detailPanel = document.querySelector("#project-detail-panel");
  document.querySelector("#project-title").textContent = project.project_name;
  document.querySelector("#project-description").textContent =
    project.description || "No description added.";
  const documentsElement = document.querySelector("#project-documents");
  const documentUrl = project.document_url || project.documents;
  const documentName = project.document_name || documentUrl;
  documentsElement.innerHTML = "";
  documentsElement.append(
    documentUrl
      ? createTextLink(documentUrl, documentName)
      : "No documents URL added."
  );
  document.querySelector("#project-assignees").textContent =
    project.assigned_to_name ||
    project.assigned_to_email ||
    formatProjectMembers(project.assignees);
  const projectStakeholderElement = document.querySelector("#project-stakeholder");
  if (projectStakeholderElement) {
    projectStakeholderElement.textContent =
      project.stakeholder_name ||
      project.stakeholder_email ||
      "No stakeholder";
  }
  const projectWatcherElement = document.querySelector("#project-watchers");
  if (projectWatcherElement) {
    projectWatcherElement.textContent = formatWatchers(project.watchers);
  }
  detailPanel?.classList.toggle("is-editable", Boolean(project.can_edit));
}

function renderTaskList(tasks) {
  const taskList = document.querySelector("#task-list");
  taskList.innerHTML = "";

  if (!tasks.length) {
    renderEmptyState(taskList, "No tasks found.");
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "data-table-wrap";

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const assignees = Array.from(
    new Set(
      tasks.flatMap((task) =>
        getTaskAssigneeList(task).map(
          (assignee) => assignee.name || assignee.email || "Unassigned"
        )
      )
    )
  ).sort();
  const statuses = Array.from(new Set(tasks.map((task) => task.status || "OPEN"))).sort();
  [
    { label: "Task title", filter: "title", type: "search" },
    { label: "Assignee", filter: "assignee", options: assignees },
    { label: "Status", filter: "status", options: statuses },
  ].forEach((column) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column.label;
    if (column.type === "search") {
      const input = document.createElement("input");
      input.className = "table-filter";
      input.type = "search";
      input.dataset.taskFilter = column.filter;
      cell.append(input);
    } else if (column.filter) {
      const select = document.createElement("select");
      select.className = "table-filter";
      select.dataset.taskFilter = column.filter;
      select.innerHTML = `<option value="">All</option>`;
      column.options.forEach((optionValue) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        select.append(option);
      });
      cell.append(select);
    }
    headerRow.append(cell);
  });
  thead.append(headerRow);

  const tbody = document.createElement("tbody");

  function renderRows(filteredTasks) {
    tbody.innerHTML = "";
    if (!filteredTasks.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.textContent = "No tasks found.";
      row.append(cell);
      tbody.append(row);
      return;
    }

    filteredTasks.forEach((task) => {
      const row = document.createElement("tr");
      row.addEventListener("click", () => {
        window.location.href = `/task?id=${task.id}`;
      });

      const titleCell = document.createElement("td");
      const taskLink = document.createElement("a");
      taskLink.href = `/task?id=${task.id}`;
      taskLink.textContent = task.task_title;
      titleCell.append(taskLink);

      const assigneeCell = document.createElement("td");
      assigneeCell.textContent = formatTaskAssignees(task);

      const statusCell = document.createElement("td");
      statusCell.append(createStatusBadge(task.status));

      row.append(titleCell, assigneeCell, statusCell);
      tbody.append(row);
    });
  }

  table.append(thead, tbody);
  tableWrap.append(table);
  taskList.append(tableWrap);

  table.querySelectorAll("[data-task-filter]").forEach((filter) => {
    filter.addEventListener("input", () => {
      const activeFilters = Object.fromEntries(
        Array.from(table.querySelectorAll("[data-task-filter]")).map((control) => [
          control.dataset.taskFilter,
          control.value,
        ])
      );
      const filteredTasks = tasks.filter((task) => {
        const title = String(task.task_title || "").toLowerCase();
        const assignees = getTaskAssigneeList(task).map(
          (assignee) => assignee.name || assignee.email || "Unassigned"
        );
        const status = task.status || "OPEN";
        return (
          (!activeFilters.title ||
            title.includes(activeFilters.title.toLowerCase())) &&
          (!activeFilters.assignee || assignees.includes(activeFilters.assignee)) &&
          (!activeFilters.status || status === activeFilters.status)
        );
      });
      renderRows(filteredTasks);
    });
  });
  renderRows(tasks);
}

function setupProjectPage() {
  const projectTitle = document.querySelector("#project-title");
  const createTaskLink = document.querySelector("#create-task-link");
  const projectMessage = document.querySelector("#project-message");
  const detailPanel = document.querySelector("#project-detail-panel");
  const inlineProjectForm = document.querySelector("#inline-project-form");
  const inlineProjectMessage = document.querySelector("#inline-project-message");
  const inlineProjectCancel = document.querySelector("#inline-project-cancel");
  const inlineAssigneeSelect = document.querySelector(
    "#inline_project_assigned_to_email"
  );
  const inlineStakeholderSelect = document.querySelector(
    "#inline_project_stakeholder_email"
  );
  const inlineWatcherList = document.querySelector(
    "#inline_project_watcher_emails"
  );
  const projectId = getQueryParam("id");
  let currentProject = null;

  if (!projectTitle) {
    return;
  }

  if (!projectId) {
    setMessage(projectMessage, "Project id is missing.", true);
    return;
  }

  createTaskLink.href = `/create-task?id=${projectId}`;

  function hideInlineProjectEditor() {
    inlineProjectForm?.classList.add("is-hidden");
    setMessage(inlineProjectMessage, "");
  }

  async function showInlineProjectEditor() {
    if (!currentProject?.can_edit || !inlineProjectForm) {
      return;
    }

    document.querySelector("#inline_project_description").value =
      currentProject.description || "";
    document.querySelector("#inline_project_document_name").value =
      currentProject.document_name || "";
    document.querySelector("#inline_project_document_url").value =
      currentProject.document_url || currentProject.documents || "";

    await populateUserSelect(inlineAssigneeSelect, { includeCurrentUser: true });
    await populateUserSelect(inlineStakeholderSelect, { includeCurrentUser: true });
    if (inlineAssigneeSelect && currentProject.assigned_to_email) {
      inlineAssigneeSelect.value = currentProject.assigned_to_email;
    }
    if (inlineStakeholderSelect && currentProject.stakeholder_email) {
      inlineStakeholderSelect.value = currentProject.stakeholder_email;
    }
    await populateUserCheckboxList(
      inlineWatcherList,
      (currentProject.watchers || []).map((watcher) => watcher.email)
    );

    inlineProjectForm.classList.remove("is-hidden");
  }

  async function loadProject() {
    setMessage(projectMessage, "Loading project...");
    try {
      const project = await getAuthorizedJson(`/projects/${projectId}`);
      currentProject = project;
      renderProjectDetail(project);
      renderTaskList(project.tasks || []);
      hideInlineProjectEditor();
      setMessage(projectMessage, "");
    } catch (error) {
      setMessage(projectMessage, error.message, true);
    }
  }

  detailPanel?.addEventListener("click", (event) => {
    if (
      event.target.closest("a, button, input, textarea, select, label") ||
      !currentProject?.can_edit
    ) {
      return;
    }

    showInlineProjectEditor().catch((error) => {
      setMessage(inlineProjectMessage, error.message, true);
    });
  });

  inlineProjectCancel?.addEventListener("click", hideInlineProjectEditor);

  inlineProjectForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(inlineProjectForm);
    setMessage(inlineProjectMessage, "Saving project...");

    try {
      const data = await postAuthorizedJson(`/projects/${projectId}/update`, {
        description: String(formData.get("description") ?? "").trim() || null,
        document_name:
          String(formData.get("document_name") ?? "").trim() || null,
        document_url: String(formData.get("document_url") ?? "").trim() || null,
        assigned_to_email:
          String(formData.get("assigned_to_email") ?? "").trim() || null,
        stakeholder_email:
          String(formData.get("stakeholder_email") ?? "").trim() || null,
        watcher_emails: getCheckedValues(inlineWatcherList),
      });
      setMessage(inlineProjectMessage, data.detail || "Project updated.");
      await loadProject();
      setMessage(projectMessage, data.detail || "Project updated.");
    } catch (error) {
      setMessage(inlineProjectMessage, error.message, true);
    }
  });

  loadProject();
}

function setupEditProjectPage() {
  const editForm = document.querySelector("#edit-project-form");
  const editMessage = document.querySelector("#edit-project-message");
  const backLink = document.querySelector("#edit-project-back-link");
  const projectId = getQueryParam("id");

  if (!editForm) {
    return;
  }

  if (!projectId) {
    setMessage(editMessage, "Project id is missing.", true);
    return;
  }

  backLink.href = `/project?id=${projectId}`;
  const editAssigneeSelect = document.querySelector("#edit_assigned_to_email");
  const editAssigneePromise = populateUserSelect(editAssigneeSelect, {
    includeCurrentUser: true,
  }).catch(() => {});
  const editWatcherSelect = document.querySelector("#edit_project_watcher_emails");

  async function loadProjectForEdit() {
    try {
      const project = await getAuthorizedJson(`/projects/${projectId}`);
      document.querySelector("#edit_description").value = project.description || "";
      document.querySelector("#edit_document_name").value =
        project.document_name || "";
      document.querySelector("#edit_document_url").value =
        project.document_url || project.documents || "";
      await editAssigneePromise;
      if (editAssigneeSelect && project.assigned_to_email) {
        editAssigneeSelect.value = project.assigned_to_email;
      }
      await populateUserMultiSelect(
        editWatcherSelect,
        (project.watchers || []).map((watcher) => watcher.email)
      );
    } catch (error) {
      setMessage(editMessage, error.message, true);
    }
  }

  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(editForm);
    setMessage(editMessage, "Saving project...");

    try {
      const data = await postAuthorizedJson(`/projects/${projectId}/update`, {
        description: String(formData.get("description") ?? "").trim() || null,
        document_name: String(formData.get("document_name") ?? "").trim() || null,
        document_url: String(formData.get("document_url") ?? "").trim() || null,
        assigned_to_email:
          String(formData.get("assigned_to_email") ?? "").trim() || null,
        watcher_emails: getSelectedValues(editWatcherSelect),
      });
      setMessage(editMessage, data.detail || "Project updated successfully.");
      window.location.href = `/project?id=${projectId}`;
    } catch (error) {
      setMessage(editMessage, error.message, true);
    }
  });

  loadProjectForEdit();
}

function setupCreateTaskPage() {
  const createTaskForm = document.querySelector("#create-task-form");
  const taskMessage = document.querySelector("#create-task-message");
  const backLink = document.querySelector("#create-task-back-link");
  const projectId = getQueryParam("id");

  if (!createTaskForm) {
    return;
  }

  if (!projectId) {
    setMessage(taskMessage, "Project id is missing.", true);
    return;
  }

  backLink.href = `/project?id=${projectId}`;
  populateUserSelect(document.querySelector("#task_assigned_to_email"), {
    includeCurrentUser: true,
  }).catch(() => {});
  populateUserSelect(document.querySelector("#task_stakeholder_email"), {
    includeCurrentUser: true,
  }).catch(() => {});
  populateUserMultiSelect(document.querySelector("#task_watcher_emails")).catch(
    () => {}
  );

  createTaskForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!createTaskForm.checkValidity()) {
      createTaskForm.reportValidity();
      return;
    }

    const formData = new FormData(createTaskForm);
    setMessage(taskMessage, "Creating task...");

    try {
      const data = await postAuthorizedJson(`/projects/${projectId}/tasks`, {
        task_title: String(formData.get("task_title") ?? "").trim(),
        task_details: String(formData.get("task_details") ?? "").trim() || null,
        documents: String(formData.get("documents") ?? "").trim() || null,
        end_date: String(formData.get("end_date") ?? "").trim(),
        assigned_to_email:
          String(formData.get("assigned_to_email") ?? "").trim() || null,
        stakeholder_email:
          String(formData.get("stakeholder_email") ?? "").trim() || null,
        watcher_emails: getSelectedValues(
          document.querySelector("#task_watcher_emails")
        ),
      });
      createTaskForm.reset();
      setMessage(taskMessage, data.detail || "Task created successfully.");
      window.location.href = `/project?id=${projectId}`;
    } catch (error) {
      setMessage(taskMessage, error.message, true);
    }
  });
}

function renderTaskDetail(task) {
  document.querySelector("#task-title").textContent = task.task_title;
  document.querySelector("#task-project-name").textContent = task.project_name;
  document.querySelector("#task-description").textContent =
    task.task_details || "No description added.";
  document.querySelector("#task-assignee").textContent =
    task.assigned_to_name || task.assigned_to_email || "Unassigned";
  const taskStatusElement = document.querySelector("#task-status");
  taskStatusElement.innerHTML = "";
  taskStatusElement.append(createStatusBadge(task.status));
  document.querySelector("#task-start-date").textContent = formatDisplayDate(
    task.start_date
  );
  document.querySelector("#task-end-date").textContent = formatDisplayDate(
    task.end_date
  );
  document.querySelector("#task-stakeholder").textContent =
    task.stakeholder_name || task.stakeholder_email || "No stakeholder";
  document.querySelector("#task-watchers").textContent = formatWatchers(
    task.watchers
  );
  document.querySelector("#task-back-link").href = `/project?id=${task.project_id}`;

  const documentsElement = document.querySelector("#task-documents");
  documentsElement.innerHTML = "";
  documentsElement.append(
    task.documents
      ? createTextLink(task.documents, task.documents)
      : "No task documents added."
  );
}

function setTaskWorkflowVisibility(task) {
  const session = getSession();
  const currentEmail = String(session?.email || "").toLowerCase();
  const assignedEmail = String(task.assigned_to_email || "").toLowerCase();
  const stakeholderEmail = String(task.stakeholder_email || "").toLowerCase();
  const status = task.status || "OPEN";
  const isAssignee = Boolean(currentEmail && currentEmail === assignedEmail);
  const isStakeholder = Boolean(currentEmail && currentEmail === stakeholderEmail);

  const startWorkButton = document.querySelector("#start-work-button");
  const requestCloseButton = document.querySelector("#request-close-button");
  const closeTaskButton = document.querySelector("#close-task-button");

  if (startWorkButton) {
    startWorkButton.classList.toggle(
      "is-hidden",
      !isAssignee || status !== "OPEN"
    );
  }

  if (requestCloseButton) {
    requestCloseButton.classList.toggle(
      "is-hidden",
      !isAssignee || status === "CLOSED" || status === "CLOSE REQUESTED"
    );
  }

  if (closeTaskButton) {
    closeTaskButton.classList.toggle(
      "is-hidden",
      !isStakeholder || status !== "CLOSE REQUESTED"
    );
  }
}

function renderComments(comments) {
  const commentList = document.querySelector("#comment-list");
  commentList.innerHTML = "";

  if (!comments.length) {
    renderEmptyState(commentList, "No comments yet.");
    return;
  }

  comments.forEach((comment) => {
    const card = document.createElement("article");
    card.className = "comment-card";

    const author = document.createElement("p");
    author.className = "meta-text";
    author.textContent = comment.commented_by_name || comment.commented_by_email || "User";
    const body = document.createElement("p");
    body.textContent = comment.comment_text || "";

    card.append(author, body);
    if (comment.deliverable_url) {
      const url = document.createElement("p");
      url.append(createTextLink(comment.deliverable_url, comment.deliverable_url));
      card.append(url);
    }

    commentList.append(card);
  });
}

function renderWorkLogs(workLogs) {
  const workLogList = document.querySelector("#work-log-list");
  if (!workLogList) {
    return;
  }

  workLogList.innerHTML = "";

  if (!workLogs.length) {
    renderEmptyState(workLogList, "No work logs yet.");
    return;
  }

  workLogs.forEach((workLog) => {
    const card = document.createElement("article");
    card.className = "comment-card";

    const author = document.createElement("p");
    author.className = "meta-text";
    const loggedBy = workLog.logged_by_name || workLog.logged_by_email || "User";
    const hours = workLog.hours ? ` · ${workLog.hours}h` : "";
    author.textContent = `${loggedBy} · ${formatDisplayDate(workLog.work_date)}${hours}`;

    const body = document.createElement("p");
    body.textContent = workLog.work_note || "";

    card.append(author, body);
    workLogList.append(card);
  });
}

function setupActivityTabs() {
  document.querySelectorAll("[data-activity-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.activityTab;
      document.querySelectorAll("[data-activity-tab]").forEach((item) => {
        item.classList.toggle("is-active", item === tab);
      });
      document.querySelectorAll("[data-activity-panel]").forEach((panel) => {
        panel.classList.toggle("is-hidden", panel.dataset.activityPanel !== target);
      });
    });
  });
}

function setupTaskPage() {
  const taskTitle = document.querySelector("#task-title");
  const commentForm = document.querySelector("#task-comment-form");
  const workLogForm = document.querySelector("#task-work-log-form");
  const messageElement = document.querySelector("#comment-message");
  const workLogMessage = document.querySelector("#work-log-message");
  const taskActionMessage = document.querySelector("#task-action-message");
  const taskAssigneeSelect = document.querySelector("#task_edit_assigned_to_email");
  const taskStakeholderSelect = document.querySelector("#task_edit_stakeholder_email");
  const taskWatcherSelect = document.querySelector("#task_edit_watcher_emails");
  const taskEndDateInput = document.querySelector("#task_edit_end_date");
  const taskId = getQueryParam("id");

  if (!taskTitle) {
    return;
  }

  if (!taskId) {
    setMessage(messageElement, "Task id is missing.", true);
    return;
  }

  async function loadTask() {
    try {
      const task = await getAuthorizedJson(`/tasks/${taskId}`);
      renderTaskDetail(task);
      setTaskWorkflowVisibility(task);
      renderComments(task.comments || []);
      renderWorkLogs(task.work_logs || []);
      await populateUserSelect(taskAssigneeSelect, { includeCurrentUser: true });
      await populateUserSelect(taskStakeholderSelect, { includeCurrentUser: true });
      await populateUserCheckboxList(
        taskWatcherSelect,
        (task.watchers || []).map((watcher) => watcher.email)
      );
      if (taskAssigneeSelect && task.assigned_to_email) {
        taskAssigneeSelect.value = task.assigned_to_email;
      }
      if (taskStakeholderSelect && task.stakeholder_email) {
        taskStakeholderSelect.value = task.stakeholder_email;
      }
      if (taskEndDateInput) {
        taskEndDateInput.value = task.end_date || "";
      }
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  }

  document.querySelector("#save-task-button")?.addEventListener("click", async () => {
    setMessage(taskActionMessage, "Saving task details...");
    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/update`, {
        assigned_to_email: taskAssigneeSelect?.value || "",
        stakeholder_email: taskStakeholderSelect?.value || "",
        end_date: taskEndDateInput?.value || null,
        watcher_emails: getCheckedValues(taskWatcherSelect),
      });
      setMessage(taskActionMessage, data.detail || "Task details saved.");
      await loadTask();
    } catch (error) {
      setMessage(taskActionMessage, error.message, true);
    }
  });

  document.querySelector("#start-work-button")?.addEventListener("click", async () => {
    setMessage(taskActionMessage, "Starting work...");
    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/status`, {
        status: "IN PROGRESS",
      });
      setMessage(taskActionMessage, data.detail || "Task updated.");
      await loadTask();
    } catch (error) {
      setMessage(taskActionMessage, error.message, true);
    }
  });

  document
    .querySelector("#request-close-button")
    ?.addEventListener("click", async () => {
      setMessage(taskActionMessage, "Requesting close...");
      try {
        const data = await postAuthorizedJson(`/tasks/${taskId}/status`, {
          status: "CLOSE REQUESTED",
        });
        setMessage(taskActionMessage, data.detail || "Close requested.");
        await loadTask();
      } catch (error) {
        setMessage(taskActionMessage, error.message, true);
      }
    });

  document.querySelector("#close-task-button")?.addEventListener("click", async () => {
    setMessage(taskActionMessage, "Closing task...");
    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/status`, {
        status: "CLOSED",
      });
      setMessage(taskActionMessage, data.detail || "Task closed.");
      await loadTask();
    } catch (error) {
      setMessage(taskActionMessage, error.message, true);
    }
  });

  commentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!commentForm.checkValidity()) {
      commentForm.reportValidity();
      return;
    }

    const formData = new FormData(commentForm);
    setMessage(messageElement, "Adding comment...");

    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/comments`, {
        comment_text: String(formData.get("comment_text") ?? "").trim(),
        deliverable_url:
          String(formData.get("deliverable_url") ?? "").trim() || null,
      });
      commentForm.reset();
      setMessage(messageElement, data.detail || "Comment added successfully.");
      await loadTask();
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });

  workLogForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!workLogForm.checkValidity()) {
      workLogForm.reportValidity();
      return;
    }

    const formData = new FormData(workLogForm);
    setMessage(workLogMessage, "Adding work log...");

    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/work-logs`, {
        work_note: String(formData.get("work_note") ?? "").trim(),
        work_date: String(formData.get("work_date") ?? "").trim() || null,
        hours: formData.get("hours")
          ? Number(String(formData.get("hours")).trim())
          : null,
      });
      workLogForm.reset();
      setMessage(workLogMessage, data.detail || "Work log added.");
      await loadTask();
    } catch (error) {
      setMessage(workLogMessage, error.message, true);
    }
  });

  setupActivityTabs();
  loadTask();
}

window.addEventListener("pageshow", guardPageAccess);
guardPageAccess();
setupLoginForm();
setupSignupForm();
setupForgotPasswordForm();
setupCreateProjectForm();
setupDashboardProjects();
setupProjectPage();
setupEditProjectPage();
setupCreateTaskPage();
setupTaskPage();
setupWorkspaceNavigation();
setupLogoutButtons();
