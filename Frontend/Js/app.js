const apiBaseUrl = window.NTT_CONFIG?.apiBaseUrl ?? "http://localhost:8000";
const sessionKey = "ntt_auth_session";
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

function saveSession(data) {
  window.sessionStorage.removeItem(historyLogoutKey);
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
}

function markHistoryLogout() {
  window.sessionStorage.setItem(historyLogoutKey, "true");
}

function wasLoggedOutByHistory() {
  return window.sessionStorage.getItem(historyLogoutKey) === "true";
}

function redirectToSignedOut() {
  window.location.replace("/signed-out");
}

function guardPageAccess() {
  const path = normalizePath(window.location.pathname);
  const session = getSession();

  if (authPages.has(path) && session?.accessToken) {
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

  if (dashboardPages.has(path) && !session?.accessToken) {
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

window.addEventListener("pageshow", guardPageAccess);
guardPageAccess();
setupLoginForm();
setupSignupForm();
setupForgotPasswordForm();
