# NTT Product, Business Logic, Access, Data, UX, and Technical Audit

Audit date: 2026-07-22  
Method: read-only static review of all 46 repository files (excluding lock files); route-to-repository-to-migration and UI-to-API tracing. No code was modified. Python and Node runtimes were unavailable, so no executable tests were run.

## Product overview

NTT is a small, invite/allow-list-based task tracker. Authenticated users create projects, assign a project assignee and stakeholder, add project/task watchers, create and update tasks, advance an assignee/stakeholder task workflow, comment and reply with mentions, attach URL-based deliverables, log work, receive in-app notifications, view dashboards, and export analytics/audit data as CSV.

Main modules are authentication (signup, login, reset), active-user directory, projects, tasks, task workflow, comments/replies/mentions, work logs, watchers, notifications, dashboard analytics, and CSV export. The only explicit stored project roles are `OWNER` and `MEMBER`; contextual roles are project assignee, project stakeholder, project watcher, task assignee, task stakeholder, and task watcher. There is no implemented super-admin/admin/manager/customer/vendor/support/finance role model.

Major workflows are allow-listed signup -> login -> dashboard; project creation -> membership/assignment/watchers -> task creation; assignee starts work -> requests closure -> stakeholder closes; and task activity -> in-app notification -> linked record.

Technology: static HTML/CSS/vanilla JavaScript on Cloudflare Pages; FastAPI/Pydantic on Render; Supabase Auth and Postgres accessed through anon and service-role clients; process-local TTL caching. There are no background workers, queues, real file storage, email/SMS/WhatsApp notification delivery, payment integrations, or analytics service integrations in the repository.

Could not fully review: the base database schema, live Supabase RLS/policies, triggers, Auth settings (email confirmation, JWT duration, redirect allow-list), live environment secrets, Render/Cloudflare settings, production data, browser behavior, responsive behavior on devices, accessibility with assistive technology, or runtime behavior. The supplied SQL is additive and does not establish the full schema.

## Executive summary

Twenty findings were identified: 3 Critical, 8 High, 7 Medium, and 2 Low. The most affected modules are access control, projects/dashboard, task detail and mutations, audit logs, authentication/session handling, and database migrations. Every authenticated stakeholder is affected; project owners, stakeholders, and watchers are particularly affected by contradictory permissions.

Top five product risks:

1. Any authenticated account can read the entire workspace's projects, tasks, people, work logs, and audit history.
2. Any authenticated account can erase the global task audit trail.
3. Deactivated allow-list users retain API access until their Supabase token expires.
4. Multi-write workflows can leave projects/tasks, memberships, watchers, logs, and notifications partially updated.
5. The implemented contextual-role model is internally contradictory, blocking intended watchers/stakeholders while granting ordinary members excessive mutation rights.

Top five immediate actions:

1. Disable `/access-logs` and introduce an explicit admin permission before restoring it.
2. Enforce one centralized, server-side record authorization policy on all list/detail/mutation endpoints; filter queries before data is loaded.
3. Validate active `REF_USERS` status on every authenticated request and revoke Supabase sessions on deactivation.
4. Move compound writes into transactional database functions and make replacement/idempotency behavior explicit.
5. Define the role-permission matrix with Product/Security, then add authorization and cross-tenant regression tests before release.

## Detailed findings

### Issue

**NTT-001 — Workspace-wide project, task, people, analytics, and audit-data disclosure**  
Category: Access-control concern / privacy  
Severity: Critical  
Confidence: Confirmed  
Affected module: Projects list, dashboard, analytics export  
Affected stakeholder or role: Every authenticated user; all project participants  
Evidence: `Backend/app/main.py:1100-1226` (`GET /projects`), `Backend/app/main.py:1228-1407` (`GET /dashboard`), `Backend/app/main.py:1118-1127`, `Backend/app/main.py:1246-1279`; `Frontend/Js/app.js:1559-1663`, `1856-1969`  
Current behaviour: both endpoints use the service-role client to query every project and every associated task, member, watcher, work log, and access log. Results and exports include names/emails and activity for records unrelated to the caller.  
Expected behaviour: queries return only records authorized for the caller (or explicitly all records for a defined privileged role), with field-level minimization.

### Problem

Authentication is treated as authorization. Although membership/watchlist repository functions exist, neither list nor dashboard uses them. Because the service-role client bypasses normal RLS, database policy cannot compensate. Trigger: any valid bearer token calls either endpoint. Scope: the entire workspace and, if organizations are later introduced, every tenant. Impact includes confidential project disclosure, personnel/activity profiling, inaccurate personal dashboards, and unauthorized CSV export. It also makes the UI appear intentionally global, undermining the contextual project roles. Related: NTT-002, NTT-003, NTT-005.

### What needs to be done

Product must decide whether NTT is a single transparent workspace or private-by-project. Backend/Security should define a reusable authorization query based on owner/member/assignee/stakeholder/watcher and optional admin role, filter at SQL level, minimize returned fields, and add tenant IDs before multi-organization use. Frontend should label genuinely global views and hide/export only permitted data. Add role-by-role list, dashboard, direct-ID and CSV tests, including two organizations. Acceptance: a user cannot infer any identifier, title, person, log, metric, or count outside their scope; privileged global access is explicit and audited. Owner: Product + Backend + Security + QA. Priority: Immediate. Effort: Large.

### Issue

**NTT-002 — Project detail authorization is deliberately bypassed**  
Category: Access-control concern  
Severity: Critical  
Confidence: Confirmed  
Affected module: Project detail and direct URLs  
Affected stakeholder or role: Every authenticated user  
Evidence: `Backend/app/main.py:533-540` (`has_project_access` returns `True`), `Backend/app/main.py:1409-1435` (`GET /projects/{project_id}`)  
Current behaviour: the endpoint calls an access function, but that function unconditionally permits every authenticated user.  
Expected behaviour: access must be derived from an explicit permission rule and denied by default.

### Problem

This is a confirmed direct-object authorization bypass. A user can enumerate project IDs and retrieve project documents, task data, participants, work logs, and audit history. The apparently present check is misleading to reviewers and future maintainers. Scope is the entire system. The service-role database client makes this application check the only enforcement point. Related: NTT-001 and NTT-003.

### What needs to be done

Product/Security must confirm which contextual roles can view a project. Backend should replace the stub with a deny-by-default policy, query only authorized records, and return 404 where identifier disclosure matters. Add negative direct-URL/API tests for unrelated, inactive, removed, watcher-only, stakeholder-only, and cross-tenant users. Acceptance: all unauthorized combinations fail and no related records are returned or cached. Owner: Backend + Security + QA. Priority: Immediate. Effort: Medium.

### Issue

**NTT-003 — Task detail has no record-level authorization and uses a cross-user cache key**  
Category: Access-control concern / privacy  
Severity: Critical  
Confidence: Confirmed  
Affected module: Task detail, comments, deliverables, work/audit logs  
Affected stakeholder or role: Every authenticated user  
Evidence: `Backend/app/main.py:2291-2454`; cache key `tasks:detail:{task_id}` at `2307`; no `ensure_project_member`/`has_project_access` before response  
Current behaviour: any authenticated caller can retrieve any task ID and its comments, URLs, identities, work logs, and audit log; the cached object is shared among users.  
Expected behaviour: task access must inherit authorized project/task participation and cached values must not cross authorization scopes.

### Problem

Only token validity is checked. Unlike comment/work-log mutations, task reads never check membership. Enumeration or notification links expose full activity. The cache amplifies future field-level authorization mistakes because one user's representation is reusable by all callers. Entire-system privacy and confidentiality are affected.

### What needs to be done

Backend should authorize before cache lookup, define task-specific visibility, and key cache by authorization scope or cache only authorization-neutral data. Validate notification targets at destination. Add direct-ID, removed-member, stale-cache, and cross-tenant tests. Acceptance: unauthorized callers receive no task data before or after authorized users warm the cache. Owner: Backend + Security + QA. Priority: Immediate. Effort: Medium.

### Issue

**NTT-004 — Any authenticated user can delete the global audit trail**  
Category: Access control / audit integrity  
Severity: High  
Confidence: Confirmed  
Affected module: Task access log  
Affected stakeholder or role: All users; operations, compliance, project owners  
Evidence: `DELETE /access-logs` at `Backend/app/main.py:2630-2644`; global delete at `Backend/app/repositories.py:546-552`; merely hidden UI control at `Frontend/Pages/post-login.html:20`  
Current behaviour: any valid token can delete every `TASK_ACCESS_LOG` row; the frontend only hides the button.  
Expected behaviour: audit logs should be append-only for ordinary users, retained by policy, and deletable only through a tightly controlled administrative retention process.

### Problem

The backend performs no role check and executes `.delete().neq("id", 0)`. A direct API call permanently removes evidence across all projects. This damages accountability, incident investigation, reporting, and stakeholder trust. Scope: entire system.

### What needs to be done

Remove/disable the route immediately. Product/Legal must define retention; Security/Backend should implement an explicit admin capability, step-up confirmation, scoped/dated archival, immutable audit of the purge, and preferably database restrictions preventing application deletion. Test ordinary-user denial and administrative scope. Acceptance: no non-admin can delete logs and every authorized retention action is recoverable/audited. Owner: Security + Backend + Legal/Compliance + QA. Priority: Immediate. Effort: Medium.

### Issue

**NTT-005 — The role model is contradictory and over-privileges members/watchers**  
Category: Access-control concern / product gap  
Severity: High  
Confidence: Confirmed  
Affected module: Projects and tasks  
Affected stakeholder or role: Owner, member, project assignee, stakeholder, watcher  
Evidence: `is_project_editor` allows assignee/watchers (`Backend/app/main.py:526-530`); create/update task and comments/work logs require membership (`1916`, `2012`, `2472`, `2581`); status also first requires membership (`2154`); `ensure_project_member` ignores stored role (`Backend/app/repositories.py:274-295`)  
Current behaviour: any active member, regardless of `OWNER`/`MEMBER`, can create/reassign/update tasks and post activity; project watchers can edit project participants/documents but may be blocked from task activity; stakeholders/watchers are often not members and cannot complete intended workflows.  
Expected behaviour: each contextual and stored role has coherent view/create/edit/transition/comment/log permissions, enforced server-side.

### Problem

Authorization mixes membership, assignment, and watch status without a matrix. A watcher can change project assignment and watcher lists, while an owner who is not current assignee cannot edit the project. A task stakeholder must be a project member to close, but project creation does not add the stakeholder as a member. This can make the core closure journey impossible. Scope: role-dependent across the system.

### What needs to be done

Product must approve a permission matrix. Backend should centralize capabilities (`can_view_project`, `can_manage_project`, `can_create_task`, `can_edit_task`, `can_transition_task`, `can_comment`, `can_log_work`) and include explicit owner/admin rules. Align frontend controls with server capability flags. Add a full role-action matrix test suite. Acceptance: every allowed/denied matrix cell is tested and project-created stakeholders can perform their intended action. Owner: Product + Backend + Frontend + QA + Security. Priority: Immediate. Effort: Large.

### Issue

**NTT-006 — Deactivated users remain authorized on protected APIs**  
Category: Authentication / account lifecycle  
Severity: High  
Confidence: Confirmed  
Affected module: All protected endpoints  
Affected stakeholder or role: Deactivated users, administrators  
Evidence: `get_current_user` only validates Supabase token at `Backend/app/dependencies.py:24-45`; `REF_USERS.status` is checked at login/create-project but not per request (`Backend/app/main.py:899-906`, `1766-1780`)  
Current behaviour: changing the allow-list status does not invalidate existing bearer tokens or block protected endpoints until Supabase rejects the token.  
Expected behaviour: deactivation promptly revokes sessions and denies every protected request.

### Problem

Allow-list status is the application's active-account control, but it is absent from the common authentication dependency. Cached responses may remain available too. A removed employee can continue viewing and mutating data. Scope: all endpoints and any organization they could access.

### What needs to be done

Backend should map token UID/email to a `NORMAL` reference user in the dependency and reject otherwise; administrative deactivation must revoke all Supabase sessions and evict user caches. Define acceptable revocation latency. Test deactivation during an active session and on multiple devices. Acceptance: deactivation blocks the next request within the agreed SLA. Owner: Backend + Security + QA + Operations. Priority: Immediate. Effort: Medium.

### Issue

**NTT-007 — Project and task compound writes are non-transactional**  
Category: Data integrity / workflow  
Severity: High  
Confidence: Confirmed  
Affected module: Create/update projects and tasks, watchers, notifications, access logs  
Affected stakeholder or role: Project creators/editors and notification recipients  
Evidence: project insert precedes membership assignment (`Backend/app/main.py:1840-1896`); task insert precedes watcher/log/notification writes (`1947-1987`); update precedes watcher replacement (`2054-2120`); delete-then-insert replacements (`Backend/app/repositories.py:232-243`, `414-425`)  
Current behaviour: failures leave orphan/incomplete projects, tasks without watchers/logs, or emptied watcher lists; errors can claim partial success/failure without recovery.  
Expected behaviour: each business operation commits atomically or has a reliable compensating workflow.

### Problem

Multiple independent PostgREST calls are treated as one transaction. The project endpoint explicitly admits the project may exist after returning an error. Retry can then create duplicates. Watcher replacement deletes first, so a failed insert loses the prior state. Notifications and audit logs can diverge from source changes. Scope: each affected record, with reporting and communication consequences.

### What needs to be done

Backend/Data should implement transactional Postgres functions for compound commands, with unique/idempotency keys and deterministic retries. Preserve old watcher state on failure. UI should distinguish retryable failure from committed success. Add injected-failure tests at every write boundary. Acceptance: no partial state remains after any single-step failure, and retry creates no duplicate. Owner: Backend + Data + QA. Priority: Immediate. Effort: Large.

### Issue

**NTT-008 — Task workflow permits bypass and has no concurrency control or recovery transition**  
Category: Business logic / race condition  
Severity: High  
Confidence: Confirmed  
Affected module: Task status workflow  
Affected stakeholder or role: Assignee, stakeholder  
Evidence: `Backend/app/main.py:2137-2289`; stakeholder can close directly from `IN PROGRESS` (`2190-2197`); update filters only by task ID (`2229`); allowed set includes `OPEN` but no valid transition to it (`2156-2197`)  
Current behaviour: closure review can be bypassed; two actors can transition from stale state and last-write wins; closed/rejected work cannot reopen; no rejection/revision path exists.  
Expected behaviour: the approved state machine should enforce conditional atomic transitions, review/rejection, and authorized recovery.

### Problem

The code describes a close-request workflow but also allows direct stakeholder closure from in-progress. It reads current status and later updates without `WHERE status = old_status`, versioning, or transaction. Concurrent requests can overwrite each other and generate misleading logs/notifications. `OPEN` is accepted as a value but every transition to it is blocked implicitly. Product intent for rejection/reopen is absent.

### What needs to be done

Product must define the state diagram, direct-close rule, rejection, reopen, cancellation, and reassignment behavior. Backend should use compare-and-set/versioned transitions in a transaction and return conflict on stale state. Add concurrency and every-edge transition tests. Acceptance: only documented edges succeed once; conflicting requests cannot create impossible logs/status. Owner: Product + Backend + QA. Priority: Short term. Effort: Medium.

### Issue

**NTT-009 — Parent comment IDs are not validated against the current task**  
Category: Data integrity / authorization  
Severity: High  
Confidence: Confirmed  
Affected module: Replies and notifications  
Affected stakeholder or role: Project members and comment authors  
Evidence: `CreateTaskCommentRequest.parent_comment_id` at `Backend/app/schemas.py:61-65`; inserted without lookup at `Backend/app/main.py:2479-2495`; FK only references comment ID at `Resources/20260714_NOTIFICATIONS_MENTIONS_REPLIES.sql:16-19`  
Current behaviour: a member of project A can submit a parent ID belonging to task/project B; the reply row has task A but parent B.  
Expected behaviour: parent comment must exist, be visible to the caller, and belong to the same task; reply depth rules should be explicit.

### Problem

The database FK validates existence, not same-task ownership. This corrupts reply trees, may create hidden/orphan-looking replies, and enables cross-record relationship inference. Deleted parents cascade-delete replies even if their `task_id` differs. Scope: individual comments across projects.

### What needs to be done

Backend should fetch and authorize the parent and verify `parent.task_id == task_id`; Data should consider a composite constraint/model enforcing same-task ancestry. Product should decide nested-depth rules. Add cross-task, missing, deleted, unauthorized and nested reply tests. Acceptance: only a visible comment on the same task can be a parent. Owner: Backend + Data + QA. Priority: Immediate. Effort: Small.

### Issue

**NTT-010 — Session persistence and logout do not implement token lifecycle management**  
Category: Authentication/session handling  
Severity: High  
Confidence: Confirmed  
Affected module: Browser session, logout, refresh  
Affected stakeholder or role: All users  
Evidence: access and refresh tokens stored in localStorage at `Frontend/Js/app.js:56-95`; logout only clears browser storage at `97-107`; refresh token is never used; backend exposes no logout/refresh endpoint  
Current behaviour: tokens persist across browser restarts, are readable by any same-origin script, never refresh, and logout does not revoke the server session or other devices.  
Expected behaviour: session duration/remember-me is explicit; refresh rotation works; logout revokes appropriate sessions; sensitive tokens are protected as far as architecture permits.

### Problem

The presence of a refresh token suggests intended renewal, but expired access tokens force sign-in. A stolen token remains valid after local logout. Loading Supabase JavaScript from a third-party CDN on reset also expands supply-chain exposure. Scope: each user/device; privacy and account takeover impact if any XSS/dependency compromise occurs.

### What needs to be done

Security/Product should define remember-me and multi-device logout. Prefer secure HttpOnly/SameSite cookies via backend or rigorously implement Supabase refresh rotation and sign-out/revocation; add CSP and pin/self-host third-party assets. Test expiry, refresh replay, logout, other-device behavior, and stolen old refresh token. Acceptance: documented expiry/renewal works and revoked sessions cannot call APIs. Owner: Security + Backend + Frontend + QA. Priority: Short term. Effort: Large.

### Issue

**NTT-011 — Update DTO defaults can silently erase watcher lists and project assignment cannot be cleared**  
Category: API contract / business logic  
Severity: Medium  
Confidence: Confirmed  
Affected module: Project/task update  
Affected stakeholder or role: Project assignee/watcher, task editors  
Evidence: watcher defaults `[]` in `Backend/app/schemas.py:28-35`, `47-54`; unconditional replacement at `Backend/app/main.py:1707-1735`, `2090-2120`; project assignment has no empty-string clearing branch at `1655-1666`, unlike task at `2026-2038`  
Current behaviour: any partial update omitting `watcher_emails` clears all watchers; project `assigned_to` can be changed but not cleared.  
Expected behaviour: omitted fields mean unchanged; explicit empty list/string/null semantics are consistent and documented.

### Problem

The POST-as-update contract cannot distinguish omission from an intentional empty list. Future clients and partial UI actions can silently remove access/notifications. Project assignment semantics contradict task semantics. Scope: each updated record.

### What needs to be done

Product/API owners should define PATCH semantics. Use optional watcher fields, `model_fields_set`, explicit clear operations, and consistent null handling; validate at least one responsible owner if required. Add omission/clear/set contract tests. Acceptance: omitted fields never change and explicit clear behaves consistently. Owner: Backend + Frontend + QA. Priority: Short term. Effort: Small.

### Issue

**NTT-012 — User directory is exposed to every authenticated account without scope or pagination**  
Category: Privacy / API scalability  
Severity: Medium  
Confidence: Confirmed  
Affected module: `GET /users`, assignment and mention UI  
Affected stakeholder or role: All active users  
Evidence: `Backend/app/main.py:953-985`; `Backend/app/repositories.py:61-81`; frontend globally loads it at `Frontend/Js/app.js:675-811`  
Current behaviour: every account can enumerate every active user's name/email, and all records are returned and cached as one list.  
Expected behaviour: expose only assignable/mentionable users within the caller's organization/scope, with search/pagination and data minimization.

### Problem

This leaks the workforce directory and will degrade as user count grows. It also lets mentions target users without task access, generating links they should not be able to open under a corrected policy. Scope: entire user population.

### What needs to be done

Product/Privacy must define discoverability. Backend should tenant-scope, permission-filter, paginate/search server-side, and return display identifiers only as needed. Mention validation must require destination visibility. Add privacy and large-directory tests. Acceptance: unrelated users are undiscoverable and response size is bounded. Owner: Product + Backend + Security + QA. Priority: Short term. Effort: Medium.

### Issue

**NTT-013 — Database migrations do not define essential integrity and security constraints**  
Category: Data integrity / deployment risk  
Severity: High  
Confidence: High confidence  
Affected module: Database schema  
Affected stakeholder or role: All roles  
Evidence: all `Resources/*.sql`; UUID actor/assignee/watcher/recipient fields lack shown FKs; no RLS enable/policies; base tables absent; no unique constraint shown for `REF_USERS.user_id/auth_uid` or project membership; several scripts recreate the same optional tables/indexes with differing definitions  
Current behaviour: the repository cannot reproduce or verify the full database security/integrity model; orphan users, duplicate memberships, invalid statuses, and environment drift are possible.  
Expected behaviour: a versioned, ordered, complete schema defines keys, checks, RLS/policies, ownership/tenant constraints, rollback/forward behavior, and migration history.

### Problem

Service-role access makes missing application checks especially dangerous. UUID columns reference no visible user/profile table. Work-log hours are nullable and have no positive/range check in SQL. Watcher status has no check. Duplicate performance migrations obscure canonical state. This is high confidence because live schema may contain controls not supplied; they cannot be relied upon for deployment or audit.

### What needs to be done

Data/Security should export the canonical schema, place ordered migrations under a migration tool, add FKs/checks/uniques/tenant keys and defense-in-depth RLS, and test clean install plus upgrade from every supported version. Acceptance: a new environment is reproducible and rejects invalid/orphan/cross-tenant rows at database level. Owner: Data + Backend + Security + DevOps. Priority: Immediate. Effort: Large.

### Issue

**NTT-014 — Broad “optional table” error matching hides real outages and changes behavior silently**  
Category: Error handling / observability  
Severity: Medium  
Confidence: Confirmed  
Affected module: Work logs, audit logs, notifications, comments, schema compatibility  
Affected stakeholder or role: All users and operators  
Evidence: `Backend/app/repositories.py:22-34`; callers return empty data or silently skip writes at `428-477`, `480-552`, `555-637`; notification insertion suppresses errors at `Backend/app/main.py:249-275`  
Current behaviour: any exception text containing generic phrases such as “does not exist”, “could not find”, or “schema cache” may be treated as an optional-feature absence; reads become empty and writes may disappear without user/operator signal.  
Expected behaviour: only known schema-version errors are handled; operational, permission, network, and data errors surface, are logged, and produce a defined degraded state.

### Problem

String matching is overly broad and can misclassify unrelated failures. Notification code also appears inverted at `251-254`: non-optional errors return silently while optional errors fall through and can raise. Users may believe comments/status changes notified others when they did not. Metrics may show zero instead of unavailable. Scope ranges from one request to system-wide outage.

### What needs to be done

Backend/DevOps should use typed PostgREST error codes, log correlation IDs and feature health, remove silent catches, and expose “unavailable” rather than false empty/zero. Add failure-injection tests for missing table, permission denied, timeout, malformed row, and network failure. Acceptance: each failure class has deterministic response, telemetry, and no false success. Owner: Backend + DevOps + QA. Priority: Immediate. Effort: Medium.

### Issue

**NTT-015 — Duplicate submissions and retries are not idempotent**  
Category: API/workflow reliability  
Severity: Medium  
Confidence: Confirmed  
Affected module: Project/task creation, comments, work logs, notifications  
Affected stakeholder or role: All creators  
Evidence: create endpoints at `Backend/app/main.py:1750-1993`, comments `2456-2563`, work logs `2565-2628`; frontend buttons are not consistently disabled during requests (`Frontend/Js/app.js:2674-2798`)  
Current behaviour: double-click, retry after timeout, or network replay can create duplicate projects/tasks/comments/work logs and notifications.  
Expected behaviour: commands are idempotent or UI/API jointly prevent and safely reconcile duplicates.

### Problem

There are no idempotency keys, uniqueness rules for business commands, or request-state guards. Partial-write errors from NTT-007 make retries particularly dangerous. Duplicate hours distort analytics and duplicate notifications erode trust.

### What needs to be done

Backend should accept scoped idempotency keys and persist command results transactionally; Frontend should disable submissions and display pending state. Define duplicate rules for names/comments/logs. Add double-click, timeout-after-commit, and replay tests. Acceptance: repeating the same command returns the original result without an additional row/notification. Owner: Backend + Frontend + QA. Priority: Short term. Effort: Medium.

### Issue

**NTT-016 — URL “documents” are not validated, governed, or consistently modeled**  
Category: File/document handling / usability  
Severity: Medium  
Confidence: Confirmed  
Affected module: Project/task documents and comment deliverables  
Affected stakeholder or role: All project participants  
Evidence: URL fields are plain strings in `Backend/app/schemas.py:18-54`, `61-64`; `normalizeExternalUrl` prepends HTTPS in `Frontend/Js/app.js:532-543`; legacy `documents` and new `document_name/document_url` coexist in schema/responses/migrations  
Current behaviour: arbitrary strings are stored; malformed, deceptive, unsupported, or internal URLs may be presented as links. There is no upload, ownership, expiry, cleanup, malware scan, or access control for linked content.  
Expected behaviour: accurately label this as external links or implement governed file storage; validate allowed schemes/domains and lifecycle.

### Problem

The UI suggests documents/deliverables while only storing external URLs. `http`, `javascript:`-like and malformed inputs require explicit server handling; frontend normalization is not a security boundary. Legacy/new project fields can disagree. Deleted records do not control external content. Scope: each link and recipient.

### What needs to be done

Product must choose external-link versus managed-file semantics. For links, validate server-side URL type/scheme, add safe link attributes and warnings, and consolidate fields. For files, use private object storage, signed URLs, type/size scanning, ownership and cleanup. Test malicious/malformed/expired/inaccessible links. Acceptance: only approved link/file types render and authorization persists through download. Owner: Product + Backend + Frontend + Security + Design. Priority: Short term. Effort: Medium/Large depending on decision.

### Issue

**NTT-017 — Work-log validation allows zero/null hours, future dates, and inconsistent reporting**  
Category: Business logic / reporting  
Severity: Medium  
Confidence: Confirmed  
Affected module: Work logs and dashboard analytics  
Affected stakeholder or role: Employees/assignees, managers/stakeholders  
Evidence: hours optional and `ge=0` at `Backend/app/schemas.py:67-70`; any project member can log at `Backend/app/main.py:2580-2595`; notification/log text substitutes `0` (`2610`, `2620`); frontend weekly calculation at `Frontend/Js/app.js:1521-1535`, `1589-1599`  
Current behaviour: logs can have no hours or zero hours, any historical/future date, and be created by any member regardless of task status/assignment. Week boundaries use browser-local Sunday while backend default date uses server date.  
Expected behaviour: approved time-entry rules and timezone/week definition are enforced consistently, with accurate metrics.

### Problem

Optional/zero hours may be valid narrative updates, but the UI labels these as work logs and analytics sums them as time. A stakeholder/member can distort effort metrics, and timezone differences can classify the same log differently. Requirement needs clarification for who may log and whether closed tasks accept logs.

### What needs to be done

Product/Operations should define minimum increments, optional-note-only entries, date window, edit/delete/approval, allowed roles/statuses, timezone and week start. Enforce in API and DB checks and calculate reporting server-side. Test zero/null/negative/future/closed-task and timezone-boundary cases. Acceptance: all accepted logs follow one documented rule and dashboard/export totals match. Owner: Product + Backend + Data + QA. Priority: Short term. Effort: Medium.

### Issue

**NTT-018 — Authentication endpoints lack abuse controls and signup is not atomic**  
Category: Authentication / reliability  
Severity: Medium  
Confidence: High confidence  
Affected module: Signup, login, forgot password  
Affected stakeholder or role: Prospective and existing users  
Evidence: unauthenticated routes at `Backend/app/main.py:780-951`; no rate limiter/CAPTCHA/lockout dependency; signup creates Auth user before updating `REF_USERS` (`812-844`)  
Current behaviour: endpoints can be repeatedly called; signup can create an Auth account but fail to activate/link the reference record, returning an unrecoverable partial failure. Login responses distinguish unregistered/inactive accounts from invalid credentials.  
Expected behaviour: abuse is rate-limited and monitored; account creation is recoverable/idempotent; disclosure policy is deliberate.

### Problem

Static review cannot verify upstream Render/Supabase rate limits, hence high confidence rather than confirmed for abuse exposure. Application code has none. Partial signup may then reject retry because Auth already contains the email while reference status remains stale. Distinct login errors enable approved-email/status enumeration.

### What needs to be done

Security/Product should define enumeration and recovery policy. Add per-IP/account throttling, monitoring, generic public errors, and an idempotent reconciliation flow for Auth/reference records. Test concurrent signup, Auth success/reference failure, repeated reset/login, and recovery. Acceptance: partial signup self-recovers safely and abusive request rates are bounded. Owner: Security + Backend + DevOps + QA. Priority: Short term. Effort: Medium.

### Issue

**NTT-019 — Dashboard/report calculations are client-side, unscoped, and definitionally ambiguous**  
Category: Reporting/analytics  
Severity: Low  
Confidence: Confirmed  
Affected module: Dashboard and CSV export  
Affected stakeholder or role: All users; management/operations  
Evidence: `Frontend/Js/app.js:1517-1663`, `1856-1969`; backend returns raw global data at `Backend/app/main.py:1228-1407`  
Current behaviour: browsers calculate overdue/workload/weekly hours from all returned records; `CLOSE REQUESTED` is absent from summary cards, workload counts closed tasks, current week is browser-local Sunday-start, and CSV definitions are not versioned.  
Expected behaviour: authorized, documented metrics use shared server-side definitions, stable timezones/ranges, and reconcile to source records.

### Problem

Different locales/timezones can report different results. “Tasks by assignee” counts all statuses, potentially misrepresenting current load. Missing close-requested count means headline totals do not reconcile. Combined with access leakage, exports expose unauthorized data.

### What needs to be done

Product/Data should define each metric and report timezone/range/status population. Compute authorized aggregates server-side, show filters/as-of metadata, and reconcile CSV/UI. Add fixture-based boundary and sum tests. Acceptance: cards partition the documented population and export equals UI/source. Owner: Product + Data + Backend + QA. Priority: Medium term. Effort: Medium.

### Issue

**NTT-020 — No automated tests, complete API contract, or reproducible verification pipeline**  
Category: QA / code quality  
Severity: Low  
Confidence: Confirmed  
Affected module: Entire product  
Affected stakeholder or role: Engineering, QA, all users  
Evidence: no test/spec files among 46 repository files; `Backend/README.md` documents only three endpoints though 16 exist; no CI configuration; no OpenAPI snapshot/client contract  
Current behaviour: critical authorization, lifecycle, transition, transaction, notification, migration, accessibility, and analytics behavior has no regression safety net.  
Expected behaviour: risk-based automated coverage and deployment gates protect core journeys.

### Problem

The most serious defects are simple regressions a matrix test would catch. Documentation understates product scope, leaving operations and QA without a reliable contract. Static syntax verification could not be executed in this environment because Python/Node runtimes were unavailable.

### What needs to be done

QA/Engineering should establish pytest/FastAPI tests with mocked or isolated Supabase, frontend unit/component tests, Playwright E2E, migration tests, security authorization matrices, and CI gates. Keep OpenAPI and workflow documentation current. Acceptance: critical journeys and every permission matrix cell run on each change; clean migration is tested. Owner: QA + Backend + Frontend + DevOps. Priority: Immediate. Effort: Large.

## Stakeholder access review

| Role found | Correctly accessible | Incorrect/missing/excessive access | Broken workflows and recommended change |
|---|---|---|---|
| Unauthenticated visitor | Signup, login, forgot/reset password | No application abuse controls; account/status enumeration risk | Add throttling, generic disclosure policy, recoverable signup |
| Authenticated active user (no project relationship) | Personal notifications | Excessive: all projects/dashboard/directory and any project/task direct read; global audit deletion; can create projects | Deny by default; return only scoped records; explicit global/admin capability |
| Project owner (`OWNER`) | Created as active member; can create/update tasks because member | Owner role is ignored by checks; cannot edit project unless also current assignee/watcher | Make owner a first-class management permission; protect ownership transfer/removal |
| Project member (`MEMBER`) | Can create tasks, update tasks, comment, log work | Excessive: all members can reassign/edit any task; no role/action distinction | Split contributor/viewer/manager capabilities or narrow member actions |
| Project assignee | Can edit project and is added as member on creation/update | Can edit participant/watch lists; cannot clear project assignment; old assignees remain members | Define manager power and remove/downgrade stale membership transactionally |
| Project stakeholder | Can view because detail bypass/global list | Not added as member; therefore may be blocked from task creation/activity and task closure unless separately a member | Either include stakeholder in authorized relationship checks or add membership deliberately |
| Project watcher | Can edit project | Watcher receives unusually high edit power but is not a member, so task actions are blocked | Decide observer vs editor; align all endpoints and UI capability flags |
| Task assignee | Can start work and request closure if also project member | Assignment alone does not grant project membership on task update/create; task editor can reassign without owner role | Ensure assignment atomically grants intended access; constrain editors |
| Task stakeholder | Can close in-progress/close-requested task if also project member | May be blocked due to project membership; can bypass close request | Grant intended scoped access and enforce approved review state machine |
| Task watcher | Receives notifications and globally can read task | Task watcher status itself does not grant authorized comment/work-log access; mentions can target unrelated users | Define watcher visibility/activity rights and validate notification target access |
| Deactivated user | None should remain | Existing tokens retain all protected access until token rejection | Check active status per request and revoke sessions/caches |
| Admin/super admin | Not implemented | Hidden audit-delete UI implies an admin operation without any role | Add explicit, least-privilege admin model only if product requires it |

No organization/tenant entity or tenant-scoped permission was found. The current model must not be assumed safe for multiple businesses.

## Broken or incomplete user journeys

| Journey | Starting point / intended flow | Actual flow and failure point | Affected stakeholder | Recommended correction |
|---|---|---|---|---|
| Private project participation | User sees only projects where owner/member/assignee/stakeholder/watcher | Dashboard/list expose all; detail check always true | Everyone | Centralize and enforce scoped visibility at query level |
| Stakeholder approval | Task assignee starts -> requests close -> stakeholder reviews/closes | Stakeholder may not be a project member and fails at `ensure_project_member`; if a member, can close before request | Task stakeholder/assignee | Grant scoped stakeholder access and enforce state diagram |
| Watch and collaborate | Watcher receives updates, views and participates per policy | Project watcher can edit project but cannot comment/log/create tasks; task watcher lacks independent authorization | Watchers | Decide observer/editor/contributor semantics and apply consistently |
| Project creation retry | Submit once -> all project relationships saved -> success | Project may be committed while membership/watcher write fails; retry duplicates | Creator | Transactional idempotent command |
| Update watcher list | Change fields without altering watchers | Omitted list defaults empty and deletes watchers; failed replacement can leave none | Editors/watchers | PATCH semantics and transactional replacement |
| Deactivation | Admin deactivates -> access stops | Existing bearer token remains valid | Former user/admin | Per-request status check plus token revocation |
| Logout/expiry | Logout revokes; refresh renews transparently | Local-only logout; refresh token unused; expiry redirects to login | All users | Implement rotation/revocation and documented remember-me |
| Reply to comment | Reply attaches within same task | Arbitrary cross-task parent ID accepted | Members/commenters | Verify parent ownership/same task |
| Audit retention | Logs support accountability and controlled retention | Any user can erase every log | All/operations | Remove endpoint; controlled retention policy |
| Reliable notification | Business change commits and recipients are informed once | Silent/inverted exception handling, partial writes, duplicates possible | Assignees/stakeholders/watchers | Transaction/outbox, retries, delivery status, idempotency |

## Feature inventory

| Feature | Classification | Evidence/notes |
|---|---|---|
| Allow-listed signup | Partially working / data-integrity risk | Auth and reference status are separate non-atomic writes |
| Login | Partially working | Active status checked only at login; enumeration and throttling concerns |
| Forgot/reset password | Partially working / requires runtime verification | Supabase flow exists; redirect/Auth configuration unavailable |
| Browser session/logout | Incomplete / security risk | Persistent tokens; no refresh or server revocation |
| Active-user directory | Working functionally / privacy and scalability risk | Global unpaginated list |
| Project create | Partially working | No transaction/idempotency; all active users may create |
| Project list/dashboard | Broken / access-control risk | Global service-role queries |
| Project detail | Broken / access-control risk | Authorization function always true |
| Project edit | Partially working / permission ambiguity | Assignee/watcher only; owner ignored; assignment cannot clear |
| Project membership | Incomplete | Owner/member stored, but role value not used for authorization |
| Project stakeholder | Incomplete / broken workflow | Not made member; inconsistent access |
| Project watchers | Partially working / duplicated semantics | Observer/edit rights contradictory; replacement non-atomic |
| Task create | Partially working | Any member; no transaction/idempotency |
| Task detail | Broken / access-control risk | No authorization, shared cache |
| Task edit/reassignment | Partially working / excessive access | Any member can edit/reassign; watcher omission clears list |
| Task status workflow | Partially working | Role checks exist but membership prerequisite, bypass, race, no recovery |
| Comments | Partially working | Member-only; duplicate risk |
| Replies | Missing validation | Parent can belong to another task |
| Mentions | Partially working / privacy risk | Global directory and no target-access validation |
| External document/deliverable links | Requires requirement clarification / missing validation | Not actual uploads; legacy/new fields coexist |
| Work logs | Partially working / missing validation | Ambiguous hours/date/role/status rules |
| Task access history | Working as display / critically unsafe retention | Global delete endpoint |
| In-app notifications | Partially working | No pagination, silent errors, no preferences/outbox |
| Email notification | Missing (except Auth reset) | Notification rows do not send email |
| SMS/WhatsApp/push | Not implemented | No integrations found |
| Dashboard analytics | Partially working / misleading/access risk | Client-side ambiguous global metrics |
| CSV export | Partially working / access risk | Exports unauthorized raw data; no server contract |
| Search/filter/sort | Partially working | Client-side filters; no scalable API pagination/search/sort |
| Cache | Partially working | Process-local/non-shared; authorization-sensitive task key |
| Multi-tenancy | Missing | No organization/tenant model found |
| Admin management | Missing / implied dead UI | Hidden global audit-delete control without role |
| Tests/CI | Missing | No test or CI files found |

## Prioritized remediation roadmap

### Immediate: before the next release

- Remove/disable global audit deletion.
- Fix project/task/list/dashboard authorization and stop loading unauthorized rows with the service-role client.
- Enforce active account status per request and revoke deactivated sessions.
- Validate reply parent ownership.
- Correct notification exception handling and add operational logging.
- Capture the complete schema; add essential constraints/RLS and clean-install migration verification.
- Approve the role-permission matrix and add blocking authorization tests.

### Short term: within 1–2 sprints

- Make create/update workflows transactional and idempotent.
- Implement consistent PATCH/null/list semantics.
- Implement the approved task transition state machine with optimistic concurrency and recovery paths.
- Scope/paginate user directory, notifications, projects, and tasks.
- Implement secure session refresh/logout/remember-me behavior.
- Define and enforce work-log and document-link policies.
- Add outbox/retry/deduplication for notifications and clear degraded-state UX.

### Medium term: within 3–6 sprints

- Move analytics and exports to authorized server-side aggregates with stable metric definitions.
- Add organization/tenant boundaries if more than one business will use the service.
- Add accessibility, responsive, timezone, high-volume, and failure-mode test passes.
- Consolidate legacy document fields and migration duplication.
- Add notification preferences, retention, archive, and data recovery processes.

### Long term: architectural/strategic

- Adopt policy-as-code capabilities shared by API/UI, defense-in-depth RLS, and an append-only audit architecture.
- Replace process-local cache with an authorization-aware strategy or shared cache only when load requires it.
- Introduce managed document storage if documents are a core product capability.
- Establish privacy, retention, backup/restore, observability, incident response, and release governance.

## Test recommendations

Critical regression scenarios: unrelated user cannot list/read/export another project/task; deactivation blocks the next request; ordinary users cannot delete logs; project creation either fully commits or leaves nothing; stakeholder close journey completes only through approved states.

Role authorization tests: parameterize every role above against list/detail/create/edit/assign/watch/comment/reply/log/start/request-close/close/export/delete. Include removed membership, inactive watcher, dual assignee+stakeholder, owner not assignee, and task role without project membership.

Negative tests: missing/expired/revoked token; malformed IDs; cross-task reply parent; unsupported/stale status; omitted versus null versus empty update fields; unauthorized notification target; malformed/unsafe URL; duplicate request; invalid dates/hours; oversized strings/lists.

Data-integrity tests: FK/orphan rejection, unique membership/watchers, status/check constraints, tenant consistency, cascade policy, transaction rollback at every write, migration clean install/upgrade, cache invalidation, and backup/restore rehearsal.

API tests: response/error schema consistency, 401/403/404 policy, pagination/filter/sort boundaries, idempotency replay, optimistic concurrency, rate limits, timeout behavior, and no sensitive error leakage.

End-to-end tests: signup/login/reset; create project with all roles; create/assign task; assignee work/close request; stakeholder close/reject; comment/reply/mention; notification click/read; work log; dashboard reconciliation; CSV export; logout/deactivation.

Integration-failure tests: Supabase Auth succeeds while DB update fails; DB transaction step fails; notification insert/outbox worker fails; schema cache stale; network timeout after commit; CDN/reset script unavailable.

Edge cases: same person in multiple roles, empty/duplicate watcher emails, Unicode/case-normalized emails, DST/timezone/week boundary, future/past dates, zero/null/24 hours, closed task edits, deleted parent comment, large projects/directories, two simultaneous status requests.

Recommended coverage: 100% permission-matrix and state-transition branch coverage; all Critical/High findings protected by automated regression; contract tests for every endpoint; migration tests on clean and representative production-like snapshots; Playwright coverage for every major journey; accessibility checks with axe plus manual keyboard/screen-reader review. Line percentage is secondary to risk coverage.

## Open product questions

1. Is NTT intentionally a fully transparent single workspace, or should projects be private to related users?
2. Will multiple organizations use one deployment? If yes, what is the tenant boundary and who can cross it?
3. What administrative roles exist, and who may manage users, view all data, export, or apply retention?
4. What does `OWNER` mean, and why is it not used in authorization?
5. Should project assignees/watchers edit assignment, stakeholder, documents, and watcher lists?
6. Do project/task stakeholders and watchers receive view-only, comment, work-log, or management rights without membership?
7. Should task stakeholders be allowed to close directly from `IN PROGRESS`, or only after `CLOSE REQUESTED`?
8. What are rejection, revision, reopen, cancel, archive, and delete flows for projects/tasks?
9. On reassignment, should old assignees remain project members and retain history access?
10. Who may create projects and tasks, and are approval/quotas required?
11. Are work logs time records or narrative updates? Who may add/edit/delete/approve them, in which statuses and date window?
12. What timezone and week-start define due dates, overdue status, and weekly reporting?
13. Are “documents” external links or managed uploads? What schemes/domains, retention, ownership, and scanning are required?
14. Should mentions be limited to users who can already access the task?
15. Which notification channels are required, what delivery SLA/retry/deduplication applies, and what preferences/consent are needed?
16. What are session duration, remember-me, refresh, inactivity timeout, and single/all-device logout requirements?
17. How quickly must deactivation take effect, and who performs it?
18. What audit retention, immutability, export, legal hold, deletion, and recovery rules apply?
19. Which dashboard metric definitions/status populations/time ranges are authoritative?
20. What are supported scale targets for users, projects, tasks, comments, notifications, and exports?
21. What accessibility standard and supported browsers/devices are release requirements?
22. Are live Supabase RLS policies and base-schema migrations available for a follow-up verification?

