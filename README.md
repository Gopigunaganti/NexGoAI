# NexGoAI

## Prerequisites

- Python 3.9 or newer and Node.js/npm.
- PostgreSQL with the `pgvector` extension installed and enabled. The
  application database role must be allowed to create the extension the first
  time the schema is initialized.
- A Groq API key, set as `GROQ_API_KEY`. Optionally set `GROQ_MODEL` to the
  Groq chat model to use (defaults to `llama-3.3-70b-versatile`).
- PDF embeddings are generated locally with FastEmbed using
  `BAAI/bge-base-en-v1.5`, which produces the 768-dimensional vectors required
  by PostgreSQL's `vector(768)` column. The model downloads on first use, so
  network access is needed the first time a PDF is indexed.

## Local development

Install the Python dependencies and configure `DATABASE_URL` and `GROQ_API_KEY`
in the environment or in the existing local `.env` file:

```sh
pip install -r requirements.txt
python create_tables.py
```

`create_tables.py` enables the PostgreSQL `vector` extension and creates the
application tables. Start the API and frontend in separate terminals:

```sh
uvicorn backend.main:app --reload
```

```sh
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Add PDFs from the
composer's PDF documents panel, then select which uploaded documents to search
for that chat. Uploads are limited to 10 MB and 500 pages; scanned PDFs without
selectable text need OCR before upload. With no documents selected, chat
continues to use the normal Groq conversation path. FastEmbed generates PDF
embeddings locally. Indexed PDF text and vectors are stored in PostgreSQL and
removed when a document is deleted. If replacing a prior Ollama embedding setup,
delete and re-upload previously indexed PDFs so their vectors use the new model.

## Deploy with Docker

Build the image from the repository root:

```sh
docker build -t nexgoai .
```

Run it with a PostgreSQL connection string and Groq API key:

```sh
docker run --rm -p 8000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://user:password@host:5432/database" \
  -e GROQ_API_KEY="your-groq-api-key" \
  nexgoai
```

The database must be reachable by the container. FastEmbed downloads its
embedding model on first use, so the container needs network access when the
model is not already cached. On a cloud platform, set `DATABASE_URL` and
`GROQ_API_KEY` as environment variables and configure the service to use the
container's `PORT` (default `8000`).

## Email and phone sign-in

Authentication uses Supabase Auth with email or SMS one-time codes. Create a
Supabase project and copy its URL and publishable key to the backend `.env`
and frontend `.env.local`, following the two `.env.example` files. Only use a
publishable/anon key in the browser, never a service-role key.

In Supabase Authentication, enable email sign-in and change the Magic Link
email template to include `{{ .Token }}` so users receive the code expected
by this UI. Configure SMTP for production email delivery. Enable phone sign-in
and configure an SMS provider to support phone verification. Configure provider
rate limits and delivery settings before public use. Provider charges may apply.

Run `python create_tables.py` before starting the updated backend. This adds
indexed ownership columns to existing databases. Existing anonymous chats and
PDFs are retained with no owner and hidden from signed-in accounts. To retain
access to your own legacy data, an administrator must explicitly assign those
rows to your verified Supabase user UUID after checking their ownership.

Every API request sends the current access token. FastAPI validates it against
the configured Supabase Auth server, requires a verified email or phone, and
scopes conversations, deletion, uploads and document retrieval to that user.
The browser SDK manages session refresh and persistence. Email and phone sign-in
can create separate accounts unless account linking is configured separately.

Validation of live email/SMS delivery requires configured provider credentials.
