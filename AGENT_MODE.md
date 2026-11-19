# Agent Mode (experimental)

Open **Agent Mode** in the left sidebar or navigate to `/agent`.

## Features
- Groq-backed structured planning (1–5 steps)
- Inspect each step and its selected tool before running
- LangGraph execution of one user-approved step per click
- Real LLM reasoning via the existing `backend.services.model`
- Safe arithmetic calculator and live UTC clock
- Step statuses and execution results

## Setup
Install `langgraph` in the backend environment:

```bash
pip install langgraph
uvicorn backend.main:app --reload --port 8000
```

Then from `frontend/` run `npm install && npm run dev`.
Set `GROQ_API_KEY` in the existing backend .env.

## Important limitations
- Real execution here means **actual Groq LLM calls and real allowlisted tools**, not a simulation.
- It does **not** browse the web, send emails, run shell commands, or write files.
- A human must approve each step by clicking Run.
- Plans are stored **in process memory** and disappear on restart; not safe for multi-worker production.
- This feature uses the app's existing auth posture; do not deploy to an untrusted public URL without authentication.
- A branch is provided for review; do not merge into the default branch until tested and approved.

## API
- `POST /api/v1/agent/plans` body `{"goal":"..."}`
- `GET /api/v1/agent/plans/{plan_id}`
- `POST /api/v1/agent/plans/{plan_id}/steps/{index}/run`

## Smoke test
1. Enter: "Calculate (1200*12)/4 and explain the result."
2. Generate plan. Confirm the selected tools and instructions.
3. Run steps sequentially; verify status and results.
4. Reload `/agent` and check the page renders.
5. Verify the back-to-chat link preserves the existing chat UI.

**Not yet validated**: end-to-end browser build, live Groq API calls, or cloud deployment.
