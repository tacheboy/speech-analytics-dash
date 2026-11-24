# Vocobase Insights: speech analytics dashboard

A working speech-analytics dashboard for collections and sales floors. The information architecture follows Voxxi's product (see `docs/01-voxxi-teardown.md`), under our own brand.

It runs on a real Postgres database and **6 real APIs**. There is **no AI in this build**: transcription and LLM scoring are replaced by pre-authored analyses behind an `Analyzer` interface, so a real pipeline can drop in without touching the UI or the API.

Demo story: **Kaveri Finance** (a fictional NBFC) runs three collections floors that speak Tamil–English, Kannada–English and Hindi–English. Calls are scored against RBI fair-practice rubrics. This is the wedge the research doc recommends.

## Quick start

Needs Node 20+ and Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 17 on localhost:5433
npm install
npm run db:migrate
npm run db:seed               # ~1,260 calls over the last 60 days, relative to today
npm run dev                   # http://localhost:3000 → pick a demo user
```

**Demo users** (no passwords; the login page lets you pick one):
- **Ananya Iyer**: admin, sees everything.
- **Suresh Menon** / **Ritika Saxena**: managers, can review and override scores.
- **Any agent** (e.g. Rahul Sharma): sees only their own calls, dashboard and report card.

You can switch users from the menu at the bottom of the sidebar.

## What works

| Area | Status |
|---|---|
| Dashboard: KPIs with deltas and sparklines, trends, outcomes, top / needs-coaching agents, recent calls | ✅ live data |
| Calls: category index, list with URL-synced filters (agent, team, outcome, status, score/duration buckets, tags, reviewed, compliance, dates), sort, pagination, live processing status | ✅ live data |
| Upload: demo recording or your own MP3/WAV/M4A file; status goes processing → analyzed (~10 s) | ✅ live, but uploads of your own audio get a *simulated* analysis |
| Call detail: dual-channel waveform, moment markers, synced transcript (native script / romanised), Summary / Audit / Data tabs, evidence quotes that seek the audio, confidence | ✅ live data |
| Manager review: per-criterion override + coaching note; score recomputes, AI score kept | ✅ live data |
| Analytics (org / category / team / agent): overview, quality improvement hub, agent leaderboard, coaching profile (strengths, needs work, improvements, regressions) | ✅ live data |
| Agents, Teams, Review queue (lowest-scoring unreviewed, compliance flags, reviewed) | ✅ live data |
| Rubric configuration editor, Users & invites, Tags, Billing, Integrations, Settings | 🟡 **mockups**: clickable, nothing persisted, marked "Demo" |

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

Agents are role-scoped at the service layer: they only ever get their own calls and numbers.

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

**Deviations from the plan:**
- 28 call templates instead of ~30.
- ~1,260 seeded calls instead of ~1,500.
- Cache Components is off, since every page is per-user and dynamic.
