# ChronosBox — Durable Asynchronous Agent Engine & Cloud Sandbox Control Plane

ChronosBox is a production-grade durable execution engine and observability control plane for long-running background agents that outlive single HTTP requests. It combines LangGraph-inspired state checkpointing (PostgreSQL/pgvector + Redis caching semantics), isolated sandboxed code/shell execution with automatic non-zero exit filesystem rollback, a deterministic SHA-256 trajectory circuit breaker to eliminate infinite token-burn loops, and first-class Kaggle GPU kernel telemetry & reconciliation (`project-zero-ram-fdtd-gpu` and `kaggle-v7-production-t4`).

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural choices incorporate your Phase 1 configuration and requirements:

- **Confirmed Decision 1 — Persistence & Kaggle Kernel Integration**: Dual-layer PostgreSQL (`pgvector`-ready relational checkpoint store) + Redis-compatible hot state cache architecture, paired with server-side Kaggle GPU kernel runners and monitors for `raviikishore07/project-zero-ram-fdtd-gpu` (Project Zero-RAM FDTD GPU) and `raviikishore07/kaggle-v7-production-t4` (Holygrail T4 Run). Credentials are managed strictly server-side via environment variables.
- **Confirmed Decision 2 — Transactional Sandbox & Automatic Rollback**: Real virtualized workspace filesystem with pre-execution Merkle/tree snapshots, strict resource quota enforcement (memory, execution timeout, network egress allowlist), and instant atomic rollback whenever a command or tool exits with a non-zero status code.
- **Confirmed Decision 3 — Core Control Plane Modules**:
  1. Deterministic SHA-256 trajectory monitor with a 3-strike semantic failure circuit breaker and Dead-Letter Queue (DLQ) crash dump inspector.
  2. Interactive DAG checkpoint time-travel debugger with JSON/filesystem state diffing, human-in-the-loop approval gates, and external webhook resume triggers.
  3. Live reproducible architecture benchmark suite evaluating ChronosBox against baseline agent frameworks across loop-prevention cost savings, checkpoint resume latency, rollback fidelity, and DataFactor repository quality metrics.

---

## 1. Overview & Core Concept

- **What It Does**: Executes, checkpoints, sandboxes, and monitors long-running asynchronous AI agents (powered by server-side Gemini API tool-calling workflows) and scheduled data/compute reconciliation jobs (including Kaggle GPU kernel orchestration).
- **Target Audience / Persona**: AI Systems Engineers, ML Infrastructure Teams, and Principal Agent Architects who require deterministic reliability, zero runaway token costs, and reproducible state recovery across multi-hour workflows.
- **Key Value**: Eliminates the "$42 overnight infinite retry spiral" via cryptographic trajectory hashing, prevents corrupted workspace states through automatic non-zero exit rollbacks, and enables zero-recomputation resumption from exact DAG checkpoints after hours of waiting on webhooks or GPU kernel completions.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Launch & Orchestrate Durable Agent Jobs**: Users dispatch long-running agent runs (e.g., *Project Zero-RAM FDTD GPU Reconciliation*, *Holygrail T4 Kernel Dependency Audit*, or custom Gemini-powered coding/shell workflows) or trigger a controlled 3-strike dependency failure scenario to observe circuit-breaker intervention in real time.
  2. **DAG Checkpoint Time-Travel & Webhook Resume**: Users inspect every node transition in the execution graph, compare exact state snapshots (`State Diff` of memory variables, token usage, and vector embeddings), Fork/Rewind from any historical checkpoint without re-running upstream LLM calls, or inject an external Webhook payload / Human Approval signal to resume a `PAUSED_WEBHOOK` run.
  3. **Isolated Sandbox & Rollback Inspector**: Users execute shell/code tool invocations inside the isolated workspace, configure network egress whitelists and CPU/memory quotas, and inspect automatic pre/post-execution filesystem diffs when a non-zero exit code triggers an atomic rollback.
  4. **Deterministic Trajectory Monitor & DLQ Crash Inspector**: Users monitor consecutive tool-call SHA-256 semantic hashes in real time. Upon 3 identical semantic failures, execution halts immediately and routes a structured crash dump (stack trace, tool AST, token burn saved, and recovery payload) to the Dead-Letter Queue where operators can patch arguments and replay.
  5. **Live Architecture Benchmark & Repository Quality Suite**: Users run verifiable, live micro-benchmarks comparing ChronosBox's deterministic trajectory monitor, checkpoint serialization, and transactional rollback against standard unmonitored agent loops (measuring exact token cost saved, P99 checkpoint latency, and architectural quality checks).

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-precision utilitarian engineering console — crisp, authoritative, zero visual fluff, engineered for dense operational clarity.
  - *Color Palette & Mood* (60-30-10 Discipline):
    - **60% Dominant Neutral Canvas**: Deep obsidian slate (`#0B0F17`) primary canvas with cool structural charcoal (`#111827`) panels.
    - **30% Structural Surfaces & Typography**: Subtle 1px hairline borders (`#1E293B`), crisp alabaster primary text (`#F8FAFC`), and muted slate secondary prose (`#94A3B8`).
    - **10% Semantic & Action Accent Budget**: High-intent cobalt/indigo (`#3B82F6`) for primary actions and active DAG nodes; semantic emerald (`#16A34A`) paired with explicit text labels for `CHECKPOINTED / NOMINAL`; amber (`#D97706`) for `PAUSED_WEBHOOK / QUOTA_WARN`; crimson (`#DC2626`) for `CIRCUIT_OPEN / DLQ_HALTED / ROLLED_BACK`.
  - *Typography & Hierarchy* (2+1 Font Rule):
    - **Display & Navigation**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700, `text-wrap: balance`) for architectural headers and workspace navigation.
    - **Body & Operational Controls**: `DM Sans` (Regular 400 / Medium 500) for dense scannability at 13px–15px.
    - **Telemetry, Hashes, Diffs & Metrics**: `JetBrains Mono` with mandatory `font-variant-numeric: tabular-nums` for SHA-256 trajectory hashes, token counters, USD burn metrics, exit codes, and unified diffs.
  - *Component Styling & Layout*:
    - Full-viewport 1440px desktop engineering layout featuring a top bar following the strict 3-zone Top Bar Contract (single-line `ChronosBox` wordmark, 4 concise single-line view switcher links, and 1 primary `"New Durable Run"` action button) plus a contextual workspace toolbar below the header.
    - Single-elevation surface hierarchy (`border border-slate-800 bg-slate-900/60`) with zero nested card-in-card clutter, zero static pills (metadata rendered as clean inline text separated by `·`), and compact `40px` tabular rows.
- **Interactive Feedback & Motion**:
  - Instant $\le 150\text{ms}$ compositor-only transitions (`opacity`, `transform`) when scrubbing across DAG checkpoints, inspecting unified diffs, or replaying DLQ payloads.
  - Complete state handling across all views: rich populated operational telemetry, skeleton loaders during live Gemini / benchmark execution, live client-side search & status filtering, and clear empty states with one-click recovery actions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Deterministic SHA-256 Canonical Trajectory Monitor vs. LLM-as-a-Judge Loop Detection**
  - *Chosen Approach*: Canonicalized JSON AST hashing (`SHA-256(tool_name + normalized_args + exit_class)`) over sliding windows with a strict 3-strike circuit breaker.
  - *Why*: LLM-based supervisor checks add latency and burn additional tokens during an active retry spiral. Canonical SHA-256 trajectory hashing executes in $<0.2\text{ms}$ with zero token overhead and 100% determinism, routing structured crash dumps to the Dead-Letter Queue before runaway costs accumulate.
  - *Alternatives Considered*: Secondary supervisor LLM polling (rejected due to compounding token cost and non-deterministic halting).

- **Decision 2: Dual-Tier PostgreSQL (`pgvector`) + Redis Checkpoint Engine with Transactional Workspace Snapshots**
  - *Chosen Approach*: Every node transition persists an immutable state snapshot (agent messages, tool outputs, workspace file tree merkle hash, and vector context metadata) indexed by `thread_id` and `checkpoint_id`, backed by a PostgreSQL-compatible relational store and hot in-memory/Redis cache layer.
  - *Why*: Enables instant sub-millisecond hot reads for active runs while guaranteeing durable, time-travelable state recovery across hours-long webhook pauses or Kaggle GPU kernel runs without re-executing upstream LLM prompts.
  - *Alternatives Considered*: Ephemeral in-process memory only (rejected because background agents waiting on external webhooks or human approvals cannot survive restarts or inspect historical diffs).

- **Decision 3: Copy-on-Write Virtualized Workspace Filesystem with Non-Zero Exit Rollback**
  - *Chosen Approach*: Before any bash or file-mutation tool executes, the sandbox captures a transactional snapshot of the workspace file tree and enforces network egress allowlists and resource quotas. If the command returns a non-zero exit code (`exit_code !== 0`) or violates egress/timeout policies, the sandbox automatically restores the pre-invocation snapshot and records the aborted diff.
  - *Why*: Prevents half-written files or broken dependency trees from poisoning subsequent agent turns or cron reconciliations.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                        CHRONOSBOX FRONTEND CONTROL PLANE (React 19)                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Top Bar: [ChronosBox] ── [Runs & DAG · Sandbox · Circuit & DLQ · Benchmarks] ── [+]│  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│         │                         │                          │                    │      │
│         ▼                         ▼                          ▼                    ▼      │
│  ┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐  ┌────────────┐  │
│  │ DAG Time-Travel │     │ Isolated Sandbox │     │ Trajectory Hash   │  │ Live Arch  │  │
│  │ & Kaggle Kernel │     │ & Auto-Rollback  │     │ Monitor & DLQ     │  │ Benchmark  │  │
│  │ Reconciler View │     │ File Inspector   │     │ Crash Dump Replay │  │ Evaluator  │  │
│  └────────┬────────┘     └────────┬─────────┘     └─────────┬─────────┘  └─────┬──────┘  │
└───────────┼───────────────────────┼─────────────────────────┼──────────────────┼─────────┘
            │ REST / SSE Stream     │                         │                  │
            ▼                       ▼                         ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                     CHRONOSBOX DURABLE EXECUTION SERVER (Express / Node)                 │
│                                                                                          │
│  ┌────────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────┐  │
│  │ LangGraph-Style State      │──▶│ Deterministic Trajectory  │──▶│ Dead-Letter Queue │  │
│  │ Machine & Gemini 3.8/4     │   │ Monitor (SHA-256 AST      │   │ (DLQ) Router &    │  │
│  │ Tool-Calling Orchestrator  │   │ 3-Strike Circuit Breaker) │   │ Patch Replayer    │  │
│  └─────────────┬──────────────┘   └───────────────────────────┘   └─────────┬─────────┘  │
│                │                                                            │            │
│                ▼                                                            ▼            │
│  ┌────────────────────────────┐   ┌───────────────────────────────────────────────────┐  │
│  │ Isolated Sandbox Runner    │   │ Durable Checkpoint & Telemetry Persistence Engine │  │
│  │ • Quota & Egress Guard     │   │ • PostgreSQL (pgvector) Schema & Checkpoint Store │  │
│  │ • Pre-Tool Merkle Snapshot │   │ • Redis Hot-State Cache & Lock Coordinator        │  │
│  │ • Non-Zero Exit Rollback   │   │ • Kaggle Kernel Poller (Zero-RAM FDTD & T4 Runs)  │  │
│  └────────────────────────────┘   └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **`DurableRun` (`runs`)**: `id`, `threadId`, `name`, `workflowType` (`KAGGLE_RECONCILIATION` | `CODE_SANDBOX_AGENT` | `CRON_DEPENDENCY_AUDIT`), `kaggleKernelSlug` (`raviikishore07/project-zero-ram-fdtd-gpu` | `raviikishore07/kaggle-v7-production-t4` | `null`), `status` (`RUNNING` | `PAUSED_WEBHOOK` | `PAUSED_APPROVAL` | `COMPLETED` | `CIRCUIT_HALTED`), `currentCheckpointId`, `tokensUsed`, `costUsd`, `savedCostUsd`, `strikeCount`, `createdAt`, `updatedAt`.
- **`StateCheckpoint` (`checkpoints`)**: `id`, `runId`, `parentCheckpointId`, `stepIndex`, `nodeName`, `stateSnapshot` (JSONB of agent memory, variables, and pending webhook expectations), `workspaceMerkleRoot`, `embeddingVector` (`pgvector` 768-dim representation for semantic state lookup), `tokenDelta`, `latencyMs`, `createdAt`.
- **`TrajectoryEvent` (`trajectory_events`)**: `id`, `runId`, `checkpointId`, `toolName`, `canonicalArgsJson`, `argSha256Hash`, `exitCode`, `consecutiveStrikeNumber`, `wasRolledBack`, `preSnapshotFiles`, `postSnapshotFiles`, `stdout`, `stderr`, `durationMs`.
- **`DeadLetterDump` (`dlq_dumps`)**: `id`, `runId`, `haltedAtCheckpointId`, `triggerHash`, `failureSignature`, `consecutiveFailures` (3), `estimatedCostSavedUsd`, `crashDumpPayload` (full stack, environment quotas, last 3 identical tool calls, workspace tree), `resolutionStatus` (`UNRESOLVED` | `PATCHED_AND_RESUMED` | `ARCHIVED`).

### Interactive Component & State Mapping

- **DAG Checkpoint & Kaggle Kernel Reconciler View**:
  - *Create / Dispatch Run*: Launches either a real Gemini-driven multi-step sandbox workflow, a Kaggle GPU kernel reconciliation job (`project-zero-ram-fdtd-gpu` or `kaggle-v7-production-t4`), or a deterministic 3-strike loop test.
  - *Checkpoint Selection & Time-Travel*: Clicking any DAG node loads its exact `StateCheckpoint`, renders a side-by-side unified diff against its parent checkpoint, and exposes `"Fork & Resume From Here"`, `"Inject Webhook Payload"`, and `"Approve Step"` controls.
- **Isolated Sandbox & Rollback Inspector**:
  - *Interactive Command & Code Runner*: Executes bash/code operations inside the virtualized workspace with configurable CPU/Memory quotas and network egress domain whitelisting.
  - *Transactional Rollback Verification*: Triggering a command that exits non-zero (e.g., broken build script or disallowed network egress) immediately demonstrates the pre-tool snapshot capture, non-zero exit trap, and automatic file restoration with a visual before/aborted/restored file tree diff.
- **Trajectory Circuit Breaker & DLQ Inspector**:
  - *Live Hash Stream & Strike Counter*: Displays the real-time SHA-256 hash of normalized tool calls and strike progression (`1/3` → `2/3` → `3/3 HALT`).
  - *DLQ Patch & Replay Modal*: Allows engineers to inspect the structured JSON crash dump, edit the broken tool argument or dependency pin, and resume the halted agent directly from the last valid pre-spiral checkpoint.
- **Live Architecture Benchmark Suite**:
  - *Execute Live Benchmark*: Runs real server-side timing and simulation trials comparing ChronosBox against unmonitored LangGraph/AutoGPT-style loops, computing exact token savings, checkpoint serialization overhead, rollback speed, and exporting a verifiable JSON/Markdown benchmark report alongside PostgreSQL (`pgvector`) + Redis + Docker Compose production deployment manifests.
