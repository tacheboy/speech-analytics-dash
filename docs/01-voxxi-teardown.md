# Voxxi teardown: how the product is actually built

Reverse-engineered on 2026-11-24 from public surfaces only: the marketing site (Astro), the app shell and JS bundle served at `app.voxxi.ai`, public API docs at `docs.voxxi.ai`, the status page, and certificate-transparency logs. We did not log in or call any authenticated endpoint.

Raw evidence is in `docs/reference/`:
- `screenshots/`: real product screenshots from the marketing site (`calls.png`, `agents.png`, `performance.png`, `script.png`)
- `trpc-procedures.txt`: every tRPC procedure the SPA calls, which is the internal API surface
- `ui-strings.txt`: about 1,000 user-facing strings from the bundle, which is effectively a screen inventory
- `external-api-docs.txt`: the public REST API and webhook contract

> **Headline:** the marketing site and the product are different things. The site sells "Script Intelligence", "Winning Habits", "Consistency heatmap" and "Revenue Opportunity Alerts". The shipped app is a **configurable rubric engine**: Category → versioned config of Sections/Criteria, Outcomes, Extraction fields and JSONLogic Targeting rules. That engine feeds analytics drilldowns, agent report cards and a manager feedback loop. The bundle has no talk/listen metrics, talk-track clustering or "chat with your calls".

---

## 1. Infrastructure map

| Surface | What it is | Evidence |
|---|---|---|
| `voxxi.ai` | Astro v5 static marketing site on Cloudflare | `<meta generator="Astro v5.17.1">`, `server: cloudflare` |
| `app.voxxi.ai` | Vite + React SPA ("Voxxi Call Insights"). Same origin also serves `/trpc`, `/api/auth`, `/api/external/v1` | index.html, a single 4.1 MB bundle built with rolldown, no code splitting |
| `docs.voxxi.ai` | Next.js API docs (Tailwind "Protocol"-style template) | `/_next/static/...` |
| `status.voxxi.ai` | Better Stack status page, one monitor: "Voxxi Dashboard" | page title |
| `storage.voxxi.ai` | S3-compatible object store (403 XML at root), likely R2 or MinIO on a custom domain | `application/xml` 403 |
| `clerk.` / `accounts.` | Old Clerk auth domains in CT logs. Current app uses **Better Auth**, so they migrated off Clerk | crt.sh; bundle calls `/api/auth/*` and `telemetry.better-auth.com` |
| `aimlay.voxxi.ai` | Customer vanity domain that 308-redirects to app. Aimlay is an Indian edtech (PhD admission, writing/publication services), which matches the rubric names in the screenshots | crt.sh + redirect |
| `crm.`, `crmkfd.`, `hermes-kfd.`, `testchat.` | Adjacent or bespoke projects (CRM, chat); not part of analytics | crt.sh |

### Stack (from the bundle)
- **FE:** React 19, react-router, TanStack Query + **tRPC client + superjson**, shadcn/ui (Radix), Tailwind v4 with `oklch` tokens, Recharts-style charts, `react-day-picker`, sonner toasts, `@react-pdf/renderer` (client-side PDF reports), PNG "quick report" export, react-markdown. Fonts: Inter + Familjen Grotesk, IBM Plex Sans Devanagari for Hindi transcripts.
- **Auth:** Better Auth with the `organization` plugin (multi-org, invitations, active org) and the `admin` plugin (ban, impersonate, sessions). Sign-in via Google, Microsoft or email/password.
- **Backend:** TypeScript monorepo (tRPC types shared with the client). There are two API layers: internal tRPC and a REST `/api/external/v1` for customers.
- **Jobs:** **Trigger.dev v3**. The client talks to `api.trigger.dev`, likely for realtime run status on analysis and report generation.
- **ASR / LLM:** an internal admin tool, "Compare Transcription Models", compares **Gemini 3 Flash Preview** against **Voxtral Small 24B**. They transcribe with audio-native LLMs rather than classic ASR. There is an LLM telemetry dashboard (cost by pipeline step and by model, cache-hit rate, P95 latency, cost per call and per recorded minute, USD→INR).
- **Payments:** Razorpay (privacy policy). The billing UI uses prepaid **minute credits**.
- **Demo booking:** cal.com.

---

## 2. Domain model (as reconstructed)

```
Organization ──< Member (user, role: owner | admin | observer | agent)
             ──< Team ──<>── Agent(Member)
             ──< Tag (hierarchical slug "rsd/only/publication", displayName, assignable)
             ──< Category ("Inbound Enquiry Team" in the UI is a Category, not a Team)
                   name, description, icon, intendedPurpose, additionalLLMContext
                   ──< ConfigVersion (draft | published snapshots; restore → draft)
                         ──< Outcome (label, description, isSuccess, isNotApplicable)
                         ──< Section (name) ──< Criterion (slug, question, context "what counts as evidence?", ≤30/section)
                         ──< ExtractionField (fieldName, displayName, type text|enum|number|boolean, enumOptions[{value,hint}], required, description=LLM hint)
                         ──< TargetingRule (targetType section|criteria|tag, targetId, JSONLogic expression over extractions.* and outcome.*)
             ──< Call (categoryId, memberId, uploadedBy, audioUrl, duration, date, udfs{}, tags[], status processing|done|failed, configVersion, llmCost)
                   ── Analysis (score, outcomeLabel, outcomeRationale, summary, callObservations, areasForImprovement,
                                sections[{sectionId, name, score, totalScore, criterias[{criteriaId, question, result true|false|null, rationale}]}],
                                extractions[{fieldName, value, ...}])
                   ── Transcript [{start, end, speaker: agent|customer, content}]
                   ──< FeedbackThread (status open | acknowledged | resolved) ──< Message
             ──< CreditBatch (minutes, note)  ──< UsageEvent (billed | reprocessed | refund on delete)
             ──< ApiKey (prefix, lastUsed, revoked)   ──< Webhook (url, events, secret, paused) ──< Delivery (status code, payload, response)
```

### Formulas, checked against the screenshots
- **Section score** = criteria met / applicable criteria ("4 out of 5 criteria met → 80%").
- **Call score** = sum met / sum applicable across sections, × 100. A call where nothing applies can show 0% (the "Not Applicable" 8:33 call).
- **Success rate** = calls whose outcome `isSuccess` / calls whose outcome is not `isNotApplicable`. Check from `performance.png`: 48 "Expert Call Scheduled" / (65 − 8 NA) = **84.2%**, and the card shows **84%**. ✔
- **Category quality** = mean call score in the window, with delta "vs start" of the window.
- **Score buckets:** Excellent 90+, Good 70–89, Fair 50–69, Poor <50. Badge colours: green ≥80, amber 60–79, red <60 (from screenshots).
- **Leaderboard order:** quality score, then success rate, then call volume.

---

## 3. Backend pipeline: how it works

The doc proposes ingest → audio prep → ASR + diarization → LLM scoring → metrics → UI. Voxxi's version, inferred from the config shape and the "Extraction Resolution Order" UI:

```
 Ingest ─┬─ UI: calls.generatePresignedUrl → PUT to storage → calls.confirmUpload
         ├─ REST: POST /api/external/v1/calls {memberId|email, categoryId, audio_url, udfs, date} → 202 {status: processing}
         └─ (dialer integrations: marketed, not visible in app)
   │  Call row created, status=processing; minutes debited (UsageEvent: billed)
   ▼  Trigger.dev task (idempotent steps; "re-process" restarts here, "re-analyze" restarts at ③)
 ① Fetch + normalise audio (duration, format; MP3/WAV/M4A ≤50 MB)  ─ fail → call.ingestion_failed webhook
 ② Transcribe + diarize with an audio LLM (Gemini Flash / Voxtral) → segments {start,end,speaker,content}, Hinglish kept as spoken
 ③ Load the category's ACTIVE PUBLISHED ConfigVersion snapshot (stored on the call so trends stay comparable)
 ④ Extraction, layered by dependency graph:
      Step 0 = base fields with no rule deps → Layer N = fields gated by rules on earlier extractions → "blocked" fields never run
 ⑤ Outcome classification: choose one of possibleOutcomes + rationale
 ⑥ Targeting: evaluate JSONLogic rules (extractions.*, outcome.label, is success / NA) → applicable sections, criteria and auto-tags
      e.g. "Lead-Type Qualification Checklist (PhD Admission)" only applies when extractions.lead_type == "phd"
 ⑦ Section scoring: per criterion → result yes/no/NA + rationale (strict JSON)
 ⑧ Narrative: summary, callObservations, areasForImprovement
 ⑨ Compute scores, persist Analysis, log LLM telemetry per step, fire call.analysis_complete webhook (HMAC-SHA256 "v1=" over "<ts>.<body>")
   ▼
 Analytics: SQL aggregations over analyses by dimension (category | team | tag) × agent × date range × config version
```

**Gaps compared with the research doc:** Voxxi shows no evidence quotes or timestamps per criterion in the API (only `rationale`), no confidence scores in the app, and no stereo-channel handling. These are places where we can do better (see `02-scope.md` §6).

---

## 4. Screen inventory (from routes and strings)

| Route | Screen | Key contents |
|---|---|---|
| `/dashboard` | Home | KPIs (calls, avg quality, success rate), Quick Actions (Upload, Browse, Agents, Analytics Explorer), recent calls |
| `/calls` | Category index | Cards/rows per category: avg score, success rate; actions: View analytics, Configuration, Clone, Edit, Delete; "View All Recordings" |
| `/calls/:categoryId` (`/calls/all`) | Call list | Search; filters: agent, team, uploader, outcome, score bucket, duration bucket, date presets, analysis status, tags; sort by agent/duration/score/date; 20/page; URL-synced filter chips; row actions (copy public link, download, delete & refund); bulk: move category + re-analyze, add to lab list, bulk delete; **Upload Call** dialog |
| `/calls/:categoryId/:callId` | Call detail | Audio player (speed) + synced transcript (click to seek, active line); Overall score; tabs **Summary** (summary, outcome + rationale, Call Observations, areas for improvement) / **Audit** ("Criteria Analysis": section accordions, met/total, per-criterion pass/fail/NA + rationale) / **Data** (extractions) / **Feedback** (threads); tags; LLM cost; actions: re-process, re-analyze, download, public link, PDF report (download or email), delete & refund |
| `/calls/:categoryId/configuration/*` | Category config | Tabs: Possible Outcomes (Success / Not Applicable / Standard) · Sections & Criteria · Extraction (fields, enum editor, resolution-order flow and dependency graph) · Targeting (builder or JSONLogic, ALL/ANY) · Versions (draft vs published diff, publish, restore); CSV export |
| `/analytics` · `/analytics/:dimension/:id` | Analytics explorer | Dimension = category/team/tag. Tabs: **Overview** (Quality, Success Rate, Call Volume KPI cards with sparkline and delta; Most Common Failure; Top Performer; Attention Required (weak sections); Outcome Distribution donut; Performance Trends line; Duration Distribution; Agent Leaderboard) · **Quality Analysis** ("Quality Improvement Hub": per-criterion failure rates, agent distribution per criterion, drill to failed calls) · **Agent Performance** (Agents Audited table, Highest Quality/Success/Volume). Date range + compare, config-version filter, "Quick report" PNG copy/download |
| `/analytics/:dim/:id/agents/:agentId` | Agent drilldown | Performance Profile, rank, trend, NA vs avg, Open Patterns, Systemic failures, Successes, Recent Improvements / Regressions, Consistent Strengths, Consistently Needs Work (grouped by section) |
| `/agents` | Agents | Total calls, avg quality, sparkline trend + delta, date added, call-volume and active filters, Add Agent |
| `/teams`, `/teams/:id` | Teams | CRUD, add/remove agents |
| `/feedback` | Feedback inbox | Open / Acknowledged / Resolved threads (agent acknowledges to close) |
| `/report-card` | Agent self-view | "My Report Card": strengths and improvement areas |
| agent `/dashboard` | My Dashboard | My Calls, My Avg Score, Score vs Team Avg, recent calls, pending feedback |
| `/workspace/*` | Workspace | Users (invite, roles Admin/Observer, pending invites), Tags (hierarchical), Billing (minute balance, "at this pace" runway, usage by category, daily usage chart, usage log, credit history), Integrations (API keys, webhooks, delivery logs, test send, secret rotation) |
| `/settings` | Account | Profile, password, linked Google/Microsoft accounts, active sessions |
| `/public/calls/:callId` | Public share | Read-only call view |
| `/admin/*` | Superadmin | Organizations, orphan users, LLM costs, Analysis Parameter Lab (test draft criteria on saved call lists, compare runs), Compare Transcriptions |

### Visual language (to match the layout, not to copy the brand)
Dark-first. Background `oklch(15.5% .009 196)` (deep teal-black), cards `oklch(19.4% .014 196)`, mint primary `oklch(88.2% .199 160)`, success/warning/danger as tinted pill badges with a 1px border, radius 1rem, collapsible sidebar with breadcrumb top bar, light-mode toggle. Tables use avatar initials, pill score badges, and 60px sparklines.
