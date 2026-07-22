const messageElement = document.querySelector("#form-message");
const form = document.querySelector("#reset-password-form");

function setResetMessage(text, isError = false) {
  if (!messageElement) {
    return;
  }

  messageElement.textContent = text;
  messageElement.classList.toggle("is-error", isError);
}

function registerMobileAppServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const isSupportedOrigin =
    window.location.protocol === "https:" ||
    ["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (!isSupportedOrigin) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Password reset remains usable if app-shell registration is unavailable.
    });
  });
}

function getRecoveryTokens() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
  };
}

async function getSupabaseClient() {
  const config = window.NTT_CONFIG;

  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new Error("Supabase reset configuration is missing.");
  }

  return window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );
}

registerMobileAppServiceWorker();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const { accessToken, refreshToken } = getRecoveryTokens();
  if (!accessToken || !refreshToken) {
    setResetMessage("This reset link is invalid or expired.", true);
    return;
  }

  const password = String(new FormData(form).get("password") ?? "");
  setResetMessage("Updating password...");

  try {
    const client = await getSupabaseClient();
    const sessionResult = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionResult.error) {
      throw sessionResult.error;
    }

    const updateResult = await client.auth.updateUser({ password });
    if (updateResult.error) {
      throw updateResult.error;
    }

    setResetMessage("Password updated. Redirecting to sign in...");
    window.setTimeout(() => {
      window.location.replace("/");
    }, 900);
  } catch (_error) {
    setResetMessage("Could not update password from this reset link.", true);
  }
});
