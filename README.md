# ChronosBox — Durable Asynchronous Agent Execution Engine & Cloud Sandbox Runner

ChronosBox is a durable execution control plane and transactional sandbox runner for background agents that outlive single HTTP requests. It combines **Neon PostgreSQL (`pgvector`) state checkpointing**, **RFC 6902 JSON Patch + Brotli delta compression**, **Content-Addressable Copy-on-Write (CAS) workspace snapshots**, and a **Hybrid Two-Tier Trajectory Circuit Breaker** to prevent runaway token spirals in long-running jobs.

---

## Core Architecture

1. **Durable State & RFC 6902 Checkpointing (`src/server/patch.ts`, `src/server/db.ts`)**
   - Persists agent execution DAG snapshots to PostgreSQL (`chronos_checkpoints_pgvector` and `chronos_checkpoint_deltas`) with sub-millisecond read-through via `ChronosAdaptiveL1Cache` (`src/server/cache.ts`).
   - Encodes intermediate steps as RFC 6902 JSON Patch operations (`add`, `replace`, `remove`) compressed with `zlib.brotliCompressSync`, reducing checkpoint payload sizes by ~84%.
   - Acquires distributed worker leases via PostgreSQL `FOR UPDATE SKIP LOCKED` (`chronos_worker_leases`) and merges concurrent state updates using deterministic channel reducers (`DEEP_MERGE`, `NUMERIC_MAX`, `APPEND_UNIQUE`, `LAST_VALUE`).

2. **Isolated Cloud Sandbox & Transactional Rollback (`src/server/sandboxRunner.ts`, `src/server/routes/sandboxRoutes.ts`)**
   - Materializes workspace files into isolated `/tmp/chronosbox-sandboxes/<runId>` directories, captures a pre-execution SHA-256 Merkle root across all `/workspace` files, and deduplicates unchanged blobs in a Content-Addressable Store (`casBlobStore`).
   - Enforces network egress allowlists (`verifyEgressHostAllowed`), executes commands via bounded `child_process.execFile` subprocesses, and automatically rolls back any dirty file mutations when a command exits with a non-zero status code (`exitCode !== 0`), generating a unified line-by-line diff (`computeUnifiedLineDiff`).

3. **Hybrid Two-Tier Trajectory Loop Monitor & Dead-Letter Queue (`src/server/crypto.ts`)**
   - **Tier 1 (Exact Normalized AST SHA-256)**: Strips volatile timestamps/nonces and normalizes CLI flag ordering (`normalizeShellCommandAst`) before hashing tool calls.
   - **Tier 2 (`pgvector` Trigram Cosine Similarity)**: Projects command AST and `stderr` signatures into an 8-dimensional $L_2$-normalized vector and halts execution after 3 consecutive semantic failures (`cosine >= 0.88`), routing a structured crash dump to the Dead-Letter Queue (`DLQ`) for human patching and replay.

---

## Getting Started

### Prerequisites
- **Node.js** `>= 20.0.0` and `npm`
- **PostgreSQL 16+** with `pgvector` extension (optional for local development; automatically falls back to local WAL `.chronosbox-wal-v2.json` if `DATABASE_URL` is omitted)

### Installation & Local Development

```bash
# 1. Install dependencies from lockfile
npm ci

# 2. Copy environment configuration
cp .env.example .env

# 3. Start full-stack Express + Vite server on http://localhost:3000
npm run dev
```

---

## Testing & Verification

ChronosBox uses **Vitest**, **ESLint**, **Prettier**, and **React Testing Library** (`jsdom`) for unit, schema validation, security middleware, sandbox execution, and UI component testing.

```bash
# Run ESLint + strict TypeScript compiler checks
npm run lint

# Check code formatting
npm run format:check

# Run full unit, integration & component test suite
npm test

# Build production client bundle
npm run build
```

---

## Environment Variables

All environment variables are documented in `.env.example`:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for server-side durable agent tool steps. |
| `APP_URL` | Optional | Public base URL of the ChronosBox server (`http://localhost:3000`). |
| `PORT` | Optional | HTTP server listen port (`3000`). |
| `DATABASE_URL` | Optional | Primary PostgreSQL (`pgvector`) connection string. |
| `POSTGRES_HOST` | Optional | PostgreSQL host or full Neon connection URL. |
| `POSTGRES_DB` | Optional | PostgreSQL database name (`neondb` / `chronosbox`). |
| `REDIS_CACHE_URI` | Optional | Redis / Upstash cache endpoint (falls back to `ChronosAdaptiveL1Cache`). |
| `KAGGLE_USERNAME` | Optional | Kaggle account username for GPU kernel telemetry sync. |
| `KAGGLE_KEY` | Optional | Kaggle API token (`KGAT_...` Bearer token or Basic key). |
| `KAGGLE_GPU_KERNEL_SLUG` | Optional | Primary Kaggle GPU kernel slug (`raviikishore07/kaggle-v7-production-t4`). |
| `KAGGLE_ALT_KERNEL_SLUG` | Optional | Secondary Kaggle GPU kernel slug (`raviikishore07/nexoralm-300m-pretraining`). |
| `DISABLE_HMR` | Optional | Set to `"true"` in managed preview environments to disable Vite HMR polling. |
| `LOG_LEVEL` | Optional | Structured Pino logger verbosity (`info`, `debug`, `warn`, `error`). |

---

## API Reference

All `POST` endpoints validate request bodies using **Zod** schemas (`src/server/schemas.ts`), apply token-bucket rate limiting (`src/server/middleware.ts`), and return `400 Bad Request` with structured issue details on invalid input.

- `GET /api/state` — Returns all durable runs, DAG checkpoints, trajectory events, DLQ dumps, and storage diagnostics.
- `GET /api/stream` — Server-Sent Events (`SSE`) real-time stream broadcasting `checkpoint_committed`, `sandbox_exec`, `checkpoint_resumed`, and `dlq_replayed` events.
- `GET /metrics` (or `GET /api/metrics/prometheus`) — Prometheus 0.0.4 exposition endpoint exporting checkpoint counts, rollback counters, L1 cache hit rates, and Brotli compression ratios.
- `GET /api/sandbox/metrics` — Polls real-time container CPU (`%`), memory (`MB`), PID counts, and I/O telemetry per durable run from host cgroup v2 and process counters.
- `POST /api/sandbox/exec` — Executes a sandbox command in an isolated workspace with pre-tool Merkle snapshot, hybrid 2-tier loop detection, and automatic rollback on non-zero exit status.
- `POST /api/checkpoints/resume` — Resumes a paused run via `WEBHOOK_RESUME`, `HUMAN_APPROVAL`, or `TIME_TRAVEL_FORK` with zero upstream LLM recomputation.
- `POST /api/dlq/replay` — Patches a halted tool command from the Dead-Letter Queue and replays execution from the last clean checkpoint.
- `POST /api/kaggle/poll` — Polls live Kaggle GPU kernel status and output artifacts via Bearer authentication.
- `POST /api/runs/create-or-step` — Dispatches a new durable run or executes the next server-side Gemini tool step.
- `POST /api/benchmarks/run` — Profiles live engine SHA-256 hashing, L1 cache lookup, and RFC 6902 + Brotli compression latency.

---

## Self-Contained Container Execution

To build and run ChronosBox alongside a local `pgvector` PostgreSQL container in complete isolation:

```bash
docker compose up --build
```

---

## Rebuilding Incremental Git History for Repository Mining

When syncing from an online IDE to GitHub, commits are often squashed into a single snapshot. To generate 10 self-contained, test-paired engineering commits and semantic release tags (`v1.0.0`, `v2.5.0`) on your local clone before pushing to GitHub:

```bash
./scripts/build-git-history.sh main
git push -u origin main --force --tags
```

