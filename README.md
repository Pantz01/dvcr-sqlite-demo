# DVCR SQLite Demo (Railway-ready)

This is the Driver Vehicle Condition Report MVP (FastAPI + Next.js) using SQLite and local image uploads.

## Quick Start (Local)
```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd ../frontend
npm install
npm run dev

# Open http://localhost:3000 and go to /login
```

## Railway Deploy (Test)
1. Push these files to a new GitHub repo.
2. In Railway → New Project → Deploy from GitHub → select the repo.
3. After the backend service is live, copy its public URL.
4. In the frontend service → Variables → set `NEXT_PUBLIC_API` to that URL → redeploy frontend.
