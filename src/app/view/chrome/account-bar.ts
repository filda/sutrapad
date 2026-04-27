import type { UserProfile } from "../../../types";
import { formatInitials } from "../../logic/account-initials";

export interface AccountBarOptions {
  profile: UserProfile | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function buildAccountBar({
  profile,
  onSignIn,
  onSignOut,
}: AccountBarOptions): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "account-bar";

  if (!profile) {
    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.className = "button button-primary account-sign-in";
    signInButton.textContent = "Sign in with Google";
    signInButton.addEventListener("click", onSignIn);
    bar.append(signInButton);
    return bar;
  }

  const menu = document.createElement("div");
  menu.className = "account-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "account-menu-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-label", `Account menu for ${profile.name}`);
  // Initial state — closed. The CSS rule that shows the panel keys off
  // this attribute, so the panel starts hidden until the user clicks.
  trigger.setAttribute("aria-expanded", "false");

  if (profile.picture) {
    const img = document.createElement("img");
    img.src = profile.picture;
    img.alt = profile.name;
    img.className = "account-avatar";
    trigger.append(img);
  } else {
    // No Google profile picture: fall back to initials over the accent
    // gradient. The empty gradient circle that lived here before was
    // ambiguous (whose account is this?); a "FK" monogram says "yes,
    // this is you" without depending on the picture URL surviving Drive
    // share-target handoff or DNS-block edge cases.
    const fallback = document.createElement("div");
    fallback.className = "account-avatar avatar-fallback";
    const initials = formatInitials(profile.name);
    if (initials) {
      const monogram = document.createElement("span");
      monogram.className = "avatar-fallback-initials";
      monogram.textContent = initials;
      // The chip is purely decorative — the trigger's aria-label already
      // reads the user's full name, so screen readers don't need the
      // initials node to repeat it.
      monogram.setAttribute("aria-hidden", "true");
      fallback.append(monogram);
    }
    trigger.append(fallback);
  }

  const panel = document.createElement("div");
  panel.className = "account-menu-panel";
  panel.setAttribute("role", "menu");

  const profileInfo = document.createElement("div");
  profileInfo.className = "account-menu-profile";

  const nameEl = document.createElement("strong");
  nameEl.textContent = profile.name;

  const emailEl = document.createElement("span");
  emailEl.textContent = profile.email;

  profileInfo.append(nameEl, emailEl);

  const signOutButton = document.createElement("button");
  signOutButton.type = "button";
  signOutButton.className = "button button-ghost account-menu-signout";
  signOutButton.textContent = "Sign out";
  signOutButton.addEventListener("click", onSignOut);

  panel.append(profileInfo, signOutButton);
  menu.append(trigger, panel);

  // ── Open / close behaviour ────────────────────────────────────────
  // Until this rewrite, the panel was visible whenever the menu was
  // hovered or focus-within. That doesn't work on touch devices and
  // surprised desktop users with accidental opens on layout grazes —
  // hence the explicit click toggle. Outside-click and Escape close
  // the panel; both are bound on open and unbound on close so the
  // listeners don't accumulate across re-renders of the topbar (the
  // app rebuilds the chrome wholesale on most state changes).

  let isOpen = false;

  const onOutsideClick = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && menu.contains(target)) return;
    closePanel();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel();
      // Bring focus back to the trigger so the keyboard user doesn't
      // lose their place in the topbar tab order after dismissing.
      trigger.focus();
    }
  };

  function openPanel(): void {
    if (isOpen) return;
    isOpen = true;
    trigger.setAttribute("aria-expanded", "true");
    // Capture-phase document listener. New listeners added during a
    // dispatch don't fire for that same event, so the click that just
    // opened the menu won't immediately re-close it; subsequent clicks
    // on the trigger or inside the panel are caught by `menu.contains`
    // before the close logic runs.
    document.addEventListener("click", onOutsideClick, true);
    document.addEventListener("keydown", onKeydown);
  }

  function closePanel(): void {
    if (!isOpen) return;
    isOpen = false;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutsideClick, true);
    document.removeEventListener("keydown", onKeydown);
  }

  trigger.addEventListener("click", () => {
    if (isOpen) closePanel();
    else openPanel();
  });

  bar.append(menu);
  return bar;
}
