const messageElement = document.querySelector("#form-message");
const form = document.querySelector("#reset-password-form");

function setResetMessage(text, isError = false) {
  messageElement.textContent = text;
  messageElement.classList.toggle("is-error", isError);
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
