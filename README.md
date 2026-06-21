# Engineering Memory

Engineering Memory is a local tool for indexing Git commit knowledge and asking questions about the evolution of a codebase.

The current implementation is a working vertical slice: it reads commits from configured local repositories, analyzes diffs with an OpenAI-compatible model served by LM Studio, stores structured knowledge in SQLite, retrieves relevant commits, and answers questions through a CLI or a local web UI.

## Current Status

Implemented:

- TypeScript project with strict compiler settings.
- YAML application configuration.
- OpenAI-compatible AI provider configured for LM Studio.
- AI health check and model availability check.
- Deterministic Git extraction:
  - commit metadata;
  - parent hashes;
  - changed files;
  - additions/deletions;
  - unified diff;
  - Windows `safe.directory` handling.
- Secret redaction before sending diffs to the model.
- Structured commit analysis through JSON Schema.
- Controlled repair of common local-model output issues:
  - clamp `confidence` into `[0, 1]`;
  - trim oversized arrays;
  - validate returned `sourceId` values.
- Local SQLite persistence:
  - repositories;
  - commits;
  - commit files;
  - diff chunks;
  - commit knowledge;
  - knowledge facts;
  - source references;
  - Git version tags associated with commits.
- Configured repository ingestion through `config/repositories.yaml`.
- Monorepo projects with path-scoped analysis and independent logical identities.
- Git tag discovery and project-specific version patterns.
- Recent commit ingestion with idempotent skipping of already indexed commits.
- Periodic commit digest daemon for configured local repositories.
- Global digestion lock to prevent overlapping LM Studio analysis cycles.
- Newest-to-oldest commit traversal within each configured history window.
- Basic retrieval over summaries and facts.
- Recency fallback for broad questions like "what changed recently?"
- Direct lookup by short or full Git commit hash.
- CLI chat over indexed memory.
- **Executive Dashboard v1.0** ✨ NEW:
  - Visual analytics dashboard with real-time metrics
  - Multi-tab interface (Chat, Dashboard, Reports)
  - Metrics endpoints (velocity, stability, reports)
  - Top contributors tracking
  - Critical areas identification
  - Stability index calculation
  - Weekly/monthly reporting
  - Auto-refresh UI
  - PDF export capability
- Local web UI and HTTP API.
- Audience-aware answers with `Desarrollador` and `Usuario` modes.
- Git author and committer metadata available to retrieval and model context.
- Combined work reports by Git author and inclusive date range, grouped by project/repository.
- Live chat progress events for retrieval, context preparation, and model response generation.

Not implemented yet:

- PostgreSQL and pgvector.
- Persistent background job queue.
- Automatic `git fetch` and remote branch reconciliation.
- Clone management for remote repositories.
- Embeddings.
- Hybrid semantic ranking.
- Token-by-token model response streaming.
- Full web views for commits, jobs, and repositories.
- Authentication.
- Pull request metadata such as PR author, description, reviewers, and approvals.

## Requirements

- Node.js 20+.
- Git.
- LM Studio running an OpenAI-compatible local server.
- A chat model loaded in LM Studio.

The current local config uses:

```yaml
ai:
  baseUrl: http://127.0.0.1:1234/v1
  apiKey: lm-studio
  chatModel: google/gemma-4-e2b
```

## Setup

Install dependencies:

```powershell
npm install
```

Create local config files if needed:

```powershell
Copy-Item config/application.example.yaml config/application.yaml
Copy-Item config/repositories.example.yaml config/repositories.yaml
```

Edit `config/application.yaml` so `ai.chatModel` matches a model currently loaded in LM Studio.

## Configuration

Application config lives in:

```text
config/application.yaml
```

Repository config lives in:

```text
config/repositories.yaml
```

An example repository entry tracking `main` is:

```yaml
repositories:
  - id: example-repository
    displayName: Example Repository
    enabled: true
    checkout:
      localPath: C:\path\to\repository
      branch: main
```

The config excludes noisy/generated files before sending diffs to the model, including `node_modules`, build output, lockfiles, and SQLite data/WAL/SHM files.

### Synchronization window

For a large repository, use a date cutoff so the first ingestion does not walk
its entire history. `count` is optional, but combining it with `since` provides
an additional upper bound:

```yaml
polling:
  intervalSeconds: 300
  initialHistory:
    mode: since
    since: "2026-01-01"
    count: 500
```

Only commits on or after the ISO date are candidates, with at most 500 commits
per configured repository or monorepo project. Already processed commits are
skipped without calling the AI model. To use a date only, omit `count`.

### Monorepos and version tags

A physical repository can expose several independently searchable projects. A
project id is expanded as `<repository-id>/<project-id>`, its analysis patterns
are relative to `rootPath`, and the repository-level exclusions still apply:

```yaml
repositories:
  - id: platform
    displayName: Platform Monorepo
    checkout:
      localPath: C:\path\to\monorepo
      branch: main
    analysis:
      exclude: ["**/node_modules/**", "**/dist/**"]
    projects:
      - id: api
        displayName: API
        rootPath: services/api
        analysis:
          include: ["**/*"]
        versioning:
          tags:
            include: ["api-v*"]
      - id: web
        displayName: Web Application
        rootPath: apps/web
        versioning:
          tags:
            include: ["web-v*"]
```

For this example, use `platform/api` or `platform/web` as the repository key in
the CLI and web API. Lightweight and annotated tags are both supported. Tags
that point at an indexed commit are stored as versions and can be found in
questions and included model context. Adding a tag later does not force a new
AI analysis; the daemon synchronizes its version metadata independently.

## Commands

Check TypeScript:

```powershell
npm run typecheck
```

Check AI connectivity:

```powershell
npm run health:ai
```

Analyze a commit and print JSON without storing it:

```powershell
npm run spike:commit -- --repo C:\path\to\repo --commit HEAD
```

Analyze and persist a single commit:

```powershell
npm run ingest:commit -- --repo C:\path\to\repo --commit HEAD --repository-key my-repo
```

Preview recent configured commits without calling the model:

```powershell
npm run ingest:recent -- --repository example-repository --count 5 --dry-run
```

Analyze and persist recent commits:

```powershell
npm run ingest:recent -- --repository example-repository --count 5
```

Analyze commits from a date, optionally with an absolute limit:

```powershell
npm run ingest:recent -- --repository example-repository --since 2026-01-01
npm run ingest:recent -- --repository example-repository --since 2026-01-01 --count 500
```

Show database contents:

```powershell
npm run db:summary
```

Ask a question from the CLI:

```powershell
npm run chat -- --repository example-repository --question "what changed recently?"
```

Choose the answer audience from the CLI:

```powershell
npm run chat -- --repository example-repository --audience developer --question "what did the latest commit change?"
npm run chat -- --repository example-repository --audience user --question "summarize the latest changes"
```

`developer` responses may include commit hashes, files, line ranges, symbols, and implementation details. `user` responses contain high-level descriptions and user-facing impact without exposing code references or internal context.

Show the context sent to the model:

```powershell
npm run chat -- --repository example-repository --question "what changed recently?" --show-context
```

Run the local web UI:

```powershell
npm run server
```

Run only the commit digest daemon:

```powershell
npm run daemon
```

Run the web server and commit digest daemon together:

```powershell
npm start
```

The daemon starts a digestion cycle immediately and then monitors repositories using each repository's `polling.intervalSeconds`. It processes one global cycle at a time, visits each eligible repository sequentially, walks commits from newest to oldest, and skips commits already indexed for the configured model.

The daemon currently monitors local branch state. It does not run `git fetch`, update branches, or clone missing repositories yet.

Open:

```text
http://127.0.0.1:8080
```

## Web API

The local server currently exposes:

```text
GET  /api/health
GET  /api/repositories
GET  /api/summary
POST /api/chat
POST /api/chat/stream
GET  /api/metrics/dashboard
GET  /api/metrics/velocity
GET  /api/metrics/report
GET  /api/metrics/stability
GET  /api/employee-reports/authors
POST /api/employee-reports
GET  /dashboard
GET  /dashboard.css
GET  /dashboard.js
```

`POST /api/chat/stream` returns Server-Sent Events for actual processing stages and then the complete result. The web UI uses it to show current work and elapsed time while the user waits.

`GET /api/health` includes live digest daemon state: whether it is running, current repository/commit, timestamps, and indexed/failed counts for the active cycle.

`GET /api/employee-reports/authors` lists exact `author_name` identities with
digested commits. `POST /api/employee-reports` accepts `from`, `to`, an optional
`authorNames` array (`null` means all authors in the period), and `language`.
It generates one evidence-backed LLM report per author and returns them as one
combined document, with tasks grouped by configured project/repository inside
each employee section. Git authorship is used for attribution; the report does not
treat commit volume as a productivity measure.

### Employee work reports

The **Reports** tab includes an employee report form with an inclusive start
date, end date, and an exact Git author or all authors. Only authors with
digested commits in currently enabled repositories are offered; stale fixture
repositories and disabled sources are excluded.

For each employee, evidence is separated by logical project/repository before
calling the model. This prevents commits from different projects being mixed in
one task group. The combined document contains:

- an overall employee summary;
- one section per project/repository;
- focus areas and grouped tasks for that project;
- outcomes, confidence, and validated commit evidence;
- declared limitations and any project block that could not be generated.

The model can only return repository keys and commit hashes included in its
input JSON Schema. References are validated again after generation. A malformed
project response is retried once with reduced evidence, while successful
project and employee sections are preserved.

Example request for all authors in a period:

```powershell
$body = @{
  from = "2026-01-01"
  to = "2026-06-30"
  authorNames = $null
  language = "es"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/employee-reports `
  -ContentType "application/json" `
  -Body $body
```

Set `authorNames` to an array such as `@("Git Author Name")` to select an
employee. A request is limited to 366 days and 50 authors. Up to 100 analyzed
commits are selected per employee with balanced representation across their
repositories. Reports are generated sequentially to avoid overlapping local
model calls.

Git attribution has precise semantics:

- `author_name` identifies the person recorded by Git as the author of the work;
- `committer_name` identifies the person or process that integrated the commit;
- neither field proves who authored, reviewed, or approved a pull request.

PR descriptions, reviewers, approvals, and formal PR authorship require a
future provider-specific API integration.

### Dashboard Ejecutivo (Executive Dashboard)

**Version 1.0** - Released 2026-06-21

The dashboard provides real-time metrics and analytics for the Engineering Memory system:

- **📊 Dashboard Tab**: Visual executive dashboard with:
  - Summary metrics (total commits, active authors, repositories, facts)
  - Daily velocity breakdown (commits per day, authors per day)
  - Top 5 contributors with progress bars
  - Critical areas (most modified files) with risk assessment
  - Stability index with risk level indicator
  - Auto-refresh every 60 seconds

- **📋 Reports Tab**: Quick access to generated reports:
  - Weekly reports (commits, top contributors, modified areas)
  - Monthly reports (detailed analysis)
  - Velocity metrics (development speed trends)
  - Stability analysis (bug/feature ratio)

- **💬 Chat Tab**: Original chat interface

**API Endpoints**:

```bash
# Get summary metrics
GET /api/metrics/dashboard

# Get velocity metrics (commits/day analysis)
GET /api/metrics/velocity?days=30

# Get detailed reports
GET /api/metrics/report?period=weekly

# Get stability index
GET /api/metrics/stability?repository=<key>
```

**Example**: View the dashboard at `http://127.0.0.1:8080/` and click the "📊 Dashboard" tab.

Example chat request:

```powershell
$body = @{
  question = "explicame un poco las ultimas cosas que se han hecho"
  repositoryKey = "example-repository"
  limit = 5
  audience = "user"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/chat `
  -ContentType "application/json" `
  -Body $body
```

## Data

The current persistence layer uses SQLite:

```text
./data/engineering-memory.sqlite
```

This is intentionally a lightweight vertical slice. The schema mirrors the planned PostgreSQL model closely enough to migrate the next iteration to PostgreSQL and pgvector.

Local database contents and repository configuration are deliberately ignored
by Git and are not part of the distributed project.

## Implementation Notes

The system deliberately treats repository content as untrusted:

- Git is executed without shell command composition.
- Repository content is not executed.
- Secrets are redacted before model calls.
- Model-provided source references are validated against known commit files.
- Employee-report evidence is restricted to known repository/commit pairs.
- Employee reports use Git authorship but do not rank people or infer productivity.
- Answers are instructed to cite repository, commit, file, and line references when available.

Retrieval is still simple. It currently combines lexical matching, fact matching, recency fallback, risk/symptom boosts, and direct commit hash lookup. Embeddings and pgvector are planned but not implemented yet.

## License

Copyright (c) 2026 Jose Vicente Lozano Copa. All rights reserved. This is
proprietary software; see `LICENSE` for the applicable terms.

## Next Steps

Recommended next implementation steps:

1. Add a commit detail endpoint and web panel showing facts and references.
2. Add a repository status panel.
3. Add `sync` support for fetching remote commits and reconciling configured branches.
4. Add a persistent job queue for `repository.sync` and `commit.analyze`.
5. Move persistence from SQLite to PostgreSQL.
6. Add embeddings and hybrid retrieval with pgvector.
7. Add streaming responses to the web chat.
