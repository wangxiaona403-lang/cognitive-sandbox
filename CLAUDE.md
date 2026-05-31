# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**思维沙盘 (Cognitive Sandbox)** — a mobile-first immersive deep-thinking tool. Users input abstract/professional concepts and receive an exhaustive 8-module deconstruction (academic definition → plain-language translation → cross-domain mapping → Socratic questioning → scenario examples → reusable paradigms → actionable steps). Includes a personal note-taking "sandbox" for each concept.

## Tech Stack

- **Framework**: Next.js 15+ (App Router, TypeScript)
- **Styling**: Tailwind CSS (dark mode, mobile-first responsive)
- **ORM**: Prisma Client
- **Database**: Supabase (PostgreSQL)
- **AI Streaming**: Vercel AI SDK (`ai`, `@ai-sdk/openai`)
- **PWA**: `next-pwa` (offline support, add-to-homescreen)
- **Primary LLM**: Zhipu AI (GLM-4-Flash) — with automatic failover to DeepSeek

## Architecture

### Data Model (Prisma Schema — see `open.txt` §3)

Two core entities with a **1:1 cascade relationship**:

- `Concept` — stores the AI-generated 8-module markdown for each word. `word` is unique (used for cache lookup). `relatedWords` is a comma-separated string parsed client-side for navigation pills.
- `Note` — personal reflection text tied 1:1 to a Concept via `conceptId` (unique FK, cascade delete).

### API Routes (from `open.txt` §5–6)

- **`POST /api/think`** — Main LLM endpoint. Flow: cache lookup by word → de-duplicate against all visited words → construct final prompt (8-module system prompt from `prompt.txt` + engineering patch with blacklist) → stream via Zhipu AI → on failure, transparent failover to DeepSeek → on stream finish, async upsert to Supabase (extracts title as `word`, strips `[RECOMMENDED_START]...` block for `relatedWords`).
- **`POST /api/note`** — Upsert note by `conceptId`. Called with 1.5s debounce from the frontend textarea `onChange`.

### Frontend (from `open.txt` §7)

Single client component (`app/page.tsx`):
- Uses Vercel AI SDK's `useCompletion` hook for streaming markdown rendering via `react-markdown`
- Two code paths: cache hit (instant render from JSON) vs cache miss (streaming generation)
- Bottom drawer with collapsible note textarea, auto-saves with 1.5s debounce
- Related-word pills parsed from `relatedWords` field, tapping triggers a new concept fetch
- Cold start picks from `src/data/seeds.ts` (20 seed words, avoiding duplicates from DB)

### Prompt Engineering (see `prompt.txt`)

The core system prompt defines a persona ("Knowledge Deconstruction Expert") with 8 mandatory output modules. The engineering patch appended at request time adds: blacklist enforcement, empty-word auto-selection, markdown formatting enforcement, and a `[RECOMMENDED_START]...[RECOMMENDED_END]` format for related-word extraction.

## Key Files

| File | Purpose |
|---|---|
| `prompt.txt` | Complete 8-module system prompt (~5.7KB). The core IP of the product. |
| `open.txt` | Full development documentation: tech stack, DB schema, all API routes, frontend component, PWA config. The implementation blueprint. |
| `src/data/seeds.ts` | Seed word bank for cold-start (planned, not yet created) |
| `prisma/schema.prisma` | Database schema (planned, not yet created) |

## Commands

```bash
# Development
npm run dev              # Start Next.js dev server (Turbopack on Next 16+)
npx prisma studio        # Open Prisma DB GUI

# Database
npx prisma db push       # Push schema to Supabase (dev)
npx prisma generate      # Regenerate Prisma client after schema changes

# Production build
npm run build
npm start
```

## Environment Variables (`.env.local`)

- `DATABASE_URL` — Supabase PostgreSQL connection string (pooler mode with `pgbouncer=true`)
- `ZHIPU_API_KEY`, `ZHIPU_BASE_URL`, `ZHIPU_MODEL` — primary LLM (Zhipu GLM)
- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` — failover LLM

## Important Design Decisions (from `open.txt`)

1. **Dual LLM failover is inline, not at the SDK level** — the code catches the primary model's error and retries with the backup inside the same request handler. The user sees a single streaming response regardless of which model served it.

2. **Related words are extracted from the LLM stream** — the LLM outputs `[RECOMMENDED_START]...[RECOMMENDED_END]` at the end of the stream. The server regex-strips this block before persisting to DB, storing extracted words separately in `relatedWords`. The client renders pills from this field.

3. **Word deduplication is DB-driven** — all previously generated `Concept.word` values are fetched and included in the prompt's blacklist, preventing duplicate generations across sessions.

4. **Note saving is optimistic with debounce** — the textarea fires a save on every keystroke via 1.5s debounce, no explicit save button. The `upsert` pattern handles both create and update.

5. **PWA is dev-disabled** — `next-pwa` is configured with `disable: process.env.NODE_ENV === 'development'` to avoid cached service workers interfering with hot reload.

@AGENTS.md
