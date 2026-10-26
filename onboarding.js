(() => {
  "use strict";

  const form = document.querySelector("[data-join-form]");
  if (!form) return;
  const email = form.elements.email;
  const button = form.querySelector("[data-join-submit]");
  const buttonLabel = form.querySelector("[data-join-button-label]");
  const status = form.querySelector("[data-join-status]");
  const challenge = form.querySelector("[data-join-challenge]");
  let apiBase;
  let token = "";
  let widgetId;
  let busy = false;

  const say = (message, error = false, state = "idle") => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
    form.dataset.state = error ? "error" : state;
  };
  const updateButton = () => { button.disabled = busy || !token; };
  const getJSON = async (url, options = {}) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Invitations are temporarily unavailable. Please try again later.");
    return data;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !token || !apiBase || !form.reportValidity()) return;
    busy = true;
    email.disabled = true;
    form.setAttribute("aria-busy", "true");
    buttonLabel.textContent = "Sending invitation…";
    updateButton();
    say("Requesting your GitHub invitation…", false, "sending");
    try {
      const result = await getJSON(`${apiBase}/api/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), turnstileToken: token }),
      });
      say(result.message, false, "success");
      email.value = "";
    } catch (error) {
      say(error.name === "TimeoutError"
        ? "The request timed out. Check your inbox before trying again."
        : error.message === "Failed to fetch"
          ? "Could not reach the invitation service. Check your connection and try again."
          : error.message, true);
    } finally {
      busy = false;
      token = "";
      email.disabled = false;
      form.setAttribute("aria-busy", "false");
      buttonLabel.textContent = "Send invitation";
      updateButton();
      window.turnstile.reset(widgetId);
    }
  });

  const init = async () => {
    try {
      const config = await getJSON("/onboarding-config.json", { cache: "no-store" });
      if (!config.apiBaseUrl) {
        say("Online invitations are not open yet. Visit DiaoOrg on GitHub to get in touch.");
        return;
      }
      const url = new URL(config.apiBaseUrl);
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new Error("The invitation service is temporarily unavailable.");
      }
      apiBase = url.origin;
      const settings = await getJSON(`${apiBase}/api/config`, { cache: "no-store" });
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load verification. Check your connection and reload the page."));
        document.head.appendChild(script);
      });
      widgetId = window.turnstile.render(challenge, {
        sitekey: settings.siteKey,
        action: "onboarding",
        theme: "dark",
        size: challenge.clientWidth < 300 ? "compact" : "flexible",
        callback: (value) => {
          token = value;
          updateButton();
          if (!busy && ["idle", "loading", "ready"].includes(form.dataset.state)) say("Verification complete. Your invitation is one click away.", false, "ready");
        },
        "expired-callback": () => {
          token = "";
          updateButton();
          if (!busy && form.dataset.state !== "success") say("Verification expired. Please verify again.", true);
        },
        "error-callback": () => {
          token = "";
          updateButton();
          say("Verification failed. Please retry the challenge or reload the page.", true);
        },
      });
      email.disabled = false;
      say("Complete the security check to request your invitation.");
    } catch (error) {
      say("The invitation service could not load. Please reload the page and try again.", true);
    }
  };
  init();
})();
