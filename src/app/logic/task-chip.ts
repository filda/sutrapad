/**
 * Describes how the "this notebook has tasks" chip should render next to a
 * note's updated-at date in the notebook list. Kept DOM-free so the three
 * branches (no tasks / all done / still open) can be unit-tested without
 * standing up a DOM fixture.
 *
 * Returning `null` means the chip should not be rendered at all — the note
 * has no tasks and the list row stays visually uncluttered.
 */
export interface TaskChipDescriptor {
  /** Visual tone; the view layer maps this to a CSS class. */
  tone: "has-open" | "all-done";
  /** Short visible label, including the glyph (e.g. "☐ 2/5", "✓ 5/5"). */
  text: string;
  /** Full accessible description used as aria-label. */
  ariaLabel: string;
}

export function describeTaskChip(counts: {
  open: number;
  done: number;
}): TaskChipDescriptor | null {
  const total = counts.open + counts.done;
  if (total === 0) return null;

  const plural = total === 1 ? "" : "s";

  if (counts.open === 0) {
    return {
      tone: "all-done",
      text: `✓ ${counts.done}/${total}`,
      ariaLabel: `${total} task${plural}, all completed`,
    };
  }

  return {
    tone: "has-open",
    text: `☐ ${counts.open}/${total}`,
    ariaLabel: `${counts.open} of ${total} task${plural} open`,
  };
}
