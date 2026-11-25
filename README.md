# Vocobase Insights: speech analytics platform

Recordings go in, evidence-backed scorecards come out. A collections or sales floor connects its dialer with one API call (or uploads recordings in the UI). Each conversation is transcribed, attributed speaker by speaker, scored against a configurable rubric with a quote and timestamp for every answer, tagged and measured. Results flow back by webhook.

- **Pipeline:** ingest → prepare (ffmpeg) → transcribe → analyze → finalize, run by a queue inside Postgres, each stage retry-safe.
- **Plug-and-play AI:** put an API key in `.env` and that provider is used. LLMs: Anthropic, OpenAI, Gemini, or any OpenAI-compatible endpoint (OpenRouter, Azure OpenAI, Groq, vLLM, Ollama…). Speech-to-text: Sarvam, Deepgram, OpenAI-compatible Whisper. No keys: mock providers replay demo scripts, so everything still runs.
- **Platform API:** 8 resources, about 20 operations, OpenAPI generated from the same schemas that validate requests. Our UI uses it too.
- **Runs anywhere:** `./dev.sh` locally; one `docker compose up` on any VM. Postgres is the only service.

The design and the reasoning behind it are in [`docs/05-pipeline-and-api-plan.md`](docs/05-pipeline-and-api-plan.md). How to run it in production is in [`docs/06-operations.md`](docs/06-operations.md).

## Quick start

Needs Node 20+ and Docker (running).

```bash
./dev.sh             # Postgres, deps, migrations, demo data, then the app (web + worker) on http://localhost:3000
./dev.sh --reseed    # same, but resets the demo data first
```

Pick a demo user on the login page:
- **Ananya Iyer**: admin, sees everything.
- **Suresh Menon** / **Ritika Saxena**: managers, can audit scorecards.
- **Any member** (e.g. Rahul Sharma): sees only their own conversations.

The demo org is **Kaveri Finance**, a fictional NBFC with three collections floors speaking Tamil–English, Kannada–English and Hindi–English, scored against RBI fair-practice rubrics. About 1,330 conversations over the last 60 days are seeded.

### Real transcription and scoring

Add keys to `.env` and restart:

```bash
ANTHROPIC_API_KEY=sk-ant-…        # scoring (Claude)
SARVAM_API_KEY=…                  # Indic code-mixed speech-to-text
LLM_MODEL=anthropic:claude-opus-5-5   # optional: pick a model (provider:model)
ASR_MODEL=sarvam:saaras:v4            # optional
```

```bash
npm run providers:check   # one tiny request to each configured provider
npm run eval -- --llm anthropic:claude-sonnet-5-5 --llm anthropic:claude-haiku-5-5   # compare models on the golden set
```

Settings → **AI providers** shows what's in use. Any other OpenAI-compatible endpoint works through `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` and `LLM_MODEL=compat:<model>`. See [`.env.example`](.env.example) for everything.

## The platform API

Base URL `/api/v1`, auth `Authorization: Bearer <key>` (keys from Workspace → Integrations; the demo key is `DEMO_API_KEY` in `.env`). The reference is at **/docs/api**, and the OpenAPI document is at `/api/v1/openapi.json`.

```bash
K="Authorization: Bearer vb_demo_7f3c9a1e2b4d"; B=http://localhost:3000/api/v1

# submit a recording (re-posting the same externalId returns the same conversation: 200 + Idempotent-Replayed)
curl -s -H "$K" -H "content-type: application/json" $B/conversations -d '{
  "externalId": "CALL-1001", "categoryId": "early-bucket", "audioUrl": "https://…/recording.mp3",
  "person": { "externalId": "AGT-204", "name": "Rahul Sharma" }, "metadata": { "loanId": "LN-2231" } }'

# demo recordings work without a URL
curl -s -H "$K" -H "content-type: application/json" $B/conversations -d '{"categoryId":"early-bucket","personId":"per_rahul_sharma","sampleId":"eb-hi-good"}'

curl -s -H "$K" $B/conversations/ext:CALL-1001                          # the full object, transcript included
curl -s -H "$K" "$B/conversations?updatedSince=2026-11-24T00:00:00Z"     # warehouse sync (includes deletions)
curl -s -H "$K" "$B/analytics?metrics=qualityScore,successRate,agreement&groupBy=person"
```

| Resource | Operations |
|---|---|
| Conversations | `POST /conversations` · `GET /conversations[/{id}]` · `DELETE /conversations/{id}` (erasure) · `POST /conversations/{id}/analyze` (re-score, or dry-run a draft rubric) · `PATCH /conversations/{id}/scorecard` (audit) |
| Uploads | `POST /uploads` → presigned PUT for your own files |
| Categories | `GET /categories[/{id}]` · `PUT /categories/{id}` (publish an immutable rubric version) |
| People · Cohorts · Tags | `GET/POST /people`, `GET/PATCH /people/{id}` · `GET/POST /cohorts`, `PATCH /cohorts/{id}` · `GET /tags`, `PUT /tags/{slug}` |
| Analytics | `GET /analytics?metrics=…&groupBy=day\|week\|person\|cohort\|category\|outcome\|tag\|criterion` |
| Webhooks | `GET/POST /webhooks` · `DELETE /webhooks/{id}`. Events `conversation.completed`, `.failed`, `.updated`, signed per Standard Webhooks, retried with backoff |

The API also has:
- the same error shape everywhere, `{ error: { type, code, message, param?, requestId } }`;
- cursor pagination;
- read-only and read-write keys;
- per-key rate limits.

A **Voxxi-compatible API** (same paths and payloads as docs.voxxi.ai) is kept, frozen, at `/api/external/v1` for teams migrating from Voxxi.

## What's in the product

| Area | |
|---|---|
| Pipeline | Upload or URL ingest (SSRF-guarded, 500 MB / 2 h) and ffprobe-style checks. Mono mixdown for ASR, plus per-channel energy, so stereo speaker attribution costs one ASR pass. One structured LLM call per conversation; every quote is verified against the transcript, with one repair retry. Rules applied after the model (deterministic NA), then scoring, tags and metrics. Typed failures (`audio_unreachable`, `too_short`, `analysis_failed`, …), a stuck-job sweeper, fallback providers, and provenance and cost on every analysis. |
| Platform (home), Conversations, Analytics, People, Cohorts | Live dashboards, a filterable list (URL-synced, cursor-paginated), and conversation detail: dual-channel waveform, synced transcript, Summary / Scorecard / Data. The Scorecard shows evidence that seeks the audio and flags quotes it couldn't verify. |
| Audits | Lowest-scoring not audited, **Needs review** (low confidence or unverified evidence), risk flags, audited. Overrides keep the AI answer and feed the AI–auditor agreement metric shown per criterion in Analytics → Quality. |
| Rubric configuration | Edit sections, criteria, outcomes, extraction fields and rules; **test the draft on recent conversations** (dry run); publish an immutable version; re-score recent conversations. |
| Integrations, Pipeline, Settings | API keys (read / write), webhooks with a delivery log, retries and auto-disable. Pipeline health: backlog, failures by code, p50/p95 latency, ₹ per conversation and per minute. AI providers in use. |
| Users, Billing | Mockups (marked "Demo"). Users are created with `npm run admin`. |

## How it's built

```
src/lib/contract.ts          zod: the API contract → validation, types, OpenAPI
src/server/
  http.ts auth.ts session.ts request handling: errors, request ids, scopes, rate limits, sign-in
  services/                  conversations · people · config (categories, cohorts, tags) · analytics · integrations · uploads
  presenters/conversation.ts DB rows → the Conversation object (the only place that shape is built)
  events.ts                  transactional outbox → webhook deliveries (Standard Webhooks)
  pipeline/
    queue.ts worker.ts       pg-boss queues per stage; the worker (in-process with ROLE=all, or `npm run worker`)
    stages/                  ingest · prepare · transcribe · analyze · finalize
    providers/               registry (env → providers) · anthropic · openai-compatible · sarvam · deepgram · mock · prices
    prompt.ts attribute.ts audio.ts   rubric → prompt + schema, evidence check · speaker attribution · ffmpeg
  scoring.ts targeting.ts metrics.ts  pure functions (unchanged contracts)
  storage.ts                 local disk or S3-compatible
  external/                  the frozen Voxxi-compatible adapter
scripts/                     seed · migrate · worker · admin · providers-check · eval · loadtest
eval/                        golden sets and the eval harness docs
```

## Scripts

| Command | |
|---|---|
| `./dev.sh` | Everything for local development (idempotent) |
| `npm test` | Unit + API tests: the real pipeline and worker on mock providers, against a separate `insights_test` database |
| `npm run build && npm run test:e2e` | Playwright smoke tests against the production build |
| `npm run eval` | Golden-set evaluation; `--llm a --llm b` compares models, `--gate` for CI |
| `npm run providers:check` | Test every configured provider |
| `npm run worker` | A standalone pipeline worker (with `ROLE=web` on the web tier) |
| `npm run admin -- org:create …` | Create an org, admin and API key on a fresh install |
| `npm run loadtest -- --n 500 --rate 5` | End-to-end throughput and latency through the API |
| `npm run db:seed` | Reset and reseed the demo data |

## Stack

Next.js 16 (App Router) · TypeScript · Postgres + Drizzle · pg-boss · zod · TanStack Query · Tailwind v4 + shadcn/ui · wavesurfer.js · Vitest · Playwright · ffmpeg (bundled via npm).

## Docs

- `docs/01-voxxi-teardown.md`: how Voxxi is built (from public surfaces)
- `docs/02-scope.md`, `docs/03-implementation-plan.md`: the original demo scope and plan
- `docs/04-voxxi-alignment.md`: gap analysis against Voxxi's product guide and API docs
- `docs/05-pipeline-and-api-plan.md`: the pipeline and platform API plan, and what was built
- `docs/06-operations.md`: deploy, configure, scale, runbook
