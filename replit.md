# DoctorX Prescription

Doctor-facing prescription workspace for managing patient details, clinical notes, medicines, templates, queue status, and prescription actions.

## Run & Operate

- `pnpm --filter @workspace/rxmanager run dev` — run the Vite frontend (port 25108 with `BASE_PATH=/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/rxmanager/src/` — React frontend, auth provider, login page, and prescription workspace
- `artifacts/api-server/src/` — Express API and authentication routes
- `lib/api-client-react/src/generated/` — generated API request hooks and schemas
- `lib/db/src/schema/` — Drizzle database schema

## Architecture decisions

- Web authentication uses a bearer token saved in `localStorage`; the shared API client attaches it to every request.
- A rejected stored token is treated as an expired session and cleared before showing the login form.
- The imported preview API currently provides demo authentication; real clinical data endpoints still require their service implementation.

## Product

The app provides a secure sign-in entry point and a doctor prescription workspace with patient, medicine, template, queue, and print-oriented workflows.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm run typecheck:libs` before artifact typechecks so shared declaration files exist.
- The frontend Vite config requires both `PORT` and `BASE_PATH`; managed artifact workflows provide them automatically.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
