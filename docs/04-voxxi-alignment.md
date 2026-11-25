# Alignment review: our build vs Voxxi's product guide and docs.voxxi.ai

**Sources:**
- *A Quick Guide to Understanding Voxxi* (PDF, 11 pp.): the product model we want to ship.
- docs.voxxi.ai, all 9 pages: overview, quickstart, authentication, errors, webhooks, reference index, agents, calls, categories. The site's JS chunks show no unlinked pages.

**Verdict:** the core engine is right. Categories, rubrics, quality score, success rate, extraction and the NA-outcome exclusion all match the PDF's formulas. Three gaps remain:
1. **Our outcome model has one type too many.**
2. **Tags are the weakest part.** They are flat, randomly seeded and manual, while Voxxi's are hierarchical and applied automatically from extractions and rubric answers.
3. **Our API isn't Voxxi's documented contract.** The 6 internal APIs power the dashboard, but none of them is the `/api/external/v1` surface a customer would integrate against.

Two of the PDF's "five questions" are therefore not answerable today: *why were calls unsuccessful?* and *which objections are most frequent?*

## 1. Concept-by-concept

| PDF concept | Voxxi definition | Our build | Status |
|---|---|---|---|
| Category | Purpose of the call. Owns the rubric, outcomes and extraction rules; every call has exactly one | Same; 3 categories | ✅ |
| Category metadata (docs) | `intendedPurpose`, `additionalLLMContext` | Only `description` | 🟡 small gap |
| Rubric / criterion | Sections of questions, answered **Yes / No / NA** | Same model; the UI says "Met / Missed / N/A" | 🟡 terminology |
| NA criterion: insufficient info | Excluded from the quality score | Supported (authored `na`) | ✅ |
| NA criterion: "configured to become NA when certain conditions are met" | Rule-driven NA per criterion | Only **section**-level targeting, and targeted-out sections are **dropped** rather than recorded as NA | ❌ gap |
| Outcome | Exactly one per call | Same | ✅ |
| Outcome types | **Exactly 3: Success / Standard / NA.** Docs: `isSuccess: bool`, `isNotApplicable: bool` | **4 variants**: success, "neutral" (`null`), "unsuccessful" (`false`), NA | ❌ misaligned (the maths is right; the model and labels are not) |
| NA outcome | Excludes the whole call from quality **and** success | Same in all analytics | ✅ |
| Success rate | Success / (Success + Standard) × 100 (example: 30/80 = 37.5%) | Same formula | ✅ (add the PDF example as a test) |
| Quality score | Passed / (Total − NA) × 100, all criteria equally weighted (example: 6/8 = 75%) | Same | ✅ (add the PDF example as a test) |
| Data extraction | Boolean / Enum / Number / Free text, used for CRM automation, QA and compliance, **reporting** | All 4 types extracted and shown per call | 🟡 no **reporting** on extracted data; no `required` or enum hints |
| Tags | Many per call; **auto-applied from extracted data or rubric answers**; **hierarchical** (tag › subtag › detail); filter at any level | Flat, randomly seeded, manual only, filter by exact id | ❌ biggest gap |
| Processing flow | upload → category → QA → outcome → metrics → extraction + tags → reporting and automation | Same, except the tag step | 🟡 |
| Upload | Manual or API | Manual + internal API | ✅ |

## 2. The five questions (PDF §11)

| Question | Feature | Answerable today? |
|---|---|---|
| What kind of call was this? | Category | ✅ |
| What happened on the call? | Outcome | ✅ |
| How well did the agent handle it? | Rubric + quality score | ✅ |
| Did it achieve its objective? | Success rate | ✅ |
| What else can we learn? *("why calls were unsuccessful", "which objections appeared most frequently")* | Extraction + tags | ❌ no tag or extraction reporting |

## 3. docs.voxxi.ai vs our API

The docs describe the **external** integration API. Our 6 APIs are the dashboard's own.

| Docs | Ours | Gap |
|---|---|---|
| Base `/api/external/v1`, `Authorization: Bearer` or `x-api-key` | Both headers accepted on `/api/v1` | Path |
| Errors `{ "error": "message" }`; 400/401/404/409; 201 for create agent, 202 for create call | `{ error: { code, message } }` | Shape |
| `GET/POST /agents`, `PATCH/DELETE /agents/{id}` (409 on duplicate email) | No agent API; "Add agent" is a toast | ❌ |
| `POST /calls/presigned-url` → `{ key, presignedUrl, publicUrl }`, then PUT the file | Multipart upload only | ❌ |
| `POST /calls {memberId \| email, categoryId, audio_url, udfs, date}` → 202 (date-only defaults to IST 09:00) | Similar, but not the same field names | 🟡 |
| `GET /calls/{id}/analysis` → `status` pending / processing / completed / failed; `analysis{score, outcomeLabel, outcomeRationale, callObservations, areasForImprovement, extractions, sections[{score, totalScore, criterias[{criteriaId, question, result, rationale}]}]}`, `metadata{…}` | Different shape on `/api/v1/calls/{id}` | ❌ |
| `GET /categories`, `GET /categories/{id}` with `possibleOutcomes`, `analysisPointers`, `extractionFields`, `targetingRules`, `tagTargets` | Only inside the workspace bootstrap | ❌ |
| Webhooks: `call.analysis_complete`, `call.analysis_failed`, `call.ingestion_failed`; HMAC-SHA256 over `<ts>.<body>`, `v1=` signature; delivery log | Mockup screen only | ❌ |
| API keys managed in Integrations settings | One key in `.env` | ❌ |

## 4. Where we deliberately go beyond Voxxi (keep)

- Evidence quote + timestamp + confidence per criterion.
- Moments on the waveform, conversation metrics, word-level language mix.
- Manager overrides that keep the AI result.
- Review queue.
- Stereo agent/customer playback.

---

## 5. Scope to close the gaps

### A. Product model (PDF fidelity)
1. **Three outcome types.** Change `isSuccess` to a strict boolean, so Standard = `false`. Rubrics move to Success / Standard / NA. The UI labels outcomes as Success / Standard / NA everywhere: badges, outcome bars, config. The maths doesn't change.
2. **Yes / No / NA** terminology in Audit, review mode and analytics.
3. **Rule-driven NA.** Targeting rules can target a `criterion` as well as a `section`. Targeted-out sections and criteria are **stored as NA with a reason** ("Not applicable: only when the customer raises a dispute"). NA from missing evidence shows "Not enough information". Two real criterion rules are seeded:
   - late-fee explanation is NA when the customer paid on the call;
   - the written settlement letter is NA when the offer was rejected.
4. **Hierarchical, rule-applied tags.**
   - An org tag taxonomy (`objection › financial › job-loss`, `objection › dispute › wrong-charges`, `compliance › threats`, `follow-up › callback`, …).
   - Categories declare `tagTargets` plus tag rules (JSONLogic over `extractions`, `outcome` and **`criteria` answers**), applied automatically at analysis time.
   - Manual tags stay available in review.
   - Filtering by any level (`objection` matches every objection).
5. **Category metadata.** `intendedPurpose`, `additionalLLMContext`, extraction `required` + enum hints, shown in configuration.

### B. Reporting: answer the fifth question
6. **"Call intelligence" analytics tab** for any slice:
   - a tag tree with counts and share, each node drilling into calls;
   - **"Why calls weren't successful"**: top tags on Standard-outcome calls;
   - **extracted-data reports** per field: value distribution with success rate per value for enum/boolean fields, count/total/average for numbers. Each value drills into calls.
7. **Call-list filters** by tag (any level) and by extracted value (`ext=delay_reason:medical`).

### C. Docs parity: the external API (thin adapters over the same services)
8. `/api/external/v1`: agents CRUD, `calls/presigned-url` (HMAC-signed local upload URL), `POST /calls`, `GET /calls/{id}/analysis`, `GET /categories[/{id}]`. Status codes, error shape and the analysis payload match the docs exactly.
9. **Webhooks.** Real HMAC-signed delivery of the 3 events when a call completes or fails, with a delivery log.
10. **API keys.** Create (shown once), list, revoke. Integrations becomes a working screen.

### Out of scope (unchanged)
Real ASR/LLM, feedback threads (agent acknowledge flow), Analysis Parameter Lab, multi-org admin.

### Acceptance
- The PDF's worked examples (37.5% and 75%) pass as tests.
- Every outcome renders as Success, Standard or NA.
- A targeted-out criterion appears as NA with its reason and doesn't count toward the score.
- Tags are applied by rules and filterable at any level, and the tag tree drills into calls.
- The quickstart in docs.voxxi.ai runs verbatim against our server, with base URL and key swapped: create agent → presigned URL → PUT → create call → poll `completed`.
- A webhook endpoint receives a signed `call.analysis_complete` payload matching the documented schema.

---

## 6. Status: all gaps above are closed (2026-11-25)

| # | Item | Where |
|---|---|---|
| 1 | Three outcome types (`isSuccess` strict boolean); Success / Standard / NA in every view | `content/rubrics`, `lib/domain.ts` (`outcomeType`), badges, outcome bars, config |
| 2 | Yes / No / NA answers | Audit, review mode, config |
| 3 | Rule-driven NA per section **and criterion**, stored with a reason | `server/targeting.ts` (`criterionApplicability`), `criterion_results.na_reason`, Audit "NA by rule" |
| 4 | Hierarchical tags applied by rules over extractions, outcome and rubric answers; manual tags kept separately; filter by any level | `content/tags.json`, tag rules in rubrics, `call_tags.source`, `?tag=objection` |
| 5 | Category `intendedPurpose` / `additionalLLMContext`; extraction `required` + enum hints | rubrics, configuration screen |
| 6 | Call intelligence: tag tree, "why calls weren't successful", extracted-data reports | `services/analytics.ts` (`intelligence`), `components/app/intelligence.tsx` |
| 7 | Filters by tag (any level) and extracted value | `?tag=…`, `?ext=field:value` |
| 8 | External API matching docs.voxxi.ai (agents, presigned upload, calls, analysis, categories) | `src/app/api/external/v1`, `src/server/external` |
| 9 | Signed webhooks for all 3 events + delivery log | `server/webhooks.ts`, Integrations |
| 10 | API keys (create once / revoke / last used) | Integrations |

Verified by tests:
- Unit tests: the PDF worked examples, criterion NA, tag rules.
- API tests: the docs quickstart run end to end, webhook signature verification, tag hierarchy filter, manual-only tag edits, call-intelligence aggregates.
- Playwright: tag-tree drill-through, review with Yes/No, upload.

A remote `audio_url` is downloaded before analysis starts (`calls.ingest_pending`). A download stuck for 2 minutes fails with `call.ingestion_failed`.
