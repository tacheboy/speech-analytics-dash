# Implementation plan: speech analytics dashboard (one-shot build)

This plan supersedes the priority list in `02-scope.md`. It narrows the build to:
- the **dashboard**, copying Voxxi's layout but not its brand (see `01-voxxi-teardown.md`),
- **6 working backend APIs** on a real database,
- a **mockup FE** for everything else,
- **no AI flows**. Transcription and LLM scoring are replaced by pre-authored analyses behind an `Analyzer` interface, so real AI can be added later without touching the UI or the API.

---

## 0. Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Framework (FE + BE) | **Next.js (App Router, latest stable, 16.x) + TypeScript (strict)** | Industry standard; one repo and one deploy for UI and API (Route Handlers); runs on Vercel or any Node host; large hiring pool |
| UI kit | Tailwind CSS v4 + **shadcn/ui** (Radix) + lucide-react | Same primitives Voxxi uses, so we get the same layout quickly |
| Charts | Recharts (via shadcn `chart`) | Standard, theme-aware |
| Tables | TanStack Table v8 | Sorting, column control, row selection |
| Client data | TanStack Query v5 + **nuqs** (URL-synced filters) | Caching, polling of processing calls, shareable filter URLs |
| Audio | wavesurfer.js v7 | Waveform, seek, speed |
| Validation / contracts | **zod v4**, shared by Route Handlers and FE fetchers | One source of truth for the API |
| DB | **PostgreSQL 17** (Docker locally; Neon in prod) + **Drizzle ORM** + drizzle-kit migrations | Standard relational store. Drizzle's SQL builder suits the analytics aggregations and is serverless-friendly |
| Tests | Vitest (scoring, analytics, API) + Playwright (e2e smoke) | Standard |
| Package manager | npm (already installed) | No extra setup |
| Brand | Working name **"Vocobase Insights"** in one config file, with its own palette (see §7) | Voxxi's layout, our brand |
| Seed vertical | **Per the research doc: collections for an NBFC lender, RBI Fair Practices Code compliance, South-Indian code-mixed languages** (Tamil–English, Kannada–English) plus Hindi–English | The doc's recommended wedge that Voxxi doesn't own |

---

## 1. What is real and what is mock

| Layer | Real | Mock / simulated |
|---|---|---|
| Database, seed, migrations | ✅ Postgres with about 1,500 seeded calls | — |
| 6 REST APIs (§4) | ✅ zod-validated, org-scoped, role-scoped, curl-able with an API key | — |
| Scoring math (section, call, success rate, overrides) | ✅ code + unit tests | — |
| Analytics (KPIs, trends, distributions, leaderboard, failure rates) | ✅ SQL aggregations over the DB | — |
| Conversation metrics (talk ratio, monologue, silence, questions, language mix) | ✅ computed from transcript segments | — |
| Upload + pipeline status (processing → done/failed) | ✅ file stored, status machine, polling | Analysis content comes from a pre-authored template (`MockAnalyzer`) |
| Transcription / LLM scoring | — | ❌ none. `Analyzer` interface only |
| Audio | ✅ real playable recordings | Generated once with macOS TTS from our scripts and committed to the repo |
| Auth | — | Demo login: pick a seeded user (Admin / Manager / Agent), stored in a cookie. API keys for curl |
| Rubric editor, teams, users, tags, billing, integrations, settings | — | **Mockup FE**: fixture data + local state, fully clickable, nothing persisted |

---

## 2. Repository layout

```
speech-analytics-dash/
├─ docker-compose.yml              # postgres:17
├─ drizzle.config.ts
├─ .env.example                    # DATABASE_URL, DEMO_API_KEY, STORAGE_DIR
├─ scripts/
│  ├─ generate-audio.ts            # macOS only: scripts → say → WAV → stereo mix → afconvert → public/audio/*.m4a (output committed)
│  └─ seed.ts                      # deterministic seed (fixed PRNG seed), dates relative to today
├─ content/
│  ├─ rubrics/*.json               # 3 category configs (sections, criteria, outcomes, extraction fields, targeting)
│  └─ call-templates/*.json        # ~30 authored dialogues + their pre-authored analysis annotations
├─ public/audio/                   # generated recordings (~30 × 2–4 min, AAC 32 kbps mono, ~25 MB total)
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/page.tsx
│  │  ├─ (app)/layout.tsx          # sidebar shell, breadcrumb, theme toggle, user/role menu
│  │  ├─ (app)/dashboard/page.tsx
│  │  ├─ (app)/calls/page.tsx                          # category index
│  │  ├─ (app)/calls/[categoryId]/page.tsx             # call list ("all" supported)
│  │  ├─ (app)/calls/[categoryId]/[callId]/page.tsx    # call detail
│  │  ├─ (app)/calls/[categoryId]/configuration/page.tsx   # MOCK rubric editor
│  │  ├─ (app)/analytics/[dimension]/[id]/page.tsx     # overview | quality | agents tabs
│  │  ├─ (app)/agents/page.tsx, agents/[agentId]/page.tsx
│  │  ├─ (app)/review/page.tsx                          # coaching queue + compliance flags
│  │  ├─ (app)/teams/…, workspace/{users,tags,billing,integrations}/…, settings/…   # MOCK
│  │  └─ api/v1/…                                       # the 6 Route Handlers (§4)
│  ├─ server/
│  │  ├─ db/schema.ts, db/client.ts
│  │  ├─ auth.ts                   # resolve org + user from demo cookie or x-api-key
│  │  ├─ services/{calls,analytics,workspace,review}.ts
│  │  ├─ pipeline/{analyzer.ts, mock-analyzer.ts, advance.ts}
│  │  ├─ scoring.ts, metrics.ts, targeting.ts (json-logic-js)
│  │  └─ storage.ts                # LocalDiskStorage now; S3/Blob adapter later
│  ├─ lib/contracts/*.ts           # zod schemas + inferred types (shared FE/BE)
│  ├─ lib/api-client.ts            # typed fetchers + TanStack Query hooks
│  ├─ components/{ui (shadcn), layout, calls, call-detail, analytics, charts, mock}/
│  ├─ fixtures/                    # data for mockup screens
│  └─ config/brand.ts
└─ tests/{unit,api,e2e}/
```

---

## 3. Data model (Drizzle / Postgres)

```
organizations     id, name, slug
users             id, org_id, name, email, role('admin'|'manager'|'agent'), team_id?, avatar_color, created_at
teams             id, org_id, name, language('ta-en'|'kn-en'|'hi-en')
categories        id, org_id, name, description, icon, active_version_id
rubric_versions   id, category_id, version, published_at, config jsonb   -- sections[{id,name,criteria[{id,slug,question,context}]}], outcomes[{id,label,isSuccess,isNotApplicable}], extractionFields[], targetingRules[]
tags              id, org_id, slug, display_name
calls             id, org_id, category_id, agent_id, uploaded_by?, rubric_version_id,
                  status('processing'|'done'|'failed'), ready_at, failure_reason?,
                  audio_path, duration_sec, call_at, language, template_id, is_simulated bool,
                  transcript jsonb  -- [{start,end,speaker:'agent'|'customer',lang:'ta'|'kn'|'hi'|'en',text,textRoman?}]
                  udfs jsonb, created_at
analyses          call_id PK, score, ai_score, outcome_id, is_success, is_na,
                  summary, outcome_rationale, observations, improvements,
                  extractions jsonb, metrics jsonb, moments jsonb [{type,start,label}],
                  reviewed_by?, reviewed_at?, review_note?
criterion_results call_id, section_id, criterion_id, ai_result('pass'|'fail'|'na'), override_result?,
                  final_result (generated: coalesce(override, ai)), rationale, evidence_quote, evidence_start, confidence
                  PK(call_id, criterion_id); index(criterion_id, final_result)
call_tags         call_id, tag_id
api_keys          id, org_id, prefix, hash, name, created_at
```
Indexes: `calls(org_id, category_id, call_at desc)`, `calls(org_id, agent_id, call_at)`, `calls(status, ready_at)`.

**Scoring rules** (`server/scoring.ts`, unit-tested against the teardown checks):
- Section score = passes / (passes + fails). NA is excluded. A section where no criteria apply is dropped.
- Call score = round(100 × Σpasses / Σ(passes + fails)) across applicable sections. 0 if nothing applies.
- Success rate = success outcomes / non-NA outcomes. Test: 48 / (65 − 8) → 84%.
- A manager override sets `override_result`; the call score is recomputed, `ai_score` is kept, and `reviewed_*` is set.

---

## 4. The 6 APIs

All under `/api/v1`. Auth is the demo session cookie **or** `x-api-key`. Every response is `{ data }` or `{ error: { code, message } }`. Inputs and outputs are zod-validated. Agents only ever see their own calls (role-scoped in the service layer).

| # | Method + path | Purpose | Key params / body | Powers |
|---|---|---|---|---|
| 1 | `GET /api/v1/workspace` | Bootstrap: org, current user, categories with active rubric, teams, agents (basic), tags | — | Shell, every filter dropdown, call-detail rubric labels |
| 2 | `GET /api/v1/calls` | List calls | `categoryId`, `agentId[]`, `teamId[]`, `outcomeId[]`, `status`, `scoreBucket`, `durationBucket`, `from`, `to`, `tag[]`, `q`, `reviewed`, `hasComplianceFlag`, `sort`(agent\|duration\|score\|date), `order`, `page`, `pageSize`(≤100) | Call lists, dashboard recent calls, review queue, drill-throughs |
| 3 | `POST /api/v1/calls` | Create call, returns **202** `{callId, status:'processing'}` | multipart `file` (mp3/wav/m4a ≤ 50 MB) **or** JSON `{sampleId}` or `{audioUrl}`; plus `categoryId`, `agentId`, `callAt?`, `durationSec?` (read in the browser from audio metadata), `udfs?` | Upload dialog |
| 4 | `GET /api/v1/calls/{id}` | Full call: metadata, audio URL, transcript, analysis, sections with criterion results (evidence, confidence, override), extractions, metrics, moments, review | — | Call detail page |
| 5 | `PATCH /api/v1/calls/{id}/review` | Manager review: per-criterion overrides, outcome override, note, tags. Recomputes and returns the updated call | `{ overrides:[{criterionId, result}], outcomeId?, note?, tagIds? }`; admin/manager only | Audit tab "Review" mode |
| 6 | `GET /api/v1/analytics` | All aggregates for one slice | `dimension`(org\|category\|team\|agent), `id`, `from`, `to`, `compare`(prev period), `categoryId?` | Dashboard KPIs, analytics tabs, agents list (sparklines + deltas), agent drilldown |

**Analytics response** (one call returns everything a tab needs; computed with SQL `GROUP BY`):
```
kpis        { quality, successRate, volume, avgDuration, complianceFlagRate } each with value, delta vs compare window, sparkline[]
trend       [{ date, quality, successRate, volume }]                       (daily ≤ 31 days, else weekly)
outcomes    [{ outcomeId, label, isSuccess, isNA, count, pct }]
durations   [{ bucket:'<2'|'2–5'|'5–10'|'10–20'|'20+', count }]
criteria    [{ sectionId, sectionName, criterionId, question, evaluated, failRate, passRate, naRate, worstAgents[] }]
sections    [{ sectionId, name, avgScore, delta }]            → "Attention Required" = lowest sections
agents      [{ agentId, name, team, calls, quality, successRate, trend[], delta, rank }]
highlights  { mostCommonFailure, topPerformer, attentionRequired[] }
agentProfile? (dimension=agent) { strengths[], needsWork[], improvements[], regressions[], vsTeam }
```

**Pipeline without workers** (`server/pipeline/advance.ts`):
- `POST /calls` stores the file through `storage.ts`, inserts the call with `status='processing'` and `ready_at = now + 8–20 s`, and picks a template:
  - `sampleId` → that exact template.
  - Arbitrary upload → a random template matching the category and agent language, flagged `is_simulated` so the UI shows "Simulated analysis".
- **Lazy completion:** every read service first calls `advancePipeline(orgId)`. It finalises any due calls in one transaction: the `MockAnalyzer` writes the analysis, criterion results, metrics and moments; about 5% of non-sample uploads get `failed`. This is idempotent and needs no cron, queue or worker, so it works the same on Vercel and locally.
- The FE polls (`refetchInterval: 3s`) only while processing rows are on screen.
- Later, `LlmAnalyzer implements Analyzer { transcribe(); analyze(config, transcript) }` swaps in behind the same interface and a real queue (Inngest/Trigger.dev) replaces lazy completion.

---

## 5. Seed content (per the doc: collections vertical)

- **Org:** "Kaveri Finance" (fictional NBFC), with collections floors in three cities.
- **Teams (language-aligned):** Chennai floor (Tamil–English), Bengaluru floor (Kannada–English), Delhi floor (Hindi–English). 6 agents each, 18 total, plus 1 admin and 2 managers.
- **Categories (3), each with a rubric of 4–5 sections and 3–6 criteria per section:**
  1. **Early Bucket (DPD 1–30)**: reminder and promise-to-pay.
  2. **Mid Bucket (DPD 31–90)**: negotiation and restructuring offers.
  3. **Disputes & Settlement**.
- **Sections:** Opening & Right-Party Verification · **RBI Fair-Practice Compliance** (recording disclosure, no threats or abusive language, no disclosure to a third party, calling-hours respect) · Discovery (reason for delay) · Negotiation (states dues accurately, offers options) · Closure (PTP amount + date captured, payment mode confirmed, recap).
- **Outcomes:** Promise to Pay ✓, Payment Made / Link Sent ✓, Callback Requested, Refused to Pay, Dispute Raised, Wrong Party / Not Reachable (NA).
- **Extraction fields:** `delay_reason` (enum: job loss, medical, business slowdown, forgot, dispute), `ptp_amount` (number), `ptp_date`, `dpd_bucket`, `language`.
- **Targeting rule:** the "Dispute Handling" section applies only when `outcome == Dispute Raised OR delay_reason == dispute`. This shows the Voxxi JSONLogic mechanism working.
- **Call templates:** ~30 authored dialogues (≈10 per category, spread across the 3 language pairs). Each template has:
  - a mix of good, average and poor agent behaviour,
  - 2–3 compliance-violation variants,
  - its pre-authored analysis: per-criterion result + rationale + evidence line + confidence, outcome + rationale, summary, observations, improvements, extractions, moments.

  Transcript segments are stored in native script (தமிழ், ಕನ್ನಡ, हिंदी) mixed with English, with a romanised copy.
- **Audio** (`scripts/generate-audio.ts`, macOS, run once, output committed). Each line is spoken by `say`:
  - agent: `Aman` or `Rishi` (en-IN), or `Lekha` (hi-IN) on Hindi lines;
  - customer: `Vani` (ta-IN), `Soumya` (kn-IN) or `Lekha` (hi-IN).

  The script writes 16 kHz WAV, stitches the lines with natural gaps (agent on the left channel, customer on the right, which is the doc's "insist on stereo"), and compresses with `afconvert`. **Segment timestamps come from the generated audio lengths, so transcript sync is exact.** No ffmpeg needed.
- **History:** ~1,500 calls over the last 60 days relative to the seed run, weekdays heavier, business hours. Personas so the analytics tell a story:
  - a top performer,
  - an improving new hire (rising trend),
  - a regressing veteran,
  - an agent who skips closure,
  - an agent with repeated compliance flags.

  Deterministic PRNG, so the numbers are stable across reseeds.

---

## 6. Screens

**Working screens (backed by the APIs):**

| Screen | Contents | APIs |
|---|---|---|
| Login | Pick a demo user (Admin / Manager / Agent cards) | — |
| Shell | Collapsible sidebar (Dashboard, Calls, Analytics, Agents, Review, Teams, Workspace ▸ Users/Tags/Billing/Integrations), breadcrumb, theme toggle, user menu with role switch | 1 |
| Dashboard | KPI cards (volume, quality, success, compliance flags) with sparklines and deltas, quality/success trend, outcome donut, top/bottom agents, recent calls, quick actions. Agent role: "My dashboard" (my score vs team) | 6, 2 |
| Calls index | Category cards: volume, avg score, success rate, buttons for View calls / Analytics / Configuration | 6 |
| Call list | Voxxi layout: search, filter popover (agent, team, outcome, status, score/duration buckets, date presets, tags, reviewed, compliance flag), URL-synced chips, sortable columns (Agent, Duration, Score pill, Outcome pill, Status, Date, Uploaded by, Actions), pagination, row actions (copy link, download, delete = mock), live status polling. **Upload dialog:** category, agent, drag-drop or "use a sample recording", per-file progress | 2, 3, 1 |
| Call detail | Header (agent, date, duration, language-mix bar, score ring, outcome pill, tags). Left: waveform player (speed, ±10 s) with **moment markers**, synced transcript (active line, click to seek, speaker colours, native/romanised toggle). Right tabs: **Summary** (summary, outcome + rationale, observations, improvements, metrics), **Audit** (section accordions met/total + bar; criterion pass/fail/NA, rationale, **evidence quote that seeks audio**, confidence; **Review mode** for managers to override and add a note), **Data** (extractions). "Simulated analysis" banner when relevant | 4, 5 |
| Analytics | Dimension switcher (org/category/team/agent), date presets + custom range, compare toggle. **Overview:** KPI cards, Most Common Failure, Top Performer, Attention Required, outcome donut (click → filtered calls), performance trend, duration distribution, agent leaderboard. **Quality:** criterion failure-rate table (search, sort, click → failed calls), section scores. **Agents:** ranked table, Highest Quality / Success / Volume | 6 |
| Agents | Voxxi layout: avatar, name, team, calls, avg quality pill, sparkline + delta. **Agent drilldown:** profile vs team, strengths, needs work, improvements/regressions, recent calls | 6, 2 |
| Review queue | Tabs: Lowest-scoring unreviewed · Compliance flags · Reviewed by me. Opens call detail in review mode | 2, 5 |

**Mockup screens (fixtures + local state, clickable, no persistence; small "Demo" badge):** rubric configuration editor (outcomes, sections and criteria, extraction fields, targeting builder ↔ JSON, versions with publish/restore), teams, users and invitations, tags, billing (minute balance, runway, usage chart, credit history), integrations (API keys, webhooks, delivery log), settings.

---

## 7. Design system

- Same structure as Voxxi: dark-first, sidebar + breadcrumb top bar, rounded cards (radius 0.875rem), pill badges with tinted fill + 1px border, avatar initials, 60 px sparklines, Inter (UI) + Noto Sans Tamil / Kannada / Devanagari (transcripts).
- **Own palette** (not Voxxi's teal/mint): ink-navy surfaces, `oklch(14% .02 265)` / card `oklch(18.5% .022 265)`, **indigo/violet primary** `oklch(72% .17 285)`, and semantic success / warning / danger / info. A full light theme comes from the same tokens.
- Score colours: ≥80 success, 60–79 warning, <60 danger. Outcome pills by `isSuccess` / `isNA` / standard.
- Every screen has loading, empty and error states. Layout works from 1280px down to 768px.
- Load the `dataviz` skill guidance before building charts.

---

## 8. Build sequence (one run, with gates)

Each step ends with its gate; don't proceed on red.

1. **Scaffold.** `create-next-app` (TS, Tailwind, App Router, src/), shadcn init + components, brand tokens, `docker-compose` Postgres, Drizzle schema + first migration, `.env.example`, ESLint/Prettier, Vitest/Playwright config.
   *Gate:* `npm run dev` boots; `npm run db:migrate` succeeds.
2. **Content.** Write the 3 rubric JSONs and ~30 call templates with analyses; zod-validate them (`npm run content:check`: every evidence line exists, criterion ids match the rubric, the targeting rule evaluates).
   *Gate:* content check green.
3. **Audio.** Run `scripts/generate-audio.ts`; write measured segment timestamps back into the templates; commit `public/audio`.
   *Gate:* every template has audio, and the last segment's end equals the file duration within 0.5 s.
4. **Core logic.** `scoring.ts`, `metrics.ts`, `targeting.ts`, `mock-analyzer.ts`, `advance.ts` with unit tests (formula checks, NA handling, override recompute, targeting, language-mix maths).
   *Gate:* Vitest green.
5. **Seed.** `npm run db:seed` (reset + deterministic generation).
   *Gate:* about 1,500 calls; the persona trends are visible in a quick SQL sanity check.
6. **APIs 1–6.** Services → Route Handlers → zod contracts; API-key + cookie auth; role scoping.
   *Gate:* API tests (Vitest against a test DB) cover filters, pagination, 202 upload → done after polling, review recompute, analytics totals equal raw counts, and agent scoping.
7. **Shell + login + dashboard.** Gate: renders from live API in both themes.
8. **Calls index + call list + upload.** Gate: filters ↔ URL round-trip; upload a sample and watch it go Processing → Done in the list.
9. **Call detail + review mode.** Gate: clicking a transcript line or evidence seeks within ±0.3 s; an override changes the score and analytics.
10. **Analytics (3 tabs) + agents + drilldown + review queue.** Gate: drill-throughs land on correctly filtered call lists.
11. **Mockup screens.** Gate: every sidebar link resolves; nothing 404s.
12. **Polish + verification.** Responsive pass, a11y labels, empty/error states, Playwright smoke per working flow, `npm run build` clean, README (setup in 4 commands, API curl examples, architecture, how to plug in real AI).

**Run locally:**
```
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## 9. Definition of done
- All 6 APIs work via curl with the demo API key, and their documentation is in the README.
- Every number in working screens comes from the DB. Upload, review override and date range changes all visibly move the numbers.
- Call detail plays real stereo code-mixed audio with exact transcript sync and evidence seeking.
- Mockup screens are complete and clickable, and labelled Demo.
- `npm run build`, `npm run lint`, Vitest and Playwright are green.
- No Voxxi branding, copy or assets anywhere in the app (reference screenshots stay in `docs/` only).

## 10. Explicitly out of scope
Real ASR/LLM, queues/workers, real auth/SSO, billing/payments, webhooks/API-key management backends, rubric editing persistence, PDF reports, multi-org admin, real-time agent assist, production deploy. Deploying to Vercel + Neon takes about 30 minutes extra once the storage adapter points at Blob/S3.

## 11. Risks
| Risk | Mitigation |
|---|---|
| Authoring ~30 realistic code-mixed dialogues is the longest step | Template format with reusable opening/closure blocks; author 10 first, generate audio, validate, then the rest |
| TTS reads English words in Tamil/Kannada voices imperfectly | Acceptable for a demo; agent English lines use the en-IN voices |
| `say` / `afconvert` exist only on macOS | Audio is generated once and committed; nobody else needs to run it |
| Template reuse (~50 calls per template) is noticeable if you inspect many calls | Vary agent, date, tags and udfs per call; durations differ across templates; it's a mock |
