# Operations: deploy, configure, scale, recover

Everything here is the same codebase and the same Docker image; only environment variables change between modes.

## 1. Run modes

| Mode | Command | What runs |
|---|---|---|
| Local | `./dev.sh` | Postgres in Docker; `next dev` with the worker in-process; audio on local disk; mock AI unless keys are in `.env` |
| Single box | `docker compose -f compose.prod.yml up -d --build` | `app` (web + worker, `ROLE=all`) + `postgres` + an audio volume; optional Caddy for HTTPS |
| Scaled | same image, two services | `ROLE=web` × N behind a load balancer, `ROLE=worker` × M, managed Postgres, `STORAGE=s3` |

## 2. First deploy (single box)

On any Linux VM with Docker (for BFSI data residency, put it in India, e.g. AWS ap-south-1).

```bash
git clone … && cd speech-analytics-dash
cp .env.example .env
# set: APP_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD, PUBLIC_BASE_URL=https://insights.example.com,
#      DOMAIN=insights.example.com, provider keys (ANTHROPIC_API_KEY, SARVAM_API_KEY, …); remove DEMO_API_KEY
docker compose -f compose.prod.yml --profile https up -d --build
docker compose -f compose.prod.yml exec app npm run admin -- org:create --name "Acme Collections" --admin-email ops@acme.in --admin-name "Asha Rao" --starter
docker compose -f compose.prod.yml exec app npm run providers:check
```

`org:create` prints the admin password and a first API key, once each. Sign in at `https://DOMAIN/login`. To see the demo instead, start with `SEED_DEMO=true DEMO_LOGIN=true`.

On every start the container:
1. runs migrations under a Postgres advisory lock, so replicas don't race;
2. starts the role in `ROLE`.

`GET /api/health` reports the database, the pipeline backlog and the resolved providers. It answers 503 when the provider configuration is invalid.

**Backups:** nightly `docker compose exec db pg_dump -U insights insights | gzip > backup.sql.gz`, shipped to object storage. Also back up the `audio` volume when `STORAGE=local`; with S3, use bucket versioning or lifecycle rules.

## 3. Configuration reference

All of it is in [`.env.example`](../.env.example). The settings that matter most:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Postgres 14+. The queue (pg-boss) creates its own `pgboss` schema |
| `APP_SECRET` | — | Signs sessions, upload and playback URLs. Rotating it signs everyone out and invalidates outstanding signed URLs |
| `ROLE` | `all` | `all` \| `web` \| `worker` |
| `LLM_MODEL` / `LLM_FALLBACK` | first configured provider | `provider:model`. Providers: `anthropic`, `openai`, `gemini`, `compat`, `mock` |
| `ASR_MODEL` / `ASR_FALLBACK` | first configured provider | `sarvam`, `deepgram`, `openai`, `compat`, `mock` |
| `STORAGE` | `local` | `s3` needs `S3_BUCKET` (+ `S3_REGION`, `S3_ENDPOINT` for R2/MinIO, credentials from the standard AWS env) |
| `DEMO_LOGIN` | on in dev, off in prod | Passwordless user picker. Never enable on a public server with real data |
| `LLM_CONCURRENCY` / `ASR_CONCURRENCY` | 4 / 8 | Per worker process. Keep within the provider's rate limits |
| `RATE_LIMIT_PER_MIN` | 600 | Per API key |
| `STUCK_AFTER_MIN` | 30 | The sweeper fails conversations whose stage hasn't moved for this long |
| `ALLOW_PRIVATE_AUDIO_URLS` | off in prod | SSRF guard for `audioUrl` |

Org settings live in the database (`organizations`):
- `min_duration_sec` (default 15);
- `keyterms`, passed to ASR;
- `retention_days`, after which audio and transcripts are erased;
- `default_language`.

## 4. Capacity

Load test (`npm run loadtest -- --n 300 --rate 10`) on a laptop: one `ROLE=all` process, default concurrency, mock AI, real ffmpeg.
- **Throughput:** 1.5 conversations/s sustained, about 130k/day.
- **Latency under that 10/s burst:** p50 108 s, p95 162 s (queueing included).
- **Failures:** none.

With real providers, ASR and LLM latency dominate. Scale by:
1. raising `ASR_CONCURRENCY` / `LLM_CONCURRENCY` up to the provider's rate limit;
2. adding `ROLE=worker` processes;
3. moving to managed Postgres when the database becomes the bottleneck.

Analytics queries scan conversations over the selected range. Add a daily rollup only if `/analytics` p95 exceeds 1 s.

## 5. Runbook

**Conversations stuck in `processing`.**
- Check Workspace → Pipeline ("In flight", oldest age) and `GET /api/health`.
- If no worker is running (`ROLE=web` without a worker service), start one.
- The sweeper fails anything stuck for 30 min with a retryable code. Retry it from the conversation page, or with `POST /api/v1/conversations/{id}/analyze`.

**Provider outage.**
- Jobs retry with backoff (ASR 5 attempts, LLM 4). On the last attempt the stage switches to `ASR_FALLBACK` / `LLM_FALLBACK` if set, and the analysis records `usedFallback`.
- Without a fallback, conversations fail with `transcription_failed` / `analysis_failed` (retryable). Re-run them once the provider recovers:
  ```bash
  curl -s -H "$K" "$B/conversations?status=failed&limit=200" | jq -r '.data[] | select(.failure.retryable) | .id' \
    | xargs -I{} curl -s -X POST -H "$K" -H 'content-type: application/json' -d '{}' "$B/conversations/{}/analyze"
  ```

**A webhook endpoint is disabled.** Endpoints failing for 3 days are disabled. The Integrations page shows a banner and the delivery log (status, response body, attempt). Fix the receiver, then switch it back on. Missed events can be reconciled with `GET /api/v1/conversations?updatedSince=…`.

**Wrong scores reported by a customer.**
1. Open the conversation: the Scorecard shows each answer's quote, whether it was verified, and the model and prompt version that produced it.
2. Audit it; overrides feed the per-criterion agreement in Analytics → Quality.
3. Criteria below 70% agreement need rewriting. Edit the rubric, **Test on recent conversations**, publish, re-score.

**Changing the model or prompt.**
1. Run `npm run eval -- --llm current --llm candidate` (G1 and, when present, G2).
2. Switch `LLM_MODEL` only if the candidate passes every gate.
3. The prompt version (`PROMPT_VERSION` in `src/server/pipeline/prompt.ts`) is stored on each analysis, so trends stay explainable.

**Erasure request (DPDP).** `DELETE /api/v1/conversations/{id}` deletes the audio, derived files, transcript and analysis. A tombstone remains so syncs see the deletion.

## 6. Security notes

- API keys are stored hashed and scoped (`read` / `write`), and created only by admins in the UI (or `npm run admin -- key:create`). Keys can't create keys.
- Every query is scoped by org in the service layer. The test suite checks cross-org access returns 404.
- Session cookies are HMAC-signed, `HttpOnly`, `SameSite=Lax` and `Secure` in production. Passwords are hashed with scrypt.
- Remote `audioUrl`s pass an SSRF guard (no private, loopback or link-local addresses) in production. Webhook URLs must be https in production.
- Playback and upload URLs are signed and short-lived.
- Logs are JSON in production and never include transcripts, keys or audio URLs.
- Known gaps, out of scope for this build: SSO, inviting and managing users in the UI (use `npm run admin`), PII redaction in transcripts, and Sentry or another error tracker (add a DSN-based integration in `src/server/log.ts`).
