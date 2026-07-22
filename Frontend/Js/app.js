const apiBaseUrl = window.NTT_CONFIG?.apiBaseUrl ?? "http://localhost:8000";
const sessionKey = "ntt_auth_session";
const persistentSessionKey = "ntt_auth_persistent_session";
const authActiveKey = "ntt_auth_active";
const historyLogoutKey = "ntt_history_logout";
let activeUsersPromise = null;
let preloadPromise = null;
let refreshSessionPromise = null;
const liveRefreshJobs = new Map();
let liveRefreshStarted = false;
const liveRefreshTickMs = 3000;
const liveRefreshIntervals = {
  badge: 10000,
  flyout: 8000,
  page: 12000,
  task: 6000,
  notifications: 8000,
};
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
  "/notifications",
  "/notifications.html",
  "/Pages/notifications.html",
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

  try {
    if (rawSession) {
      const session = JSON.parse(rawSession);
      return session?.accessToken ? session : null;
    }

    return null;
  } catch (_error) {
    window.sessionStorage.removeItem(sessionKey);
    return null;
  }
}

function getPersistentSession() {
  const rawPersistentSession = window.localStorage.getItem(persistentSessionKey);
  if (!rawPersistentSession) {
    return null;
  }

  try {
    const session = JSON.parse(rawPersistentSession);
    if (session?.refreshToken && session?.rememberMe) {
      if (session.accessToken) {
        window.localStorage.setItem(
          persistentSessionKey,
          JSON.stringify({
            refreshToken: session.refreshToken,
            userId: session.userId,
            email: session.email,
            rememberMe: true,
            savedAt: session.savedAt || Date.now(),
          })
        );
      }

      return session;
    }
  } catch (_error) {
    // Invalid persisted data is cleaned below.
  }

  window.localStorage.removeItem(persistentSessionKey);
  return null;
}

function isAuthActive() {
  return window.localStorage.getItem(authActiveKey) === "true";
}

function saveSession(data, rememberMe = false) {
  clearHistoryLogout();
  window.localStorage.setItem(authActiveKey, "true");
  const session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId: data.user_id,
    email: data.email,
    rememberMe: Boolean(rememberMe),
    savedAt: Date.now(),
  };

  window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
  if (rememberMe) {
    window.localStorage.setItem(
      persistentSessionKey,
      JSON.stringify({
        refreshToken: session.refreshToken,
        userId: session.userId,
        email: session.email,
        rememberMe: true,
        savedAt: session.savedAt,
      })
    );
  } else {
    window.localStorage.removeItem(persistentSessionKey);
  }
}

function clearSession() {
  window.sessionStorage.removeItem(sessionKey);
  window.localStorage.removeItem(persistentSessionKey);
  window.localStorage.removeItem(authActiveKey);
}

async function logout() {
  const session = getSession();
  if (session?.accessToken) {
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          refresh_token: session.refreshToken || null,
        }),
      });
    } catch (_error) {
      // Client cleanup still needs to happen even if network logout fails.
    }
  }

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
  const persistentSession = getPersistentSession();
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

  if (authPages.has(path) && persistentSession?.refreshToken && isAuthActive()) {
    refreshSession()
      .then((restoredSession) => {
        if (restoredSession?.accessToken) {
          window.location.replace("/post-login");
        }
      })
      .catch(() => {
        clearSession();
        clearHistoryLogout();
      });
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
    if (persistentSession?.refreshToken && isAuthActive()) {
      refreshSession()
        .then((restoredSession) => {
          if (restoredSession?.accessToken) {
            preloadWorkspaceData();
            return;
          }

          redirectToSignIn();
        })
        .catch(() => {
          redirectToSignIn();
        });
      return;
    }

    window.location.replace(wasLoggedOutByHistory() ? "/signed-out" : "/");
    return;
  }

  if (dashboardPages.has(path) && session?.accessToken) {
    preloadWorkspaceData();
  }
}

function getFormValues(form) {
  const formData = new FormData(form);

  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    remember_me: Boolean(formData.get("remember")),
  };
}

function createIdempotencyKey(scope) {
  if (window.crypto?.randomUUID) {
    return `${scope}:${window.crypto.randomUUID()}`;
  }

  return `${scope}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function hashIdentityKey(value) {
  return Array.from(String(value || "item")).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0
  );
}

function applyIdentityColor(element, type, item) {
  if (!element) {
    return;
  }

  const identityKey = `${type}:${item?.id || item?.task_id || item?.project_id || item?.project_name || item?.task_title || "item"}`;
  const hue = hashIdentityKey(identityKey) % 360;
  element.classList.add("identity-card");
  element.style.setProperty("--identity-bg", `hsl(${hue} 86% 96%)`);
  element.style.setProperty("--identity-border", `hsl(${hue} 62% 82%)`);
  element.style.setProperty("--identity-accent", `hsl(${hue} 46% 38%)`);
  element.style.setProperty("--identity-shadow", `hsla(${hue}, 62%, 52%, 0.16)`);
}

function setButtonBusy(button, isBusy) {
  if (!button) {
    return;
  }

  button.disabled = isBusy;
  button.classList.toggle("is-loading", isBusy);
}

function setMessage(messageElement, text, isError = false) {
  if (!messageElement) {
    return;
  }

  messageElement.textContent = text;
  messageElement.classList.toggle("is-error", isError);
}

function isLiveRefreshPausedByInput() {
  const activeElement = document.activeElement;
  if (!activeElement || activeElement === document.body) {
    return false;
  }

  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName) ||
    Boolean(activeElement.isContentEditable)
  );
}

function registerLiveRefreshJob(key, callback, options = {}) {
  if (!key || typeof callback !== "function") {
    return;
  }

  liveRefreshJobs.set(key, {
    callback,
    intervalMs: options.intervalMs || liveRefreshIntervals.page,
    lastRunAt: Date.now(),
    isRunning: false,
    runWhileEditing: Boolean(options.runWhileEditing),
    shouldRun: options.shouldRun || (() => true),
  });
}

function shouldRunLiveRefreshJob(job) {
  try {
    return job.shouldRun();
  } catch (_error) {
    return false;
  }
}

async function runLiveRefreshJob(job, force = false) {
  if (
    !job ||
    job.isRunning ||
    !getSession()?.accessToken ||
    document.hidden ||
    (!job.runWhileEditing && isLiveRefreshPausedByInput()) ||
    !shouldRunLiveRefreshJob(job)
  ) {
    return;
  }

  const now = Date.now();
  if (!force && now - job.lastRunAt < job.intervalMs) {
    return;
  }

  job.isRunning = true;
  try {
    await job.callback({ silent: true, force });
    job.lastRunAt = Date.now();
  } catch (_error) {
    // Background refresh should never interrupt the current workflow.
  } finally {
    job.isRunning = false;
  }
}

function refreshLiveJobs(force = false) {
  liveRefreshJobs.forEach((job) => {
    runLiveRefreshJob(job, force);
  });
}

function startLiveRefreshLoop() {
  if (liveRefreshStarted) {
    return;
  }

  liveRefreshStarted = true;
  window.setInterval(() => refreshLiveJobs(false), liveRefreshTickMs);
  window.addEventListener("focus", () => refreshLiveJobs(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshLiveJobs(true);
    }
  });
}

function getDataFilterValues(root, selector, datasetKey) {
  if (!root) {
    return {};
  }

  return Object.fromEntries(
    Array.from(root.querySelectorAll(selector))
      .map((control) => [control.dataset[datasetKey], control.value])
      .filter(([key, value]) => key && value)
  );
}

function getProjectTableFilters(root) {
  return getDataFilterValues(root, "[data-project-filter]", "projectFilter");
}

function getTaskBoardFilters(root) {
  return getDataFilterValues(
    root,
    "[data-task-board-filter]",
    "taskBoardFilter"
  );
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (!element) {
    return null;
  }

  element.textContent = text;
  return element;
}

function setHref(selector, href) {
  const element = document.querySelector(selector);
  if (!element) {
    return null;
  }

  element.href = href;
  return element;
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

function getMentionDisplayName(user) {
  return String(user?.user_name || user?.email || "User").trim();
}

function getMentionEmailLocalPart(user) {
  return String(user?.email || "").split("@")[0].trim();
}

function getMentionToken(user) {
  const hasDisplayName = Boolean(String(user?.user_name || "").trim());
  const displayName = getMentionDisplayName(user);
  const emailLocalPart = getMentionEmailLocalPart(user);
  const source = hasDisplayName ? displayName : emailLocalPart;
  const compactToken = source.replace(/[^A-Za-z0-9._-]/g, "");

  return compactToken || emailLocalPart.replace(/[^A-Za-z0-9._-]/g, "");
}

function getMentionContext(textarea) {
  if (!textarea || textarea.selectionStart !== textarea.selectionEnd) {
    return null;
  }

  const caretPosition = textarea.selectionStart;
  const beforeCaret = textarea.value.slice(0, caretPosition);
  const match = beforeCaret.match(/(^|[\s([{])@([A-Za-z0-9._-]{0,50})$/);

  if (!match) {
    return null;
  }

  return {
    start: caretPosition - match[2].length - 1,
    end: caretPosition,
    query: match[2].toLowerCase(),
  };
}

function filterMentionUsers(users, query) {
  const normalizedQuery = String(query || "").toLowerCase();

  return users
    .filter((user) => {
      const name = String(user.user_name || "").toLowerCase();
      const email = String(user.email || "").toLowerCase();
      const localPart = email.split("@")[0];
      const compactName = name.replace(/[^a-z0-9]/g, "");
      const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, "");

      if (!normalizedQuery) {
        return true;
      }

      return [name, email, localPart, compactName].some((candidate) =>
        candidate.includes(normalizedQuery) ||
        (compactQuery && candidate.includes(compactQuery))
      );
    })
    .slice(0, 8);
}

function setupMentionAutocomplete(textarea, panel) {
  if (!textarea || !panel) {
    return;
  }

  let mentionContext = null;
  let mentionUsers = [];
  let activeIndex = 0;
  let requestId = 0;

  function hideSuggestions() {
    panel.classList.add("is-hidden");
    panel.innerHTML = "";
    mentionContext = null;
    mentionUsers = [];
    activeIndex = 0;
    textarea.removeAttribute("aria-activedescendant");
  }

  function updateActiveSuggestion() {
    panel.querySelectorAll(".mention-suggestion").forEach((suggestion, index) => {
      const isActive = index === activeIndex;
      suggestion.classList.toggle("is-active", isActive);
      suggestion.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        textarea.setAttribute("aria-activedescendant", suggestion.id);
      }
    });
  }

  function insertMention(user) {
    if (!mentionContext) {
      return;
    }

    const token = getMentionToken(user);
    if (!token) {
      hideSuggestions();
      return;
    }

    const beforeMention = textarea.value.slice(0, mentionContext.start);
    const afterMention = textarea.value.slice(mentionContext.end);
    const insertedText = `@${token} `;
    const nextCaretPosition = beforeMention.length + insertedText.length;

    textarea.value = `${beforeMention}${insertedText}${afterMention}`;
    textarea.focus();
    textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    hideSuggestions();
  }

  function renderSuggestions(users) {
    panel.innerHTML = "";

    if (!users.length) {
      hideSuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    users.forEach((user, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.id = `mention-suggestion-${index}`;
      item.className = "mention-suggestion";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === activeIndex));

      const avatar = document.createElement("span");
      avatar.className = "mention-avatar";
      avatar.textContent = getMentionDisplayName(user).slice(0, 1).toUpperCase();

      const details = document.createElement("span");
      details.className = "mention-details";

      const name = document.createElement("span");
      name.className = "mention-name";
      name.textContent = getMentionDisplayName(user);

      const handle = document.createElement("span");
      handle.className = "mention-handle";
      handle.textContent = `@${getMentionToken(user)}`;

      details.append(name, handle);
      item.append(avatar, details);

      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      item.addEventListener("click", () => {
        insertMention(user);
      });

      fragment.append(item);
    });

    panel.append(fragment);
    panel.classList.remove("is-hidden");
    updateActiveSuggestion();
  }

  async function refreshSuggestions() {
    const nextContext = getMentionContext(textarea);
    if (!nextContext) {
      hideSuggestions();
      return;
    }

    mentionContext = nextContext;
    const currentRequestId = ++requestId;

    try {
      const users = await getActiveUsers();
      if (currentRequestId !== requestId) {
        return;
      }

      mentionUsers = filterMentionUsers(users, mentionContext.query);
      activeIndex = 0;
      renderSuggestions(mentionUsers);
    } catch (_error) {
      hideSuggestions();
    }
  }

  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-controls", panel.id);

  textarea.addEventListener("input", refreshSuggestions);
  textarea.addEventListener("click", refreshSuggestions);
  textarea.addEventListener("keyup", (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      refreshSuggestions();
    }
  });

  textarea.addEventListener("keydown", (event) => {
    if (panel.classList.contains("is-hidden") || !mentionUsers.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % mentionUsers.length;
      updateActiveSuggestion();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + mentionUsers.length) % mentionUsers.length;
      updateActiveSuggestion();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(mentionUsers[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hideSuggestions();
    }
  });

  textarea.addEventListener("blur", () => {
    window.setTimeout(hideSuggestions, 120);
  });
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

async function refreshSession() {
  const session = getSession() || getPersistentSession();
  if (!session?.refreshToken) {
    return null;
  }

  if (!refreshSessionPromise) {
    refreshSessionPromise = postJson("/auth/refresh", {
      refresh_token: session.refreshToken,
    })
      .then((data) => {
        saveSession(data, Boolean(session.rememberMe));
        return getSession();
      })
      .catch((error) => {
        clearSession();
        throw error;
      })
      .finally(() => {
        refreshSessionPromise = null;
      });
  }

  return refreshSessionPromise;
}

async function authorizedJson(path, options = {}, allowRefresh = true) {
  let session = getSession();
  if (!session?.accessToken) {
    try {
      const restoredSession = allowRefresh ? await refreshSession() : null;
      if (restoredSession?.accessToken) {
        session = restoredSession;
      }
    } catch (_error) {
      // Fall through to sign-in redirect below.
    }

    if (!session?.accessToken) {
      redirectToSignIn();
      throw new Error("Session expired. Redirecting to sign in.");
    }
  }

  async function sendRequest(accessToken) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    };

    let response;

    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        cache: "no-store",
        ...options,
        headers,
      });
    } catch (error) {
      throw new Error("Could not reach the backend. Please try again in a moment.");
    }

    const data = await response.json().catch(() => ({
      detail: response.ok ? "" : `Backend returned ${response.status}.`,
    }));

    return { response, data };
  }

  let { response, data } = await sendRequest(session.accessToken);

  if (!response.ok) {
    if (isExpiredSessionResponse(response, data)) {
      if (allowRefresh) {
        try {
          const refreshedSession = await refreshSession();
          if (refreshedSession?.accessToken) {
            ({ response, data } = await sendRequest(refreshedSession.accessToken));
            if (response.ok) {
              return data;
            }
          }
        } catch (_error) {
          // Fall through to sign-in redirect below.
        }
      }

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

function preloadWorkspaceData() {
  if (!getSession()?.accessToken) {
    return Promise.resolve(null);
  }

  if (!preloadPromise) {
    preloadPromise = Promise.allSettled([
      getActiveUsers(),
      getAuthorizedJson("/projects"),
    ]).finally(() => {
      preloadPromise = null;
    });
  }

  return preloadPromise;
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

function createNotificationTray(notificationIcon) {
  const tray = document.createElement("div");
  tray.className = "notification-tray";

  const trigger = document.createElement("button");
  trigger.className = "btn btn-icon notification-trigger";
  trigger.type = "button";
  trigger.dataset.notificationTrigger = "true";
  trigger.setAttribute("aria-label", "Show notifications");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = notificationIcon;

  const flyout = document.createElement("div");
  flyout.className = "notification-flyout";

  const header = document.createElement("div");
  header.className = "notification-flyout-header";

  const title = document.createElement("p");
  title.textContent = "Notifications";

  const viewAll = document.createElement("a");
  viewAll.href = "/notifications";
  viewAll.textContent = "View all";

  const markAll = document.createElement("button");
  markAll.type = "button";
  markAll.className = "notification-header-action";
  markAll.textContent = "Read all";

  const headerActions = document.createElement("div");
  headerActions.className = "notification-flyout-actions";
  headerActions.append(markAll, viewAll);

  header.append(title, headerActions);

  const list = document.createElement("div");
  list.className = "notification-list notification-list-compact";
  list.dataset.notificationFlyoutList = "true";

  flyout.append(header, list);
  tray.append(trigger, flyout);

  let isPinned = false;
  let hasLoaded = false;

  function closeFlyout() {
    if (isPinned) {
      return;
    }

    tray.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  async function loadFlyoutNotifications(force = false) {
    if (hasLoaded && !force) {
      return;
    }

    if (!hasLoaded) {
      renderEmptyState(list, "Loading notifications...");
    }
    try {
      const notifications = await getAuthorizedJson("/notifications");
      renderNotifications(notifications.slice(0, 6), list);
      hasLoaded = true;
    } catch (error) {
      renderEmptyState(list, error.message || "Notifications could not be loaded.");
    }
  }

  function openFlyout() {
    tray.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    loadFlyoutNotifications();
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    isPinned = !tray.classList.contains("is-open") || !isPinned;
    if (isPinned) {
      openFlyout();
      return;
    }

    tray.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });

  tray.addEventListener("mouseenter", openFlyout);
  tray.addEventListener("mouseleave", closeFlyout);
  tray.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  list.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-notification-id]");
    if (!item) {
      return;
    }

    await openNotificationTarget(
      item.dataset.notificationId,
      item.dataset.targetUrl || "/post-login"
    );
  });

  markAll.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    markAll.disabled = true;
    try {
      await markAllNotificationsRead();
      list
        .querySelectorAll(".notification-item.is-unread")
        .forEach((item) => item.classList.remove("is-unread"));
      await loadFlyoutNotifications(true);
    } catch (error) {
      renderEmptyState(list, error.message || "Notifications could not be updated.");
    } finally {
      markAll.disabled = false;
    }
  });

  document.addEventListener("click", () => {
    isPinned = false;
    closeFlyout();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      isPinned = false;
      closeFlyout();
    }
  });

  registerLiveRefreshJob(
    "notification-flyout",
    () => loadFlyoutNotifications(true),
    {
      intervalMs: liveRefreshIntervals.flyout,
      runWhileEditing: true,
      shouldRun: () => tray.classList.contains("is-open"),
    }
  );

  return tray;
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
    notifications:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.4 2.4 0 0 0 2.3-1.7H9.7A2.4 2.4 0 0 0 12 22Zm7-6.2V11a7 7 0 0 0-5-6.7V3a2 2 0 0 0-4 0v1.3A7 7 0 0 0 5 11v4.8L3.5 18v1h17v-1L19 15.8ZM7 17l.9-1.3V11a4.1 4.1 0 0 1 8.2 0v4.7L17 17H7Z"/></svg>',
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
  trigger.setAttribute("aria-expanded", "false");
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

  const closeNavigation = () => {
    nav.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = nav.classList.toggle("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
  });

  nav.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", closeNavigation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNavigation();
    }
  });

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

    const topbarActions = document.createElement("div");
    topbarActions.className = "workspace-topbar-actions";

    if (actions) {
      topbarActions.append(actions);
    }

    topbarActions.append(createNotificationTray(icons.notifications));

    topbar.append(brand, topbarActions);
    header.prepend(topbar);
    updateNotificationBadge();
    registerLiveRefreshJob("notification-badge", updateNotificationBadge, {
      intervalMs: liveRefreshIntervals.badge,
      runWhileEditing: true,
    });
    return;
  }

  shell.prepend(nav);
  updateNotificationBadge();
  registerLiveRefreshJob("notification-badge", updateNotificationBadge, {
    intervalMs: liveRefreshIntervals.badge,
    runWhileEditing: true,
  });
}

async function updateNotificationBadge() {
  const notificationTrigger = document.querySelector("[data-notification-trigger]");
  if (!notificationTrigger || !getSession()?.accessToken) {
    return;
  }

  try {
    const data = await getAuthorizedJson("/notifications/unread-count");
    notificationTrigger.querySelector(".notification-badge")?.remove();
    if (data.unread_count > 0) {
      const badge = document.createElement("span");
      badge.className = "notification-badge";
      badge.textContent = data.unread_count > 99 ? "99+" : String(data.unread_count);
      notificationTrigger.append(badge);
    }
  } catch (_error) {
    notificationTrigger.querySelector(".notification-badge")?.remove();
  }
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
      const values = getFormValues(form);
      const data = await postJson("/auth/login", values);
      saveSession(data, values.remember_me);
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
  const stakeholderSelect = document.querySelector("#project_stakeholder_email");
  const watcherSelect = document.querySelector("#project_watcher_emails");

  if (!form) {
    return;
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
      stakeholder_email:
        String(formData.get("stakeholder_email") ?? "").trim() || null,
      watcher_emails: getSelectedValues(watcherSelect),
      idempotency_key: createIdempotencyKey("create-project"),
    };

    setMessage(messageElement, "Creating project...");
    const submitButton = event.submitter || form.querySelector("[type='submit']");
    setButtonBusy(submitButton, true);

    try {
      const data = await postAuthorizedJson("/projects", payload);
      form.reset();
      setMessage(messageElement, data.detail || "Project created successfully.");
      window.location.href = "/projects";
    } catch (error) {
      setMessage(messageElement, error.message, true);
    } finally {
      setButtonBusy(submitButton, false);
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

const taskBoardColumns = [
  { key: "OPEN", label: "Open", className: "is-open" },
  { key: "IN PROGRESS", label: "In Progress", className: "is-progress" },
  { key: "CLOSED", label: "Closed", className: "is-closed" },
];

function getTaskBoardStatus(task) {
  const status = String(task.status || "OPEN").toUpperCase();
  if (status === "CLOSED") {
    return "CLOSED";
  }
  if (status === "IN PROGRESS" || status === "CLOSE REQUESTED") {
    return "IN PROGRESS";
  }
  return "OPEN";
}

function getTaskFilterLabels(tasks, key, options = {}) {
  if (key === "project") {
    return Array.from(
      new Set(tasks.map((task) => task.project_name || "No project"))
    ).sort();
  }

  if (key === "assignee") {
    return Array.from(
      new Set(
        tasks.flatMap((task) =>
          getTaskAssigneeList(task).map(
            (assignee) => assignee.name || assignee.email || "Unassigned"
          )
        )
      )
    ).sort();
  }

  if (key === "status") {
    return Array.from(new Set(tasks.map((task) => task.status || "OPEN"))).sort();
  }

  return options.values || [];
}

function filterTasksForBoard(tasks, activeFilters = {}) {
  return tasks.filter((task) => {
    const title = String(task.task_title || "").toLowerCase();
    const projectName = task.project_name || "No project";
    const assignees = getTaskAssigneeList(task).map(
      (assignee) => assignee.name || assignee.email || "Unassigned"
    );
    const status = task.status || "OPEN";

    return (
      (!activeFilters.title ||
        title.includes(String(activeFilters.title).toLowerCase())) &&
      (!activeFilters.project || projectName === activeFilters.project) &&
      (!activeFilters.assignee || assignees.includes(activeFilters.assignee)) &&
      (!activeFilters.status || status === activeFilters.status)
    );
  });
}

function renderTaskBoardFilters(
  container,
  sourceTasks,
  activeFilters,
  onFilterChange,
  options = {}
) {
  const filterBar = document.createElement("div");
  filterBar.className = "task-board-filters";

  const filterDefinitions = [
    {
      key: "title",
      label: "Task title",
      type: "search",
      placeholder: "Search task title",
    },
  ];

  if (options.showProjectFilter) {
    filterDefinitions.push({ key: "project", label: "Project" });
  }

  filterDefinitions.push(
    { key: "assignee", label: "Assignee" },
    { key: "status", label: "Status" }
  );

  filterDefinitions.forEach((definition) => {
    const field = document.createElement("label");
    field.className = "task-board-filter";
    const label = document.createElement("span");
    label.textContent = definition.label;
    field.append(label);

    if (definition.type === "search") {
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = definition.placeholder;
      input.value = activeFilters[definition.key] || "";
      input.dataset.taskBoardFilter = definition.key;
      field.append(input);
    } else {
      const select = document.createElement("select");
      select.dataset.taskBoardFilter = definition.key;
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "All";
      select.append(defaultOption);
      getTaskFilterLabels(sourceTasks, definition.key).forEach((optionValue) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = activeFilters[definition.key] === optionValue;
        select.append(option);
      });
      field.append(select);
    }

    filterBar.append(field);
  });

  filterBar.querySelectorAll("[data-task-board-filter]").forEach((control) => {
    const applyFilter = () => {
      const nextFilters = Object.fromEntries(
        Array.from(filterBar.querySelectorAll("[data-task-board-filter]")).map(
          (filterControl) => [
            filterControl.dataset.taskBoardFilter,
            filterControl.value,
          ]
        )
      );
      onFilterChange(nextFilters);
    };
    control.addEventListener("input", applyFilter);
    control.addEventListener("change", applyFilter);
  });

  container.append(filterBar);
}

function createTaskBoardCard(task, options = {}) {
  const card = document.createElement("article");
  card.className = "task-card";
  applyIdentityColor(card, "task", task);
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.addEventListener("click", () => {
    window.location.href = `/task?id=${task.id}`;
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.location.href = `/task?id=${task.id}`;
    }
  });

  const title = document.createElement("a");
  title.className = "task-card-title";
  title.href = `/task?id=${task.id}`;
  title.textContent = task.task_title || `Task #${task.id}`;
  title.addEventListener("click", (event) => event.stopPropagation());

  const meta = document.createElement("div");
  meta.className = "task-card-meta";

  if (options.showProject && task.project_name) {
    const projectMeta = document.createElement("span");
    projectMeta.textContent = task.project_name;
    meta.append(projectMeta);
  }

  const assigneeMeta = document.createElement("span");
  assigneeMeta.textContent = `Assignee: ${formatTaskAssignees(task)}`;
  meta.append(assigneeMeta);

  const dueMeta = document.createElement("span");
  dueMeta.textContent = `Due: ${formatDisplayDate(task.end_date)}`;
  meta.append(dueMeta);

  const statusWrap = document.createElement("div");
  statusWrap.className = "task-card-status";
  statusWrap.append(createStatusBadge(task.status));

  card.append(title, meta, statusWrap);
  return card;
}

function renderTaskBoard(container, tasks, options = {}) {
  const board = document.createElement("div");
  board.className = "task-board";
  const tasksByColumn = taskBoardColumns.reduce((columns, column) => {
    columns[column.key] = [];
    return columns;
  }, {});

  tasks.forEach((task) => {
    tasksByColumn[getTaskBoardStatus(task)].push(task);
  });

  taskBoardColumns.forEach((column) => {
    const section = document.createElement("section");
    section.className = `task-column ${column.className}`;

    const header = document.createElement("div");
    header.className = "task-column-header";
    const title = document.createElement("h3");
    title.textContent = column.label;
    const count = document.createElement("span");
    count.textContent = tasksByColumn[column.key].length;
    header.append(title, count);

    const body = document.createElement("div");
    body.className = "task-column-body";
    if (!tasksByColumn[column.key].length) {
      const empty = document.createElement("p");
      empty.className = "empty-state compact";
      empty.textContent = "No tasks.";
      body.append(empty);
    } else {
      tasksByColumn[column.key].forEach((task) => {
        body.append(createTaskBoardCard(task, options));
      });
    }

    section.append(header, body);
    board.append(section);
  });

  container.append(board);
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

  function getProjectWatchers(project) {
    if (Array.isArray(project.watchers) && project.watchers.length) {
      return project.watchers.map((watcher) => ({
        name: watcher.user_name || watcher.email,
        email: watcher.email || null,
      }));
    }

    return [{ name: "No watchers", email: null }];
  }

  function getProjectWatcherLabel(project) {
    return getProjectWatchers(project)
      .map((watcher) => watcher.name || watcher.email)
      .join(", ");
  }

  function incrementMetric(metricMap, label, amount = 1) {
    metricMap.set(label, (metricMap.get(label) || 0) + amount);
  }

  function isInCurrentWeek(dateValue) {
    if (!dateValue) {
      return false;
    }
    const dateText = String(dateValue).slice(0, 10);
    const [year, month, day] = dateText.split("-").map(Number);
    if (!year || !month || !day) {
      return false;
    }
    const date = Date.UTC(year, month - 1, day);
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    const mondayOffset = (new Date(today).getUTCDay() + 6) % 7;
    const weekStart = today - mondayOffset * 24 * 60 * 60 * 1000;
    const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
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

  function filterProjectsForTable(projects, activeFilters = {}) {
    return projects.filter((project) => {
      const watchers = getProjectWatchers(project).map(
        (watcher) => watcher.name || watcher.email || "No watchers"
      );
      const stakeholder =
        project.stakeholder_name || project.stakeholder_email || "No stakeholder";
      return (
        (!activeFilters.watcher || watchers.includes(activeFilters.watcher)) &&
        (!activeFilters.stakeholder || stakeholder === activeFilters.stakeholder)
      );
    });
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

    const watchers = Array.from(
      new Set(
        dashboardProjects.flatMap((project) =>
          getProjectWatchers(project).map(
            (watcher) => watcher.name || watcher.email || "No watchers"
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
      { label: "Watchers", filter: "watcher", options: watchers },
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
      row.className = "project-row";
      applyIdentityColor(row, "project", project);
      row.addEventListener("click", () => {
        window.location.href = `/project?id=${project.id}`;
      });

      const titleCell = document.createElement("td");
      titleCell.dataset.label = "Project title";
      const projectLink = document.createElement("a");
      projectLink.href = `/project?id=${project.id}`;
      projectLink.textContent = project.project_name;
      titleCell.append(projectLink);

      const watcherCell = document.createElement("td");
      watcherCell.dataset.label = "Watchers";
      watcherCell.textContent = getProjectWatcherLabel(project);

      const stakeholderCell = document.createElement("td");
      stakeholderCell.dataset.label = "Stakeholder";
      stakeholderCell.textContent =
        project.stakeholder_name || project.stakeholder_email || "No stakeholder";

      row.append(titleCell, watcherCell, stakeholderCell);
      tbody.append(row);
    });

    table.append(thead, tbody);
    tableWrap.append(table);
    projectList.append(tableWrap);

    table.querySelectorAll("[data-project-filter]").forEach((filter) => {
      filter.addEventListener("change", () => {
        const activeFilters = getProjectTableFilters(table);
        const filtered = filterProjectsForTable(dashboardProjects, activeFilters);
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

    renderTaskBoardFilters(
      taskList,
      filterSourceTasks,
      activeFilters,
      (nextFilters) => {
        renderGlobalTaskRows(
          filterTasksForBoard(filterSourceTasks, nextFilters),
          nextFilters
        );
      },
      { showProjectFilter: true }
    );
    renderTaskBoard(taskList, tasks, { showProject: true });
  }

  async function loadProjects(options = {}) {
    const { silent = false } = options;
    const activeProjectFilters = getProjectTableFilters(projectList);
    const activeTaskFilters = getTaskBoardFilters(taskList);
    if (!silent) {
      setMessage(messageElement, "Loading workspace data...");
    }
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
      renderProjectRows(
        filterProjectsForTable(projects, activeProjectFilters),
        activeProjectFilters
      );
      renderGlobalTaskRows(
        filterTasksForBoard(tasks, activeTaskFilters),
        activeTaskFilters
      );
      if (!silent) {
        setMessage(messageElement, "");
      }
    } catch (error) {
      if (!silent) {
        if (projectList) {
          renderEmptyState(projectList, "Projects could not be loaded.");
        }
        if (taskList) {
          renderEmptyState(taskList, "Tasks could not be loaded.");
        }
        setMessage(messageElement, error.message, true);
      }
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
      ["Project", "Description", "Watchers", "Stakeholder", "Status"],
      ...dashboardProjects.map((project) => [
        project.project_name,
        project.description || "",
        getProjectWatcherLabel(project),
        project.stakeholder_name || project.stakeholder_email || "",
        project.status || "",
      ]),
      [],
      ["Task Register"],
      [
        "Project",
        "Project Watchers",
        "Project Stakeholder",
        "Task",
        "Task Assignee",
        "Task Status",
        "Start Date",
        "End Date",
      ],
      ...tasks.map(({ project, ...task }) => [
        project.project_name,
        getProjectWatcherLabel(project),
        project.stakeholder_name || project.stakeholder_email || "",
        task.task_title,
        getTaskAssigneeLabel(task),
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
  registerLiveRefreshJob("workspace-data", loadProjects, {
    intervalMs: liveRefreshIntervals.page,
  });
}

function fillSelectsForProjectPage() {
  const taskAssigneeSelect = document.querySelector("#task_assigned_to_email");

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
  const activeFilters = getTaskBoardFilters(taskList);
  taskList.innerHTML = "";

  if (!tasks.length) {
    renderEmptyState(taskList, "No tasks found.");
    return;
  }

  function renderBoard(filteredTasks, activeFilters = {}) {
    taskList.innerHTML = "";
    renderTaskBoardFilters(taskList, tasks, activeFilters, (nextFilters) => {
      renderBoard(filterTasksForBoard(tasks, nextFilters), nextFilters);
    });
    renderTaskBoard(taskList, filteredTasks);
  }

  renderBoard(filterTasksForBoard(tasks, activeFilters), activeFilters);
}

function setupProjectPage() {
  const projectTitle = document.querySelector("#project-title");
  const createTaskLink = document.querySelector("#create-task-link");
  const projectMessage = document.querySelector("#project-message");
  const detailPanel = document.querySelector("#project-detail-panel");
  const inlineProjectForm = document.querySelector("#inline-project-form");
  const inlineProjectMessage = document.querySelector("#inline-project-message");
  const inlineProjectCancel = document.querySelector("#inline-project-cancel");
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

    await populateUserSelect(inlineStakeholderSelect, { includeCurrentUser: true });
    if (inlineStakeholderSelect && currentProject.stakeholder_email) {
      inlineStakeholderSelect.value = currentProject.stakeholder_email;
    }
    await populateUserCheckboxList(
      inlineWatcherList,
      (currentProject.watchers || []).map((watcher) => watcher.email)
    );

    inlineProjectForm.classList.remove("is-hidden");
  }

  async function loadProject(options = {}) {
    const { silent = false } = options;
    if (
      silent &&
      inlineProjectForm &&
      !inlineProjectForm.classList.contains("is-hidden")
    ) {
      return;
    }

    if (!silent) {
      setMessage(projectMessage, "Loading project...");
    }
    try {
      const project = await getAuthorizedJson(`/projects/${projectId}`);
      currentProject = project;
      renderProjectDetail(project);
      renderTaskList(project.tasks || []);
      if (!silent) {
        hideInlineProjectEditor();
        setMessage(projectMessage, "");
      }
    } catch (error) {
      if (!silent) {
        setMessage(projectMessage, error.message, true);
      }
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
  registerLiveRefreshJob(`project-detail:${projectId}`, loadProject, {
    intervalMs: liveRefreshIntervals.page,
  });
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
  const editStakeholderSelect = document.querySelector(
    "#edit_project_stakeholder_email"
  );
  const editStakeholderPromise = populateUserSelect(editStakeholderSelect, {
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
      await editStakeholderPromise;
      if (editStakeholderSelect && project.stakeholder_email) {
        editStakeholderSelect.value = project.stakeholder_email;
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
        stakeholder_email:
          String(formData.get("stakeholder_email") ?? "").trim() || null,
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

  createTaskForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!createTaskForm.checkValidity()) {
      createTaskForm.reportValidity();
      return;
    }

    const formData = new FormData(createTaskForm);
    setMessage(taskMessage, "Creating task...");
    const submitButton =
      event.submitter || createTaskForm.querySelector("[type='submit']");
    setButtonBusy(submitButton, true);

    try {
      const data = await postAuthorizedJson(`/projects/${projectId}/tasks`, {
        task_title: String(formData.get("task_title") ?? "").trim(),
        task_details: String(formData.get("task_details") ?? "").trim() || null,
        documents: String(formData.get("documents") ?? "").trim() || null,
        end_date: String(formData.get("end_date") ?? "").trim(),
        assigned_to_email:
          String(formData.get("assigned_to_email") ?? "").trim() || null,
        idempotency_key: createIdempotencyKey("create-task"),
      });
      createTaskForm.reset();
      setMessage(taskMessage, data.detail || "Task created successfully.");
      window.location.href = `/project?id=${projectId}`;
    } catch (error) {
      setMessage(taskMessage, error.message, true);
    } finally {
      setButtonBusy(submitButton, false);
    }
  });
}

function renderTaskDetail(task) {
  setText("#task-title", task.task_title || "Task");
  setText("#task-project-name", task.project_name || "Project");
  setText("#task-description", task.task_details || "No description added.");
  setText(
    "#task-assignee",
    task.assigned_to_name || task.assigned_to_email || "Unassigned"
  );

  const taskStatusElement = document.querySelector("#task-status");
  if (taskStatusElement) {
    taskStatusElement.innerHTML = "";
    taskStatusElement.append(createStatusBadge(task.status));
  }

  setText("#task-start-date", formatDisplayDate(task.start_date));
  setText("#task-end-date", formatDisplayDate(task.end_date));
  setText(
    "#task-stakeholder",
    task.stakeholder_name || task.stakeholder_email || "No stakeholder"
  );
  setText(
    "#task-watchers",
    formatWatchers(task.watchers)
  );
  setHref("#task-back-link", `/project?id=${task.project_id}`);

  const documentsElement = document.querySelector("#task-documents");
  if (!documentsElement) {
    return;
  }

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
  const status = String(task.status || "OPEN").toUpperCase();
  const isAssignee = Boolean(currentEmail && currentEmail === assignedEmail);
  const isStakeholder = Boolean(currentEmail && currentEmail === stakeholderEmail);
  const canUseAssigneeWorkflow = isAssignee;

  const startWorkButton = document.querySelector("#start-work-button");
  const requestCloseButton = document.querySelector("#request-close-button");
  const closeTaskButton = document.querySelector("#close-task-button");

  if (startWorkButton) {
    startWorkButton.classList.toggle(
      "is-hidden",
      !canUseAssigneeWorkflow || status !== "OPEN"
    );
  }

  if (requestCloseButton) {
    requestCloseButton.classList.toggle(
      "is-hidden",
      !canUseAssigneeWorkflow || status !== "IN PROGRESS"
    );
  }

  if (closeTaskButton) {
    closeTaskButton.classList.toggle(
      "is-hidden",
      !isStakeholder ||
        !["IN PROGRESS", "CLOSE REQUESTED"].includes(status)
    );
  }
}

function renderComments(comments) {
  const commentList = document.querySelector("#comment-list");
  if (!commentList) {
    return;
  }

  commentList.innerHTML = "";

  if (!comments.length) {
    renderEmptyState(commentList, "No comments yet.");
    return;
  }

  const repliesByParent = new Map();
  const rootComments = [];
  comments.forEach((comment) => {
    const parentId = comment.parent_comment_id;
    if (parentId) {
      const replies = repliesByParent.get(parentId) || [];
      replies.push(comment);
      repliesByParent.set(parentId, replies);
      return;
    }

    rootComments.push(comment);
  });

  function createCommentCard(comment, isReply = false) {
    const card = document.createElement("article");
    card.className = "comment-card";
    if (isReply) {
      card.classList.add("is-reply");
    }

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

    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const replyButton = document.createElement("button");
    replyButton.className = "link-button";
    replyButton.type = "button";
    replyButton.dataset.replyCommentId = comment.id;
    replyButton.dataset.replyCommentAuthor = author.textContent;
    replyButton.textContent = "Reply";
    actions.append(replyButton);
    card.append(actions);

    return card;
  }

  function appendCommentThread(comment, container, isReply = false) {
    const card = createCommentCard(comment, isReply);
    container.append(card);

    const replies = repliesByParent.get(comment.id) || [];
    if (replies.length) {
      const replyList = document.createElement("div");
      replyList.className = "comment-replies";
      replies.forEach((reply) => appendCommentThread(reply, replyList, true));
      container.append(replyList);
    }
  }

  rootComments.forEach((comment) => {
    appendCommentThread(comment, commentList);
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
    const hours = workLog.hours ? ` - ${workLog.hours}h` : "";
    author.textContent = `${loggedBy} - ${formatDisplayDate(workLog.work_date)}${hours}`;

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

function getNotificationTarget(notification) {
  if (notification.target_url) {
    return notification.target_url;
  }

  const sourceType = String(notification.source_type || "").toUpperCase();
  if (sourceType === "TASK") {
    return `/task?id=${notification.source_id}`;
  }
  if (sourceType === "PROJECT") {
    return `/project?id=${notification.source_id}`;
  }

  return "/post-login";
}

async function openNotificationTarget(notificationId, targetUrl) {
  try {
    await postAuthorizedJson(`/notifications/${notificationId}/read`, {});
    await updateNotificationBadge();
  } catch (_error) {
    // Navigation is still useful even if the read marker fails.
  }

  window.location.href = targetUrl;
}

async function markAllNotificationsRead() {
  await postAuthorizedJson("/notifications/read-all", {});
  await updateNotificationBadge();
}

function renderNotifications(notifications, targetList = null) {
  const list = targetList || document.querySelector("#notification-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (!notifications.length) {
    renderEmptyState(list, "No notifications yet.");
    return;
  }

  notifications.forEach((notification) => {
    const item = document.createElement("button");
    item.className = "notification-item";
    item.type = "button";
    item.dataset.notificationId = notification.id;
    item.dataset.targetUrl = getNotificationTarget(notification);
    if (String(notification.status || "").toUpperCase() !== "READ") {
      item.classList.add("is-unread");
    }

    const title = document.createElement("span");
    title.className = "notification-title";
    title.textContent = notification.subject || "Notification";

    const body = document.createElement("span");
    body.className = "notification-body";
    body.textContent = notification.description || notification.body || "";

    const meta = document.createElement("span");
    meta.className = "notification-meta";
    meta.textContent = formatDisplayDate(notification.created_at);

    item.append(title, body, meta);
    list.append(item);
  });
}

function setupNotificationsPage() {
  const list = document.querySelector("#notification-list");
  const messageElement = document.querySelector("#notification-message");
  const readAllButton = document.querySelector("#notifications-read-all");
  if (!list) {
    return;
  }

  list.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-notification-id]");
    if (!item) {
      return;
    }

    await openNotificationTarget(
      item.dataset.notificationId,
      item.dataset.targetUrl || "/post-login"
    );
  });

  async function loadNotifications(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      setMessage(messageElement, "Loading notifications...");
    }
    try {
      const notifications = await getAuthorizedJson("/notifications");
      renderNotifications(notifications);
      updateNotificationBadge();
      if (!silent) {
        setMessage(messageElement, "");
      }
    } catch (error) {
      if (!silent) {
        setMessage(messageElement, error.message, true);
        renderEmptyState(list, "Notifications could not be loaded.");
      }
    }
  }

  readAllButton?.addEventListener("click", async () => {
    readAllButton.disabled = true;
    setMessage(messageElement, "Marking notifications as read...");
    try {
      await markAllNotificationsRead();
      await loadNotifications({ silent: true });
      setMessage(messageElement, "All notifications marked as read.");
    } catch (error) {
      setMessage(messageElement, error.message, true);
    } finally {
      readAllButton.disabled = false;
    }
  });

  loadNotifications();
  registerLiveRefreshJob("notifications-page", loadNotifications, {
    intervalMs: liveRefreshIntervals.notifications,
    runWhileEditing: true,
  });
}

function setupTaskPage() {
  const taskTitle = document.querySelector("#task-title");
  const commentForm = document.querySelector("#task-comment-form");
  const workLogForm = document.querySelector("#task-work-log-form");
  const messageElement = document.querySelector("#comment-message");
  const workLogMessage = document.querySelector("#work-log-message");
  const taskActionMessage = document.querySelector("#task-action-message");
  const commentList = document.querySelector("#comment-list");
  const commentTextInput = document.querySelector("#comment_text");
  const mentionSuggestions = document.querySelector("#mention-suggestions");
  const parentCommentInput = document.querySelector("#parent_comment_id");
  const replyContext = document.querySelector("#reply-context");
  const replyTarget = document.querySelector("#reply-target");
  const cancelReplyButton = document.querySelector("#cancel-reply-button");
  const taskAssigneeSelect = document.querySelector("#task_edit_assigned_to_email");
  const taskEndDateInput = document.querySelector("#task_edit_end_date");
  const taskId = getQueryParam("id");

  if (!taskTitle) {
    return;
  }

  if (!taskId) {
    setMessage(messageElement, "Task id is missing.", true);
    return;
  }

  setupMentionAutocomplete(commentTextInput, mentionSuggestions);

  function clearReplyTarget() {
    if (parentCommentInput) {
      parentCommentInput.value = "";
    }
    if (replyTarget) {
      replyTarget.textContent = "";
    }
    replyContext?.classList.add("is-hidden");
  }

  function setReplyTarget(commentId, authorName) {
    if (parentCommentInput) {
      parentCommentInput.value = commentId;
    }
    if (replyTarget) {
      replyTarget.textContent = authorName || "comment";
    }
    replyContext?.classList.remove("is-hidden");
    document.querySelector("#comment_text")?.focus();
  }

  async function loadTask(options = {}) {
    const { silent = false } = options;
    if (silent && isLiveRefreshPausedByInput()) {
      return;
    }

    try {
      const task = await getAuthorizedJson(`/tasks/${taskId}`);
      renderTaskDetail(task);
      setTaskWorkflowVisibility(task);
      renderComments(task.comments || []);
      renderWorkLogs(task.work_logs || []);
      await populateUserSelect(taskAssigneeSelect, { includeCurrentUser: true });
      if (taskAssigneeSelect && task.assigned_to_email) {
        taskAssigneeSelect.value = task.assigned_to_email;
      }
      const session = getSession();
      const currentEmail = String(session?.email || "").toLowerCase();
      const assignedEmail = String(task.assigned_to_email || "").toLowerCase();
      const stakeholderEmail = String(task.stakeholder_email || "").toLowerCase();
      const canChangeAssignee =
        Boolean(currentEmail) &&
        (currentEmail === assignedEmail || currentEmail === stakeholderEmail);
      if (taskAssigneeSelect) {
        taskAssigneeSelect.disabled = !canChangeAssignee;
      }
      if (taskEndDateInput) {
        taskEndDateInput.value = task.end_date || "";
      }
    } catch (error) {
      if (!silent) {
        setMessage(messageElement, error.message, true);
      }
    }
  }

  document.querySelector("#save-task-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setMessage(taskActionMessage, "Saving task details...");
    setButtonBusy(button, true);
    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/update`, {
        assigned_to_email: taskAssigneeSelect?.value || "",
        end_date: taskEndDateInput?.value || null,
      });
      setMessage(taskActionMessage, data.detail || "Task details saved.");
      await loadTask();
    } catch (error) {
      setMessage(taskActionMessage, error.message, true);
    } finally {
      setButtonBusy(button, false);
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

  commentList?.addEventListener("click", (event) => {
    const replyButton = event.target.closest("[data-reply-comment-id]");
    if (!replyButton) {
      return;
    }

    setReplyTarget(
      replyButton.dataset.replyCommentId,
      replyButton.dataset.replyCommentAuthor
    );
  });

  cancelReplyButton?.addEventListener("click", clearReplyTarget);

  commentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!commentForm.checkValidity()) {
      commentForm.reportValidity();
      return;
    }

    const formData = new FormData(commentForm);
    const submitButton = commentForm.querySelector("button[type='submit']");
    setMessage(messageElement, "Adding comment...");
    setButtonBusy(submitButton, true);

    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/comments`, {
        comment_text: String(formData.get("comment_text") ?? "").trim(),
        deliverable_url:
          String(formData.get("deliverable_url") ?? "").trim() || null,
        parent_comment_id: parentCommentInput?.value
          ? Number(parentCommentInput.value)
          : null,
        idempotency_key: createIdempotencyKey("task-comment"),
      });
      commentForm.reset();
      clearReplyTarget();
      setMessage(messageElement, data.detail || "Comment added successfully.");
      await loadTask();
    } catch (error) {
      setMessage(messageElement, error.message, true);
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  workLogForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!workLogForm.checkValidity()) {
      workLogForm.reportValidity();
      return;
    }

    const formData = new FormData(workLogForm);
    const submitButton = workLogForm.querySelector("button[type='submit']");
    setMessage(workLogMessage, "Adding work log...");
    setButtonBusy(submitButton, true);

    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/work-logs`, {
        work_note: String(formData.get("work_note") ?? "").trim(),
        work_date: String(formData.get("work_date") ?? "").trim() || null,
        hours: Number(String(formData.get("hours")).trim()),
        idempotency_key: createIdempotencyKey("task-work-log"),
      });
      workLogForm.reset();
      setMessage(workLogMessage, data.detail || "Work log added.");
      await loadTask();
    } catch (error) {
      setMessage(workLogMessage, error.message, true);
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  setupActivityTabs();
  loadTask();
  registerLiveRefreshJob(`task-detail:${taskId}`, loadTask, {
    intervalMs: liveRefreshIntervals.task,
  });
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
setupNotificationsPage();
setupWorkspaceNavigation();
setupLogoutButtons();
startLiveRefreshLoop();
