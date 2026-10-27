/*
 * Welcome / intro for new members (shown to juniors on first sign-in, open to
 * everyone from the Guide). Short steps, ending with the profile form.
 */
(function () {
  "use strict";

  const root = document.querySelector("#welcome-root");
  if (!root) {
    return;
  }

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
    briefs: [],
    form: { roll_no: "", phone: "", linkedin_url: "", skills: "" },
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
      title: "How work flows",
      render: () => `
        <p class="welcome-kicker">How NTT works</p>
        <h2 class="welcome-title">From project to done, in six steps</h2>
        <ol class="welcome-flow">
          ${FLOW.map(([name, text], i) => `<li style="--i:${i}"><span class="welcome-flow-dot">${i + 1}</span><b>${esc(name)}</b><span>${esc(text)}</span></li>`).join("")}
        </ol>
        <div class="welcome-note is-soft">
          <b>Good habits</b>
          <span>Log hours on the day you work, post an update or link whenever you make progress, and send work for review as soon as it's ready. Your hours and finished tasks are what the leaderboard counts.</span>
        </div>`,
    },
    {
      title: "What's happening",
      render: () => `
        <p class="welcome-kicker">Live projects</p>
        <h2 class="welcome-title">What the team is working on right now</h2>
        <p class="welcome-copy">A quick look at the projects juniors are part of. Open any of them from the Projects page.</p>
        ${state.briefs.length
          ? `<ul class="welcome-briefs">${state.briefs.map(briefCard).join("")}</ul>`
          : '<p class="welcome-empty">Projects will appear here once you\'re added to a team.</p>'}`,
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
              <li>${avatar(u.user_name, u.email)}<span><b>${esc(u.user_name || u.email)}</b><small>Senior team</small></span></li>`).join("")
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

  function briefCard(b) {
    const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
    return `
      <li class="welcome-brief${b.mine ? " is-mine" : ""}">
        <div class="welcome-brief-head">
          <b>${esc(b.name)}</b>
          ${b.mine ? '<span class="welcome-brief-you">You\'re on this</span>' : ""}
        </div>
        ${b.about ? `<p>${esc(b.about)}</p>` : ""}
        <div class="welcome-brief-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <dl>
          <div><dt>Progress</dt><dd>${b.done}/${b.total} tasks done</dd></div>
          <div><dt>Next up</dt><dd>${esc(b.next)}</dd></div>
          ${b.team.length ? `<div><dt>Team</dt><dd>${esc(b.team.join(", "))}</dd></div>` : ""}
          ${b.reviewers.length ? `<div><dt>Reviewer</dt><dd>${esc(b.reviewers.join(", "))}</dd></div>` : ""}
        </dl>
      </li>`;
  }

  // Live projects that juniors are part of (a junior on the team). Seniors'
  // own side projects, onboarding and external work have no junior on the
  // team, so they stay out of the briefing.
  function buildBriefs(dashboard, users) {
    const me = String(session().email || "").toLowerCase();
    const classOf = new Map((users || []).map((u) => [String(u.email || "").toLowerCase(), String(u.user_class || "").toUpperCase()]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = (v) => {
      const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    };
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return (dashboard.project_details || [])
      .filter((p) => String(p.status || "").toUpperCase() !== "CLOSED")
      // The starter "NTT onboarding" project is their first task, not live work.
      .filter((p) => String(p.project_name || "").trim().toLowerCase() !== "ntt onboarding")
      .map((p) => {
        const team = (p.team || []).filter((t) => t.email);
        const juniors = team.filter((t) => classOf.get(String(t.email).toLowerCase()) === "JUNIOR");
        if (!juniors.length) {
          return null;
        }
        const tasks = p.tasks || [];
        const open = tasks.filter((t) => String(t.status || "").toUpperCase() !== "CLOSED");
        const dated = open
          .map((t) => ({ t, d: day(t.end_date) }))
          .filter((x) => x.d && x.d >= today)
          .sort((a, b) => a.d - b.d);
        let next;
        if (!tasks.length) {
          next = "Tasks are being set up";
        } else if (!open.length) {
          next = "All current tasks are done";
        } else if (dated[0]) {
          next = `"${dated[0].t.task_title}" by ${dated[0].d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
        } else {
          next = `${open.length} task${open.length === 1 ? "" : "s"} in progress`;
        }
        const about = String(p.description || "").trim().split(/(?<=[.!?])\s+/)[0].slice(0, 160);
        return {
          name: p.project_name,
          about,
          total: tasks.length,
          done: tasks.length - open.length,
          next,
          mine: team.some((t) => String(t.email).toLowerCase() === me),
          team: juniors.map((t) => t.user_name || t.email).slice(0, 4),
          reviewers: (p.supervisors || []).map((x) => x.user_name || x.email).filter(Boolean).slice(0, 2),
          rank: rank[String(p.priority || "").toUpperCase()] ?? 3,
          soon: dated[0] ? dated[0].d.getTime() : Infinity,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.rank - b.rank || a.soon - b.soon)
      .slice(0, 6);
  }

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
            <button type="button" class="btn btn-primary" data-next ${state.saving ? "disabled" : ""}>${last ? (state.saving ? "Saving…" : "Finish") : "Next"}</button>
          </div>
        </div>
      </div>`;
    root.querySelector(".welcome-body h2")?.setAttribute("tabindex", "-1");
    root.querySelector(".welcome-body h2")?.focus({ preventScroll: true });
  }

  async function finish() {
    readForm();
    if (isJunior() && !state.form.roll_no) {
      state.error = "Please enter your roll number.";
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
      ["roll_no", "phone", "linkedin_url", "skills"].forEach((key) => {
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
    try {
      const [dashboard, users] = await Promise.all([
        getAuthorizedJson("/dashboard"),
        typeof getActiveUsers === "function" ? getActiveUsers() : getAuthorizedJson("/users"),
      ]);
      state.briefs = buildBriefs(dashboard, users);
    } catch (_error) {
      state.briefs = [];
    }
    root.removeAttribute("aria-busy");
    draw();
  }

  document.addEventListener("DOMContentLoaded", load);
})();
