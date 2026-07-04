# NTT Backend

Python backend for the NTT login flow.

## Setup

1. Create a virtual environment.
2. Install dependencies:

   ```powershell
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in your Supabase project values.
   Use the Supabase publishable key for `SUPABASE_PUBLISHABLE_KEY`.
   By default, signup checks `REF_USERS.user_id` for the email address.
4. Run the API from the `Pages-backend` folder:

   ```powershell
   uvicorn app.main:app --reload
   ```

## Endpoints

- `GET /health` checks whether the API is running.
- `POST /auth/signup` checks whether the email exists in the configured
  allowed-users table, then creates the Supabase Auth user.
- `POST /auth/login` signs in with Supabase email/password auth.

## Frontend API URL

The static frontend reads the backend URL from `Pages-frontend/config.js`.
For local development, keep `apiBaseUrl` as `http://localhost:8000`.
When the backend is deployed, change it to the deployed backend URL.
