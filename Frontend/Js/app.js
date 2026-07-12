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

function getSelectedValues(selectElement) {
  if (!selectElement) {
    return [];
  }

  return Array.from(selectElement.selectedOptions)
    .map((option) => option.value.trim())
    .filter(Boolean);
}

function setupLogoutButtons() {
  document.querySelectorAll("[data-logout-button]").forEach((button) => {
    button.addEventListener("click", logout);
  });
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
  const messageElement = document.querySelector("#projects-message");
  const refreshButton = document.querySelector("#refresh-projects-button");

  if (!projectList) {
    return;
  }

  async function loadProjects() {
    setMessage(messageElement, "Loading projects...");
    try {
      const projects = await getAuthorizedJson("/projects");
      projectList.innerHTML = "";

      if (!projects.length) {
        renderEmptyState(projectList, "No projects found.");
        setMessage(messageElement, "");
        return;
      }

      const tableWrap = document.createElement("div");
      tableWrap.className = "data-table-wrap";

      const table = document.createElement("table");
      table.className = "data-table";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      ["Project title", "Assignee"].forEach((label) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        headerRow.append(cell);
      });
      thead.append(headerRow);

      const tbody = document.createElement("tbody");

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
        assigneeCell.textContent =
          project.assigned_to_name ||
          project.assigned_to_email ||
          formatProjectMembers(project.assignees);

        row.append(titleCell, assigneeCell);
        tbody.append(row);
      });

      table.append(thead, tbody);
      tableWrap.append(table);
      projectList.append(tableWrap);

      setMessage(messageElement, "");
    } catch (error) {
      renderEmptyState(projectList, "Projects could not be loaded.");
      setMessage(messageElement, error.message, true);
    }
  }

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
  const projectWatcherElement = document.querySelector("#project-watchers");
  if (projectWatcherElement) {
    projectWatcherElement.textContent = formatWatchers(project.watchers);
  }
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
  ["Task title", "Assignee", "Status"].forEach((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.append(cell);
  });
  thead.append(headerRow);

  const tbody = document.createElement("tbody");

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

    const assigneeCell = document.createElement("td");
    assigneeCell.textContent =
      task.assigned_to_name || task.assigned_to_email || "Unassigned";

    const statusCell = document.createElement("td");
    statusCell.textContent = task.status || "OPEN";

    row.append(titleCell, assigneeCell, statusCell);
    tbody.append(row);
  });

  table.append(thead, tbody);
  tableWrap.append(table);
  taskList.append(tableWrap);
}

function setupProjectPage() {
  const projectTitle = document.querySelector("#project-title");
  const editProjectLink = document.querySelector("#edit-project-link");
  const createTaskLink = document.querySelector("#create-task-link");
  const projectMessage = document.querySelector("#project-message");
  const projectId = getQueryParam("id");

  if (!projectTitle) {
    return;
  }

  if (!projectId) {
    setMessage(projectMessage, "Project id is missing.", true);
    return;
  }

  editProjectLink.href = `/edit-project?id=${projectId}`;
  createTaskLink.href = `/create-task?id=${projectId}`;

  async function loadProject() {
    setMessage(projectMessage, "Loading project...");
    try {
      const project = await getAuthorizedJson(`/projects/${projectId}`);
      renderProjectDetail(project);
      renderTaskList(project.tasks || []);
      setMessage(projectMessage, "");
    } catch (error) {
      setMessage(projectMessage, error.message, true);
    }
  }

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
  document.querySelector("#task-status").textContent = task.status || "OPEN";
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

function setupTaskPage() {
  const taskTitle = document.querySelector("#task-title");
  const commentForm = document.querySelector("#task-comment-form");
  const messageElement = document.querySelector("#comment-message");
  const taskActionMessage = document.querySelector("#task-action-message");
  const taskStatusSelect = document.querySelector("#task_status");
  const taskUpdateForm = document.querySelector("#task-update-form");
  const taskAssigneeSelect = document.querySelector("#task_edit_assigned_to_email");
  const taskStakeholderSelect = document.querySelector("#task_edit_stakeholder_email");
  const taskWatcherSelect = document.querySelector("#task_edit_watcher_emails");
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
      renderComments(task.comments || []);
      if (taskStatusSelect) {
        taskStatusSelect.value = task.status || "OPEN";
      }
      await populateUserSelect(taskAssigneeSelect, { includeCurrentUser: true });
      await populateUserSelect(taskStakeholderSelect, { includeCurrentUser: true });
      await populateUserMultiSelect(
        taskWatcherSelect,
        (task.watchers || []).map((watcher) => watcher.email)
      );
      if (taskAssigneeSelect && task.assigned_to_email) {
        taskAssigneeSelect.value = task.assigned_to_email;
      }
      if (taskStakeholderSelect && task.stakeholder_email) {
        taskStakeholderSelect.value = task.stakeholder_email;
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
        watcher_emails: getSelectedValues(taskWatcherSelect),
      });
      setMessage(taskActionMessage, data.detail || "Task details saved.");
      await loadTask();
    } catch (error) {
      setMessage(taskActionMessage, error.message, true);
    }
  });

  taskUpdateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(taskActionMessage, "Updating status...");
    try {
      const data = await postAuthorizedJson(`/tasks/${taskId}/status`, {
        status: String(taskStatusSelect?.value ?? "OPEN"),
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
setupLogoutButtons();
