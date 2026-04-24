# Project Conventions

## Language

- Application UI text must be in English.
- Source code, identifiers, and code comments must be in English.
- Repository documentation must be in English.

## Product Direction

- SutraPad is a client-only PWA running in the browser.
- Authentication uses a Google account.
- User data is stored in Google Drive.

## Engineering

- A bugfix is not complete without a test that would fail before the fix and pass after it.
- Prefer small extracted helpers for logic that is otherwise hard to test in UI setup code.

## Consistency

Consistency matters in two layers — the UX the user sees, and the patterns the next change has to slot into. When adding or modifying a feature, check that both stay coherent:

### Cross-page UX

- **Same control, same shape.** When a control appears on more than one page (view toggles, filter pills, sort dropdowns, header CTAs), its option order, labels, default, keyboard shortcut, and storage scope must match across all pages. *Example: the `[Cards | List]` view toggle on Notes and Links lists `Cards` first because both pages default to it; flipping the order on one page would surprise anyone who switched once and now expects the same muscle memory elsewhere.*
- **Default mode first.** When a control offers two or more modes and one of them is the default, list it first in the picker.
- **Same word for the same thing.** If one page calls a thing a "notebook," the other pages don't call it a "note" or a "doc." Pick the term once and grep the codebase if it drifts.
- **Same empty-state shape.** Pages with comparable empty states (no notes / no links / no tags) use the shared `buildEmptyScene` + `EMPTY_COPY` set so the illustration, eyebrow, copy length, and CTA placement all match.

### Code shape

- **Look for the slot before adding the field.** Before extending a shared type (e.g. `SutraPadCaptureContext`, `SutraPadDocument`), grep for the semantic name — there's a real chance the model already has the field nested somewhere it belongs. Adding a duplicate at a different level forces every reader to learn two slots and silently breaks the helper that already populates the existing one.
- **Parallel patterns over premature abstraction.** When a second feature wants the same shape as an existing one (e.g. `notes-view.ts` ⇆ `links-view.ts`, both URL+localStorage view-mode persistence), it's fine to copy-adapt the first instead of factoring a generic helper. Once a *third* instance lands, factor — earlier abstraction tends to constrain the second instance for shape, and the constraint costs more than the duplication.
- **Same filename / function signature for sibling responsibilities.** New page modules go under `src/app/view/pages/<page>-page.ts` with a `build<Page>Page(options)` entry point. New pure-logic modules go under `src/app/logic/<topic>.ts` and stay DOM-free + node-testable. Wiring goes through `app.ts`'s `RenderCallbackOptions`.

### Catching drift

- After a change that touches a *family* of pages (e.g. one of the list-style screens, one toggle, one filter), spot-check every other member of the family for the same surface and confirm it still matches. The cleanup pass in `AGENTS.md` (critical review → refactor → coverage → mutation) is the moment to do this.
