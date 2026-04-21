import { formatAutoTagDisplay } from "../../../lib/auto-tag-display";

/**
 * Fills a chip button/span with either `[icon] [label]` (auto-tag) or the
 * plain tag text (user tag, or any unknown-namespace fallback). Keeps all
 * three chip renderers — Tags page cloud, Notes page cloud, selected-filters
 * bar — consistent without repeating the `formatAutoTagDisplay` null-check
 * dance in each one.
 *
 * The suffix argument exists for the tag cloud chips that append "· <count>"
 * after the label; passing it through here keeps the count next to the label
 * rather than squashed up against the icon.
 */
export function appendTagChipContent(
  chip: HTMLElement,
  tag: string,
  isAuto: boolean,
  suffix = "",
): void {
  const display = isAuto ? formatAutoTagDisplay(tag) : null;

  if (display === null) {
    chip.textContent = suffix ? `${tag}${suffix}` : tag;
    return;
  }

  const icon = document.createElement("span");
  icon.className = "tag-chip-icon";
  // The label already carries the semantic information (e.g. "mobile"), so
  // the icon is decorative — exposing it to assistive tech would just make
  // the chip read "laptop mobile" to a screen reader user.
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = display.icon;
  chip.append(icon);

  const label = document.createElement("span");
  label.className = "tag-chip-label";
  label.textContent = suffix ? `${display.label}${suffix}` : display.label;
  chip.append(label);
}
