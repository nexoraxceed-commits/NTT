/*
 * People page: who is on the team, seniors and juniors, and what each person
 * has achieved in a chosen window (last 30 days by default).
 *
 * Merits for everyone: hours logged and tasks finished. Open and overdue
 * counts appear only where the viewer is allowed them: seniors see them for
 * everyone, juniors see them for juniors. (The server already withholds
 * seniors' open work from juniors; this page doesn't try to show it.)
 */
(function () {
  "use strict";

  const root = document.querySelector("#people-root");
  if (!root) {
    return;
  }

  const VERTICALS = {
    PSO: "Pipeline Sourcing & Outreach",
    VAD: "Venture Advisory & Development",
    IPR: "Investor & Partnership Relations",
    VOC: "Venture Operations & Compliance",
  };

  const state = {
    users: [],
    tasks: [],
    merit: [],
    group: "all",
    vertical: "all",
    query: "",
    start: null,
    end: null,
    open: null,
    loaded: false,
  };

  /* ------------------------------------------------------------- utils */

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const lower = (v) => String(v || "").trim().toLowerCase();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parseDay = (v) => {
    if (!v) {
      return null;
    }
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : startOfDay(d);
  };
  const isoDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoursText = (h) => `${Number((h || 0).toFixed(1))}h`;
  const shortDate = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const viewerEmail = () => lower(typeof getSession === "function" ? getSession()?.email : "");
  const viewerClass = () => String((typeof getSession === "function" ? getSession()?.userClass : "") || "").toUpperCase();
  const isSenior = (cls) => cls === "SENIOR" || cls === "ADMIN";

  function hue(text) {
    let h = 0;
    for (const ch of String(text)) {
      h = (h * 31 + ch.charCodeAt(0)) % 360;
    }
    return h;
  }

  function avatar(name, email, size = "") {
    const initials =
      String(name || email || "?")
        .split(/[\s._@-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join("") || "?";
    const h = hue(email || name);
    return `<span class="people-avatar ${size}" style="--av-bg:hsl(${h} 60% 92%);--av-ink:hsl(${h} 45% 32%)" aria-hidden="true">${esc(initials)}</span>`;
  }

  function closedOn(task) {
    const days = (task.access_logs || [])
      .filter((l) => l.event_type === "TASK_CLOSED" || String(l.new_status || "").toUpperCase() === "CLOSED")
      .map((l) => parseDay(l.created_at))
      .filter(Boolean)
      .sort((a, b) => b - a);
    return days[0] || null;
  }

  /* ------------------------------------------------------------- stats */

  function buildPeople() {
    const today = startOfDay(new Date());
    const from = state.start;
    const to = state.end;
    const map = new Map();
    state.users.forEach((u) => {
      const cls = String(u.user_class || "").toUpperCase();
      if (!u.email || cls === "REDUNDANT_USER") {
        return;
      }
      map.set(lower(u.email), {
        email: lower(u.email),
        name: u.user_name || u.email,
        cls,
        vertical: u.vertical || null,
        hours: 0,
        done: [],
        open: 0,
        overdue: 0,
        lastActive: null,
        daily: new Map(),
      });
    });
    const touch = (p, day) => {
      if (day && (!p.lastActive || day > p.lastActive)) {
        p.lastActive = day;
      }
    };
    const addLog = (log) => {
      const p = map.get(lower(log.logged_by_email));
      const day = parseDay(log.work_date);
      const hours = Number(log.hours || 0);
      if (!p || !day || !hours) {
        return;
      }
      touch(p, day);
      if (day >= from && day <= to) {
        p.hours += hours;
        const key = isoDay(day);
        p.daily.set(key, (p.daily.get(key) || 0) + hours);
      }
    };
    state.tasks.forEach((task) => {
      (task.work_logs || []).forEach(addLog);
      const p = map.get(lower(task.assigned_to_email));
      if (!p) {
        return;
      }
      const status = String(task.status || "").toUpperCase();
      if (status === "CLOSED") {
        const at = closedOn(task);
        touch(p, at);
        if (at && at >= from && at <= to) {
          p.done.push({ id: task.id, title: task.task_title, project: task.project_name, at });
        }
      } else {
        p.open += 1;
        const end = parseDay(task.end_date);
        if (end && end < today) {
          p.overdue += 1;
        }
      }
    });
    state.merit.forEach(addLog);
    return Array.from(map.values()).map((p) => {
      p.done.sort((a, b) => b.at - a.at);
      return p;
    });
  }

  function canSeeLoad(person) {
    const me = viewerClass();
    if (isSenior(me)) {
      return true;
    }
    return person.cls === "JUNIOR";
  }

  /* ------------------------------------------------------------ render */

  function spark(person) {
    const days = [];
    for (let d = state.start; d <= state.end; d = addDays(d, 1)) {
      days.push(person.daily.get(isoDay(d)) || 0);
    }
    const max = Math.max(1, ...days);
    const bars = days
      .slice(-45)
      .map((v) => `<i style="height:${v ? Math.max(12, (v / max) * 100) : 6}%" class="${v ? "on" : ""}"></i>`)
      .join("");
    return `<span class="pp-spark" aria-hidden="true">${bars}</span>`;
  }

  // Recency dot: green within 3 days, amber within 10, grey after.
  // Juniors only see it on juniors' cards.
  function pulse(person) {
    if (!person.lastActive || !canSeeLoad(person)) {
      return "";
    }
    const days = Math.round((startOfDay(new Date()) - person.lastActive) / 86400000);
    const tone = days <= 3 ? "is-fresh" : days <= 10 ? "is-recent" : "is-quiet";
    return `<i class="pp-pulse ${tone}" aria-hidden="true"></i>`;
  }

  function roleTag(cls) {
    return isSenior(cls)
      ? '<span class="role-tag is-senior">Senior</span>'
      : cls === "JUNIOR"
        ? '<span class="role-tag is-junior">Junior</span>'
        : "";
  }

  function card(person) {
    const me = person.email === viewerEmail();
    const open = state.open === person.email;
    const showLoad = canSeeLoad(person);
    const lastActive = person.lastActive
      ? `Active ${shortDate(person.lastActive)}`
      : "No activity yet";
    const vertical = "";
    const detail = open
      ? `<div class="pp-detail" id="people-detail-${esc(person.email)}">
          <p class="pp-detail-head">Finished in this window</p>
          ${person.done.length
            ? `<ul class="pp-done">${person.done
                .slice(0, 8)
                .map((t) => `<li><a href="/task?id=${encodeURIComponent(t.id)}">${esc(t.title)}</a><span>${esc(t.project || "")} · ${shortDate(t.at)}</span></li>`)
                .join("")}</ul>`
            : `<p class="pp-empty">No tasks finished in this window.</p>`}
          ${showLoad
            ? `<p class="pp-load">${person.open} open${person.overdue ? ` · <b>${person.overdue} overdue</b>` : ""}</p>`
            : ""}
        </div>`
      : "";
    return `
      <li class="pp-card${me ? " is-me" : ""}${open ? " is-open" : ""}">
        <button type="button" class="pp-card-btn" data-person="${esc(person.email)}" aria-expanded="${open}">
          ${avatar(person.name, person.email)}
          <span class="pp-main">
            <span class="pp-name">${esc(person.name)}${me ? " <em>you</em>" : ""}${roleTag(person.cls)}${vertical}</span>
            <span class="pp-sub">${pulse(person)}${esc(lastActive)}</span>
          </span>
          ${spark(person)}
          <span class="pp-stats">
            <span class="${person.hours ? "has-hours" : "is-zero"}"><b>${hoursText(person.hours)}</b><small>hours</small></span>
            <span class="${person.done.length ? "has-done" : "is-zero"}"><b>${person.done.length}</b><small>finished</small></span>
          </span>
        </button>
        ${detail}
      </li>`;
  }

  function section(title, sub, people, key = "") {
    if (!people.length) {
      return "";
    }
    const hours = people.reduce((t, p) => t + p.hours, 0);
    const done = people.reduce((t, p) => t + p.done.length, 0);
    return `
      <section class="pp-section${key ? ` is-${key}` : ""}">
        <header class="pp-section-head">
          <div>
            <h2>${esc(title)} <span>${people.length}</span></h2>
            <p>${esc(sub)}</p>
          </div>
          <p class="pp-section-total"><b>${hoursText(hours)}</b> logged · <b>${done}</b> finished</p>
        </header>
        <ul class="pp-list">${people.map(card).join("")}</ul>
      </section>`;
  }

  function chips(name, options, current) {
    return `<div class="pp-chips" role="group" aria-label="${esc(name)}">${options
      .map(([key, label]) => `<button type="button" data-${name}="${key}" aria-pressed="${current === key}">${esc(label)}</button>`)
      .join("")}</div>`;
  }

  function draw() {
    if (!state.loaded) {
      return;
    }
    const people = buildPeople()
      .filter((p) => state.vertical === "all" || p.vertical === state.vertical)
      .filter((p) => !state.query || lower(p.name).includes(state.query) || p.email.includes(state.query))
      .sort((a, b) => b.hours + b.done.length - (a.hours + a.done.length) || a.name.localeCompare(b.name));
    const seniors = people.filter((p) => isSenior(p.cls));
    const juniors = people.filter((p) => p.cls === "JUNIOR");
    const hasVerticals = state.users.some((u) => u.vertical);
    const days = Math.round((state.end - state.start) / 86400000) + 1;

    // Verticals are not decided yet, so there is no vertical filter for now.
    const verticalChips = "";

    root.innerHTML = `
      <div class="pp-toolbar">
        ${chips("group", [["all", "Everyone"], ["senior", "Seniors"], ["junior", "Juniors"]], state.group)}
        ${verticalChips}
        <label class="pp-search"><span class="visually-hidden">Search people</span>
          <input type="search" id="pp-search" placeholder="Search by name" value="${esc(state.query)}" autocomplete="off">
        </label>
      </div>
      <div class="pp-window">
        <span>Showing the last <b>${days} days</b></span>
        <label>From <input type="date" id="people-from" value="${isoDay(state.start)}" max="${isoDay(state.end)}"></label>
        <label>To <input type="date" id="people-to" value="${isoDay(state.end)}" max="${isoDay(startOfDay(new Date()))}"></label>
        <button type="button" class="link-button" data-reset-window>Last 30 days</button>
      </div>
      ${state.group !== "junior" ? section("Senior team", "Supervisors and admins who set up projects and review work", seniors, "seniors") : ""}
      ${state.group !== "senior" ? section("Juniors", "Members working on assigned projects and tasks", juniors, "juniors") : ""}
      ${!seniors.length && !juniors.length ? '<p class="empty-state">No one matches that search.</p>' : ""}`;
  }

  /* ------------------------------------------------------------ events */

  root.addEventListener("click", (event) => {
    const person = event.target.closest("[data-person]");
    if (person) {
      state.open = state.open === person.dataset.person ? null : person.dataset.person;
      draw();
      return;
    }
    const group = event.target.closest("[data-group]");
    if (group) {
      state.group = group.dataset.group;
      draw();
      return;
    }
    const vertical = event.target.closest("[data-vertical]");
    if (vertical) {
      state.vertical = vertical.dataset.vertical;
      draw();
      return;
    }
    if (event.target.closest("[data-reset-window]")) {
      resetWindow();
      draw();
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.id === "people-from" || event.target.id === "people-to") {
      const from = parseDay(root.querySelector("#people-from").value);
      const to = parseDay(root.querySelector("#people-to").value);
      if (from && to && from <= to) {
        state.start = from;
        state.end = to;
        draw();
      }
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.id === "pp-search") {
      state.query = lower(event.target.value);
      const pos = event.target.selectionStart;
      draw();
      const input = root.querySelector("#pp-search");
      input.focus();
      input.setSelectionRange(pos, pos);
    }
  });

  function resetWindow() {
    state.end = startOfDay(new Date());
    state.start = addDays(state.end, -29);
  }

  /* -------------------------------------------------------------- load */

  async function load() {
    try {
      const [users, dashboard] = await Promise.all([
        typeof getActiveUsers === "function" ? getActiveUsers() : getAuthorizedJson("/users"),
        getAuthorizedJson("/dashboard"),
      ]);
      state.users = users || [];
      state.tasks = (dashboard.project_details || []).flatMap((project) =>
        (project.tasks || []).map((task) => ({ ...task, project_name: project.project_name }))
      );
      state.merit = dashboard.merit_logs || [];
      state.loaded = true;
      root.removeAttribute("aria-busy");
      draw();
    } catch (error) {
      root.removeAttribute("aria-busy");
      root.innerHTML = `<p class="empty-state">People could not be loaded. ${esc(error.message || "")}</p>`;
    }
  }

  resetWindow();
  document.addEventListener("DOMContentLoaded", () => {
    load();
    if (typeof registerLiveRefreshJob === "function") {
      registerLiveRefreshJob("people", load, { intervalMs: 60000 });
    }
  });
})();
