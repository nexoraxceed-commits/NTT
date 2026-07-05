const apiBaseUrl = window.NTT_CONFIG?.apiBaseUrl ?? "http://localhost:8000";

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
      await postJson("/auth/login", getFormValues(form));
      window.location.href = "post-login.html";
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
        window.location.href = "index.html";
      }, 900);
    } catch (error) {
      setMessage(messageElement, error.message, true);
    }
  });
}

setupLoginForm();
setupSignupForm();
