# Scope: speech analytics dashboard (working FE on a mock backend)

**Goal:** a fully clickable, stateful dashboard that matches Voxxi's analytics product (see `01-voxxi-teardown.md`), running on a mock backend. The mock is shaped so a real pipeline can replace it later without touching UI code.

**Not a clone of the brand.** We reproduce the information architecture, data model and interactions. We do not copy Voxxi's name, logo, copy or exact palette.

---

## 1. Architecture

```
React UI (pages, components)
   │  only talks to ↓
api client — typed, procedure-shaped: api.calls.list(), api.analytics.getCategoryAnalytics() …
   │  (same names as Voxxi's tRPC routers; swap the transport later for tRPC/REST)
MockServer
   ├─ db: seeded in-memory store, persisted to IndexedDB (reset button in settings)
   ├─ latency + error injection (dev toggle)
   ├─ pipeline simulator: upload → processing (transcribing → analyzing, ~5–15 s) → done | failed
   ├─ analytics engine: real aggregations over seeded analyses (no hard-coded chart numbers)
   └─ scoring engine: real formulas (section, call, success rate), JSONLogic targeting evaluation
```

Why this shape: every number on screen is computed from rows, so filters, date ranges, overrides and re-analysis behave like the real product. The future backend implements the same procedure contract.

**Recommended stack:** Vite + React + TypeScript, react-router, TanStack Query, Tailwind v4 + shadcn/ui, Recharts, react-day-picker, wavesurfer.js (waveform player), json-logic-js, zod (shared schemas, which become the API contract), @react-pdf/renderer (P1), Vitest + Playwright.

## 2. Seed data (the demo story)

- **Org:** fictional Indian edtech inside-sales floor, about 60 days of history, around 1,200 calls.
- **Roles:** an Owner/Admin, an Observer (QA manager) and about 15 agents in 3 teams. A demo role switcher in the user menu lets you view as Admin, Observer or Agent.
- **Categories (3):** "Inbound Enquiry" (lead qualification), "Counselling / Demo Call", "Payment Follow-up". Each gets 4–6 sections, 3–8 criteria per section, 4–6 outcomes, 3–5 extraction fields (e.g. `lead_type` enum, `budget` number, `course_interest`), and 1–2 targeting rules.
- **Agent personas** so the analytics tell a story: a consistent top performer, an improving new hire, a regressing veteran, and an agent who always skips the closing criteria.
- **Transcripts:** Hinglish (Devanagari + Roman) generated from templates per outcome. **Audio:** about 8–12 real demo recordings synthesised once with TTS (two voices, agent and customer) and reused across calls, with the transcript timestamps produced from the TTS segments so playback sync is exact.

## 3. In scope, by priority

### P0: core loop (the demo must work end to end)
1. **App shell:** collapsible sidebar, breadcrumbs, dark/light theme, org/user menu, role switcher, ⌘K navigation (nice to have), empty/loading/error states.
2. **Dashboard home:** KPI cards, quick actions, recent calls.
3. **Calls index:** category cards with avg score and success rate; "View all recordings".
4. **Call list** (per category and all): search, every filter from the teardown, sort, pagination, URL-synced filter chips, row actions (copy link, download, delete), status badges with live updates while processing.
5. **Upload flow:** pick category and agent (or create an agent inline), drag-drop multiple files with progress. Calls appear as Processing, move through pipeline states, then land as analysed results; some fail at random so the retry path gets exercised.
6. **Call detail:** waveform player (speed, seek, skip), synced transcript (active line, click to seek, speaker labels, Devanagari rendering), overall score, tabs Summary / Audit / Data / Feedback, tags, re-analyze and re-process, delete with refund.
   - **Audit:** section accordion (met/total, progress bar); per-criterion pass/fail/NA, rationale, **evidence quote + timestamp that seeks the player** (better than Voxxi).
7. **Analytics explorer:** dimension = category/team/tag, date range presets + compare to the previous period, config-version filter.
   - *Overview:* Quality / Success / Volume cards with sparklines and deltas, Most Common Failure, Top Performer, Attention Required, Outcome donut (click → filtered call list), Performance Trends, Duration Distribution, Agent Leaderboard.
   - *Quality Analysis:* criterion failure-rate table (filterable), per-criterion agent distribution, drill to failed calls.
   - *Agent Performance:* audited-agents table, highest quality/success/volume, link to the drilldown.
8. **Agents list:** sparkline trend + delta, totals, filters, add/edit/delete. **Agent drilldown:** profile, strengths, needs work, improvements/regressions, recent calls.

### P1: depth that makes it feel real
9. **Manager review loop:** feedback threads on a call (open → acknowledged → resolved), feedback inbox, pending badge in the sidebar; **manager score override per criterion** that recomputes scores and flags the call as "human-reviewed" (calibration data; Voxxi has no visible override).
10. **Category configuration:** outcomes, sections and criteria CRUD (drag reorder), extraction fields with enum editor, targeting-rule builder ↔ JSONLogic, draft vs published diff, publish and restore versions. Publishing then bulk re-analysing lets you see scores shift.
11. **Teams** CRUD and membership.
12. **Agent persona:** My Dashboard, My Report Card, feedback acknowledge.
13. **Workspace:** Users and invitations (mock), Tags (hierarchical slugs), Billing (minute balance, runway, usage by category, daily usage chart, usage log, credit history), Integrations (API keys, webhooks with a mock delivery log and test send).
14. **Reports:** agent report card and call report as PDF; analytics "quick report" as PNG.
15. **Public share page** for a call (read-only).

### P2 / later (out of scope for this build)
- Superadmin (orgs, orphan users, LLM-cost console, Analysis Parameter Lab, transcription compare). The Lab is worth building when the real pipeline exists, since it is how rubrics get tuned.
- Real auth (we mock login), real storage and ASR/LLM, real webhooks and REST API.

## 4. Differentiators beyond Voxxi (cheap to add on the mock, all computed from transcript rows)
- **Conversation metrics** on call detail and agent level: talk/listen ratio, longest monologue, silence %, questions asked, **Hindi/English mix %** (the marketing site shows this; the app does not).
- **Moments timeline** on the player: objections, buying signals, upsell cues and compliance phrases as markers.
- **Confidence + abstain** per criterion ("cannot determine"), shown on the Audit tab.
- Optional, P1+: **Revenue opportunity alerts** list (customer raised a need, agent did not pitch), from tagged moments.

## 5. Acceptance criteria
- Every chart and KPI is derived from mock rows. Changing a filter, a date range, an override or a re-analysis visibly changes the numbers.
- The success-rate and score formulas match the teardown (`48/(65−8) = 84%` style checks covered by unit tests).
- An uploaded call goes Processing → Done and appears in lists, analytics, the agent trend and billing usage without a page reload.
- Transcript sync: clicking a line or an evidence timestamp seeks audio within ±0.3 s, and the active line auto-scrolls.
- Full flows work at 1280px and degrade cleanly to tablet. Dark and light themes both pass contrast.
- Playwright smoke test per P0 flow.

## 6. Milestones (estimate, single dev + AI pairing)
| M | Deliverable | Est. |
|---|---|---|
| M1 | Scaffold, design tokens, shell, mock server + seed generator, zod schemas | 2–3 d |
| M2 | Calls index, call list (filters/sort/URL state), upload + pipeline simulator | 3 d |
| M3 | Call detail: player, transcript sync, Summary/Audit/Data, evidence seek, metrics | 3 d |
| M4 | Analytics explorer (3 tabs, dimensions, date compare), agents list + drilldown | 4 d |
| M5 | P1: feedback + overrides, category config + versions, teams, agent persona | 4–5 d |
| M6 | P1: workspace (users, tags, billing, integrations), reports, public share, polish + tests | 3–4 d |

## 7. Decisions (resolved 2026-11-24; see `03-implementation-plan.md`, which supersedes §3 and §6 above)
Next.js full-stack TypeScript; Voxxi's layout with our own brand; TypeScript backend in the same app; seed vertical per the research doc (collections, South-Indian code-mixed). Original questions:
1. **Stack:** Vite SPA (recommended; matches Voxxi and keeps the backend independent) or Next.js (what the research doc suggests)?
2. **Brand:** ship under Vocobase branding, or a neutral working name?
3. **Future backend language:** TypeScript (tRPC, sharing the zod contract directly) or Python/FastAPI (per the doc)? This decides whether the contract lives as zod or as OpenAPI.
4. **Seed vertical:** EdTech admissions (mirrors Voxxi) or the wedge the research doc recommends (collections or insurance, possibly in a South Indian language)?
