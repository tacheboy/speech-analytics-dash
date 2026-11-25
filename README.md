# Vocobase Insights: speech analytics platform

A working speech-analytics platform for collections and sales floors. The information architecture follows Voxxi's product (see `docs/01-voxxi-teardown.md`), under our own brand.

It runs on a real Postgres database, **6 platform APIs** and a **Voxxi-compatible external API with webhooks**. There is **no AI in this build**: transcription and LLM scoring are replaced by pre-authored analyses behind an `Analyzer` interface, so a real pipeline can drop in without touching the UI or the API.

Demo story: **Kaveri Finance** (a fictional NBFC) runs three collections floors that speak Tamil–English, Kannada–English and Hindi–English. Calls are scored against RBI fair-practice rubrics. This is the wedge the research doc recommends.

## Quick start

Needs Node 20+ and Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 17 on localhost:5433
npm install
npm run db:migrate
npm run db:seed               # ~1,330 calls over the last 60 days, relative to today
npm run dev                   # http://localhost:3000 → pick a demo user
```

**Demo users** (no passwords; the login page lets you pick one):
- **Ananya Iyer**: admin, sees everything.
- **Suresh Menon** / **Ritika Saxena**: managers, can audit conversations and override scores.
- **Any member** (e.g. Rahul Sharma): sees only their own conversations, platform view and report card.

You can switch users from the menu at the bottom of the sidebar.

## Naming

The UI uses: **Platform** (home), **Conversations** (calls), **People** (agents), **Cohorts** (teams), **Audits** (review queue), **Scorecard** (the per-conversation rubric tab), **Risk flags** (compliance flags), **Report card**. Roles are **admin, manager, member**. Internal code, the database and both APIs keep `call` / `agent` / `team` identifiers; the external API must match docs.voxxi.ai.

## The product model (as in Voxxi's product guide)

- **Category**: what the agent was trying to do. Each category owns a rubric, a list of possible outcomes, extraction fields and rules.
- **Rubric**: sections of yes/no questions. Each criterion is answered **Yes / No / NA**. NA means either there wasn't enough information, or a **rule** made it not applicable (e.g. "late-fee explanation" is NA when the customer paid on the call).
- **Outcome**: exactly one per call, of one of three types:
  - **Success**: the objective was achieved.
  - **Standard**: valid, but not successful.
  - **NA**: tracked, but excluded from all scoring (e.g. wrong party).
- **Quality score** = Yes ÷ (criteria − NA) × 100. **Success rate** = Success ÷ (Success + Standard) × 100. The guide's worked examples (75% and 37.5%) are unit tests.
- **Extraction**: Yes/No, choice, number and free-text fields pulled from each call. Reported per field under *Analytics → Call intelligence*.
- **Tags**: hierarchical (`objection › financial › medical`), **applied automatically** by rules over extracted data, the outcome and rubric answers. A few are added by managers. Filter by any level; *Call intelligence* shows the tag tree and **why calls weren't successful**.

## What works

| Area | Status |
|---|---|
| Platform: KPIs with deltas and sparklines, trends, outcomes, top / needs-coaching people, recent conversations | ✅ live data |
| Conversations: category index, list with URL-synced filters (person, cohort, outcome, status, score/duration buckets, tag at any level, extracted value, reviewed, risk flags, dates), sort, pagination, live processing status | ✅ live data |
| Upload: demo recording or your own MP3/WAV/M4A file; status goes processing → analyzed (~10 s) | ✅ live, but uploads of your own audio get a *simulated* analysis |
| Conversation detail: dual-channel waveform, moment markers, synced transcript (native script / romanised), Summary / Scorecard / Data tabs, evidence quotes that seek the audio, confidence | ✅ live data |
| Manager audit: per-criterion Yes/No/NA override, manual tags, coaching note; score recomputes, AI score kept | ✅ live data |
| Analytics (org / category / cohort / person): overview, quality improvement hub, **call intelligence** (tag tree, reasons for unsuccessful calls, extracted-data reports), people leaderboard, coaching profile | ✅ live data |
| Tags (taxonomy, rule vs manual, live counts) · Integrations (API keys, webhooks with delivery log, external API reference) | ✅ live data |
| People, Cohorts, Audits (lowest-scoring unreviewed, risk flags, reviewed) | ✅ live data |
| Rubric configuration editor (sections, outcome types, extraction fields, section/criterion/tag rules, versions), Users & invites, Billing, Settings | 🟡 **mockups**: show the live configuration; edits are not persisted; marked "Demo" |

Every number on the working screens is computed from the database. Uploads, overrides and date-range changes all move them.

## The 6 APIs

All live under `/api/v1`. Authenticate with the demo session cookie or `x-api-key: $DEMO_API_KEY` (from `.env`). Responses are `{ data }` or `{ error: { code, message } }`, and all input is zod-validated.

| # | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /workspace` | Org, current user, categories with rubrics, teams, agents, tags, demo samples |
| 2 | `GET /calls` | List calls: `categoryId, agentId, teamId, outcome, tag, status, scoreBucket, durationBucket, from, to, q, reviewed, compliance, sort, order, page, pageSize` |
| 3 | `POST /calls` | Create a call from a multipart `file`, or JSON `{ sampleId }` / `{ audioUrl }`, plus `categoryId` and `agentId` (id or email) → **202** `{ callId, status: "processing" }` |
| 4 | `GET /calls/:id` | Call, transcript, scored sections with evidence, extractions, conversation metrics, moments |
| 5 | `PATCH /calls/:id/review` | `{ overrides: [{ criterionId, result }], note?, tagIds? }`; recomputes the score |
| 6 | `GET /analytics` | `dimension=org\|category\|team\|agent&id&from&to`: KPIs vs previous period, trend, outcomes, durations, sections, criteria failure rates, leaderboard, agent coaching profile |

```bash
K="x-api-key: vb_demo_7f3c9a1e2b4d"
curl -s -H "$K" "localhost:3000/api/v1/calls?categoryId=mid-bucket&scoreBucket=poor&sort=score&order=asc&pageSize=5"
curl -s -H "$K" -H "content-type: application/json" -d '{"categoryId":"early-bucket","agentId":"rahul.sharma@kaverifinance.in","sampleId":"eb-hi-good"}' localhost:3000/api/v1/calls
curl -s -H "$K" "localhost:3000/api/v1/analytics?dimension=team&id=team_chennai"
```

Members are role-scoped at the service layer: they only ever get their own calls and numbers.

## External API (Voxxi-compatible)

A customer-facing API under `/api/external/v1` that follows the public Voxxi docs: same paths, status codes and payloads (`docs/reference/external-api-docs.txt`). Authenticate with `Authorization: Bearer <key>` or `x-api-key`, using a key created in **Workspace → Integrations** or `$DEMO_API_KEY`. Errors are `{ "error": "…" }` (400 / 401 / 404 / 409).

Endpoints: `GET/POST /agents`, `PATCH/DELETE /agents/{id}`, `POST /calls/presigned-url`, `POST /calls` (202), `GET /calls/{callId}/analysis`, `GET /categories`, `GET /categories/{categoryId}`.

```bash
B=http://localhost:3000/api/external/v1/; K="Authorization: Bearer vb_demo_7f3c9a1e2b4d"; J="Content-Type: application/json"
curl -X POST "${B}agents" -H "$K" -H "$J" -d '{"name":"Jane Agent","email":"jane.agent@example.com"}'            # → data.id = MEMBER_ID
curl -X POST "${B}calls/presigned-url" -H "$K" -H "$J" -d '{"filename":"demo-call.mp3","contentType":"audio/mpeg"}' # → presignedUrl, publicUrl
curl -X PUT "$PRESIGNED_URL" -H "Content-Type: audio/mpeg" --data-binary @demo-call.mp3                              # signed, 15 min, ≤ 50 MB
curl -X POST "${B}calls" -H "$K" -H "$J" -d '{"memberId":"'"$MEMBER_ID"'","categoryId":"early-bucket","audio_url":"'"$PUBLIC_URL"'"}'  # 202 → CALL_ID
curl "${B}calls/$CALL_ID/analysis" -H "$K"                                                                           # poll until data.status = "completed"
```

`audio_url` can also be any public recording URL: it is downloaded after the response, and a failed download ends the call as `failed` with a `call.ingestion_failed` event. Set `PUBLIC_BASE_URL` when the app sits behind a proxy, and `UPLOAD_SIGNING_SECRET` in production (it defaults to `DEMO_API_KEY`).

**Webhooks.** Add endpoints in Integrations. Each terminal call state POSTs `call.analysis_complete`, `call.analysis_failed` or `call.ingestion_failed` with headers `X-Insights-Event`, `X-Insights-Timestamp`, `X-Insights-Delivery-Id` and `X-Insights-Signature: v1=<hex>`. Every attempt is logged with its status and response. To try it without your own server, point an endpoint at `<origin>/api/dev/webhook-sink`.

```js
import crypto from "node:crypto";
function verify({ secret, timestamp, rawBody, signatureHeader }) {
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const provided = signatureHeader?.replace(/^v1=/, "");
  return Boolean(provided) && crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}
```

## How it works

```
content/rubrics/*.json         3 category rubrics: sections → yes/no criteria, outcomes, extraction fields, JSONLogic targeting
content/call-templates/*.json  28 authored code-mixed calls + the analysis an LLM would return
public/audio/*.m4a             stereo recordings (agent left, customer right) generated from the templates with macOS TTS
content/generated/             exact segment timings + English lexicon for the language-mix metric

POST /calls → call row (processing, ready_at = now + ~10 s)
read services → advancePipeline(): due calls are finalised by the Analyzer (idempotent, no worker or queue)
  └ MockAnalyzer: template → transcript, extractions, outcome → targeting (which sections apply) → criteria → score
```

- **Scoring** (`src/server/scoring.ts`): section score = met / applicable; call score = Σmet / Σapplicable; success rate = success outcomes / non-NA outcomes.
- **Conversation metrics** (`src/server/metrics.ts`): talk ratio, longest monologue, silence, questions, and word-level language mix. These are computed, not authored.
- **Adding real AI:** implement `Analyzer` (`src/server/pipeline/analyzer.ts`) with ASR + LLM. Then swap lazy completion for a queue (Inngest / Trigger.dev) and swap `storage/uploads` for S3. The API and UI don't change.

## Stack

- Next.js 16 (App Router, Route Handlers) · TypeScript · Tailwind v4 + shadcn/ui (Base UI)
- TanStack Query · nuqs · Recharts · wavesurfer.js
- Postgres + Drizzle · zod · Vitest · Playwright

## Scripts

| Command | |
|---|---|
| `npm test` | Unit + API tests (they create and seed a separate `insights_test` database) |
| `npm run build && npm run test:e2e` | Playwright smoke tests against the production build |
| `npm run content:check` | Validates every template against its rubric (criteria, targeting, evidence lines) |
| `npm run audio:generate` | **macOS only.** Re-renders `public/audio` and the timings after editing templates (output is committed) |
| `npm run db:seed` | Resets and reseeds deterministically |

## Docs

- `docs/01-voxxi-teardown.md`: how Voxxi is built (reverse-engineered from public surfaces)
- `docs/02-scope.md` and `docs/03-implementation-plan.md`: scope and the plan this build follows
- `docs/04-voxxi-alignment.md`: gap analysis against Voxxi's product guide and docs.voxxi.ai, and what closed each gap

**Deviations from the plan:**
- 28 call templates instead of ~30.
- ~1,260 seeded calls instead of ~1,500.
- Cache Components is off, since every page is per-user and dynamic.
