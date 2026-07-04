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
4. Run the API from the `Pages-backend` folder:

   ```powershell
   uvicorn app.main:app --reload
   ```

## Endpoints

- `GET /health` checks whether the API is running.
- `POST /auth/login` signs in with Supabase email/password auth.
