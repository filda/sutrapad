/**
 * Home-page hint banner — composer + DOM builder.
 *
 * The composer ({@link composeHintBanner}) loads the persisted hint
 * store, asks the engine in `src/app/logic/hints.ts` which candidate
 * (if any) to show, records the impression, and returns a DOM element
 * the home page can drop above the timeline. Returns `null` when no
 * candidate applies — the home page omits the slot rather than rendering
 * an empty placeholder, so users with nothing to surface don't get a
 * "Tip: …" header pointing at nothing.
 *
 * The CTA and dismiss handlers both record a dismiss with the candidate's
 * cooldown. The CTA path does so because navigating away counts as the
 * user "handling" the hint — the next render after they come back
 * shouldn't flicker the same banner during the moment between clicking
 * and the underlying gate flipping (the new captured note hasn't landed
 * yet, the tag merge dialog hasn't been confirmed yet, the one-thing
 * pin hasn't been set yet). The dismiss path does so because that's the
 * literal user gesture.
 *
 * The DOM shape mirrors the simple one-line banner pattern in
 * `update-notification.ts` — accent strip on the left, eyebrow + title +
 * body in the middle column, CTA + dismiss × on the right. Class names
 * are scoped under `.hint-banner` so the existing `.update-banner` /
 * `.capture-chip` chrome is unaffected.
 */
import {
  loadHintStore,
  persistHintStore,
  recordDismissed,
  recordShown,
  selectHint,
  type HintCallbacks,
  type HintCandidate,
  type HintContext,
  type HintId,
} from "../../logic/hints";
import { DEFAULT_HINT_CANDIDATES } from "../../logic/hint-candidates";
import { suggestTagAliases } from "../../logic/tag-aliases";
import { buildTagIndex } from "../../../lib/notebook";
import { countTasksInNote } from "../../../lib/tasks";
import type { SutraPadWorkspace, UserProfile } from "../../../types";

/**
 * Inputs needed to derive the home-page {@link HintContext}. Lifted out
 * of `render-app.ts` so the workspace-walking signal computation has
 * its own scope and doesn't shadow the outer `note` parameter that
 * `RenderAppOptions` already destructures. Centralising the build
 * here also keeps every candidate's pre-computed dependency next to
 * the engine that consumes it.
 */
export interface HomeHintContextOptions {
  workspace: SutraPadWorkspace;
  profile: UserProfile | null;
  dismissedTagAliases: ReadonlySet<string>;
  tasksOneThingKey: string | null;
  callbacks: HintCallbacks;
}

/**
 * Builds the {@link HintContext} for one home render. Walks the
 * workspace twice in the worst case (open-task tally + capture-source
 * scan) — both are O(n) over notes and the cost mirrors the existing
 * stats-strip computation, so the banner doesn't add a round trip.
 */
export function buildHomeHintContext(
  options: HomeHintContextOptions,
): HintContext {
  const {
    workspace,
    profile,
    dismissedTagAliases,
    tasksOneThingKey,
    callbacks,
  } = options;
  const tagAliasSuggestions = suggestTagAliases(buildTagIndex(workspace), {
    dismissed: dismissedTagAliases,
  });
  let openTaskCount = 0;
  for (const note of workspace.notes) {
    openTaskCount += countTasksInNote(note).open;
  }
  const hasEverCapturedExternally = workspace.notes.some(
    (note) =>
      note.captureContext?.source === "url-capture" ||
      note.captureContext?.source === "text-capture",
  );
  return {
    workspace,
    profile,
    dismissedTagAliases,
    tasksOneThingKey,
    tagAliasSuggestions,
    openTaskCount,
    hasEverCapturedExternally,
    callbacks,
  };
}

/**
 * Options accepted by {@link composeHintBanner}. The candidate list and
 * storage are injectable so tests can build the banner against
 * deterministic input without touching `window.localStorage` or the
 * real registration order.
 */
export interface ComposeHintBannerOptions {
  /** Inputs the engine + each candidate gate read from. */
  ctx: HintContext;
  /** Reference time for cooldown comparison. Defaults to `Date.now()`. */
  now?: number;
  /** Candidate list. Defaults to {@link DEFAULT_HINT_CANDIDATES}. */
  candidates?: readonly HintCandidate[];
  /** Storage shim. Defaults to `window.localStorage`. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/**
 * Composes the hint banner for the current render. Returns the element
 * to mount, or `null` when no candidate applies. Side effects: persists
 * the impression so the rotation rotates next time and so the cooldown
 * gate stays accurate.
 */
export function composeHintBanner(
  options: ComposeHintBannerOptions,
): HTMLElement | null {
  const {
    ctx,
    now = Date.now(),
    candidates = DEFAULT_HINT_CANDIDATES,
    storage = window.localStorage,
  } = options;

  const store = loadHintStore(storage);
  const candidate = selectHint(candidates, ctx, store, now);
  if (candidate === null) return null;

  // Record the impression immediately. If `build` throws, we'd still
  // rather have the rotation memory updated — the alternative is the
  // same hint sticking on every render until the user dismisses it,
  // which would defeat the round-robin entirely.
  persistHintStore(recordShown(store, candidate.id, now), storage);

  const content = candidate.build(ctx);

  const handleDismiss = (): void => {
    const fresh = loadHintStore(storage);
    persistHintStore(recordDismissed(fresh, candidate.id, now), storage);
  };

  const banner = buildHintBannerElement({
    id: candidate.id,
    eyebrow: content.eyebrow,
    title: content.title,
    body: content.body,
    ctaLabel: content.ctaLabel,
    onCta: () => {
      // Cooldown the hint *before* we navigate so a quick "back" press
      // doesn't immediately re-surface it. The candidate's gate will
      // usually flip on its own once the user follows through; this is
      // belt-and-braces for the in-between moment.
      handleDismiss();
      content.onCta();
    },
    onDismiss: () => {
      handleDismiss();
      banner.remove();
    },
  });

  return banner;
}

interface HintBannerElementOptions {
  id: HintId;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
  onDismiss: () => void;
}

/**
 * Renders the banner DOM. Pure builder — no storage, no engine. Kept
 * separate so tests can exercise the markup without a hint context.
 *
 * `data-hint-id` lands on the root so the home-page test can assert
 * "the right banner rendered" without scraping the visible copy.
 * `aria-live="polite"` matches `update-banner`'s pattern: the hint is
 * advisory, not urgent, so screen readers announce it on the next
 * available pause rather than interrupting whatever the user is on.
 */
function buildHintBannerElement(
  options: HintBannerElementOptions,
): HTMLElement {
  const banner = document.createElement("section");
  banner.className = "hint-banner";
  banner.dataset.hintId = options.id;
  banner.setAttribute("role", "note");
  banner.setAttribute("aria-live", "polite");
  banner.setAttribute("aria-label", "Hint");

  const accent = document.createElement("span");
  accent.className = "hint-banner-accent";
  accent.setAttribute("aria-hidden", "true");
  banner.append(accent);

  const text = document.createElement("div");
  text.className = "hint-banner-text";

  const eyebrow = document.createElement("p");
  eyebrow.className = "hint-banner-eyebrow";
  eyebrow.textContent = options.eyebrow;
  text.append(eyebrow);

  const title = document.createElement("p");
  title.className = "hint-banner-title";
  title.textContent = options.title;
  text.append(title);

  const body = document.createElement("p");
  body.className = "hint-banner-body";
  body.textContent = options.body;
  text.append(body);

  banner.append(text);

  const actions = document.createElement("div");
  actions.className = "hint-banner-actions";

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "hint-banner-cta";
  cta.textContent = options.ctaLabel;
  cta.addEventListener("click", () => options.onCta());
  actions.append(cta);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "hint-banner-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss hint");
  dismiss.title = "Not now — hide for a while";
  // Inline ✕ glyph as text rather than an SVG icon. The dismiss surface
  // is one of the most common targets in this banner; an SVG would mean
  // an extra style rule for sizing parity with the CTA button text, and
  // the ✕ glyph reads identically across the system fonts the rest of
  // the chrome falls back to.
  dismiss.textContent = "✕";
  dismiss.addEventListener("click", () => options.onDismiss());
  actions.append(dismiss);

  banner.append(actions);

  return banner;
}
