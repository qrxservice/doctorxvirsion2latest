# DoctorX / RxManager Work Plan Handoff

**Prepared:** 2026-09-10  
**Purpose:** Transfer the current project status and continuation plan to another Replit account or agent.

## Product

Doctor-facing prescription workspace for:

- Patient details and clinical notes
- Queue status
- Medicine search and prescription entry
- Prescribed medicine review, editing, deletion, and reordering
- Templates
- Save/edit prescription flows
- Print/PDF-oriented workflows

## Current project structure

- Frontend artifact: `artifacts/rxmanager`
- API artifact: `artifacts/api-server`
- Main prescription page: `artifacts/rxmanager/src/pages/doctor/NewPrescriptionPage.tsx`
- Prescription UI styles: `artifacts/rxmanager/src/index.css`
- Generated API client: `lib/api-client-react/src/generated/`
- Database schema: `lib/db/src/schema/`

## Completed phases

### Phase A — Source audit

Completed. The existing React/Vite frontend, API client, prescription state, handlers, templates, queue logic, save/edit flows, and print/PDF behavior were reviewed before UI changes.

### Phase B — Prescription page UI skeleton

Completed.

- Added two top menu rows.
- Moved Queue Summary into a shared strip directly below the menus.
- Added responsive clinical context and prescription panels.
- Added screen-only doctor/patient header presentation using existing doctor/settings state.
- Preserved print/PDF behavior.
- Added scoped Rx styling, responsive layout rules, Bengali-friendly typography, and screen-only watermark treatment.

### Phase C — Medicine prescription entry UI

Completed.

- Reused the existing debounced medicine search endpoint and suggestion flow.
- Added keyboard support:
  - Arrow Up/Down to navigate suggestions
  - Enter to select or add
  - Escape to close suggestions
- Added accessible combobox/listbox semantics.
- Added selected-medicine confirmation presentation.
- Added quick selectable dose, timing, and duration options from existing template data.
- Preserved custom dose, timing, duration, and instruction inputs.
- Preserved add/reset/focus behavior and medicine shortcuts.

### Phase D — Prescribed medicine list

Completed.

- Added a clearer card-based prescribed-medicine list.
- Added automatic serial numbers based on current list order.
- Displayed available brand, generic, strength, form, dose, timing, duration, and instructions.
- Added a dedicated drag handle.
- Preserved existing drag/drop reorder logic.
- Preserved move-up and move-down controls for mobile and keyboard-friendly use.
- Improved edit/delete action targets.
- Edit continues to load the same Phase C entry form and updates the original medicine in place.
- Added cancel-edit reset behavior.
- Added lightweight delete confirmation.
- Delete clears edit mode if the deleted medicine was being edited.
- No duplicate medicine state was introduced.

## Files changed for the UI work

- `artifacts/rxmanager/src/pages/doctor/NewPrescriptionPage.tsx`
- `artifacts/rxmanager/src/index.css`

No backend, API, database schema, authentication, routes, queue, patient loading, templates, or print/PDF files were changed for these phases.

## Important existing logic to preserve

In `NewPrescriptionPage.tsx`, do not replace or duplicate:

- `medicines` state
- `currentMed` state
- `addMedicine`
- `editMedicine`
- `updateMedicine`
- `removeMed`
- `moveMedicine`
- `dropMedicine`
- Existing prescription load/edit state hydration
- Existing save and print handlers
- Existing medicine search debounce and suggestion selection
- Existing template-backed dose/timing/duration data

## Known limitation

The imported API currently returns 404 responses for several clinical endpoints, including some queue, appointment, doctor profile/settings, prescription, and app settings endpoints.

Effect:

- The prescription page UI renders.
- Static/default controls render.
- Patient, queue, doctor, and saved prescription data may remain empty in preview until those existing API services are implemented or connected.

This limitation was intentionally not changed because the requested phases were UI-only.

## Validation completed

Run from the workspace root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/rxmanager run typecheck
PORT=25108 BASE_PATH=/ pnpm --filter @workspace/rxmanager run build
git diff --check
```

All checks passed after the Phase D changes.

Desktop and mobile previews were also checked. Browser logs showed the known API 404 responses but no React render/compiler errors.

## Workflow notes

Configured workflows include:

```text
Start RxManager frontend
Start RxManager API
artifacts/rxmanager: web
artifacts/api-server: API Server
artifacts/mockup-sandbox: Component Preview Server
```

The managed workflows are the preferred ones. Avoid starting duplicate frontend/API workflows when the managed service already owns the port. A duplicate start may report `EADDRINUSE` even though the managed service is healthy.

## Recommended continuation plan

### Immediate handoff steps

1. Read this file and `replit.md`.
2. Inspect the current `git diff` before editing.
3. Run the shared-library typecheck before the frontend typecheck.
4. Verify which managed workflow owns the frontend/API port.
5. Do not assume clinical data is available until the API 404 limitation is resolved.

### Phase E — pending, do not start automatically

Phase E was explicitly deferred. It may cover the doctor-header and print-focused work, but it requires a separate user request before implementation.

Potential Phase E areas named by the specification:

- Doctor header/profile presentation
- Screen watermark changes
- Print header
- PDF header
- Print prescription design

Before Phase E:

- Re-read the new Phase E specification.
- Confirm which screen-only versus print-visible changes are allowed.
- Preserve existing print/PDF handlers and output contracts unless the user explicitly requests changes.

## Safety boundaries for future work

Do not:

- Modify backend/API/database code for a UI-only phase.
- Change database schema.
- Replace the existing medicine search system.
- Create duplicate medicine or prescription state.
- Break reopened prescription editing.
- Remove existing medicine fields.
- Change authentication, routes, queue behavior, patient loading, templates, or save logic without explicit scope.
- Start a later phase while implementing an earlier phase.
