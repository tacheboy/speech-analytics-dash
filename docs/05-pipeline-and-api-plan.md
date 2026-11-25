# Plan: the real speech pipeline and the platform API

**Status:** built (2026-11-25). All decisions settled; see "Build status" below for what shipped, how it was verified, and what is left.
**Reads with:** the research doc (*Speech Analytics Landscape & Building a Voxxi-style Platform*), `docs/04-voxxi-alignment.md`, and the current code.

---

## Build status (2026-11-25)

Phases 0–4 are built and verified against mock providers. Measuring against real providers needs keys and real recordings (D7).

| Phase | Built | Verified by |
|---|---|---|
| 0 | Provider registry and adapters (Anthropic, OpenAI-compatible incl. Gemini/OpenRouter/Azure/vLLM, Sarvam batch, Deepgram, OpenAI-compatible Whisper, mock); `providers:check`; eval harness (`npm run eval`, G1 built in, G2 format in `eval/README.md`, gates from §1, `--gate` for CI) | G1 runs end to end (mock = 100% by construction). Real-model numbers need keys |
| 1 | zod contract → OpenAPI (`/api/v1/openapi.json`, `/docs/api`); error envelope, request ids, scopes, rate limits, cursor pagination, `updatedSince` sync, `ext:` addressing, natural idempotency; schema migration with the vocabulary rename; outbox + Standard Webhooks with retries; pg-boss worker (`ROLE=all\|web\|worker`); UI moved onto `/api/v1` | 18 API tests run the real worker: idempotent replay, sync with tombstones, org isolation, read-only keys, rate limits, signatures |
| 2 | Storage (local disk / S3); ingest with SSRF guard; ffmpeg prepare (mixdown, channel energy, playback); transcribe (async poll, keyterms, attribution, fallback); analyze (structured output, evidence check, one repair, fallback, cost); finalize (rules, score, tags, metrics, overrides kept); typed failures; sweeper | Upload → PUT → submit → completed; 404 URL → `audio_forbidden`; 3 s file → `skipped/too_short`; Voxxi-adapter tests through the same pipeline |
| 3 | `POST /analyze` (re-score, dry run with draft rubric); `PATCH /scorecard`; `PUT /categories` (immutable versions, validation); `GET /analytics` (metrics × groupBy incl. `agreement`); rubric editor wired: test draft on recent conversations, publish, re-score; agreement per criterion in Analytics → Quality; Audits "Needs review" queue | API tests (dry run saves nothing; overrides survive re-analysis; versions immutable, unchanged PUT is a no-op) |
| 4 | Dockerfile (one image), `compose.prod.yml` (+ Caddy HTTPS profile), migrations on start under an advisory lock, `/api/health`, password sign-in + `npm run admin` bootstrap (demo login off in production), retention and erasure, Pipeline ops page, JSON logs, load test, runbook (`docs/06-operations.md`) | Compose stack brought up clean: seed, pipeline, `org:create`, password login, cross-org isolation. Load test: 1.5 conversations/s sustained on one process, p95 162 s under a 10/s burst, 0 failures. 10 Playwright tests |

**Changed from the plan while building:**
- **Sarvam returns timestamps per chunk or per diarized turn, not per word.** Attribution therefore works on "timed units" of any size: each unit goes to the louder channel. Diarization is requested on stereo too, so units are single-speaker turns. §5.4's "word timestamps mandatory" no longer applies.
- **Webhook retries:** 8 attempts with exponential backoff over about 2 hours, rather than about 24 hours. Auto-disable after 3 days of failing is kept.
- **Bulk re-analysis** runs through the normal analyze queue rather than provider batch APIs. Batch pricing is an optimisation left for later.
- **Sign-in is real now.** There is a signed session cookie and email + password (scrypt). The demo user picker only works with `DEMO_LOGIN=true`.
- **Ops view.** Sentry was not added. Workspace → Pipeline shows backlog, failures by code, latency, cost and webhook health from our own tables.

**Not done (each needs an input we don't have yet, or is a later optimisation):**
- Real-provider eval numbers and G2 (need keys and the 150 recordings).
- Transliteration of native-script ASR output (the "Romanised" toggle shows only where the ASR returns roman text).
- `?include=words`.
- Per-category moment types.
- Provider batch APIs.
- An error tracker.
- User management in the UI.

## 0. Summary

**What we have:** a working product shell. It has a rubric engine, scoring, tags, reporting, the UI, a Voxxi-compatible API and webhooks. The speech and AI core is simulated: transcripts are scripted, and every "analysis" is a pre-written answer replayed by `MockAnalyzer`.

**What this plan delivers:**
1. **A real post-call pipeline:**
   - audio in (upload or URL);
   - speech-to-text for code-mixed Tamil/Kannada/Hindi–English;
   - speakers attributed;
   - LLM scoring against the category rubric, with evidence that is checked against the transcript;
   - the scores, tags and metrics we already compute;
   - webhooks out.
2. **One platform API.** It is small and resource-oriented: **8 resources and about 20 operations**. It is designed for the people who will actually integrate it (dialers, CRMs, BI teams, collections ops). Our own UI uses it too, so its quality is tested every day.
3. **An evaluation harness.** No prompt, model or ASR change ships unless it holds its scores on a golden set.

**The engineering calls that matter most:**

| # | Call | Why |
|---|---|---|
| 1 | **One ASR pass per conversation, even for stereo.** Mix both channels down to mono, transcribe once, then attribute each word to agent or customer by comparing channel energy at that word's timestamp. | ASR is the biggest cost line (doc §Unit economics). Transcribing each channel separately doubles billed minutes. This keeps stereo's near-perfect speaker split at mono's price. It is verified in Phase 0 before we rely on it. |
| 2 | **One LLM call per conversation, with structured output.** The rubric becomes a JSON schema (answers, outcome, extractions, summary, moments). Targeting rules are applied *after* the call. | One call, simple to cache and retry. Rule-driven NA stays deterministic and auditable, never left to the model. |
| 3 | **Evidence or it didn't happen.** Every Yes/No must cite a transcript segment and a quote that we verify ourselves. Unverified answers get one repair retry, then are flagged for review. | Wrong scores are what customers churn over (doc §Making auto-QA trustworthy). |
| 4 | **Postgres is the only required dependency.** The job queue is `pg-boss`, inside the same Postgres. Audio goes to local disk by default, or to any S3-compatible bucket if one is configured. No Redis or Kafka, no hosted workflow SaaS, no system ffmpeg. | Anyone can run it with `./dev.sh` and deploy it with one `docker compose up` on any VM, in any region (§8.2). pg-boss scales well past our 12-month volume. |
| 5 | **Natural idempotency instead of an idempotency-key system.** `externalId` (the dialer's call ID) is unique per org. Re-posting the same conversation returns the existing one. | Dialers retry webhooks. This removes duplicate charges and duplicate rows without a separate key store. |
| 6 | **Provenance on every analysis.** Each analysis records the rubric version, prompt version, ASR provider and model, LLM provider and model, tokens, audio seconds and cost. | Makes trends comparable across rubric changes, makes reanalysis safe, and gives us real cost per conversation. |
| 7 | **Inference is plug and play.** Set a provider's API key in `.env` and it becomes available. One line picks the model (`LLM_MODEL=anthropic:claude-opus-5-5`), with an optional fallback. Two LLM adapters cover most of the market: Anthropic native, and one OpenAI-compatible adapter for OpenAI, Gemini, Azure OpenAI, OpenRouter, Groq and self-hosted vLLM/Ollama. ASR works the same way: Sarvam, Deepgram, or any OpenAI-compatible transcription endpoint (§5.4). | Choosing a model becomes a config change backed by an eval report, not a code change. With no keys at all, mock providers keep the whole app runnable. |

**Status of decisions (§12):** all settled on 2026-11-25. The model is a config value chosen from the eval report, hosting is portable with the first deploy on one VM in Mumbai, and inference keys live in env vars.

---

## 1. Objective, impact, goals

### Objective
Turn the demo into a product a collections or sales floor can connect its dialer to. Recordings go in; trustworthy, evidence-backed scorecards come out within minutes. The integration surface should be one a developer can learn in an afternoon.

### Impact
- **For customers:** QA coverage goes from roughly 2% (manual sampling) to 100% of connected conversations. Scores are explainable (a quote and timestamp per answer), and results flow into their systems (webhook to CRM or BI) without anyone opening our UI.
- **For us:** the API *is* the product for integrators and channel partners. Dialer marketplace distribution is moat #4 in the research doc. A clean, stable, well-documented API is the cheapest sales asset we will ever build.
- **For the business:** we measure real cost per analysed minute from day one. That is the number that decides pricing (doc §Unit economics).

### Goals (measurable)

| Area | Target at end of plan |
|---|---|
| Accuracy: rubric answers | ≥ 85% agreement with human auditors overall, with no criterion below 70%, on the golden set (doc's target) |
| Accuracy: outcome | ≥ 90% match with human label |
| Accuracy: extraction (enum/boolean) | ≥ 90% exact match |
| Evidence | ≥ 95% of Yes/No answers carry a verified quote |
| Speaker attribution | ≥ 97% of words attributed to the right side (stereo) |
| Latency | p95 ≤ 5 min from "audio available" to `conversation.completed`, for calls up to 15 min |
| Reliability | ≥ 99.5% of valid recordings complete without manual action; every failure has a typed reason |
| Throughput | Sustains 100k conversations/day (≈ 1.2/s average, 5/s peak) on the default deployment |
| Integration | A developer goes from API key to first webhook in < 30 min, using only the docs |
| Cost visibility | Cost per conversation recorded on every analysis; dashboard shows ₹/analysed minute |

### Non-goals (explicitly out of this plan)
- Real-time or live agent assist (doc: Phase 3 product).
- Semantic search or "ask your calls" (v1 feature, later).
- Self-hosted ASR or GPUs. We buy ASR now (doc: "buy now, self-host at scale").
- Native dialer connectors (Exotel, Ozonetel). `audio_url` + `externalId` + webhooks make any dialer integrable today; connectors are a later distribution play (§10, Later).
- PII redaction (planned for after this; §8 covers what we do now).
- SSO, multi-org admin, billing integration.

---

## 2. Honest baseline

| Layer | Today | After this plan |
|---|---|---|
| Ingest | Upload to local disk; remote URL fetched inside the request lifecycle (`after()`) | S3 presigned upload or URL fetch, done in a worker with retries; probed with ffprobe |
| Audio prep | None | ffmpeg: decode, mono mixdown, per-channel energy envelope, browser playback file |
| ASR | None (scripted transcripts) | Sarvam Saaras (code-mix) behind an `Asr` interface; mock kept for tests |
| Speakers | Scripted | Channel-energy attribution (stereo) or diarization + role detection (mono) |
| Analysis | Pre-written JSON per template | One structured-output LLM call per conversation; evidence verification |
| Scoring, tags, metrics | ✅ real, reused unchanged | same |
| Orchestration | "Lazy completion" on read (no worker) | pg-boss queues + one worker service |
| Webhooks | Single attempt, no retries | Outbox + retries with backoff, Standard Webhooks signatures |
| API | Internal `/api/v1` (UI-shaped) + Voxxi adapter | One public `/api/v1` (resource-shaped) used by UI and customers; Voxxi adapter kept, frozen |
| Rubric versions | A version number; no history | Immutable rubric versions; every analysis points at one |

We keep the scoring, targeting, tag rules, metrics, the UI and the Voxxi presenter. Roughly 60% of the existing server code survives as is.

---

## 3. Who calls the API, and what they need

The API design follows from these jobs, not from our screens.

| Consumer | Job to be done | What they need from us |
|---|---|---|
| **Dialer / telephony** (Exotel, Ozonetel, in-house) | "After every connected call, send the recording." | One POST with an audio URL and their call ID. Dedupe on retries. No pre-registration of agents. |
| **Customer backend / CRM** (Salesforce, LeadSquared, a collections LMS) | "When a call is scored, update the account: promise-to-pay date, dispute flag, score." | A webhook with the full result, verifiable signatures, a stable shape, and a pull API to reconcile missed events. |
| **BI / data team** | "Nightly sync of all scores into our warehouse." | A list endpoint with `updatedSince` and cursor pagination, plus an aggregate endpoint for numbers. |
| **QA / ops lead** (via our UI, or scripts) | "Change the rubric, see what it would do to last week's calls, then publish." | Rubric as config (PUT a version), dry-run reanalysis, audit overrides. |
| **Our UI** | Everything above, plus composite dashboard views | Same API with session auth. A handful of UI-only composite endpoints. |

**The design target:** a dialer integration is two calls (`POST /uploads` is optional) plus a webhook handler, and a BI sync is one paginated GET.

---

## 4. The platform API

### 4.1 Principles

1. **Few resources, complete objects.** A `Conversation` carries its status, scorecard, outcome, extractions, tags, metrics and transcript. There is one object to learn, and no `/analysis` vs `/transcript` vs `/metrics` split.
2. **Natural keys beat ceremony.** `externalId` on conversations and people makes POSTs idempotent and lets customers address our objects by their own IDs (`GET /conversations/ext:CALL-8812`).
3. **Async is explicit.** Creating a conversation returns `202` with a `status`. Completion is pushed (webhook) and pullable (`GET`). Every failure has a machine-readable `code` and says whether it is `retryable`.
4. **One way to do each thing.** No aliases, no alternative field spellings. The only deliberate exception is the frozen Voxxi adapter, which lives on its own path.
5. **Additive evolution.** Within `v1` we only add fields and endpoints. Clients must ignore unknown fields (documented). Breaking changes need `v2`.
6. **Contract-first.** zod schemas are the single source of truth for validation, TypeScript types, the OpenAPI spec and the docs page. No hand-written spec that can drift.

### 4.2 Conventions (apply to every endpoint)

| Topic | Rule |
|---|---|
| Base URL | `https://<host>/api/v1` |
| Auth | `Authorization: Bearer <key>` (API keys), or the session cookie (our UI). Keys have a scope: `read` or `write`. |
| Format | JSON, **camelCase** fields (matches our TS code and the Voxxi payloads customers already know), ISO-8601 UTC timestamps, durations in seconds. |
| IDs | Opaque, prefixed: `conv_…`, `per_…`, `coh_…`, `cat_…`, `wh_…`, `evt_…`. Customer IDs are accepted wherever an object is addressed, as `ext:<externalId>`. |
| Lists | `{ "data": [...], "nextCursor": "…" \| null }`. Query `limit` (default 50, max 200) and `cursor`. Stable ordering. |
| Errors | `{ "error": { "type", "code", "message", "param"?, "requestId" } }`. Types: `invalid_request` 400, `authentication` 401, `permission` 403, `not_found` 404, `conflict` 409, `rate_limited` 429, `api_error` 500. `code` is a stable snake_case string (`category_not_found`, `audio_url_unreachable`, …) and is documented. |
| Request IDs | Every response has `X-Request-Id`, and it is logged everywhere for support. |
| Rate limits | Per key: 600 req/min (default), 429 with `Retry-After`. `RateLimit-Limit/Remaining/Reset` headers. |
| Idempotency | Natural keys (`externalId`). A POST that matches an existing object returns **200 + the existing object** and the header `Idempotent-Replayed: true`, not a 409. |

### 4.3 The resources

| Resource | What it is |
|---|---|
| **Conversation** | One recorded call: its audio, transcript and analysis. The core object. |
| **Upload** | A short-lived presigned URL for sending audio directly to storage. |
| **Person** | Someone whose conversations are analysed (the *member* role in our UI). Has an `externalId` for the dialer's agent ID. |
| **Cohort** | A group of people (floor, team, batch). Used for reporting. |
| **Category** | The purpose of a conversation. Holds the current rubric: sections, criteria, outcomes, extraction fields, rules and tag targets. Versioned. |
| **Tag** | A node in the org's hierarchical taxonomy (`objection/financial/medical`). |
| **Analytics** | Aggregates over conversations, grouped and filtered. |
| **Webhook** | An endpoint subscribed to events. |

### 4.4 Endpoints

Tier A is the integration loop and ships first. Tier B is the quality loop. Tier C is supporting configuration.

| # | Tier | Method & path | Purpose | Notes |
|---|---|---|---|---|
| 1 | A | `POST /uploads` | Get a presigned URL for direct-to-storage upload | `{ fileName, contentType, sizeBytes }` → `{ uploadUrl, audioUrl, expiresAt }`. Direct PUT (S3 presigned, or our own signed endpoint when storage is local disk), 15 min, ≤ 500 MB. Optional: callers with a public URL skip it. |
| 2 | A | `POST /conversations` | Submit a recording for analysis | See 4.5. **202** new, **200** replayed (same `externalId`). Person is upserted inline by `externalId` or `email`. |
| 3 | A | `GET /conversations/{id}` | The full object | `?include=words` adds word-level timings. `{id}` also accepts `ext:<externalId>`. |
| 4 | A | `GET /conversations` | List, filter, sync | Filters: `status, categoryId, personId, cohortId, outcome, tag` (any level), `ext=<field>:<value>`, `riskFlag, audited, from, to` (call time), **`updatedSince`** (sync). Transcript omitted in lists. |
| 5 | A | `GET /categories` · `GET /categories/{id}` | Read rubric config | Includes `version`. `?version=n` reads an older one. |
| 6 | A | `GET/POST /people` · `PATCH /people/{id}` | Manage people | `externalId`, `email`, `name`, `cohortId`, `active`. POST upserts on `externalId`/`email`. Deactivate, never hard-delete (history stays). |
| 7 | A | `GET/POST /webhooks` · `DELETE /webhooks/{id}` | Subscribe to events | `{ url, events[] }` → returns the signing secret once. Test sends and the delivery log stay in the UI. |
| 8 | B | `POST /conversations/{id}/analyze` | Re-run analysis | `{ categoryId?, rubricVersion? }`: re-score with the current or a chosen rubric (reuses the transcript, no ASR cost). `{ dryRun: true, rubric? }` scores against a **draft** rubric and returns the result without saving it. That is how rubric changes are tested before publishing. |
| 9 | B | `PATCH /conversations/{id}/scorecard` | Human audit | `{ overrides: [{ criterionId, result }], outcomeId?, tagSlugs?, note? }`. Recomputes the score, keeps the AI answer, emits `conversation.updated`. Overrides become calibration data. |
| 10 | B | `PUT /categories/{id}` | Create or publish a rubric version | Full category document (config-as-code friendly). Validated: IDs unique, rules parse, tag targets exist. Each publish = new immutable version. |
| 11 | B | `GET /analytics` | Aggregates | `metrics=qualityScore,successRate,volume,minutes,riskRate,agreement` · `groupBy=day\|week\|person\|cohort\|category\|outcome\|tag\|criterion` · same filters as #4. Returns rows. One endpoint replaces bespoke report APIs. |
| 12 | B | `DELETE /conversations/{id}` | Erasure | Deletes audio, transcript and analysis (DPDP right to erasure). Keeps a tombstone (`id`, `externalId`, `deletedAt`) so syncs see the deletion. |
| 13 | C | `GET/POST /cohorts` · `PATCH /cohorts/{id}` | Groups for reporting | `{ name, language? }`. Language is a default ASR hint for its people. |
| 14 | C | `GET /tags` · `PUT /tags/{slug}` | Tag taxonomy | Upsert by slug path; parents auto-created. |

That is 8 resources and about 20 operations. **Deliberately not included:**
- `/transcripts`, `/scores`, `/metrics` as separate resources: they are fields of a conversation.
- An `/events` feed: `GET /conversations?updatedSince=` is the reconciliation path, and it is simpler for customers than replaying events.
- Bulk import: loop over #2. It's cheap, and natural idempotency makes retries safe. Revisit only if a customer needs more than 50k backfills.
- API-key management via API: keys are created in the UI by an admin, which avoids a privilege-escalation surface.
- Separate presigned-URL flows per storage: one `POST /uploads`.

### 4.5 `POST /conversations` in detail

```jsonc
// request
{
  "externalId": "EXO-CALL-88123",            // optional, strongly recommended: the dialer's call id (dedupe + lookup)
  "audioUrl": "https://…/rec.mp3",          // public/presigned URL, or the audioUrl returned by POST /uploads
  "categoryId": "cat_early_bucket",          // required for now ("auto" = classify, later)
  "person": { "externalId": "AGT-204", "email": "rahul@…", "name": "Rahul Sharma" }, // upserted; or "personId"
  "occurredAt": "2026-11-25T09:14:00+05:30", // call time (defaults to now)
  "language": "ta-en",                       // optional hint; default: person's cohort language, else auto-detect
  "channels": { "agent": "left" },           // stereo layout; default left = agent. "mono" forces diarization.
  "metadata": { "loanId": "LN-2231", "dpd": 12 } // free-form, ≤ 4 KB, returned as is, usable in targeting rules
}

// 202 response — the same Conversation object as GET, at status "queued"
{ "id": "conv_8Kf2…", "externalId": "EXO-CALL-88123", "status": "queued", "stage": null, … }
```

### 4.6 The Conversation object (abridged)

```jsonc
{
  "id": "conv_8Kf2…", "externalId": "EXO-CALL-88123",
  "status": "completed",            // queued | processing | completed | failed | skipped
  "stage": null,                    // while processing: ingesting | transcribing | analyzing
  "failure": null,                  // { code, message, stage, retryable } when failed / skipped
  "categoryId": "cat_early_bucket", "rubricVersion": 4,
  "person": { "id": "per_…", "externalId": "AGT-204", "name": "Rahul Sharma", "cohortId": "coh_chennai" },
  "occurredAt": "…", "createdAt": "…", "completedAt": "…", "updatedAt": "…",
  "audio": { "durationSec": 312, "channels": 2, "playbackUrl": "https://…(signed, 1h)" },
  "language": { "hint": "ta-en", "detected": { "ta": 0.64, "en": 0.36 } },
  "score": 72, "aiScore": 75,       // aiScore stays fixed when an auditor overrides
  "outcome": { "id": "ptp", "label": "Promise to Pay", "type": "success", "rationale": "…" },
  "riskFlag": false,
  "summary": "…", "observations": "…", "improvements": "…",
  "scorecard": [ {
    "sectionId": "opening", "name": "Opening & RPC", "passed": 2, "applicable": 3,
    "criteria": [ {
      "criterionId": "rpc_verified", "question": "…",
      "result": "yes",              // yes | no | na
      "source": "ai",               // ai | audit | rule
      "naReason": null,             // "rule: only when customer disputes" | "insufficient_information"
      "rationale": "…", "confidence": 0.92,
      "evidence": { "quote": "…", "start": 12.4, "end": 15.1, "verified": true }
    } ]
  } ],
  "extractions": { "ptp_date": "2026-11-30", "ptp_amount": 18500, "delay_reason": "medical" },
  "tags": [ { "slug": "objection/financial/medical", "source": "rule" } ],
  "moments": [ { "type": "ptp", "start": 141.2, "label": "Promised ₹18,500 by 30 Nov" } ],
  "metrics": { "talkRatio": 0.58, "longestMonologueSec": 41, "silencePct": 0.07, "questionsAsked": 9, "interruptions": 3 },
  "transcript": [ { "start": 0.4, "end": 3.1, "speaker": "agent", "lang": "ta", "text": "…", "roman": "…" } ],
  "metadata": { "loanId": "LN-2231", "dpd": 12 },
  "audit": { "auditedBy": "per_…", "auditedAt": "…", "note": "…" },
  "analysis": { "id": "anl_…", "models": { "asr": "saaras:v3", "llm": "claude-…" }, "promptVersion": "2026-12-01" }
}
```

### 4.7 Status and failure model

```
queued → processing(ingesting → transcribing → analyzing) → completed
                                  ↘ failed   (failure.code, failure.stage, failure.retryable)
                                  ↘ skipped  (too short / no speech: not billed)
```

| `failure.code` | Stage | Retryable | Meaning |
|---|---|---|---|
| `audio_unreachable` | ingesting | yes | URL timed out or returned 5xx after retries |
| `audio_forbidden` | ingesting | no | 401/403/404 at the URL (expired presign, etc.) |
| `audio_invalid` | ingesting | no | Not decodable, or exceeds limits |
| `too_short` | ingesting | no (status `skipped`) | Below the org's minimum duration (default 15 s) |
| `no_speech` | transcribing | no (status `skipped`) | ASR returned no words |
| `transcription_failed` | transcribing | yes | Provider error after retries |
| `analysis_failed` | analyzing | yes | LLM error, or output invalid after the repair attempt |

`retryable` failures can be retried with `POST /conversations/{id}/analyze`, or automatically by the worker before it gives up. Customers never have to parse a message string.

### 4.8 Webhooks

- **Events:**
  - `conversation.completed`
  - `conversation.failed` (covers `skipped` too, with `failure.code`)
  - `conversation.updated` (audit override, reanalysis, deletion)
- **Envelope:** `{ "id": "evt_…", "type": "conversation.completed", "createdAt": "…", "data": { "conversation": { …full object without transcript… } } }`. Transcripts can be big, so receivers fetch them with `GET` if needed.
- **Signatures:** follow the **Standard Webhooks** spec (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 hmac-sha256>`). Customers can verify with off-the-shelf libraries in every language instead of our snippet. This replaces today's `X-Insights-*` headers; the Voxxi adapter keeps its own.
- **Delivery:**
  - transactional outbox (the event row is written in the same transaction as the state change), then a delivery queue;
  - retries with exponential backoff, 8 attempts over about 24 h;
  - an endpoint failing for 3 days straight is disabled, with a banner in the UI;
  - at-least-once delivery, with `evt_` id for dedupe.
- **Reconciliation:** `GET /conversations?updatedSince=<last sync>` is documented as the safety net.

### 4.9 How our UI uses it, and the Voxxi adapter

- The UI moves onto the public `/api/v1` for every overlapping read and write (conversations, people, categories, scorecard, analytics). The few composite views that only the UI needs live under `/api/internal/*`:
  - workspace bootstrap (`me`, nav data);
  - platform home (several aggregates in one round trip).
- The **Voxxi-compatible adapter** stays at `/api/external/v1`, **frozen**. It is a thin mapper over the same services (it already is), so it costs nothing. It gives Voxxi customers a drop-in migration path. New capability only ever goes into `/api/v1`.

---

## 5. The pipeline

### 5.1 Shape

```
 POST /conversations ──► conversations row (queued) + job ──┐
                                                          ▼
 ┌──────────── worker (pg-boss queues) ─────────────────────────────────────────┐
 │ 1 ingest      fetch/confirm audio → store original → ffprobe (duration, channels, rate)  │
 │               → too short? skipped                                                   │
 │ 2 prepare     ffmpeg: mono mix (16 kHz) for ASR · per-channel energy envelope (20 ms) │
 │               · playback file (opus/m4a) for the browser                               │
 │ 3 transcribe  ASR submit → delayed poll → words with timings + lang                  │
 │               → speaker attribution → segments (native + roman)                      │
 │ 4 analyze     build prompt + JSON schema from rubric version → LLM (structured)      │
 │               → verify evidence → repair once if needed                              │
 │ 5 finalize    targeting rules (NA by rule) · score · metrics · tag rules · persist   │
 │               (one transaction) + outbox event                                        │
 └──────────────────────────────────────────────────────────────────────────────────┘
                                                          ▼
                                              webhook delivery queue
```

Each stage:
- is a single function `run(conversationId)` that reads its inputs from the database or storage, writes its outputs, then enqueues the next stage;
- is **idempotent**: if its output already exists, it skips. So a retry never pays for ASR twice (the doc's "without double-billing ASR");
- has its own queue with its own concurrency limit (matched to the provider's rate limit), retry policy and timeout.

The conversation row holds `status` and `stage`, so the API always tells the truth about where a conversation is.

### 5.2 Stage details

**1. Ingest**
- Sources:
  - a presigned upload (object already in storage; we check it exists);
  - a remote URL (streamed into storage with a 60 s connect / 10 min total timeout, 3 retries on 5xx or timeouts, none on 4xx).
- Store the original at `…/org/{orgId}/conv/{id}/original.{ext}`.
- `ffprobe` gives duration, channels, sample rate and codec. Limits: 2 h, 500 MB.
- Below the minimum duration → `skipped/too_short`. This is the doc's main cost lever: "analyse only connected calls over ~30 seconds".

**2. Prepare** (ffmpeg and ffprobe from the `ffmpeg-static` / `ffprobe-static` npm packages, so nobody installs ffmpeg)
- `asr.flac`: mono mixdown, 16 kHz.
- For stereo, `energy.json`: RMS per channel in 20 ms frames (about 25 KB for a 5-min call).
- `playback.m4a` for the UI, so the browser never streams 8 kHz WAVs.
- No VAD or denoise in v1. Sarvam handles telephony audio, and we add steps only if the eval shows a gain.

**3. Transcribe**
- **Provider:** whichever `ASR_MODEL` names (§5.4). Sarvam Saaras is the expected default because it is built for 8 kHz code-mixed Indic audio (doc §Tech stack). Deepgram and OpenAI-compatible transcription are the alternatives.
  - Every provider sits behind the same `Asr` interface (§5.4), so the rest of this stage never knows which one ran.
  - `mock` (built from our 28 templates) keeps the tests, CI and the keyless demo working.
  - Phase 0 checks each provider's limits, timestamp granularity and code-mix output format, and whether to use Sarvam's batch or sync API by file length.
- **Async:** submit, then poll with delayed jobs (15 s, backing off to 60 s). No worker slot sits waiting.
- **Keyterms:** org- and category-level vocabulary (product names, plan names, lender name) is passed to ASR wherever the provider supports it (doc's third technical call).
- **Speaker attribution:**
  - *Stereo:* for each word, compare the summed energy of the agent and customer channels over the word's time span; the louder channel wins. Words where neither channel clearly dominates (overlapping speech) take their neighbours' speaker. Words are then grouped into segments by speaker change and pauses over 0.7 s.
  - *Mono:* provider diarization. Which diarized speaker is the agent is decided by a rule plus a cheap check: the speaker who says the org name or greeting first. A mismatch flags the conversation `lowConfidenceSpeakers`.
- **Roman text:** when the provider's code-mix output is not already in Latin script, we transliterate (Sarvam transliterate API, or similar), so the UI's "Romanised" toggle and search work.

**4. Analyze**
- **Input:**
  - the transcript as numbered lines (`[17 A 02:14] text`);
  - the category's intended purpose and additional LLM context;
  - the rubric (criteria with definitions and pass/fail examples);
  - outcomes with descriptions;
  - extraction fields with types and enum hints;
  - moment types;
  - `metadata`.
- **Output:** strict JSON schema generated from the rubric version:
  - every criterion answered with `result` (yes/no/na), `rationale`, `evidenceLine`, `evidenceQuote` and `confidence`;
  - exactly one outcome id from the enum;
  - typed extractions;
  - summary, observations, improvements, moments.

  Providers that support strict schema-constrained output use it (Claude's `output_config.format`, OpenAI-style `response_format: json_schema`). For the rest, the adapter asks for JSON and zod validates it, and a schema miss goes through the same single repair request as an evidence miss. The schema generator stays inside the subset every strict mode accepts: objects with every field required, `additionalProperties: false`, enums, no `oneOf`.
- **One prompt for all providers:** plain system text plus user text, no provider-specific tricks in the prompt files. Provider features are optimisations inside the adapter, never requirements.
- **Caching:** instructions and the rubric go first in the prompt, so all conversations of one category share that prefix. The transcript goes last. The Anthropic adapter marks the prefix with `cache_control`. OpenAI and Gemini cache stable prefixes automatically, so the ordering alone gets the discount.
- **Evidence verification** (deterministic, our code): the quote is normalised (case, punctuation, script-insensitive using the roman text) and must fuzzy-match (≥ 0.85 token overlap) inside the cited line ±1.
  - If any Yes/No fails, we send **one repair request** listing the failures.
  - Anything still unverified keeps the model's answer with `evidence.verified=false`, confidence capped at 0.5, and the conversation lands in the Audits queue.
- **Model:** whatever `LLM_MODEL` names (§5.4). The eval harness (§7) compares any set of configured models side by side, and the cheapest one that clears the §1 gates becomes the default. Cost per conversation differs by roughly 40× across candidates (§8.3).
- **Bulk reanalysis** (after a rubric publish) uses the provider's batch API when the adapter has one (Anthropic Message Batches, OpenAI Batch; about 50% cost). Otherwise it runs on a low-priority queue. Latency doesn't matter there.

**5. Finalize** (pure functions we already have, one transaction)
- Apply targeting rules (`targeting.ts`): criteria or sections ruled out become `na` with `source: "rule"` and the rule's description as `naReason`. This overrides the model, so rule-driven NA is always deterministic.
- Compute the score (`scoring.ts`), metrics (`metrics.ts`, now from real word timings, plus interruptions), tag rules and risk flag.
- Write the analysis record (provenance and cost), the criterion rows and the tags, set the conversation to `completed`, and write the outbox event.

### 5.3 Reliability rules

| Rule | Implementation |
|---|---|
| Every external call has a timeout and a retry budget | Per-queue `retryLimit`/`retryBackoff` in pg-boss; provider clients with explicit timeouts |
| No double charge | Stage outputs checked before calling providers; ASR result stored (`asr.json` in storage) before attribution |
| Poison jobs don't block queues | After retries the conversation goes `failed` with a typed code; the job completes |
| Stuck detection | A sweeper (every 5 min) fails conversations whose stage hasn't moved in 30 min, and alerts |
| Provider outage | If a fallback is configured (§5.4), the stage switches to it once the primary has used up its retries. Without one, the queue backs off and conversations stay `processing`. Either way the API is honest about the stage and nothing is lost. |
| Rubric changes mid-flight | The conversation pins its `rubricVersion` at creation; analysis uses that version |

### 5.4 Inference providers: plug and play

**Goal:** an operator pastes API keys into `.env` and gets real transcription and scoring, from whichever providers they already pay for. No code changes, and no lock-in to one vendor.

**Two interfaces, nothing more:**

```ts
// pipeline/providers/types.ts
interface Llm {
  id: string;                                    // "anthropic:claude-opus-5-5"
  supports: { strictJson: boolean; batch: boolean };
  generate(req: {
    system: string;          // stable prefix: instructions + rubric (cache-friendly)
    input: string;           // the transcript
    schema: JsonSchema;      // generated from the rubric version
    maxOutputTokens: number;
  }): Promise<{ json: unknown; usage: { input: number; cachedInput: number; output: number } }>;
}

interface Asr {
  id: string;                                    // "sarvam:saaras-v3" (model name to confirm)
  supports: { keyterms: boolean; diarization: boolean; wordTimestamps: true };
  submit(audio: AudioRef, opts: { language?: string; keyterms?: string[] }): Promise<AsrJob>;
  poll(job: AsrJob): Promise<{ status: "pending" } | { status: "done"; words: Word[] }>;
}
```

Sync providers return `done` from the first `poll`, so the stage code has one path. Word-level timestamps are mandatory: speaker attribution and evidence seeking need them, and a provider that can't supply them is not supported.

**Adapters in v1.** Each is one file of about 100–150 lines.

| Kind | Adapter | Covers | Notes |
|---|---|---|---|
| LLM | `anthropic` | Claude models | Official SDK. Strict JSON, explicit prompt caching, Message Batches. |
| LLM | `openai` | OpenAI, **plus any OpenAI-compatible endpoint via a base URL**: Gemini (Google's OpenAI-compatible endpoint), Azure OpenAI, OpenRouter (hundreds of models), Groq, Together, Fireworks, self-hosted vLLM or Ollama | Official OpenAI SDK. Uses strict `json_schema` where the endpoint supports it, otherwise JSON mode + zod + repair. Phase 0 confirms Gemini's structured output through this path; a native Gemini adapter is added only if the eval shows a gap. |
| ASR | `sarvam` | Sarvam Saaras / Saarika | Indic code-mix, keyterms, batch for long files |
| ASR | `deepgram` | Deepgram Nova multilingual | Keyterms, diarization |
| ASR | `openai` | OpenAI-compatible `/audio/transcriptions` with word timestamps: OpenAI Whisper, Groq Whisper, self-hosted faster-whisper servers | Only models that return word timestamps qualify; checked at startup |
| both | `mock` | Our 28 scripted conversations | Default when no keys are set: tests, CI, demos |

Deliberately left out: a generic multi-provider framework (e.g. LangChain, or the Vercel AI SDK). We need exactly one call shape, and owning ~300 lines of adapters keeps provider features like caching and batches fully under our control. Bedrock and Vertex can come later as adapters if a customer asks for them, and the `anthropic` adapter may only need a client swap for Bedrock.

**Configuration** (the entire surface):

```bash
# Keys. Setting a key makes that provider available.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=                 # uses the openai adapter with Google's base URL, built in
SARVAM_API_KEY=
DEEPGRAM_API_KEY=
OPENAI_COMPAT_BASE_URL=         # one custom endpoint: OpenRouter, Azure, Groq, vLLM, Ollama…
OPENAI_COMPAT_API_KEY=

# Selection: "provider:model". The model part may itself contain slashes (OpenRouter).
LLM_MODEL=anthropic:claude-opus-5-5
LLM_FALLBACK=                   # optional, e.g. openai:<model> or compat:<model>
ASR_MODEL=sarvam:<model>
ASR_FALLBACK=                   # optional
```

**Resolution rules:**
1. If `LLM_MODEL` / `ASR_MODEL` are set, use them. Startup fails loudly if the named provider has no key.
2. If they are unset, use the first configured provider's recommended model (each adapter declares one).
3. If nothing is configured, use `mock`. The app always runs.
4. The worker logs the resolved configuration at startup. The Settings page shows it read-only: provider, model, key present or not, and the last successful call.
5. `npm run providers:check` sends one tiny request to every configured provider and reports latency and errors. Running it is the first thing to do after adding a key.

**Fallback:** when the primary fails with a retryable error (5xx, timeout, 429 after backoff) and its retries are used up, the stage runs once on the fallback. The `analyses` row records the model that actually produced the result, so reports and evals can tell them apart. A fallback model must pass the same eval gates as the primary; the eval report flags any configured fallback that doesn't.

**Cost:** `providers/prices.ts` holds per-model token prices (input, cached input, output) and per-minute ASR prices. It is plain data and editable. Each analysis stores its usage and computed cost. A model with no price entry still records tokens; its cost is left null and shown as "unknown" rather than guessed.

**Choosing the model becomes an eval run:**

```bash
npm run eval -- --set g1 --llm anthropic:claude-sonnet-5-5 --llm openai:<model> --llm compat:<model>
```

This prints one table: agreement per criterion, outcome and extraction accuracy, evidence rate, p95 latency and ₹ per conversation for each model. You pick, set `LLM_MODEL`, and you're done.

**Data residency note:** providers differ in where inference runs. The Settings page and the DPA list the active providers. BFSI customers who need in-country inference can be served through a regional endpoint (e.g. Azure OpenAI in an India region, via the `compat` adapter) without code changes.

---

## 6. Data model changes

These are kept small. Most columns exist already.

| Table | Change |
|---|---|
| `conversations` (today `calls`) | Add:<br>• `external_id` (unique per org, nullable)<br>• `stage`<br>• `failure_code`, `failure_stage`, `failure_retryable`<br>• `status` gains `queued` and `skipped`<br>• `audio_key`, `playback_key` (storage keys; drop the public `audio_url`)<br>• `channels`, `sample_rate`<br>• `language_hint`, `language_detected`<br>• `metadata` (rename of `udfs`)<br>• `current_analysis_id`<br>• `deleted_at` (tombstone)<br>• `updated_at` + index `(org_id, updated_at)` for sync<br>Remove the mock-only columns (`template_id`, `is_simulated`, `ready_at`, `ingest_pending`) once the mock runs through the same pipeline. |
| `analyses` (new) | One row per analysis run:<br>• `id`, `conversation_id`, `rubric_version`, `prompt_version`<br>• `asr_model`, `llm_model` (both `provider:model`), `used_fallback`<br>• `status`, `started_at`, `completed_at`<br>• `audio_seconds`, `input_tokens`, `cached_tokens`, `output_tokens`, `cost_micros_inr`<br>• `raw_output` (jsonb, for debugging and evals), `error`<br>A dry run writes nothing; a reanalysis writes a new row and repoints the conversation. |
| `criterion_results` | Add `evidence_end`, `evidence_verified`, `source` (ai/audit/rule). On reanalysis, overrides are kept for criterion IDs that still exist. |
| `transcripts` | Stay as jsonb on the conversation (segments, ~20–60 KB). Words-level timings live in `words.json` in storage and are served with `?include=words`, keeping rows small. |
| `rubric_versions` (new) | `category_id`, `version`, `rubric` (jsonb), `created_by`, `created_at`. Immutable. `categories.current_version` points to the published one. Rubrics gain optional per-criterion `definition` / `passExample` / `failExample` and per-category `momentTypes` (today's moment enum is collections-specific). |
| `people` | Today these are `users` with role `member`; add `external_id` (unique per org). |
| `cohorts` | Today `teams`; no structural change. |
| `org_settings` (new, or columns on `organizations`) | `min_duration_sec`, `keyterms[]`, `retention_days`, `default_language`. Provider keys and models are **not** stored here; they live in env (§5.4, D8). |
| `events` (new, outbox) | `id`, `org_id`, `type`, `conversation_id`, `payload`, `created_at` |
| `webhook_deliveries` | Add `event_id`, `attempt`, `next_attempt_at`; the webhook gets `disabled_at`, `failing_since` |
| `rate_limits` (new, tiny) | `key_id`, `window_start`, `count` (fixed window, upsert) |

The pg-boss tables are created by pg-boss in their own schema.

---

## 7. Quality: the evaluation system

Accuracy is the product. The eval harness is built **before** the real analyzer, and it gates every change to prompts, models and ASR.

### 7.1 Golden sets

| Set | Contents | Used for | Where from |
|---|---|---|---|
| **G1 synthetic** | Our 28 scripted conversations with known answers (transcripts, outcomes, extractions, criteria) | Analysis-stage regression (transcript in, scorecard out); runs in CI | Have it |
| **G2 real** | 150 real recordings: 50 each Tamil-, Kannada- and Hindi-English, mixed quality, ≥ 70% stereo | ASR (WER/CER, speaker attribution) and end-to-end scoring | **Needs a design partner's consented recordings**: the critical dependency (§11) |
| **G2 labels** | Human verbatim transcripts (native script) for 60 of them; full scorecards from **two** independent auditors for all 150 | Ground truth, plus the human–human agreement ceiling | Labelling vendor or partner QA team, using our own Audit UI |

### 7.2 Metrics (one report per run)

- **ASR:** CER per language (more meaningful than WER for code-mixed native script), plus mixed-error-rate on the roman text and word-level speaker attribution accuracy.
- **Scoring:** per-criterion agreement with the auditor (and Cohen's κ), compared with the **human–human** agreement on the same items (the realistic ceiling).
- **Other analysis outputs:** outcome accuracy, extraction exact-match (enum, boolean, number), date/amount tolerance, and the evidence-verification rate.
- **Operations:** cost per conversation, latency p50 and p95.

### 7.3 Workflow

- `npm run eval -- --set g1|g2 --stage asr|analysis|e2e --config <name>` writes `eval/runs/<date>-<config>.json` and a markdown summary that diffs against the last accepted baseline.
- CI runs G1 analysis on every change to `pipeline/analyze/**` or the prompt files (28 conversations; cost is cents to a few dollars depending on model). The build fails if any gate in §1 regresses by more than 2 points.
- G2 runs on demand (provider or model changes) and before each release.
- **Calibration loop in production:** every audit override is a labelled data point. `GET /analytics?metrics=agreement&groupBy=criterion` shows AI–human agreement per criterion live. Criteria below 70% are the ones to rewrite (the doc's "rewrite items that disagree").

---

## 8. Scale, cost, operations

### 8.1 Throughput math (target 100k conversations/day, ~5 min average)

| Stage | Load | Constraint | Plan |
|---|---|---|---|
| API | ~1.2 req/s avg (POST) + reads | none at this level | Stateless Next.js, 2+ instances |
| Ingest + prepare | 100k ffmpeg runs/day of 5-min audio | CPU: ~1–2 s per conversation | 2–4 worker vCPUs |
| ASR | 500k audio-min/day | Provider rate/concurrency limits | Queue concurrency = provider limit; agree a volume tier with Sarvam before ~20k/day |
| LLM | 100k calls/day, ~6–8K tokens each | Tokens per minute on the API tier | Concurrency cap per queue; prompt caching lowers counted input; check the rate-limit tier early |
| Postgres | ~100k conversations + ~1.5M criterion rows/day | Analytics queries over 90 days (~140M rows) | Indexes on `(org, criterion, result, occurred_at)`. Add a daily rollup table **only** when `/analytics` p95 > 1 s. ClickHouse is a later move, not now. |
| pg-boss | ~600k jobs/day | Fine on a modest Postgres instance | Archive completed jobs after 7 days |

### 8.2 Running and hosting: one image, three ways

**Goal:** anyone can run it on a laptop with one command, and deploying it is one command on any machine with Docker. Growing from one box to many is an env change, not a re-architecture.

**What makes this possible:**
- **One codebase, one Docker image.** A `ROLE` env var (`all` | `web` | `worker`) decides what a process runs. With `ROLE=all` the Next.js server starts the pg-boss workers itself from its `instrumentation.ts` startup hook, so web and worker are one process. (To confirm against the Next 16 docs in Phase 1. The fallback is a two-line entrypoint that starts both.)
- **Postgres is the only service.** Queue, outbox, rate limits and data are all in it.
- **Storage has two drivers.** `STORAGE=local` (the default) writes to a `DATA_DIR` volume and serves signed URLs through our own route; the upload signing already exists today. `STORAGE=s3` works with any S3-compatible store: AWS S3, Cloudflare R2, MinIO, GCS interop.
- **No system binaries.** ffmpeg/ffprobe come from npm (`ffmpeg-static`), so a contributor's machine needs only Node and Docker.
- **Migrations run on start.** The container runs `drizzle migrate` before serving; it is safe across replicas because migrations take an advisory lock.
- **The minimum production `.env` is four lines:** `DATABASE_URL`, `APP_SECRET`, one LLM key, one ASR key. Everything else has a default.
- **`GET /api/health`** reports the database, queue depth and resolved providers, for any platform's health check.

| Mode | Command | What runs | Good for |
|---|---|---|---|
| **Local** | `./dev.sh` | Postgres in Docker; `next dev` with `ROLE=all`; local disk; mock providers unless keys are in `.env` | Development, demos, evaluating providers |
| **Single box** | `docker compose -f compose.prod.yml up -d` | `app` (`ROLE=all`) + `postgres` + a data volume, with optional Caddy for automatic HTTPS | First customers. Runs on any VM in any region: AWS EC2/Lightsail Mumbai, an Indian VPS, Hetzner. Also on Railway/Render/Fly from the same image. Estimated to handle ~10–20k conversations/day, since ASR and LLM are remote; the Phase 4 load test confirms the number. |
| **Scaled** | Same image, two services | `web` (N replicas) + `worker` (M replicas, concurrency per queue), managed Postgres (RDS etc.), `STORAGE=s3` | Beyond one box, up to the 100k/day target (§8.1) |

Moving between modes changes env vars only. No code path exists in one mode but not another, so what you test locally is what runs in production.

**Recommended first deploy (D3):** a single VM in AWS Mumbai (ap-south-1) using the single-box compose file, with nightly `pg_dump` to S3. That keeps data in India for BFSI customers (doc §Risks: DPDP, residency), costs very little, and avoids ECS/Kubernetes until volume requires it. Inference residency depends on the providers chosen (§5.4).

Deliberately left out: Kubernetes manifests, Terraform, and a separate MinIO in local dev (local disk covers it). Any of these can be added when a customer or the volume requires it.

### 8.3 Cost per 5-minute stereo conversation

Prices are list prices from the research doc and the current Claude price list, at ₹85/$. To be replaced by measured numbers in Phase 0.

| Line | Per-channel ASR | **Mixdown ASR (plan)** |
|---|---|---|
| ASR (Sarvam ₹0.41–0.49/min) | ₹4.10–4.90 | **₹2.05–2.45** |
| LLM, ~5K cached prefix + ~3K transcript in, ~1.5K out: Haiku 5.5 | ₹0.1–0.2 | ₹0.1–0.2 |
| … Sonnet 5.5 | ≈ ₹2 | ≈ ₹2 |
| … Opus 5.5 | ≈ ₹4–5 | ≈ ₹4–5 |
| Storage, compute | ~₹0.15 | ~₹0.15 |

**Takeaways:**
- Mixdown halves the dominant line.
- The LLM choice can move COGS anywhere from +5% to +200%.
- That is why the model is a config value chosen from the eval report (§5.4), not hard-coded. Non-Claude models enter the same table once their price is in `prices.ts`.

### 8.4 Observability and security
- **Observability:**
  - Structured JSON logs (pino) with `requestId`, `conversationId`, `stage` and `orgId`; transcripts and audio URLs are never logged.
  - Sentry for errors.
  - Per-stage metrics: duration, failures by code, queue depth, cost. Shown on an internal ops page that reads from the `analyses` and pg-boss tables. No new monitoring stack.
- **Alerts:** queue depth growing for 15 min, failure rate over 2%, a stuck sweeper hit, a webhook endpoint disabled.
- **Security:**
  - API keys stored hashed and scoped (`read`/`write`); admins only in the UI.
  - Every query is scoped by `orgId` in the service layer, with a test that hits every endpoint with another org's IDs and expects 404.
  - Playback URLs are signed and short-lived.
  - Webhook URLs must be https in production, and URLs resolving to private IP ranges are refused (SSRF). The same check applies to `audioUrl` fetches.
  - `DELETE /conversations` is a real erasure (stored audio and derived files included).

---

## 9. Code structure

The aim is the smallest structure where each concept has exactly one home. Plain functions and modules; no DI container, no class hierarchies.

```
src/
  lib/contract/            zod schemas = the API contract (Conversation, Person, Category, errors…) → types + OpenAPI
  server/
    http/                  auth (key/session + scope), errors, pagination, rate limit, route helpers
    services/              conversations · people · cohorts · categories · tags · analytics · webhooks
                           (business logic; called by route handlers AND the worker)
    pipeline/
      queue.ts             pg-boss setup, queue names, enqueue(stage, conversationId)
      stages/              ingest.ts · prepare.ts · transcribe.ts · analyze.ts · finalize.ts  (one run() each)
      providers/           types.ts (Llm, Asr) · registry.ts (env → resolved providers + fallback)
                           prices.ts · llm/{anthropic,openai,mock}.ts · asr/{sarvam,deepgram,openai,mock}.ts
      attribute.ts         speaker attribution (stereo energy, mono diarization + role check)
      prompt/              build.ts (rubric → prompt + JSON schema) · verify.ts (evidence) · versions.ts
    scoring.ts targeting.ts metrics.ts tags.ts   (exist today; unchanged contracts)
    storage.ts             two drivers, local disk (default) and S3-compatible: put, head, signedGet, signedPut, delete
    presenters/            conversation.ts (DB rows → API object) · voxxi/ (frozen adapter)
  app/api/v1/**            thin route handlers: parse → service → present
  app/api/internal/**      UI-only composites
  worker.ts                starts pg-boss workers for each stage + webhook delivery + sweeper
                           (imported by instrumentation.ts when ROLE=all, or run alone when ROLE=worker)
Dockerfile                 one image (Next standalone output)
docker-compose.yml         dev: Postgres only (exists today)
compose.prod.yml           single box: app + Postgres + volume (+ optional Caddy)
eval/                      golden sets, runner, reports
```

**Rules that keep it understandable:**
1. Route handlers contain no business logic: parse with the contract schema, call one service, present.
2. Services never import from `app/`. Stages call services or shared pure functions, never route handlers.
3. A provider is one file implementing one small interface (`Asr`, `Llm`). Only `registry.ts` reads provider env vars. Stages ask the registry for "the LLM" or "the ASR" and never name a vendor. Switching providers is a config value (`LLM_MODEL=…`), not a code change.
4. The presenter is the only place DB rows become API objects, so the API shape cannot leak schema details.
5. Pure functions (scoring, targeting, metrics, attribution, verify, prompt build) have unit tests. Stages and routes have integration tests against Postgres with mock providers.

---

## 10. Implementation path

Phases are sequential. Phases 1 and 2 can overlap once the contract is fixed. Effort is focused build days for me working with you; your review points are marked ⏸.

### Phase 0: Spikes and baseline (≈ 4–5 days, plus waiting on real audio)
1. **ASR spike, Sarvam first and Deepgram alongside**, on 20–30 real stereo recordings, measuring:
   - API limits;
   - timestamp granularity;
   - code-mix output;
   - CER;
   - latency;
   - cost per minute.
2. **Mixdown + energy attribution spike:** compare its accuracy against per-channel transcription on the same files. **Go/no-go for decision #1** in §0.
3. **Provider registry and the two LLM adapters** (`anthropic`, `openai`-compatible), plus `providers:check`. Built here because the bake-off needs them.
4. **LLM bake-off on G1** (and G2 where labels exist): Claude Opus / Sonnet / Haiku 5.5 against whichever other models you have keys for (OpenAI, Gemini, or OpenRouter models). Compared on agreement, evidence rate, ₹/conversation and latency, all in one eval table.
5. Write the eval runner skeleton (needed for 4 anyway).

**Exit:** a one-page results memo with the recommended `LLM_MODEL`, `LLM_FALLBACK` and `ASR_MODEL`, and measured ₹/conversation. ⏸ You pick the defaults; anyone can still override them in `.env`.

### Phase 1: API foundation and the deployable shape (≈ 5–6 days)
Contract first, still on mock providers, so integrators can build against it while the real pipeline is being finished.
1. `lib/contract`: zod schemas for all objects and requests; OpenAPI generation; a docs page (`/docs/api`, rendered from the spec).
2. `server/http`: key scopes, the error envelope, request IDs, cursor pagination, rate limiting.
3. Schema migration (§6): external IDs, stage/failure fields, `analyses`, `rubric_versions`, `events`, tombstones, `updated_at`. Plus the vocabulary rename in code and DB (D2).
4. Tier A endpoints (#1–7) with presenters, and person upsert inline on conversation create.
5. Outbox + webhook delivery worker with retries and Standard Webhooks signatures.
6. pg-boss and `worker.ts`, with the **mock** providers running through the real stages. `ROLE=all` starts the workers inside the web process, so `./dev.sh` stays one command. This deletes "lazy completion" and the `ready_at` timer.
7. `Dockerfile` (Next standalone, one image), `compose.prod.yml` (single box), migrations on start, `GET /api/health`. Shipping this early means every later phase can be deployed and tried on a real VM.
8. Move the UI onto `/api/v1` for the overlapping calls; `/api/internal/*` for composites. Keep the Voxxi adapter green by pointing it at the new services.
9. Tests: contract tests per endpoint, org-isolation test, webhook signature and retry tests, an idempotent-replay test. The existing e2e suite stays green.

**Exit:** the integration loop works end to end with mocks: `POST /conversations` → webhook → `GET`, and `updatedSince` sync. OpenAPI published. `docker compose -f compose.prod.yml up` on a fresh VM gives a working instance. ⏸ API review with you before anything depends on it.

### Phase 2: The real pipeline (≈ 7–9 days)
1. `storage.ts` (local disk and S3-compatible drivers), presigned uploads, signed playback, and the ingest stage with the SSRF guard.
2. Prepare stage (ffmpeg via `ffmpeg-static`): mixdown, energy envelope, playback file.
3. Transcribe stage: ASR adapters (`sarvam`, `deepgram`, `openai`-compatible) with submit + delayed poll, keyterms, attribution (stereo energy, mono diarization + role check), segments, transliteration.
4. Analyze stage: provider-neutral prompt and schema builder from the rubric version, run through the registry's LLM (strict JSON or JSON + repair, prefix caching), evidence verification + one repair, fallback, and provenance and cost on `analyses`.
5. Finalize stage: reuse scoring, targeting, metrics and tags. Add interruptions to metrics. Write the outbox event.
6. Sweeper, per-stage retry policies, the failure taxonomy (§4.7), and `skipped` handling.
7. Mock providers stay the default in dev and CI; real providers are switched on with env keys.

**Exit:**
- G2 end-to-end run meets the §1 accuracy gates (or a documented gap with a fix list);
- p95 latency ≤ 5 min on G2;
- a real recording uploaded in the UI shows a real transcript and an evidence-backed scorecard.

⏸ You review real outputs on your own sample calls.

### Phase 3: The quality loop (≈ 3–4 days)
1. `POST /conversations/{id}/analyze` (re-score with current or chosen version, dry run with a draft rubric) and `PUT /categories/{id}` (publish an immutable version).
2. `PATCH /conversations/{id}/scorecard` on the new model (source = audit), plus the `conversation.updated` event.
3. `GET /analytics` with `agreement`, `minutes` and `cost` metrics, and the Analytics UI showing per-criterion AI–human agreement.
4. Bulk reanalysis after a publish, through the provider's batch API where the adapter supports it (Anthropic, OpenAI), otherwise a low-priority queue.
5. Wire the configuration screen to the real rubric API. It stops being a mockup: draft, then "test on last 20 conversations" (dry run), then publish.
6. CI eval gate on G1.

**Exit:** a QA lead can change a criterion, see the impact on recent conversations, publish, and watch agreement move. ⏸

### Phase 4: Production hardening (≈ 2–3 days)
1. First deployment: a single VM in Mumbai with `compose.prod.yml`, HTTPS, nightly `pg_dump` to S3, and the scaled-mode split (`ROLE=web` / `ROLE=worker`, `STORAGE=s3`) tested once so the upgrade path is proven.
2. Retention and erasure (`DELETE` with real deletion from storage, S3 lifecycle rules when on S3, org `retention_days`).
3. Observability: logs, Sentry, the ops page, alerts.
4. Load test: 10k conversations through mock providers at 5/s, plus a smaller real-provider soak.
5. Runbook: stuck queue, provider outage, webhook endpoint disabled, reprocessing a failed batch.
6. Developer docs: quickstart (key → upload → webhook in 30 min), webhook verification snippets, error code reference, changelog.

**Exit:** the §1 reliability, latency and throughput targets are met in staging, and the docs quickstart works verbatim. ⏸ Ship to the first design partner.

### Later (not in this plan, ordered by expected ROI)
1. Native dialer connectors (Exotel first): distribution.
2. `categoryId: "auto"` (a cheap classifier picks the category from the opening of the call).
3. PII redaction on transcripts and audio (Aadhaar, PAN, card numbers).
4. Semantic search ("ask your conversations").
5. Self-hosted Indic ASR when volume justifies GPUs.
6. Real-time assist.

**Total:** about 21–27 focused build days after Phase 0's real-audio dependency is unblocked.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **No real recordings to build and evaluate on** | High until solved | Blocks Phase 0 and the Phase 2 exit | Ask a design partner now. Phase 1 proceeds on mocks in the meantime. Consent and a DPA template are needed (doc §Risks). |
| Mixdown attribution worse than per-channel on crosstalk-heavy calls | Medium | Wrong "who said what": the doc's #1 cause of wrong scores | Spike in Phase 0. Fallback: per-channel ASR (2× ASR cost) only for conversations whose overlap ratio exceeds a threshold. |
| ASR quality on Kannada/Tamil code-mix below what the scores need | Medium | Accuracy gates missed | Measure CER per language in Phase 0; keyterms; test a second provider behind the same interface; abstain (`insufficient_information`) rather than guess |
| LLM cost (if a top-tier model is needed for accuracy) | Medium | Margin | The eval compares models across providers, and the cheapest one that meets the gates wins; prompt caching; batch reanalysis |
| Weaker structured output on some OpenAI-compatible endpoints | Medium | Schema misses, extra repair calls | JSON + zod + one repair; the eval report shows the repair rate per model; models with high repair rates don't become defaults |
| A provider changes or deprecates a model | Medium | Scores shift silently | Provenance records `provider:model` on every analysis; changing a default requires a G1 eval run |
| Provider rate limits or outages at volume | Medium | Latency SLO breaks at peaks | Per-queue concurrency caps (graceful backlog, not failures); `LLM_FALLBACK` / `ASR_FALLBACK`; negotiate tiers before ~20k/day |
| API changes after customers integrate | Low (if we review in Phase 1) | Painful breaking changes | Phase 1 review gate; additive-only rule; OpenAPI diff check in CI |
| Data residency demands (BFSI) | Medium | Lost deals | India-region storage and compute; confirm inference region options; document data flows in the DPA |

---

## 12. Decisions

All decisions were settled on 2026-11-25.

| # | Decision | Outcome |
|---|---|---|
| D1 | **Scoring model** | **It's a config value, not a build decision.** `LLM_MODEL` / `LLM_FALLBACK` in `.env`, any supported provider (§5.4). The Phase 0 eval table recommends the default: the cheapest model that clears the §1 gates. Development uses whichever key is present, with `mock` when there is none. |
| D2 | **Rename code and DB to the new vocabulary** | Agreed: rename now, in the Phase 1 migration. |
| D3 | **Hosting** | **Portable by design** (§8.2): one image, Postgres as the only service, local disk or S3-compatible storage. First deploy is a single VM in AWS Mumbai with `compose.prod.yml`. We split web and worker and move to managed Postgres and S3 only when volume requires it. |
| D4 | **Queue** | Agreed: pg-boss. |
| D5 | **ASR for the spike** | Agreed: Sarvam first, with Deepgram compared in the same spike (now cheap, since both are adapters anyway). |
| D6 | **Voxxi adapter** | Agreed: keep it, frozen. |
| D7 | **Real audio** | Agreed: you source 150 consented recordings (≥ 70% stereo). This is the critical path. |
| D8 | **Where inference keys live** | Agreed: **env vars only.** Settings shows the resolved providers read-only. Keys entered in the UI (encrypted in the DB, about 1 day of work) are deferred until customers self-serve or bring their own keys. |
