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
