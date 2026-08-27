# Podmonitor

Turn podcast listening into reading: Podmonitor watches RSS feeds, acquires transcripts,
summarizes episodes against your stated interests, and builds a searchable knowledge base
of insights.

This repository currently contains the **foundation** of v1: the app scaffold, database,
job queue, and authentication. Feed polling, transcription, summarization, and digests
land in subsequent PRs on top of this base.

## Stack

| Concern | Choice |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript strict |
| Data | Postgres 17 + `pgvector`, Drizzle ORM + drizzle-kit migrations |
| Jobs | pg-boss (Postgres-backed queue, own `pgboss` schema) |
| Auth | email + password, bcrypt hashes, opaque session cookies |
| Tests | Vitest against a real Postgres database |
| CI | GitHub Actions: lint, typecheck, test, build |

## Local setup

Prerequisites: Node 20.11+ and Docker.

```bash
cp .env.example .env            # defaults match docker-compose
docker compose up -d            # Postgres 17 with pgvector on :5432
npm install
npm run db:migrate              # creates the vector extension, then applies migrations
npm run dev                     # http://localhost:3000
```

Register an account at `/register`, add interests on `/dashboard`, and check
`GET /api/health` — it reports database reachability, whether the `vector` extension is
installed, and the pg-boss queue state.

Run the pipeline worker (currently a logging stub per queue) in a second terminal:

```bash
npm run queue:worker
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev, production build, production server |
| `npm run lint` / `typecheck` | ESLint (next/core-web-vitals + next/typescript), `tsc --noEmit` |
| `npm test` | Vitest suite (needs Postgres running) |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run queue:worker` | Start the pg-boss worker process |

### Environment

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string for the app |
| `TEST_DATABASE_URL` | Database used by `npm test`; created automatically if missing |
| `BCRYPT_COST` | bcrypt work factor (12 by default; CI and local tests use 4) |
| `SESSION_TTL_DAYS` | Session lifetime, default 30 days |

## Authentication design

The simplest implementation that is still solid: **server-side sessions**, no JWTs, no
third-party identity provider.

- **Passwords** are hashed with bcrypt (`BCRYPT_COST`, default 12) in
  `src/lib/auth/password.ts`. Only the hash is ever stored. Minimum length 10 characters.
- **Emails** are normalized to lowercase (`src/lib/auth/credentials.ts`) and protected by a
  unique index, so `A@x.com` cannot shadow `a@x.com`. Registration relies on that index
  rather than a pre-check, which would race two concurrent signups.
- **Sessions** are 256-bit random tokens (`src/lib/auth/session-token.ts`). The raw token
  lives only in the cookie; the `sessions` table stores its SHA-256 hash, so a leaked table
  yields no usable cookies. SHA-256 rather than bcrypt is deliberate: the token is already
  high-entropy, so a slow KDF would only add latency to every request.
- **The cookie** `pm_session` is `httpOnly`, `sameSite=lax`, `secure` in production, and
  expires with the session row. Logout deletes the row first, then the cookie.
- **Login failures** are indistinguishable between "no such account" and "wrong password",
  and the no-account path still runs a hash so timing does not leak account existence.

### Per-user isolation

Every authenticated route calls `requireUser()` (`src/lib/auth/current-user.ts`), which
resolves the user **from the session cookie**. Data services take that `userId` as their
first argument and filter on it — see `src/lib/interests/service.ts`. No handler reads a
user id from request input, so a client cannot ask for another user's rows. The rule for
later PRs: **every user-owned query filters by the session user id**, no exceptions.

`tests/integration/user-isolation.test.ts` enforces this at the route level with two
concurrent users, including a request that smuggles another user's id into the payload.

## Data model

`src/db/schema.ts` holds the v1 model; `drizzle/` holds generated SQL migrations.

```
users ─┬─ sessions
       ├─ interests
       ├─ summaries ── insights ── insight_links
       └─ digests

podcasts ── episodes ─┬─ transcripts
                      └─ summaries
```

- `users`, `sessions`, `interests` — accounts and per-user topic weights.
- `podcasts`, `episodes` — feeds and their items, deduped on `(podcast_id, guid)`.
- `transcripts` — one row per episode, tracking source (`rss`, `asr`) and status.
- `summaries` — per-user, per-episode structured output with an interest-match score.
- `insights` + `insight_links` — atomic takeaways with `vector(1536)` embeddings and their
  cross-episode links, the retrieval layer for "this connects to what you heard before".
- `digests` — periodic roll-ups per user.

Migrations are additive: later PRs run `npm run db:generate` and commit the new folder.
The `vector` extension is created by the migration runner rather than inside a generated
file, so drizzle-kit output never needs hand-editing.

## Queue

`src/queue/queues.ts` declares one queue per pipeline stage (`poll-feeds`,
`ingest-episode`, `acquire-transcript`, `summarize-episode`, `link-insights`,
`build-digest`). `src/queue/boss.ts` owns a single pg-boss instance and creates any missing
queue on boot; `src/queue/worker.ts` registers a stub handler per queue. pg-boss keeps its
tables in a separate `pgboss` schema so it never collides with Drizzle migrations.

## Knowledge base and cross-referencing

Each stored summary's `keyInsights` become `insights` rows — the atomic, searchable unit —
carrying a `vector(1536)` embedding and a 1-based `ordinal` (the "#N" a callout cites).
The `link-insights` job runs right after summarization and cross-references every new
insight against the same user's earlier ones:

```
summarize-episode ──▶ link-insights
                        1. insert insights (unique per summary+ordinal)
                        2. embed  (EMBEDDING_PROVIDER)
                        3. pgvector cosine kNN over this user's other insights
                        4. keep similarity >= INSIGHT_LINK_THRESHOLD, cap per insight
                        5. LLM classifies each pair: extends | contradicts | echoes
                        6. insert insight_links (insight, related, relation, score)
```

**Embedding provider (documented choice).** Default is `local`: deterministic feature
hashing (the "hashing trick") computed in-process — free, offline, and reproducible in
tests, at the cost of being lexical rather than semantic. `openai` swaps in
`text-embedding-3-small` (1536 dimensions, ~$0.02/1M tokens) for real semantics. Both sit
behind `EmbeddingProvider` in `src/lib/embeddings/types.ts`, selected by one env var, so
adding a provider is a new adapter file and nothing else. Vectors from different providers
are not comparable — changing provider means re-embedding existing insights.

**Why the LLM classifies the relation.** Similarity says two insights are about the same
thing; it cannot say whether the new one agrees. "X works" and "X does not work" sit close
together in every vector space, so contradiction detection needs a reader. Similarity
selects the pairs, the LLM labels them, and an unparseable answer degrades to `echoes`
rather than dropping a link the reader would want to see.

**Reading it back.** `listSummaryCrossReferences` (and `GET /api/summaries`) returns each
link with a rendered callout — `This echoes insight #1 from "The Standard Oil Episode",
Nov 2025` — so the web view and the weekly digest email cannot word it differently. Every
query is scoped by `user_id`: one reader's knowledge base never surfaces another's insight.

## Tests

```bash
docker compose up -d
npm test
```

The suite creates `podmonitor_test` if absent, migrates it, and truncates between tests.
Coverage: embedding determinism and provider adapters, link thresholding on fixture
vectors, relation parsing and its degrade path, callout formatting, a two-episode overlap
integration test proving the second summary's insight links back to the first with a
rendered callout (plus cross-user isolation and job idempotency), password hashing, session
token minting/hashing/expiry, credential validation,
the full register/login/session/revoke lifecycle against Postgres, route-level session
handling (register, login, logout, forged cookie, unauthenticated access), two-user data
isolation, and a pg-boss job round-trip plus the health probe.

## CI

`.github/workflows/ci.yml` runs on every pull request with a `pgvector/pgvector:pg17`
service container — the same image as docker-compose — and executes lint, typecheck,
tests, and a production build.
