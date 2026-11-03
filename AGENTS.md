# s3-migrator

A Cloudflare Worker that copies objects between S3-compatible buckets. A cron job lists the source, a queue fans out one job per file, and a Durable Object per file runs the multipart copy. D1 holds the transfer records, and a Vue dashboard (`dashboard/`) is served as static assets.

Cloudflare APIs and limits change. Check current docs before relying on them: https://developers.cloudflare.com/workers/ (MCP: `https://docs.mcp.cloudflare.com/mcp`). Limits live under each product's `/platform/limits/` page.

## Setup
Needs Node 22.18 or later, for `node --test` on TypeScript files, and pnpm.

1. Run `pnpm install`.
2. Create the D1 database and the queue: `npx wrangler d1 create s3-migrator-registry` and `npx wrangler queues create s3-migrator-jobs`.
3. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in the D1 database ID and bucket vars.
4. Put the four secrets in `.dev.vars` for local use, or set them with `wrangler secret put`: `SOURCE_ACCESS_KEY_ID`, `SOURCE_SECRET_ACCESS_KEY`, `DESTINATION_ACCESS_KEY_ID`, `DESTINATION_SECRET_ACCESS_KEY`.
5. Run `pnpm cf-typegen`. It generates `worker-configuration.d.ts`, which is gitignored and must never be edited by hand. Run it again after changing bindings or vars.
6. Run `pnpm db:migrate:local`, or `pnpm db:migrate:remote` before deploying.

## Commands
| Command | Purpose |
|---|---|
| `pnpm dev` | Local Worker. It also builds the dashboard |
| `pnpm dev:dashboard` | Vite dev server for dashboard work. It proxies `/api` to `pnpm dev`, which must be running |
| `pnpm build:dashboard` | Build the dashboard into `dashboard/dist` |
| `pnpm typecheck` | Typecheck the Worker and the dashboard |
| `pnpm test` | Unit tests in `tests/`, run with `node --test`. Imports between source files need explicit `.ts` extensions wherever a test reaches them |
| `pnpm run deploy` | Deploy. Plain `pnpm deploy` is a built-in pnpm command, not this script |

Local dev has no cron. To run one scan, start `npx wrangler dev --test-scheduled` and request `/cdn-cgi/local/scheduled`. A paused install does nothing until Start is pressed.

## Things to know
- New installs start paused. Nothing is copied until Start is pressed.
- The HTTP routes have no authentication. Put any deployed hostname behind Cloudflare Access.
- Change bucket vars or secrets only while paused with nothing in progress. Durable Objects read them on every request.
- Files with `.` or `..` key segments, or files too large for a 10,000-part upload, are recorded as `skipped` and never copied.
