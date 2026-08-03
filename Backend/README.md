# NTT Backend

Python backend for the NTT login flow.

## Setup

1. Create a virtual environment.
2. Install dependencies:

   ```powershell
   pip install -r requirements.txt
   ```

3. Project defaults are stored in the root `Resources` folder:

   - `Resources/RENDER.PROPERTIES`
   - `Resources/SUPABASE.PROPERTIES`
   - `Resources/CLOUDFLARE.PROPERTIES`

   Environment variables and `Backend/.env` override these values.
   Use Render environment variables for deployment-specific secrets/config.
4. Run the API from the `Backend` folder:

   ```powershell
   uvicorn app.main:app --reload
   ```

## Endpoints

- `GET /health` checks whether the API is running.
- `POST /auth/signup` checks whether the email exists in the configured
  allowed-users table, then creates the Supabase Auth user.
- `POST /auth/login` signs in with Supabase email/password auth.

## Code Structure

The backend is organized so each module has one clear responsibility:

- `app/main.py` creates the FastAPI app, configures middleware, and wires routes.
- `app/config.py` loads environment and property-file configuration.
- `app/supabase_client.py` creates Supabase clients.
- `app/dependencies.py` contains reusable FastAPI dependencies, including auth.
- `app/repositories.py` contains Supabase table access functions.
- `app/mappers.py` converts database rows into API response objects.
- `app/schemas.py` defines request and response models.
- `app/constants.py` stores shared table and column names.
- `app/utils.py` stores small shared helpers.

## Frontend API URL

The static frontend reads the backend URL from `Frontend/Js/config.js`.
For local development, keep `apiBaseUrl` as `http://localhost:8000`.
When the backend is deployed, change it to the deployed backend URL.

## User classes and onboarding

Run `Resources/20260723_USER_CLASS_AND_ONBOARDING_RULES.sql` before deploying
the user-management code.

- `ADMIN` can register users, change managed users between `SENIOR` and
  `JUNIOR`, and download the board report.
- `SENIOR` can manage projects and tasks and can be assigned work.
- `JUNIOR` can only participate as a task assignee. Junior users cannot be
  selected as project stakeholders or watchers.

An administrator-created user starts with `status = 'PENDING'` and
`auth_uid = null`. The first successful login updates both fields together to
`status = 'NORMAL'` and the matching Auth UID. Protected API requests reject
records whose status and Auth UID are not synchronized.

## Mailjet task emails

Configure these only as backend environment variables:

- `MAILJET_API_KEY`
- `MAILJET_SECRET_KEY`
- `MAILJET_FROM_EMAIL` (a sender address or domain validated in Mailjet)
- `MAILJET_FROM_NAME` (optional; defaults to `Nexora`)

Nexora sends transactional email when a user is newly assigned a task and
when a task-close request is sent to the project stakeholder. In-app and push
notifications continue independently. A Mailjet delivery failure is logged
but does not roll back the task action.

## Backlog reminder service

The backend starts an in-process backlog scheduler with the API. Its schedule is
configured in `Resources/service.properties`. At `backlog.time` on each day in
`backlog.days`, it emails assignees, project stakeholders, and project watchers
for tasks whose `end_date` is before the current server-local date and whose
status is not `CLOSED`. The reminder log prevents duplicate reminders for the
same task, recipient, reminder type, and date.
