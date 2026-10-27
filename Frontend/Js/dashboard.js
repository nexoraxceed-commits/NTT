/*
 * NTT dashboard (post-login page).
 *
 * Draws the dashboard from the same /dashboard payload the old page used, plus
 * the user's notifications for @mentions. It only reads data; nothing here
 * writes to the backend except marking a notification read when it is opened
 * (the same call the notification tray already makes).
 *
 * app.js calls window.renderNttDashboard(container, projectDetails) on every
 * load and live refresh. View state (My work / Team, the open status list,
 * the hours range) lives here so a refresh never resets what the user picked.
 */
(function () {
  "use strict";

  const DAY_MS = 86400000;
  const SCOPE_KEY = "ntt-dashboard-scope";
  const NOTIFICATION_TTL_MS = 30000;
  const STATUS_ORDER = ["open", "progress", "overdue", "closed"];
  const STATUS = {
    open: {
      label: "To do",
      filter: "OPEN",
      color: "var(--st-open)",
      icon: '<circle cx="12" cy="12" r="8.5"/>',
    },
    progress: {
      label: "In progress",
      filter: "IN PROGRESS",
      color: "var(--st-progress)",
      icon: '<path d="M20.5 12a8.5 8.5 0 1 1-5.8-8.06"/><path d="M20.5 4v4.5H16"/>',
    },
    overdue: {
      label: "Overdue",
      filter: "OVERDUE",
      color: "var(--st-overdue)",
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5"/><path d="M12 16.2h.01"/>',
    },
    closed: {
      label: "Done",
      filter: "CLOSED",
      color: "var(--st-closed)",
      icon: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.6 2.6 5-5.6"/>',
    },
  };
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)"];
  const OTHER = "var(--s-other)";

  const state = {
    scope: readScope(),
    open: null,
    hours: "week",
    customStart: "",
    customEnd: "",
    notifications: null,
    notificationsFetchedAt: 0,
    leaderPeriod: "month",
    users: null,
    container: null,
    details: [],
  };

  /* ------------------------------------------------------------------ utils */

  function readScope() {
    try {
      const saved = window.localStorage.getItem(SCOPE_KEY);
      return saved === "me" ? "me" : "team";
    } catch (_error) {
      return "team";
    }
  }

  function saveScope(scope) {
    try {
      window.localStorage.setItem(SCOPE_KEY, scope);
    } catch (_error) {
      // Remembering the choice is a convenience only.
    }
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function lower(value) {
    return String(value || "").trim().toLowerCase();
  }

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseDay(value) {
    if (!value) {
      return null;
    }
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
  }

  function shortDate(date) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function weekStart(date) {
    const day = startOfDay(date);
    const offset = (day.getDay() + 6) % 7; // Monday = 0
    return addDays(day, -offset);
  }

  function formatHours(hours) {
    const minutes = Math.round(hours * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `<span class="dash-hero-num">${h}<small>h</small>${m ? ` ${String(m).padStart(2, "0")}<small>m</small>` : ""}</span>`;
  }

  function hoursText(hours) {
    return `${Number(hours.toFixed(1))}h`;
  }

  function hue(text) {
    let hash = 0;
    for (const char of String(text || "?")) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash % 360;
  }

  function avatar(name, email) {
    const label = String(name || email || "?").trim();
    const initials = label
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?";
    const h = hue(email || label);
    return `<span class="dash-avatar" style="--av-bg:hsl(${h} 60% 92%);--av-ink:hsl(${h} 45% 32%)" aria-hidden="true">${esc(initials)}</span>`;
  }

  function icon(paths, extraClass = "") {
    return `<svg class="dash-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  /* ------------------------------------------------------------- task model */

  function currentEmail() {
    return lower(typeof getSession === "function" ? getSession()?.email : "");
  }

  function assigneesOf(task) {
    if (typeof getTaskAssigneeList === "function") {
      return getTaskAssigneeList(task);
    }
    return [{ name: task.assigned_to_name || task.assigned_to_email, email: task.assigned_to_email }];
  }

  function isAssignee(task, email) {
    return Boolean(email) && assigneesOf(task).some((a) => lower(a.email) === email);
  }

  function isStakeholder(task, email) {
    return Boolean(email) && lower(task.stakeholder_email) === email;
  }

  function isMine(task, email) {
    return isAssignee(task, email) || isStakeholder(task, email);
  }

  function isWatching(task, email) {
    return (
      Boolean(email) &&
      !isMine(task, email) &&
      (task.watchers || []).some((w) => lower(w.email) === email)
    );
  }

  function bucketOf(task, today) {
    const status = String(task.status || "OPEN").toUpperCase();
    if (status === "CLOSED") {
      return "closed";
    }
    const end = parseDay(task.end_date);
    if (end && end < today) {
      return "overdue";
    }
    if (status === "IN PROGRESS" || status === "CLOSE REQUESTED") {
      return "progress";
    }
    return "open";
  }

  function closedOn(task) {
    const logs = (task.access_logs || []).filter(
      (log) => log.event_type === "TASK_CLOSED" || String(log.new_status || "").toUpperCase() === "CLOSED"
    );
    const latest = logs
      .map((log) => parseDay(log.created_at))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    return latest || null;
  }

  function createdOn(task) {
    const created = (task.access_logs || []).find((log) => log.event_type === "TASK_CREATED");
    return parseDay(created?.created_at) || parseDay(task.start_date);
  }

  function lastActivity(task, email) {
    return (task.access_logs || [])
      .filter((log) => lower(log.actor_email) !== email && log.created_at)
      .map((log) => ({ log, at: new Date(log.created_at) }))
      .filter((item) => !Number.isNaN(item.at.getTime()))
      .sort((a, b) => b.at - a.at)[0] || null;
  }

  function flattenTasks(details) {
    return details.flatMap((project) =>
      (project.tasks || []).map((task) => ({
        ...task,
        project_name: project.project_name,
        project_id: task.project_id ?? project.id,
      }))
    );
  }

  function myName(tasks, email) {
    for (const task of tasks) {
      for (const person of assigneesOf(task)) {
        if (lower(person.email) === email && person.name && lower(person.name) !== email) {
          return person.name;
        }
      }
      if (lower(task.stakeholder_email) === email && task.stakeholder_name) {
        return task.stakeholder_name;
      }
    }
    const local = email.split("@")[0] || "";
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
  }

  function greeting(now) {
    const hour = now.getHours();
    if (hour < 12) {
      return "Good morning";
    }
    if (hour < 17) {
      return "Good afternoon";
    }
    return "Good evening";
  }

  /* -------------------------------------------------------- notifications */

  function refreshNotifications() {
    if (typeof getAuthorizedJson !== "function") {
      return;
    }
    if (Date.now() - state.notificationsFetchedAt < NOTIFICATION_TTL_MS) {
      return;
    }
    state.notificationsFetchedAt = Date.now();
    getAuthorizedJson("/notifications")
      .then((list) => {
        state.notifications = Array.isArray(list) ? list : [];
        draw();
      })
      .catch(() => {
        state.notifications = state.notifications || [];
      });
  }

  function taskIdFromUrl(url) {
    const match = String(url || "").match(/[?&]id=(\d+)/);
    return match && /\/task\b/.test(url) ? Number(match[1]) : null;
  }

  /* ------------------------------------------------------------ sections */

  function renderHead(name, scope, now) {
    const title = scope === "me" ? `${greeting(now)}${name ? `, ${esc(name)}` : ""}` : "Team overview";
    const sub =
      scope === "me"
        ? "Tasks you own or are the stakeholder for, and the hours you logged."
        : "Everything the team is working on right now.";
    const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    return `
      <div class="dash-head">
        <div class="dash-head-copy">
          <p class="dash-date">${esc(dateLabel)}</p>
          <h1 class="dash-title">${title}</h1>
          <p class="dash-sub">${sub}</p>
        </div>
        <div class="dash-seg" role="group" aria-label="Whose work to show">
          <button type="button" data-dash-scope="me" aria-pressed="${scope === "me"}">
            ${icon('<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>')}My work
          </button>
          <button type="button" data-dash-scope="team" aria-pressed="${scope === "team"}">
            ${icon('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M15.5 5.3a3.2 3.2 0 0 1 0 6.4"/><path d="M17.5 13.8a6 6 0 0 1 3.5 5.7"/>')}Team
          </button>
        </div>
      </div>`;
  }

  function kpiMeta(key, list, today) {
    if (key === "open") {
      const soon = list.filter((t) => {
        const end = parseDay(t.end_date);
        return end && daysBetween(today, end) <= 7;
      }).length;
      return { text: soon ? `${soon} due this week` : "Nothing due this week", tone: "flat" };
    }
    if (key === "progress") {
      const review = list.filter((t) => String(t.status).toUpperCase() === "CLOSE REQUESTED").length;
      return { text: review ? `${review} in review` : "Being worked on", tone: review ? "review" : "flat" };
    }
    if (key === "overdue") {
      const oldest = list.reduce((max, t) => {
        const end = parseDay(t.end_date);
        return end ? Math.max(max, daysBetween(end, today)) : max;
      }, 0);
      return { text: oldest ? `Oldest is ${oldest} day${oldest === 1 ? "" : "s"} late` : "All on time", tone: oldest ? "bad" : "good" };
    }
    const thisWeek = list.filter((t) => {
      const at = closedOn(t);
      return at && daysBetween(at, today) < 7;
    }).length;
    const lastWeek = list.filter((t) => {
      const at = closedOn(t);
      const gap = at ? daysBetween(at, today) : -1;
      return gap >= 7 && gap < 14;
    }).length;
    if (!thisWeek && !lastWeek) {
      return { text: "None closed in the last two weeks", tone: "flat" };
    }
    const up = thisWeek >= lastWeek;
    return { text: `${up ? "↑" : "↓"} ${thisWeek} closed this week`, tone: up ? "good" : "bad" };
  }

  function renderKpis(buckets, today) {
    return `<section class="dash-kpis" aria-label="Tasks by status">${STATUS_ORDER.map((key) => {
      const list = buckets[key];
      const meta = kpiMeta(key, list, today);
      const isOpen = state.open === key;
      return `
        <button type="button" class="dash-kpi is-${key}" data-dash-kpi="${key}" aria-expanded="${isOpen}" aria-controls="dash-drawer">
          <span class="dash-kpi-top">
            <span class="dash-kpi-label">${icon(STATUS[key].icon)}${STATUS[key].label}</span>
            <span class="dash-chev" aria-hidden="true">${icon('<path d="m6 9 6 6 6-6"/>')}</span>
          </span>
          <span class="dash-kpi-num">${list.length}</span>
          <span class="dash-kpi-meta tone-${meta.tone}">${esc(meta.text)}</span>
        </button>`;
    }).join("")}</section>`;
  }

  function dueLabel(task, key, today) {
    if (key === "closed") {
      const at = closedOn(task);
      return { text: at ? `Closed ${shortDate(at)}` : "Closed", tone: "" };
    }
    const end = parseDay(task.end_date);
    if (!end) {
      return { text: "No due date", tone: "muted" };
    }
    const diff = daysBetween(today, end);
    if (diff < 0) {
      return { text: `${-diff}d late`, tone: "late" };
    }
    if (diff === 0) {
      return { text: "Due today", tone: "soon" };
    }
    if (diff === 1) {
      return { text: "Tomorrow", tone: "soon" };
    }
    return { text: shortDate(end), tone: diff <= 3 ? "soon" : "" };
  }

  function renderDrawer(buckets, today) {
    const key = state.open;
    if (!key) {
      return "";
    }
    const all = buckets[key].slice().sort((a, b) => {
      if (key === "closed") {
        return (closedOn(b) || 0) - (closedOn(a) || 0);
      }
      return (parseDay(a.end_date) || Infinity) - (parseDay(b.end_date) || Infinity);
    });
    const limit = window.matchMedia("(max-width: 700px)").matches ? 8 : 12;
    const shown = all.slice(0, limit);
    const rows = shown.map((task) => {
      const due = dueLabel(task, key, today);
      const owner = assigneesOf(task)[0] || {};
      const review = String(task.status).toUpperCase() === "CLOSE REQUESTED";
      return `
        <li>
          <a class="dash-row" href="/task?id=${encodeURIComponent(task.id)}">
            <span class="dash-row-dot" style="background:${STATUS[key].color}"></span>
            <span class="dash-row-main">
              <span class="dash-row-title">${esc(task.task_title || `Task #${task.id}`)}</span>
              <span class="dash-row-sub">${esc(task.project_name || "")}${review ? ' · <em class="dash-review">In review</em>' : ""}</span>
            </span>
            <span class="dash-row-owner" title="${esc(owner.name || owner.email || "Unassigned")}">${avatar(owner.name, owner.email)}</span>
            <span class="dash-row-due tone-${due.tone}">${esc(due.text)}</span>
          </a>
        </li>`;
    }).join("");
    const scopeText = state.scope === "me" ? "Yours" : "Whole team";
    const more = all.length > shown.length ? `Showing ${shown.length} of ${all.length}` : `${all.length} task${all.length === 1 ? "" : "s"}`;
    const boardUrl = typeof getTaskStatusFilterUrl === "function" ? getTaskStatusFilterUrl(STATUS[key].filter) : "/tasks";
    return `
      <section class="dash-drawer is-${key}" id="dash-drawer" aria-label="${STATUS[key].label} tasks">
        <header class="dash-drawer-head">
          <h2>${STATUS[key].label} <span>${esc(scopeText)} · ${esc(more)}</span></h2>
          <div class="dash-drawer-actions">
            <a class="dash-link" href="${esc(boardUrl)}">Open in Tasks</a>
            <button type="button" class="dash-close" data-dash-close aria-label="Close list">${icon('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
          </div>
        </header>
        ${all.length
          ? `<ul class="dash-rows">${rows}</ul>`
          : `<p class="dash-empty">No ${STATUS[key].label.toLowerCase()} tasks ${state.scope === "me" ? "on your plate" : "right now"}.</p>`}
      </section>`;
  }

  function buildNudges(tasks, email, today) {
    const items = [];
    const seen = new Set();
    const tasksById = new Map(tasks.map((t) => [Number(t.id), t]));

    tasks.forEach((task) => {
      if (String(task.status).toUpperCase() === "CLOSE REQUESTED" && isStakeholder(task, email)) {
        const owner = assigneesOf(task)[0] || {};
        const who = lower(owner.email) === email ? "You" : owner.name || "The assignee";
        items.push({
          rank: 0,
          kind: "review",
          tag: "Review & close",
          title: task.task_title,
          sub: `${who} asked to close this · ${task.project_name}`,
          href: `/task?id=${task.id}`,
          taskId: Number(task.id),
        });
        seen.add(Number(task.id));
      }
    });

    (state.notifications || [])
      .filter((n) => String(n.status).toUpperCase() === "UNREAD" && /mentioned you/i.test(n.subject || ""))
      .forEach((n) => {
        const taskId = taskIdFromUrl(n.target_url);
        const task = taskId ? tasksById.get(taskId) : null;
        if (taskId && seen.has(taskId)) {
          return;
        }
        items.push({
          rank: 1,
          kind: "mention",
          tag: "Mentioned you",
          title: task?.task_title || String(n.body || n.subject).replace(/^.*mentioned you in\s*/i, "").replace(/^"|"\.?$/g, ""),
          sub: `${String(n.subject || "").replace(/\s*mentioned you$/i, "")} wants your input${task ? ` · ${task.project_name}` : ""}`,
          href: n.target_url || "/notifications",
          notificationId: n.id,
          taskId,
        });
        if (taskId) {
          seen.add(taskId);
        }
      });

    tasks.forEach((task) => {
      if (!isWatching(task, email) || seen.has(Number(task.id)) || String(task.status).toUpperCase() === "CLOSED") {
        return;
      }
      const end = parseDay(task.end_date);
      const late = end && end < today ? daysBetween(end, today) : 0;
      const recent = lastActivity(task, email);
      const recentDays = recent ? daysBetween(recent.at, today) : 99;
      if (!late && recentDays > 3) {
        return;
      }
      const what = recent && recentDays <= 3
        ? {
            TASK_COMMENT_ADDED: "new comment",
            TASK_CLOSE_REQUESTED: "close requested",
            TASK_WORK_LOGGED: "work logged",
            TASK_ASSIGNEE_CHANGED: "reassigned",
            TASK_DUE_DATE_CHANGED: "due date moved",
          }[recent.log.event_type] || "updated"
        : null;
      items.push({
        rank: late ? 2 : 3,
        kind: "watch",
        tag: "Watching",
        title: task.task_title,
        sub: [
          late ? `${late} day${late === 1 ? "" : "s"} late` : null,
          what ? `${what} by ${recent.log.actor_name || "a teammate"}` : null,
          task.project_name,
        ].filter(Boolean).join(" · "),
        href: `/task?id=${task.id}`,
        taskId: Number(task.id),
      });
      seen.add(Number(task.id));
    });

    return items.sort((a, b) => a.rank - b.rank);
  }

  function renderNudges(items) {
    const shown = items.slice(0, 5);
    const body = shown.length
      ? `<ul class="dash-nudges">${shown.map((item) => `
          <li>
            <a class="dash-nudge is-${item.kind}" href="${esc(item.href)}"${item.notificationId ? ` data-dash-notification="${esc(item.notificationId)}"` : ""}>
              <span class="dash-nudge-icon">${icon(
                item.kind === "review"
                  ? '<path d="m8 12.5 2.8 2.8L16.5 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="5"/>'
                  : item.kind === "mention"
                    ? '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 6.9"/>'
                    : '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'
              )}</span>
              <span class="dash-nudge-main">
                <span class="dash-nudge-title">${esc(item.title)}</span>
                <span class="dash-nudge-sub">${esc(item.sub)}</span>
              </span>
              <span class="dash-tag is-${item.kind}">${esc(item.tag)}</span>
            </a>
          </li>`).join("")}</ul>${items.length > shown.length ? `<p class="dash-foot"><a href="/notifications">${items.length - shown.length} more in Notifications</a></p>` : ""}`
      : `<p class="dash-calm">${icon('<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.6 2.6 5-5.6"/>')}You're all caught up. Close requests, @mentions and activity on tasks you watch will show up here.</p>`;
    return `
      <article class="dash-card dash-attention">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Needs your attention</p>
            <p class="dash-card-sub">Reviews, mentions and tasks you watch</p>
          </div>
          ${items.length ? `<span class="dash-count">${items.length}</span>` : ""}
        </header>
        ${body}
      </article>`;
  }

  function renderDueNext(scoped, today) {
    const upcoming = scoped
      .filter((t) => {
        if (String(t.status).toUpperCase() === "CLOSED") {
          return false;
        }
        const end = parseDay(t.end_date);
        return end && end >= today && daysBetween(today, end) <= 7;
      })
      .sort((a, b) => parseDay(a.end_date) - parseDay(b.end_date));
    const shown = upcoming.slice(0, 5);
    const list = shown.length
      ? `<ul class="dash-due">${shown.map((task) => {
          const end = parseDay(task.end_date);
          const diff = daysBetween(today, end);
          const owner = assigneesOf(task)[0] || {};
          return `
            <li>
              <a href="/task?id=${encodeURIComponent(task.id)}">
                <span class="dash-cal ${diff <= 2 ? "is-soon" : ""}"><b>${end.getDate()}</b><span>${esc(end.toLocaleDateString(undefined, { month: "short" }))}</span></span>
                <span class="dash-due-main">
                  <span class="dash-due-title">${esc(task.task_title)}</span>
                  <span class="dash-due-sub">${esc(lower(owner.email) === currentEmail() ? "You" : owner.name || "Unassigned")} · ${esc(task.project_name)}</span>
                </span>
                <span class="dash-due-when">${diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `${diff} days`}</span>
              </a>
            </li>`;
        }).join("")}</ul>${upcoming.length > shown.length ? `<p class="dash-foot">${upcoming.length - shown.length} more due this week</p>` : ""}`
      : `<p class="dash-calm">${icon('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>')}Nothing due in the next 7 days.</p>`;
    return `
      <article class="dash-card">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Due next</p>
            <p class="dash-card-sub">${state.scope === "me" ? "Your deadlines" : "Team deadlines"} in the next 7 days</p>
          </div>
        </header>
        ${list}
      </article>`;
  }

  /* ---------------------------------------------------------------- hours */

  function scopedLogs(tasks, email) {
    const logs = [];
    tasks.forEach((task) => {
      (task.work_logs || []).forEach((log) => {
        const day = parseDay(log.work_date);
        const hours = Number(log.hours || 0);
        if (!day || !hours) {
          return;
        }
        if (state.scope === "me" && lower(log.logged_by_email) !== email) {
          return;
        }
        logs.push({
          day,
          hours,
          person: log.logged_by_name || log.logged_by_email || "Unknown",
          personEmail: lower(log.logged_by_email),
          project: task.project_name || "No project",
        });
      });
    });
    return logs;
  }

  function groupKey(log) {
    return state.scope === "me" ? log.project : log.person;
  }

  function sumHours(logs, from, to) {
    return logs.reduce((total, log) => (log.day >= from && log.day <= to ? total + log.hours : total), 0);
  }

  function hoursRange(today) {
    if (state.hours === "lastweek") {
      const start = addDays(weekStart(today), -7);
      return { start, end: addDays(start, 6), kind: "week" };
    }
    if (state.hours === "month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: new Date(today.getFullYear(), today.getMonth() + 1, 0), kind: "totals" };
    }
    if (state.hours === "custom") {
      const start = parseDay(state.customStart) || new Date(today.getFullYear(), today.getMonth(), 1);
      const end = parseDay(state.customEnd) || today;
      return { start, end, kind: "totals" };
    }
    const start = weekStart(today);
    return { start, end: addDays(start, 6), kind: "week" };
  }

  function renderHours(logs, today) {
    const range = hoursRange(today);
    const inRange = logs.filter((log) => log.day >= range.start && log.day <= range.end);
    const totals = new Map();
    inRange.forEach((log) => totals.set(groupKey(log), (totals.get(groupKey(log)) || 0) + log.hours));
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const total = inRange.reduce((sum, log) => sum + log.hours, 0);

    const tabs = [
      ["week", "This week"],
      ["lastweek", "Last week"],
      ["month", "Month"],
      ["custom", "Custom"],
    ].map(([key, label]) => `<button type="button" data-dash-hours="${key}" aria-pressed="${state.hours === key}">${label}</button>`).join("");

    let hero = "";
    let delta = "";
    let chart = "";
    let legend = "";

    if (range.kind === "week") {
      const isCurrent = state.hours === "week";
      const elapsed = isCurrent ? Math.min(7, daysBetween(range.start, today) + 1) : 7;
      hero = `${formatHours(total / elapsed)}<span class="dash-hero-unit">daily average</span>`;
      const prevStart = addDays(range.start, -7);
      const prevTotal = sumHours(logs, prevStart, addDays(prevStart, elapsed - 1));
      if (prevTotal > 0) {
        const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
        const up = pct >= 0;
        delta = `<p class="dash-delta tone-${up ? "good" : "bad"}">${up ? "↑" : "↓"} ${Math.abs(pct)}% vs the same days a week earlier · ${hoursText(total)} total</p>`;
      } else {
        delta = `<p class="dash-delta tone-flat">${hoursText(total)} total${isCurrent ? " so far this week" : ""}</p>`;
      }

      const top = ranked.slice(0, 3).map(([key]) => key);
      const groups = top.concat(ranked.length > 3 ? ["Other"] : []);
      const colorOf = (group) => (group === "Other" ? OTHER : SERIES[top.indexOf(group)]);
      const days = Array.from({ length: 7 }, (_, i) => addDays(range.start, i));
      const columns = days.map((day) => {
        const row = Object.fromEntries(groups.map((g) => [g, 0]));
        inRange.filter((log) => dateKey(log.day) === dateKey(day)).forEach((log) => {
          const group = top.includes(groupKey(log)) ? groupKey(log) : "Other";
          row[group] += log.hours;
        });
        return { day, row, total: Object.values(row).reduce((a, b) => a + b, 0) };
      });
      const maxValue = Math.max(4, ...columns.map((c) => c.total));
      const step = maxValue > 16 ? 8 : maxValue > 8 ? 4 : 2;
      const ceiling = Math.ceil(maxValue / step) * step;
      const gridLines = [];
      for (let v = 0; v <= ceiling; v += step) {
        gridLines.push(`<span class="dash-gridline" style="bottom:${(v / ceiling) * 100}%"><em>${v}h</em></span>`);
      }
      chart = `
        <div class="dash-cols" role="img" aria-label="Hours logged per day, ${esc(shortDate(range.start))} to ${esc(shortDate(range.end))}">
          <div class="dash-cols-plot">
            ${gridLines.join("")}
            ${columns.map((col, i) => {
              const isToday = dateKey(col.day) === dateKey(today);
              const segs = groups
                .filter((g) => col.row[g] > 0)
                .map((g) => `<span class="dash-seg-fill" style="height:${(col.row[g] / ceiling) * 100}%;background:${colorOf(g)}"></span>`)
                .join("");
              const tip = encodeURIComponent(JSON.stringify({
                title: col.day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
                rows: groups.filter((g) => col.row[g] > 0).map((g) => [g, hoursText(col.row[g]), colorOf(g)]),
                total: hoursText(col.total),
              }));
              return `<span class="dash-col${isToday ? " is-today" : ""}" data-dash-tip="${tip}" style="grid-column:${i + 1}">${segs}</span>`;
            }).join("")}
          </div>
          <div class="dash-cols-x">${days.map((day) => `<span class="${dateKey(day) === dateKey(today) ? "is-today" : ""}">${esc(day.toLocaleDateString(undefined, { weekday: "narrow" }))}</span>`).join("")}</div>
        </div>`;
      legend = groups.length
        ? `<div class="dash-legend">${groups.map((g) => `<span><i style="background:${colorOf(g)}"></i>${esc(g)}</span>`).join("")}</div>`
        : "";
    } else {
      hero = `${formatHours(total)}<span class="dash-hero-unit">logged</span>`;
      delta = `<p class="dash-delta tone-flat">${esc(shortDate(range.start))} – ${esc(shortDate(range.end))}${ranked.length ? ` · ${ranked.length} ${state.scope === "me" ? (ranked.length === 1 ? "project" : "projects") : (ranked.length === 1 ? "person" : "people")}` : ""}</p>`;
      const max = Math.max(1, ...ranked.map(([, h]) => h));
      chart = ranked.length
        ? `<div class="dash-hbars">${ranked.slice(0, 8).map(([name, hours]) => `
            <div class="dash-hbar">
              <span class="dash-hbar-name">${esc(name)}</span>
              <span class="dash-hbar-track"><span style="width:${Math.max((hours / max) * 100, 2)}%"></span></span>
              <span class="dash-hbar-val">${hoursText(hours)}</span>
            </div>`).join("")}</div>`
        : "";
    }

    const custom = state.hours === "custom"
      ? `<div class="dash-range">
          <label>From <input type="date" id="dash-range-start" value="${esc(state.customStart || dateKey(range.start))}"></label>
          <label>To <input type="date" id="dash-range-end" value="${esc(state.customEnd || dateKey(range.end))}"></label>
          <button type="button" class="btn btn-secondary btn-sm" data-dash-range-apply>Apply</button>
          <span class="dash-range-msg" role="status" aria-live="polite"></span>
        </div>`
      : "";

    const empty = !inRange.length
      ? `<p class="dash-calm">${icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>')}No hours logged ${state.scope === "me" ? "by you " : ""}in this period. Log work from any task page.</p>`
      : "";

    return `
      <article class="dash-card dash-hours">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Hours logged</p>
            <p class="dash-card-sub">${state.scope === "me" ? "Your work log, by project" : "Team work log, by person"}</p>
          </div>
          <div class="dash-tabs" role="group" aria-label="Period">${tabs}</div>
        </header>
        ${custom}
        <div class="dash-hero">${hero}</div>
        ${delta}
        ${empty || chart + legend}
      </article>`;
  }

  /* ------------------------------------------------------ workload split */

  function renderSplit(scoped, today) {
    const byKey = new Map();
    scoped.forEach((task) => {
      const keys = state.scope === "me"
        ? [task.project_name || "No project"]
        : assigneesOf(task).map((a) => a.name || a.email || "Unassigned");
      keys.forEach((key) => {
        if (!byKey.has(key)) {
          byKey.set(key, { open: 0, progress: 0, overdue: 0, closed: 0, total: 0 });
        }
        const entry = byKey.get(key);
        entry[bucketOf(task, today)] += 1;
        entry.total += 1;
      });
    });
    const rows = Array.from(byKey.entries()).sort((a, b) => b[1].total - a[1].total);
    const max = Math.max(1, ...rows.map(([, e]) => e.total));
    const order = ["closed", "progress", "open", "overdue"];
    const body = rows.length
      ? `<div class="dash-split">${rows.map(([name, entry]) => {
          const tip = encodeURIComponent(JSON.stringify({
            title: name,
            rows: order.map((k) => [STATUS[k].label, String(entry[k]), STATUS[k].color]),
            total: String(entry.total),
          }));
          return `
            <div class="dash-split-row">
              <span class="dash-split-name">${esc(name)}</span>
              <span class="dash-split-track" data-dash-tip="${tip}" aria-label="${esc(name)}: ${entry.total} tasks">
                ${order.filter((k) => entry[k] > 0).map((k) => `<span style="width:calc(${(entry[k] / max) * 100}% - 2px);background:${STATUS[k].color}"></span>`).join("")}
              </span>
              <span class="dash-split-total">${entry.total}</span>
            </div>`;
        }).join("")}</div>
        <div class="dash-legend">${order.map((k) => `<span><i style="background:${STATUS[k].color}"></i>${STATUS[k].label}</span>`).join("")}</div>`
      : `<p class="dash-calm">No tasks yet.</p>`;
    return `
      <article class="dash-card dash-split-card">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">${state.scope === "me" ? "My tasks by project" : "Tasks by assignee"}</p>
            <p class="dash-card-sub">${state.scope === "me" ? "Where your work sits, by status" : "Who holds what, by status"}</p>
          </div>
        </header>
        ${body}
      </article>`;
  }

  /* --------------------------------------------------------------- trend */

  function renderTrend(scoped, today) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const days = Array.from({ length: daysBetween(start, today) + 1 }, (_, i) => addDays(start, i));
    const values = days.map((day) =>
      scoped.filter((task) => {
        const created = createdOn(task);
        if (created && created > day) {
          return false;
        }
        const closed = closedOn(task);
        if (String(task.status).toUpperCase() === "CLOSED" && !closed) {
          return false;
        }
        return !closed || closed > day;
      }).length
    );
    const now = values[values.length - 1] || 0;
    const first = values[0] || 0;
    const diff = now - first;
    const monthName = start.toLocaleDateString(undefined, { month: "long" });
    const delta = diff === 0
      ? `<p class="dash-delta tone-flat">Same as on 1 ${esc(monthName)}</p>`
      : `<p class="dash-delta tone-${diff < 0 ? "good" : "bad"}">${diff < 0 ? "↓" : "↑"} ${Math.abs(diff)} since 1 ${esc(monthName)}</p>`;

    const W = 440;
    const H = 168;
    const L = 30;
    const R = 14;
    const T = 10;
    const B = 26;
    const maxV = Math.max(4, ...values);
    const stepV = maxV > 40 ? 20 : maxV > 20 ? 10 : maxV > 8 ? 5 : 2;
    const topV = Math.ceil(maxV / stepV) * stepV;
    const span = Math.max(1, values.length - 1);
    const x = (i) => L + (i / span) * (W - L - R);
    const y = (v) => T + (1 - v / topV) * (H - T - B);
    let grid = "";
    for (let v = 0; v <= topV; v += stepV) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="dash-svg-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="dash-svg-axis">${v}</text>`;
    }
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = values.length > 1
      ? `<path d="M${x(0)},${y(0)} L${pts.join(" L")} L${x(values.length - 1)},${y(0)} Z" fill="url(#dash-area)"/>`
      : "";
    const ticks = [0, Math.floor((values.length - 1) / 2), values.length - 1]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}" class="dash-svg-axis">${esc(shortDate(days[i]))}</text>`)
      .join("");
    const hitW = (W - L - R) / Math.max(1, values.length);
    const hits = values.map((v, i) => {
      const tip = encodeURIComponent(JSON.stringify({
        title: days[i].toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
        rows: [["Not yet closed", String(v), "var(--s1)"]],
      }));
      return `<rect x="${x(i) - hitW / 2}" y="${T}" width="${hitW}" height="${H - T - B}" fill="transparent" data-dash-tip="${tip}" data-dash-i="${i}"/>`;
    }).join("");

    return `
      <article class="dash-card dash-trend">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Open work this month</p>
            <p class="dash-card-sub">Tasks not yet closed, day by day</p>
          </div>
        </header>
        <div class="dash-hero"><span class="dash-hero-num">${now}</span><span class="dash-hero-unit">not yet closed</span></div>
        ${delta}
        <svg class="dash-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks not yet closed each day this month, now ${now}">
          <defs><linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a6cf5" stop-opacity="0.18"/><stop offset="1" stop-color="#0a6cf5" stop-opacity="0"/></linearGradient></defs>
          ${grid}${area}
          <polyline points="${pts.join(" ")}" fill="none" stroke="var(--s1)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
          <line class="dash-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
          <circle class="dash-dot" r="4.5" fill="var(--s1)" stroke="#fff" stroke-width="2" visibility="hidden"/>
          <circle cx="${x(values.length - 1)}" cy="${y(now)}" r="4.5" fill="var(--s1)" stroke="#fff" stroke-width="2"/>
          ${ticks}${hits}
        </svg>
        <script type="application/json" class="dash-trend-data">${JSON.stringify({ L, R, T, B, W, H, topV, span, values })}</script>
      </article>`;
  }

  /* --------------------------------------------- leaderboard and nudges */

  function loadUsers() {
    if (state.users !== null || typeof getActiveUsers !== "function") {
      return;
    }
    state.users = [];
    getActiveUsers()
      .then((users) => {
        state.users = (users || []).filter(
          (user) => user.email && String(user.user_class || "").toUpperCase() !== "REDUNDANT_USER"
        );
        draw();
      })
      .catch(() => {
        state.users = [];
      });
  }

  function periodStart(today, period) {
    return period === "week" ? weekStart(today) : new Date(today.getFullYear(), today.getMonth(), 1);
  }

  function contributionStats(tasks, today, period) {
    const start = periodStart(today, period);
    const people = new Map();
    const ensure = (email, name) => {
      const key = lower(email) || lower(name);
      if (!key) {
        return null;
      }
      if (!people.has(key)) {
        people.set(key, { email: lower(email), name: name || email, hours: 0, done: 0, onTime: 0, open: 0, late: 0, lastLog: null });
      }
      const entry = people.get(key);
      if (name && (!entry.name || entry.name === entry.email)) {
        entry.name = name;
      }
      return entry;
    };
    (state.users || []).forEach((user) => ensure(user.email, user.user_name));
    tasks.forEach((task) => {
      const closed = closedOn(task);
      const end = parseDay(task.end_date);
      const status = String(task.status || "OPEN").toUpperCase();
      assigneesOf(task).forEach((person) => {
        if (!person.email) {
          return;
        }
        const entry = ensure(person.email, person.name);
        if (!entry) {
          return;
        }
        if (status === "CLOSED" && closed && closed >= start && closed <= today) {
          entry.done += 1;
          if (!end || closed <= end) {
            entry.onTime += 1;
          }
        }
        if (status !== "CLOSED") {
          entry.open += 1;
          if (end && end < today) {
            entry.late += 1;
          }
        }
      });
      (task.work_logs || []).forEach((log) => {
        const day = parseDay(log.work_date);
        const entry = ensure(log.logged_by_email, log.logged_by_name);
        if (!entry || !day) {
          return;
        }
        if (!entry.lastLog || day > entry.lastLog) {
          entry.lastLog = day;
        }
        if (day >= start && day <= today) {
          entry.hours += Number(log.hours || 0);
        }
      });
    });
    const list = Array.from(people.values());
    list.forEach((entry) => {
      // Hours carry the score; each task finished counts like an hour, and
      // finishing on time adds a little more. Shown on the card so it's fair.
      entry.score = entry.hours + entry.done * 1 + entry.onTime * 0.5;
    });
    return list.sort((a, b) => b.score - a.score || b.done - a.done || a.name.localeCompare(b.name));
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) {
      return 0;
    }
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function renderLeaderboard(stats, email) {
    const ranked = stats.filter((entry) => entry.score > 0);
    const top = ranked.slice(0, 5);
    const myIndex = ranked.findIndex((entry) => entry.email === email);
    const periodLabel = state.leaderPeriod === "week" ? "this week" : "this month";
    const tabs = [["week", "Week"], ["month", "Month"]]
      .map(([key, label]) => `<button type="button" data-dash-leader="${key}" aria-pressed="${state.leaderPeriod === key}">${label}</button>`)
      .join("");
    const max = Math.max(1, ...top.map((entry) => entry.score));
    const medal = ["is-gold", "is-silver", "is-bronze"];
    const rows = top.map((entry, index) => `
      <li class="dash-leader ${entry.email === email ? "is-me" : ""}">
        <span class="dash-rank ${medal[index] || ""}">${index + 1}</span>
        ${avatar(entry.name, entry.email)}
        <span class="dash-leader-main">
          <span class="dash-leader-name">${esc(entry.name)}${entry.email === email ? ' <em>you</em>' : ""}</span>
          <span class="dash-leader-bar"><span style="width:${Math.max(4, (entry.score / max) * 100)}%"></span></span>
        </span>
        <span class="dash-leader-stats"><b>${hoursText(entry.hours)}</b><span>${entry.done} done${entry.done ? ` · ${Math.round((entry.onTime / entry.done) * 100)}% on time` : ""}</span></span>
      </li>`).join("");
    const me = myIndex >= 5
      ? `<p class="dash-leader-you">You're <b>#${myIndex + 1}</b> of ${ranked.length} ${periodLabel} with ${hoursText(ranked[myIndex].hours)} and ${ranked[myIndex].done} done.</p>`
      : "";
    return `
      <article class="dash-card dash-leaders">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Top contributors</p>
            <p class="dash-card-sub">Hours logged and tasks finished ${periodLabel}</p>
          </div>
          <div class="dash-tabs" role="group" aria-label="Leaderboard period">${tabs}</div>
        </header>
        ${top.length
          ? `<ol class="dash-leader-list">${rows}</ol>${me}`
          : `<p class="dash-calm">No hours logged or tasks finished ${periodLabel} yet. Log hours on a task to get on the board.</p>`}
        <p class="dash-foot dash-score-note">Score: 1 point per hour logged, 1 per task finished, +0.5 if it was on time.</p>
      </article>`;
  }

  function renderStanding(stats, email, today, isManager) {
    const periodLabel = state.leaderPeriod === "week" ? "this week" : "this month";
    const active = stats.filter((entry) => entry.hours > 0 || entry.done > 0 || entry.open > 0);
    const teamMedian = median(active.map((entry) => entry.hours));
    const mine = stats.find((entry) => entry.email === email) || { hours: 0, done: 0, onTime: 0, open: 0, late: 0, lastLog: null };
    const idleDays = mine.lastLog ? daysBetween(mine.lastLog, today) : null;

    let tone = "good";
    let headline = "You're keeping pace with the team";
    let advice = "Keep logging hours as you go so your work is counted.";
    if (mine.late > 0) {
      tone = "bad";
      headline = `${mine.late} of your task${mine.late === 1 ? " is" : "s are"} overdue`;
      advice = "Finish or send them for review, or ask your supervisor to move the due date.";
    } else if (teamMedian > 0 && mine.hours < teamMedian * 0.5) {
      tone = "warn";
      headline = "You're behind the team " + periodLabel;
      advice = mine.open
        ? "Log the hours you've already put in, and move one of your open tasks forward today."
        : "Nothing is assigned to you. Pick up a task from the board or ask a supervisor.";
    } else if (mine.hours >= teamMedian && mine.hours > 0) {
      headline = "You're ahead of the team median";
    }
    if (idleDays !== null && idleDays >= 7 && tone !== "bad") {
      tone = "warn";
      headline = `No hours logged in ${idleDays} days`;
    }

    const compareMax = Math.max(1, mine.hours, teamMedian);
    const mineCard = `
      <div class="dash-standing is-${tone}">
        <p class="dash-standing-head">${esc(headline)}</p>
        <div class="dash-compare">
          <div><span>You</span><span class="dash-compare-track"><span style="width:${(mine.hours / compareMax) * 100}%" class="is-me"></span></span><b>${hoursText(mine.hours)}</b></div>
          <div><span>Team median</span><span class="dash-compare-track"><span style="width:${(teamMedian / compareMax) * 100}%"></span></span><b>${hoursText(teamMedian)}</b></div>
        </div>
        <p class="dash-standing-facts">${mine.done} done ${periodLabel} · ${mine.open} open · ${mine.late} overdue</p>
        <p class="dash-standing-advice">${esc(advice)}</p>
      </div>`;

    let checkIn = "";
    if (isManager) {
      const needs = stats
        .filter((entry) => entry.email && entry.email !== email)
        .map((entry) => {
          const idle = entry.lastLog ? daysBetween(entry.lastLog, today) : null;
          const reasons = [];
          if (entry.late >= 2) reasons.push(`${entry.late} overdue`);
          if (idle === null && entry.open > 0) reasons.push("no hours logged yet");
          else if (idle !== null && idle >= 14) reasons.push(`no hours in ${idle} days`);
          if (teamMedian > 0 && entry.open > 0 && entry.hours < teamMedian * 0.3 && !reasons.length) reasons.push(`${hoursText(entry.hours)} vs ${hoursText(teamMedian)} median`);
          return { entry, reasons, weight: entry.late * 2 + (idle === null ? 10 : idle / 7) };
        })
        .filter((item) => item.reasons.length)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5);
      checkIn = `
        <div class="dash-checkin">
          <p class="dash-checkin-head">Needs a check-in <span>Only seniors see this</span></p>
          ${needs.length
            ? `<ul>${needs.map((item) => `<li>${avatar(item.entry.name, item.entry.email)}<span class="dash-checkin-name">${esc(item.entry.name)}</span><span class="dash-checkin-why">${esc(item.reasons.join(" · "))}</span></li>`).join("")}</ul>`
            : `<p class="dash-calm">Everyone is active and on time.</p>`}
        </div>`;
    }

    return `
      <article class="dash-card dash-standing-card">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">How you're doing</p>
            <p class="dash-card-sub">Private to you · ${periodLabel}</p>
          </div>
        </header>
        ${mineCard}
        ${checkIn}
      </article>`;
  }

  /* ------------------------------------------------------------ activity */

  // Day-by-day heatmap of effort (hours logged + tasks finished). It only
  // shows merits, so it is safe to show to everyone.
  const HEAT_WEEKS = 20;

  function renderActivity(tasks, email, today) {
    const first = addDays(weekStart(today), -7 * (HEAT_WEEKS - 1));
    const days = new Map();
    const bump = (day, key, amount) => {
      if (!day || day < first || day > today) {
        return;
      }
      const k = dateKey(day);
      if (!days.has(k)) {
        days.set(k, { hours: 0, done: 0 });
      }
      days.get(k)[key] += amount;
    };
    tasks.forEach((task) => {
      (task.work_logs || []).forEach((log) => {
        if (state.scope === "me" && lower(log.logged_by_email) !== email) {
          return;
        }
        bump(parseDay(log.work_date), "hours", Number(log.hours || 0));
      });
      if (String(task.status || "").toUpperCase() === "CLOSED" && (state.scope !== "me" || isAssignee(task, email))) {
        bump(closedOn(task), "done", 1);
      }
    });

    const scoreOf = (entry) => (entry ? entry.hours + entry.done : 0);
    const values = Array.from(days.values()).map(scoreOf).filter((v) => v > 0);
    const peak = Math.max(1, ...values);
    const level = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / peak) * 4)));

    let cells = "";
    let monthLabels = "";
    let lastMonth = -1;
    let activeDays = 0;
    let hoursTotal = 0;
    let doneTotal = 0;
    let streak = 0;
    let best = 0;
    for (let w = 0; w < HEAT_WEEKS; w += 1) {
      const colStart = addDays(first, w * 7);
      if (colStart.getMonth() !== lastMonth) {
        lastMonth = colStart.getMonth();
        monthLabels += `<span style="grid-column:${w + 1}">${colStart.toLocaleDateString(undefined, { month: "short" })}</span>`;
      }
      for (let d = 0; d < 7; d += 1) {
        const day = addDays(colStart, d);
        if (day > today) {
          cells += `<span class="dash-heat-cell is-future" aria-hidden="true"></span>`;
          continue;
        }
        const entry = days.get(dateKey(day));
        const v = scoreOf(entry);
        if (v > 0) {
          activeDays += 1;
          streak += 1;
          best = Math.max(best, streak);
        } else if (day < today) {
          streak = 0;
        }
        hoursTotal += entry ? entry.hours : 0;
        doneTotal += entry ? entry.done : 0;
        const label = day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
        const tip = encodeURIComponent(JSON.stringify({
          title: label,
          rows: [["Hours logged", hoursText(entry ? entry.hours : 0), "var(--s1)"], ["Tasks finished", String(entry ? entry.done : 0), "var(--st-closed)"]],
        }));
        cells += `<span class="dash-heat-cell lv-${level(v)}" data-dash-tip="${tip}" aria-label="${esc(label)}: ${entry ? entry.hours : 0} hours, ${entry ? entry.done : 0} finished"></span>`;
      }
    }
    const who = state.scope === "me" ? "Your" : "The team's";
    return `
      <article class="dash-card dash-split-card dash-activity">
        <header class="dash-card-head">
          <div>
            <p class="dash-eyebrow">Activity</p>
            <p class="dash-card-sub">${who} hours logged and tasks finished, day by day, last ${HEAT_WEEKS} weeks</p>
          </div>
        </header>
        <div class="dash-activity-body">
          <div class="dash-heat-wrap">
            <div class="dash-heat-months" style="grid-template-columns:repeat(${HEAT_WEEKS},minmax(0,1fr))">${monthLabels}</div>
            <div class="dash-heat" style="grid-template-columns:repeat(${HEAT_WEEKS},minmax(0,1fr))" role="img" aria-label="${activeDays} active days in the last ${HEAT_WEEKS} weeks">${cells}</div>
            <div class="dash-heat-legend" aria-hidden="true">Less <i class="lv-0"></i><i class="lv-1"></i><i class="lv-2"></i><i class="lv-3"></i><i class="lv-4"></i> More</div>
          </div>
          <dl class="dash-heat-stats">
            <div><dt>Active days</dt><dd>${activeDays}</dd></div>
            <div><dt>Hours logged</dt><dd>${hoursText(hoursTotal)}</dd></div>
            <div><dt>Tasks finished</dt><dd>${doneTotal}</dd></div>
            <div><dt>Best streak</dt><dd>${best} day${best === 1 ? "" : "s"}</dd></div>
          </dl>
        </div>
      </article>`;
  }

  /* -------------------------------------------------------------- render */

  function draw() {
    const container = state.container;
    if (!container) {
      return;
    }
    const email = currentEmail();
    const now = new Date();
    const today = startOfDay(now);
    const tasks = flattenTasks(state.details);
    const scoped = state.scope === "me" ? tasks.filter((t) => isMine(t, email)) : tasks;
    const buckets = { open: [], progress: [], overdue: [], closed: [] };
    scoped.forEach((task) => buckets[bucketOf(task, today)].push(task));
    const stats = contributionStats(tasks, today, state.leaderPeriod);
    const isManager = ["ADMIN", "SENIOR"].includes(
      String((typeof getSession === "function" ? getSession()?.userClass : "") || "").toUpperCase()
    );

    const html = `
      ${renderHead(myName(tasks, email), state.scope, now)}
      ${renderKpis(buckets, today)}
      ${renderDrawer(buckets, today)}
      <div class="dash-grid">
        ${renderNudges(buildNudges(tasks, email, today))}
        ${renderDueNext(scoped, today)}
        ${renderLeaderboard(stats, email)}
        ${renderStanding(stats, email, today, isManager)}
        ${renderHours(scopedLogs(tasks, email), today)}
        ${renderTrend(scoped, today)}
        ${renderSplit(scoped, today)}
        ${renderActivity(tasks, email, today)}
      </div>`;
    container.innerHTML = html;
    bindTrend(container);

    // Motion and the status orb live in ui-kit.js; skipped if it didn't load.
    if (window.NTTUI && typeof window.NTTUI.enhanceDashboard === "function") {
      const dueSoon = buckets.open.filter((t) => {
        const end = parseDay(t.end_date);
        return end && daysBetween(today, end) <= 7;
      }).length;
      try {
        window.NTTUI.enhanceDashboard(container, {
          scope: state.scope,
          open: state.open,
          dueSoon,
          counts: {
            open: buckets.open.length,
            progress: buckets.progress.length,
            overdue: buckets.overdue.length,
            closed: buckets.closed.length,
          },
        });
      } catch (_error) {
        // Never let decoration break the dashboard.
      }
    }
  }

  /* ------------------------------------------------------------ tooltip */

  let tip = null;

  function ensureTip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "dash-tooltip";
      tip.hidden = true;
      document.body.append(tip);
    }
    return tip;
  }

  function showTip(event, encoded) {
    let data;
    try {
      data = JSON.parse(decodeURIComponent(encoded));
    } catch (_error) {
      return;
    }
    const el = ensureTip();
    el.innerHTML = `<b>${esc(data.title)}</b>${(data.rows || []).map(([label, value, color]) =>
      `<div><span><i style="background:${color}"></i>${esc(label)}</span><span>${esc(value)}</span></div>`).join("")}${
      data.total ? `<div class="is-total"><span>Total</span><span>${esc(data.total)}</span></div>` : ""}`;
    el.hidden = false;
    const x = Math.min(event.clientX + 14, window.innerWidth - el.offsetWidth - 8);
    const y = event.clientY - el.offsetHeight - 12 < 8 ? event.clientY + 16 : event.clientY - el.offsetHeight - 12;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${y}px`;
  }

  function hideTip() {
    if (tip) {
      tip.hidden = true;
    }
  }

  function bindTrend(container) {
    const svg = container.querySelector(".dash-line");
    const raw = container.querySelector(".dash-trend-data");
    if (!svg || !raw) {
      return;
    }
    const cfg = JSON.parse(raw.textContent);
    const cross = svg.querySelector(".dash-cross");
    const dot = svg.querySelector(".dash-dot");
    svg.addEventListener("mousemove", (event) => {
      const rect = event.target.closest("[data-dash-i]");
      if (!rect) {
        return;
      }
      const i = Number(rect.dataset.dashI);
      const px = cfg.L + (i / cfg.span) * (cfg.W - cfg.L - cfg.R);
      const py = cfg.T + (1 - cfg.values[i] / cfg.topV) * (cfg.H - cfg.T - cfg.B);
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      dot.setAttribute("visibility", "visible");
    });
    svg.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
    });
  }

  /* ------------------------------------------------------------- events */

  function bindOnce(container) {
    if (container.dataset.dashBound === "true") {
      return;
    }
    container.dataset.dashBound = "true";

    container.addEventListener("click", (event) => {
      const scopeButton = event.target.closest("[data-dash-scope]");
      if (scopeButton) {
        state.scope = scopeButton.dataset.dashScope === "me" ? "me" : "team";
        saveScope(state.scope);
        draw();
        return;
      }
      const kpi = event.target.closest("[data-dash-kpi]");
      if (kpi) {
        state.open = state.open === kpi.dataset.dashKpi ? null : kpi.dataset.dashKpi;
        draw();
        if (state.open) {
          container.querySelector("#dash-drawer")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        return;
      }
      if (event.target.closest("[data-dash-close]")) {
        state.open = null;
        draw();
        return;
      }
      const leaderTab = event.target.closest("[data-dash-leader]");
      if (leaderTab) {
        state.leaderPeriod = leaderTab.dataset.dashLeader === "week" ? "week" : "month";
        draw();
        return;
      }
      const hoursTab = event.target.closest("[data-dash-hours]");
      if (hoursTab) {
        state.hours = hoursTab.dataset.dashHours;
        draw();
        return;
      }
      if (event.target.closest("[data-dash-range-apply]")) {
        const start = container.querySelector("#dash-range-start")?.value || "";
        const end = container.querySelector("#dash-range-end")?.value || "";
        const message = container.querySelector(".dash-range-msg");
        if (!start || !end) {
          message.textContent = "Pick both a start and an end date.";
          return;
        }
        if (start > end) {
          message.textContent = "The start date needs to be on or before the end date.";
          return;
        }
        state.customStart = start;
        state.customEnd = end;
        draw();
        return;
      }
      const notificationLink = event.target.closest("[data-dash-notification]");
      if (notificationLink && typeof openNotificationTarget === "function") {
        event.preventDefault();
        openNotificationTarget(notificationLink.dataset.dashNotification, notificationLink.getAttribute("href"));
      }
    });

    container.addEventListener("mousemove", (event) => {
      const target = event.target.closest("[data-dash-tip]");
      if (target) {
        showTip(event, target.dataset.dashTip);
      } else {
        hideTip();
      }
    });
    container.addEventListener("mouseleave", hideTip);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.open) {
        state.open = null;
        draw();
      }
    });
  }

  window.renderNttDashboard = function renderNttDashboard(container, projectDetails) {
    if (!container) {
      return;
    }
    state.container = container;
    state.details = Array.isArray(projectDetails) ? projectDetails : [];
    container.classList.add("dash");
    bindOnce(container);
    draw();
    refreshNotifications();
    loadUsers();
  };
})();
