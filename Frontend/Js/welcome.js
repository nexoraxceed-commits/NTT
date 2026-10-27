/*
 * Welcome / intro for new members (shown to juniors on first sign-in, open to
 * everyone from the Guide). Five short steps, ending with the profile form.
 */
(function () {
  "use strict";

  const root = document.querySelector("#welcome-root");
  if (!root) {
    return;
  }

  const VERTICALS = [
    {
      key: "PSO",
      name: "Pipeline Sourcing & Outreach",
      blurb: "Find and engage high-potential startups, run first evaluations, and bring them into the XCEED incubation programme.",
    },
    {
      key: "VAD",
      name: "Venture Advisory & Development",
      blurb: "Work with founders on business models, market validation, growth strategy and investor readiness.",
    },
    {
      key: "IPR",
      name: "Investor & Partnership Relations",
      blurb: "Build relationships with investors, VCs, corporates, mentors, government bodies and ecosystem partners.",
    },
    {
      key: "VOC",
      name: "Venture Operations & Compliance",
      blurb: "Keep incubated ventures running well: governance, documentation, compliance and incubation operations.",
    },
  ];

  const FLOW = [
    ["Project", "Seniors set up a project and add you to its team."],
    ["Task", "Each piece of work is a task with an owner, a reviewer and a due date."],
    ["Start work", "Tap Start work when you begin, so everyone sees it moving."],
    ["Log & share", "Log your hours and post updates or links to your work as you go."],
    ["Send for review", "When it's done, send it to your reviewer."],
    ["Done", "Your reviewer approves it, or sends it back with a note to fix."],
  ];

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const session = () => (typeof getSession === "function" ? getSession() : null) || {};
  const isJunior = () => String(session().userClass || "").toUpperCase() === "JUNIOR";

  const state = {
    step: 0,
    profile: null,
    seniors: [],
    form: { vertical: "", roll_no: "", phone: "", linkedin_url: "", skills: "" },
    saving: false,
    error: "",
  };

  function firstName() {
    const name = state.profile?.user_name || "";
    return name.split(/\s+/)[0] || "";
  }

  function guessRoll() {
    const local = String(session().email || "").split("@")[0];
    return /^[a-z]{1,4}\d{4,6}$/i.test(local) ? local.toUpperCase() : "";
  }

  /* ------------------------------------------------------------- steps */

  const steps = [
    {
      title: "Welcome",
      render: () => `
        <p class="welcome-kicker">Welcome to NEXORA${firstName() ? `, ${esc(firstName())}` : ""}</p>
        <h2 class="welcome-title">You won't just study entrepreneurship. You'll help build it.</h2>
        <p class="welcome-copy">XCEED is the startup incubator of XLRI Xavier School of Management. It helps early-stage ventures validate ideas, refine business models, strengthen operations, build partnerships and prepare for growth.</p>
        <p class="welcome-copy">NEXORA is XCEED's Student Venture Corps: the student team working alongside founders, mentors, investors and industry partners to make that happen. This app, NTT, is where that work is planned, tracked and recognised.</p>
        <ul class="welcome-points">
          <li><b>Real founders, real problems</b><span>Work directly with startups on live business challenges.</span></li>
          <li><b>The whole startup lifecycle</b><span>Incubation, fundraising, strategy and operations, up close.</span></li>
          <li><b>Recognition for effort</b><span>Hours and finished work show up on the team leaderboard.</span></li>
        </ul>`,
    },
    {
      title: "Verticals",
      render: () => `
        <p class="welcome-kicker">Four verticals</p>
        <h2 class="welcome-title">Which team are you in?</h2>
        <p class="welcome-copy">Pick your vertical. It shows next to your name so seniors and teammates can find you.</p>
        <div class="welcome-verticals" role="radiogroup" aria-label="Your vertical">
          ${VERTICALS.map((v) => `
            <button type="button" class="welcome-vertical" role="radio" aria-checked="${state.form.vertical === v.key}" data-vertical="${v.key}">
              <span class="welcome-vertical-key">${v.key}</span>
              <b>${esc(v.name)}</b>
              <span>${esc(v.blurb)}</span>
            </button>`).join("")}
        </div>`,
    },
    {
      title: "How work flows",
      render: () => `
        <p class="welcome-kicker">How NTT works</p>
        <h2 class="welcome-title">From project to done, in six steps</h2>
        <ol class="welcome-flow">
          ${FLOW.map(([name, text], i) => `<li style="--i:${i}"><span class="welcome-flow-dot">${i + 1}</span><b>${esc(name)}</b><span>${esc(text)}</span></li>`).join("")}
        </ol>
        <div class="welcome-note">
          <b>What you'll see</b>
          <span>Your own tasks and every junior's work in full. For the senior team, you'll see their hours and recently finished work, so you can see the effort that goes in. Seniors can see everyone's progress so they can help when something is stuck.</span>
        </div>
        <div class="welcome-note is-soft">
          <b>Good habits</b>
          <span>Log hours on the day you work, post an update or link whenever you make progress, and send work for review as soon as it's ready. Your hours and finished tasks are what the leaderboard counts.</span>
        </div>`,
    },
    {
      title: "Your seniors",
      render: () => `
        <p class="welcome-kicker">Your senior team</p>
        <h2 class="welcome-title">The people who'll review your work</h2>
        <p class="welcome-copy">Seniors set up projects, assign tasks and review what you send. Reach out to them whenever you're stuck. You can always find everyone on the People page.</p>
        <ul class="welcome-seniors">
          ${state.seniors.length
            ? state.seniors.map((u) => `
              <li>${avatar(u.user_name, u.email)}<span><b>${esc(u.user_name || u.email)}</b><small>${esc(u.vertical || "Senior team")}</small></span></li>`).join("")
            : '<li class="welcome-empty">The senior team will appear here.</li>'}
        </ul>`,
    },
    {
      title: "Your profile",
      render: () => `
        <p class="welcome-kicker">Last step</p>
        <h2 class="welcome-title">Tell the team about you</h2>
        <form class="welcome-form" id="welcome-form" novalidate>
          <div class="field-group">
            <label for="wf-vertical">Vertical${isJunior() ? "" : " <span class=\"field-optional\">(optional)</span>"}</label>
            <select id="wf-vertical" name="vertical" ${isJunior() ? "required" : ""}>
              <option value="">Choose your vertical</option>
              ${VERTICALS.map((v) => `<option value="${v.key}" ${state.form.vertical === v.key ? "selected" : ""}>${v.key} · ${esc(v.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field-group">
            <label for="wf-roll">Roll number${isJunior() ? "" : " <span class=\"field-optional\">(optional)</span>"}</label>
            <input id="wf-roll" name="roll_no" type="text" maxlength="30" placeholder="B26182" value="${esc(state.form.roll_no)}" ${isJunior() ? "required" : ""} autocomplete="off">
          </div>
          <div class="field-group">
            <label for="wf-phone">WhatsApp number <span class="field-optional">(optional)</span></label>
            <input id="wf-phone" name="phone" type="text" inputmode="tel" maxlength="30" placeholder="98765 43210" value="${esc(state.form.phone)}" autocomplete="tel">
          </div>
          <div class="field-group">
            <label for="wf-linkedin">LinkedIn <span class="field-optional">(optional)</span></label>
            <input id="wf-linkedin" name="linkedin_url" type="url" maxlength="300" placeholder="linkedin.com/in/your-name" value="${esc(state.form.linkedin_url)}">
          </div>
          <div class="field-group">
            <label for="wf-skills">Skills and interests <span class="field-optional">(optional)</span></label>
            <textarea id="wf-skills" name="skills" rows="3" maxlength="500" placeholder="e.g. financial modelling, market research, design, fintech, healthtech">${esc(state.form.skills)}</textarea>
          </div>
          <p class="form-message is-error" id="welcome-error" role="alert">${esc(state.error)}</p>
        </form>`,
    },
  ];

  function hue(text) {
    let h = 0;
    for (const ch of String(text)) {
      h = (h * 31 + ch.charCodeAt(0)) % 360;
    }
    return h;
  }

  function avatar(name, email) {
    const initials =
      String(name || email || "?")
        .split(/[\s._@-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join("") || "?";
    const h = hue(email || name);
    return `<span class="people-avatar" style="--av-bg:hsl(${h} 60% 92%);--av-ink:hsl(${h} 45% 32%)" aria-hidden="true">${esc(initials)}</span>`;
  }

  /* ------------------------------------------------------------ render */

  function readForm() {
    const form = root.querySelector("#welcome-form");
    if (!form) {
      return;
    }
    const data = new FormData(form);
    Object.keys(state.form).forEach((key) => {
      state.form[key] = String(data.get(key) ?? "").trim();
    });
  }

  function draw(direction = 1) {
    const last = state.step === steps.length - 1;
    root.innerHTML = `
      <div class="welcome-card">
        <ol class="welcome-progress" aria-label="Progress">
          ${steps.map((s, i) => `<li class="${i < state.step ? "is-done" : i === state.step ? "is-now" : ""}"${i === state.step ? ' aria-current="step"' : ""}><span class="visually-hidden">${esc(s.title)}</span></li>`).join("")}
        </ol>
        <div class="welcome-body" style="--dir:${direction}">${steps[state.step].render()}</div>
        <div class="welcome-actions">
          ${state.step > 0 ? '<button type="button" class="btn btn-secondary" data-back>Back</button>' : '<span></span>'}
          <div class="welcome-actions-right">
            ${!isJunior() && !last ? '<a class="link-button" href="/post-login">Skip</a>' : ""}
            <button type="button" class="btn btn-primary" data-next ${state.saving ? "disabled" : ""}>${last ? (state.saving ? "Saving…" : "Finish") : state.step === 1 && !state.form.vertical ? "Skip for now" : "Next"}</button>
          </div>
        </div>
      </div>`;
    root.querySelector(".welcome-body h2")?.setAttribute("tabindex", "-1");
    root.querySelector(".welcome-body h2")?.focus({ preventScroll: true });
  }

  async function finish() {
    readForm();
    if (isJunior() && (!state.form.vertical || !state.form.roll_no)) {
      state.error = "Please choose your vertical and enter your roll number.";
      draw(0);
      return;
    }
    state.saving = true;
    state.error = "";
    draw(0);
    try {
      await patchAuthorizedJson("/me/profile", { ...state.form, mark_onboarded: true });
      try {
        window.sessionStorage.setItem("ntt_welcome_checked", "done");
        window.sessionStorage.removeItem("ntt_active_users");
      } catch (_error) {
        // Storage is optional.
      }
      window.NTTUI?.toast?.("Profile saved. Welcome aboard!");
      setTimeout(() => window.location.replace("/post-login"), 900);
    } catch (error) {
      state.saving = false;
      state.error = error.message || "Couldn't save. Please try again.";
      draw(0);
    }
  }

  root.addEventListener("click", (event) => {
    const vertical = event.target.closest("[data-vertical]");
    if (vertical) {
      state.form.vertical = vertical.dataset.vertical;
      window.NTTUI?.haptic?.(8);
      draw(0);
      return;
    }
    if (event.target.closest("[data-back]")) {
      readForm();
      state.step = Math.max(0, state.step - 1);
      draw(-1);
      return;
    }
    if (event.target.closest("[data-next]")) {
      if (state.step === steps.length - 1) {
        finish();
        return;
      }
      state.step += 1;
      draw(1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  async function load() {
    try {
      const [profile, users] = await Promise.all([
        getAuthorizedJson("/me/profile"),
        typeof getActiveUsers === "function" ? getActiveUsers() : getAuthorizedJson("/users"),
      ]);
      state.profile = profile;
      ["vertical", "roll_no", "phone", "linkedin_url", "skills"].forEach((key) => {
        state.form[key] = profile[key] || "";
      });
      if (!state.form.roll_no) {
        state.form.roll_no = guessRoll();
      }
      state.seniors = (users || [])
        .filter((u) => ["SENIOR", "ADMIN"].includes(String(u.user_class || "").toUpperCase()) && !/secretary|^admin$/i.test(u.user_name || ""))
        .sort((a, b) => String(a.user_name || "").localeCompare(String(b.user_name || "")));
    } catch (_error) {
      state.form.roll_no = guessRoll();
    }
    root.removeAttribute("aria-busy");
    draw();
  }

  document.addEventListener("DOMContentLoaded", load);
})();
