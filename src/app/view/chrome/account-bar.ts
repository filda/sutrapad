import type { UserProfile } from "../../../types";

export interface AccountBarOptions {
  profile: UserProfile | null;
  onSignIn: () => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignOut: () => void;
}

export function buildAccountBar({
  profile,
  onSignIn,
  onLoadNotebook,
  onSaveNotebook,
  onSignOut,
}: AccountBarOptions): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "account-bar";

  if (!profile) {
    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.className = "button button-primary account-sign-in";
    signInButton.textContent = "Sign in with Google";
    signInButton.onclick = onSignIn;
    bar.append(signInButton);
    return bar;
  }

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "button account-action";
  loadButton.textContent = "Load";
  loadButton.title = "Load notebook from Google Drive";
  loadButton.setAttribute("aria-label", "Load notebook");
  loadButton.onclick = onLoadNotebook;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "button button-primary account-action";
  saveButton.textContent = "Save";
  saveButton.title = "Save notebook to Google Drive";
  saveButton.setAttribute("aria-label", "Save notebook");
  saveButton.onclick = onSaveNotebook;

  const menu = document.createElement("div");
  menu.className = "account-menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "account-menu-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-label", `Account menu for ${profile.name}`);

  if (profile.picture) {
    const img = document.createElement("img");
    img.src = profile.picture;
    img.alt = profile.name;
    img.className = "account-avatar";
    trigger.append(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "account-avatar avatar-fallback";
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
  signOutButton.onclick = onSignOut;

  panel.append(profileInfo, signOutButton);
  menu.append(trigger, panel);

  bar.append(loadButton, saveButton, menu);
  return bar;
}
