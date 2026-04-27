/**
 * Concrete hint candidates for the home page rotation.
 *
 * Each candidate is a pure function of {@link HintContext}: an
 * `isApplicable` gate plus a `build` that produces the banner content.
 * The engine in `hints.ts` decides which one to show; this file decides
 * what each one looks like and when it fires.
 *
 * Priority bands:
 *   - **100** — onboarding bumpers. Fire only for users who haven't
 *     done a one-time setup step. Cooldowns are weeks-long because the
 *     bumper isn't a daily nag — once the step is done the gate goes
 *     false on its own and the cooldown becomes academic.
 *   - **50** — periodic nudges that depend on workspace state. Tag
 *     hygiene and the "one thing for today" pin both compete here, so
 *     the engine rotates between them at the same priority.
 *
 * Cooldowns are intentionally generous. Filip explicitly chose
 * "schovat na určitou dobu" over permanent dismiss — clicking ✕ is a
 * "not now," not a "never." A cooldown that's too short feels like
 * pestering; one that's too long means a one-off "not today" silently
 * eats the hint for good.
 *
 * Adding a new candidate: append it to {@link DEFAULT_HINT_CANDIDATES}
 * and add the relevant signal to {@link HintContext} if it isn't
 * already there. The engine picks it up automatically.
 */
import type { HintCandidate, HintContent, HintId } from "./hints";

/**
 * Stable string ids. Exported so tests, the view layer, and any future
 * "reset just this hint" affordance can refer to a candidate without
 * importing the candidate object itself. Renaming an id wipes that
 * hint's dismiss memory for existing users — bump a version segment
 * (e.g. `"install-capture/v2"`) when the change is deliberate.
 */
export const HINT_INSTALL_CAPTURE: HintId = "install-capture";
export const HINT_TAG_MERGE: HintId = "tag-merge";
export const HINT_ONE_THING: HintId = "one-thing";

/**
 * "You haven't installed the bookmarklet yet" — the highest-priority
 * onboarding bumper. Gate: signed-in user with no note ever captured
 * via the bookmarklet or iOS share. New users see this every time they
 * land on Home until they either install something or dismiss it for
 * a month.
 *
 * The signed-in check matters because capture-import only meaningfully
 * helps a user who has Drive sync set up — for a signed-out drafter,
 * "install a button" is a step too far on day one. Once they sign in,
 * the hint surfaces naturally.
 */
const installCapture: HintCandidate = {
  id: HINT_INSTALL_CAPTURE,
  priority: 100,
  cooldownDays: 30,
  isApplicable(ctx) {
    if (ctx.profile === null) return false;
    return !ctx.hasEverCapturedExternally;
  },
  build(_ctx): HintContent {
    return {
      eyebrow: "Capture · install",
      title: "Send anything into SutraPad.",
      body:
        "One button in your browser, one Shortcut on iOS. Save a page or a quote without opening the app.",
      ctaLabel: "Set up capture",
      onCta: () => _ctx.callbacks.openCapture(),
    };
  },
};

/**
 * "These two tags look like the same thing" — a hygiene nudge. Gate:
 * the suggestion engine has at least one non-dismissed cluster. The
 * banner doesn't list specific tags inline (yet) because rendering a
 * faithful pair preview means picking one cluster out of N and the UX
 * for "show me the rest" doesn't exist on the home banner — Settings
 * already does that surface well, so the hint just routes there.
 *
 * Cooldown is one week: aliases creep in slowly (you typed `Žižkov`
 * and `zizkov` in two separate notes), so re-prompting weekly catches
 * fresh duplicates without nagging on the same cluster three days
 * after a "not now."
 */
const tagMerge: HintCandidate = {
  id: HINT_TAG_MERGE,
  priority: 50,
  cooldownDays: 7,
  isApplicable(ctx) {
    return ctx.tagAliasSuggestions.length > 0;
  },
  build(ctx): HintContent {
    const count = ctx.tagAliasSuggestions.length;
    const noun = count === 1 ? "duplicate" : "duplicates";
    return {
      eyebrow: "Tags · hygiene",
      title:
        count === 1
          ? "Two tags look like the same thing."
          : `${count} pairs of tags look like duplicates.`,
      body: `Merge the ${noun} in Settings so the constellation stays clean. Each pair has a "keep separate" option if it's intentional.`,
      ctaLabel: "Open Settings",
      onCta: () => ctx.callbacks.openSettings(),
    };
  },
};

/**
 * "Pick one thing for today" — daily anchor. Gate: at least three open
 * tasks across the workspace and no current pin. Three is a soft
 * threshold: with one or two open tasks, the user already knows what's
 * next; with three or more, a pin actually helps narrow focus.
 *
 * Cooldown is one day so the same prompt can come back tomorrow if the
 * user dismisses today and never picks. The Tasks page has its own
 * "one thing" widget, so the hint is a shortcut for the home reader,
 * not the only path to the feature.
 */
const oneThing: HintCandidate = {
  id: HINT_ONE_THING,
  priority: 50,
  cooldownDays: 1,
  isApplicable(ctx) {
    if (ctx.tasksOneThingKey !== null) return false;
    return ctx.openTaskCount >= 3;
  },
  build(ctx): HintContent {
    const count = ctx.openTaskCount;
    return {
      eyebrow: "Today · focus",
      title: "Pick one thing for today.",
      body: `${count} open threads waiting. Pin one and the rest can stay loose.`,
      ctaLabel: "Open Tasks",
      onCta: () => ctx.callbacks.openTasks(),
    };
  },
};

/**
 * Default registration order. The engine doesn't depend on order — it
 * sorts by priority + recency — but tests and any "show all hints in
 * Settings" affordance read this in declaration order, so keep the
 * highest-priority bumpers near the top for easy scanning.
 */
export const DEFAULT_HINT_CANDIDATES: readonly HintCandidate[] = [
  installCapture,
  tagMerge,
  oneThing,
];
