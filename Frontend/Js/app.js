const apiBaseUrl = window.NTT_CONFIG?.apiBaseUrl ?? "http://localhost:8000";
const sessionKey = "ntt_auth_session";
const authActiveKey = "ntt_auth_active";
const historyLogoutKey = "ntt_history_logout";
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
  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession);
  } catch (_error) {
    window.sessionStorage.removeItem(sessionKey);
    return null;
  }
}

function isAuthActive() {
  return window.localStorage.getItem(authActiveKey) === "true";
}

function saveSession(data) {
  window.sessionStorage.removeItem(historyLogoutKey);
  window.localStorage.removeItem(historyLogoutKey);
  window.localStorage.setItem(authActiveKey, "true");
  window.sessionStorage.setItem(
    sessionKey,
    JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user_id,
      email: data.email,
    })
  );
}

function clearSession() {
  window.sessionStorage.removeItem(sessionKey);
  window.localStorage.removeItem(authActiveKey);
}

function markHistoryLogout() {
  window.sessionStorage.setItem(historyLogoutKey, "true");
  window.localStorage.setItem(historyLogoutKey, "true");
}

function wasLoggedOutByHistory() {
  return (
    window.sessionStorage.getItem(historyLogoutKey) === "true" ||
    window.localStorage.getItem(historyLogoutKey) === "true"
  );
}

function redirectToSignedOut() {
  window.location.replace("/signed-out");
}

function guardPageAccess() {
  const path = normalizePath(window.location.pathname);
  const session = getSession();

  if (authPages.has(path) && (session?.accessToken || isAuthActive())) {
    clearSession();
    markHistoryLogout();
    redirectToSignedOut();
    return;
  }

  if (dashboardPages.has(path) && wasLoggedOutByHistory()) {
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

function createTextLink(url, text) {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = text;
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
    throw new Error("Session expired. Please sign in again.");
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

async function populateUserSelect(selectElement, options = {}) {
  if (!selectElement) {
    return;
  }

  const { includeCurrentUser = false } = options;
  const users = await getAuthorizedJson("/users");
  const session = getSession();
  let optionCount = 0;

  selectElement.querySelectorAll("option[disabled]").forEach((option) => {
    option.remove();
  });

  users.forEach((user) => {
    if (!user.email || (!includeCurrentUser && user.email === session?.email)) {
      return;
    }

    const option = document.createElement("option");
    option.value = user.email;
    option.textContent = formatAssignee(user);
    selectElement.append(option);
    optionCount += 1;
  });

  if (optionCount === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.disabled = true;
    option.textContent = "No other active users found";
    selectElement.append(option);
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
      const data = await postJson("/auth/login", getFormValues(form));
      saveSession(data);
      window.location.href = "/post-login";
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

  if (!form) {
    return;
  }

  if (assigneeSelect) {
    populateUserSelect(assigneeSelect)
      .catch((error) => {
        setMessage(messageElement, error.message, true);
      });
  }

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
      documents: String(formData.get("documents") ?? "").trim() || null,
      assigned_to_email:
        String(formData.get("assigned_to_email") ?? "").trim() || null,
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

      projects.forEach((project) => {
        const card = document.createElement("a");
        card.className = "item-card";
        card.href = `/project?id=${project.id}`;

        const title = document.createElement("h3");
        title.textContent = project.project_name;
        const description = document.createElement("p");
        description.textContent = project.description || "No description added.";
        const assignees = document.createElement("p");
        assignees.className = "meta-text";
        assignees.textContent = `Assignees: ${formatProjectMembers(project.assignees)}`;

        card.append(title, description, assignees);
        projectList.append(card);
      });

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
  documentsElement.innerHTML = "";
  documentsElement.append(
    project.documents
      ? createTextLink(project.documents, project.documents)
      : "No documents URL added."
  );
  document.querySelector("#project-assignees").textContent = formatProjectMembers(
    project.assignees
  );

  document.querySelector("#edit_description").value = project.description || "";
  document.querySelector("#edit_documents").value = project.documents || "";
}

function renderTaskList(tasks) {
  const taskList = document.querySelector("#task-list");
  taskList.innerHTML = "";

  if (!tasks.length) {
    renderEmptyState(taskList, "No tasks found.");
    return;
  }

  tasks.forEach((task) => {
    const card = document.createElement("a");
    card.className = "item-card";
    card.href = `/task?id=${task.id}`;

    const title = document.createElement("h3");
    title.textContent = task.task_title;
    const description = document.createElement("p");
    description.textContent = task.task_details || "No description added.";
    const assignee = document.createElement("p");
    assignee.className = "meta-text";
    assignee.textContent = `Assignee: ${
      task.assigned_to_name || task.assigned_to_email || "Unassigned"
    }`;

    card.append(title, description, assignee);
    taskList.append(card);
  });
}

function setupProjectPage() {
  const projectTitle = document.querySelector("#project-title");
  const editForm = document.querySelector("#edit-project-form");
  const createTaskForm = document.querySelector("#create-task-form");
  const projectMessage = document.querySelector("#project-message");
  const editMessage = document.querySelector("#edit-project-message");
  const taskMessage = document.querySelector("#create-task-message");
  const projectId = getQueryParam("id");

  if (!projectTitle) {
    return;
  }

  if (!projectId) {
    setMessage(projectMessage, "Project id is missing.", true);
    return;
  }

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

  fillSelectsForProjectPage();

  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(editForm);
    setMessage(editMessage, "Saving project...");

    try {
      const data = await postAuthorizedJson(`/projects/${projectId}/update`, {
        description: String(formData.get("description") ?? "").trim() || null,
        documents: String(formData.get("documents") ?? "").trim() || null,
        assigned_to_email:
          String(formData.get("assigned_to_email") ?? "").trim() || null,
      });
      setMessage(editMessage, data.detail || "Project updated successfully.");
      await loadProject();
    } catch (error) {
      setMessage(editMessage, error.message, true);
    }
  });

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
      });
      createTaskForm.reset();
      setMessage(taskMessage, data.detail || "Task created successfully.");
      await loadProject();
    } catch (error) {
      setMessage(taskMessage, error.message, true);
    }
  });

  loadProject();
}

function renderTaskDetail(task) {
  document.querySelector("#task-title").textContent = task.task_title;
  document.querySelector("#task-project-name").textContent = task.project_name;
  document.querySelector("#task-description").textContent =
    task.task_details || "No description added.";
  document.querySelector("#task-assignee").textContent =
    task.assigned_to_name || task.assigned_to_email || "Unassigned";
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
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  }

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
setupTaskPage();
