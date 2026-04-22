/**
 * Primary "+ New note" CTA shared across the Home and Notes headers.
 *
 * The button itself is a plain accented button that fires the passed
 * `onNewNote` handler — the same callback the global `N` keyboard
 * shortcut dispatches to. A small, decorative `N` kbd pill sits to the
 * right of the label so first-time users can *discover* the shortcut
 * without us having to write a help page for it.
 *
 * The pill is *not* interactive — it's inside the button so a click
 * anywhere (pill included) triggers new-note, and the only hint of its
 * hotkey nature is its monospaced paper look. If we ever add more kbd
 * hints to buttons we should either hoist this into a generic
 * `button-with-kbd` helper or migrate callers to it.
 */
export function buildNewNoteButton(onNewNote: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-accent button-with-kbd";
  button.addEventListener("click", onNewNote);

  const label = document.createElement("span");
  label.textContent = "+ New note";
  button.append(label);

  const kbd = document.createElement("span");
  kbd.className = "button-kbd";
  kbd.setAttribute("aria-hidden", "true");
  kbd.textContent = "N";
  button.append(kbd);

  return button;
}
