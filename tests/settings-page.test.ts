// @vitest-environment happy-dom
//
// DOM tests for the Settings page's Backup card, focused on the new
// "Rebuild index" action (Phase 2 notes-scaling maintenance rebuild).
// The other cards (Appearance, Persona, Tag hygiene, Privacy, Workbench)
// already have coverage via their own logic modules; this suite targets
// the Backup card's three-action layout and the rebuild status line
// specifically, since that's the surface `rebuildStatus` / `onRebuildIndex`
// actually render through.

import { describe, expect, it, vi } from "vitest";
import { buildSettingsPage, type SettingsPageOptions } from "../src/app/view/pages/settings-page";
import type { UserProfile } from "../src/types";

const PROFILE: UserProfile = { name: "Filip", email: "filip@example.com" };

function baseOptions(
  overrides: Partial<SettingsPageOptions> = {},
): SettingsPageOptions {
  return {
    currentTheme: "auto",
    personaPreference: "off",
    captureLocationPreference: "unanswered",
    profile: PROFILE,
    tagAliasSuggestions: [],
    onChangeTheme: vi.fn(),
    onChangePersonaPreference: vi.fn(),
    onChangeCaptureLocationPreference: vi.fn(),
    onLoadNotebook: vi.fn(),
    onSaveNotebook: vi.fn(),
    rebuildStatus: { state: "idle" },
    onRebuildIndex: vi.fn(),
    onSignIn: vi.fn(),
    onMergeTagAlias: vi.fn(),
    onDismissTagAlias: vi.fn(),
    onSelectMenuItem: vi.fn(),
    ...overrides,
  };
}

function backupActionByTitle(page: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(
    page.querySelectorAll(".settings-backup-action-title"),
  ).find((el) => el.textContent === title);
  if (!heading) throw new Error(`expected a backup action titled "${title}"`);
  const row = heading.closest(".settings-backup-action");
  if (!row) throw new Error("expected the heading to be inside an action row");
  return row as HTMLElement;
}

describe("buildSettingsPage — Backup card rebuild action", () => {
  it("renders three backup actions for a signed-in user, including Rebuild index", () => {
    const page = buildSettingsPage(baseOptions());
    const titles = Array.from(
      page.querySelectorAll(".settings-backup-action-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Load from Drive", "Save to Drive", "Rebuild index"]);
  });

  it("does not render any backup actions for a signed-out user", () => {
    const page = buildSettingsPage(baseOptions({ profile: null }));
    expect(page.querySelectorAll(".settings-backup-action-title")).toHaveLength(0);
    expect(page.querySelector(".settings-backup-signin")).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("wires the Rebuild button to onRebuildIndex", () => {
    const onRebuildIndex = vi.fn();
    const page = buildSettingsPage(baseOptions({ onRebuildIndex }));
    const button = backupActionByTitle(page, "Rebuild index").querySelector(
      "button.settings-backup-action-button",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("expected a button element");
    }
    button.click();
    expect(onRebuildIndex).toHaveBeenCalledTimes(1);
  });

  it("shows no status line and an enabled button when idle", () => {
    const page = buildSettingsPage(baseOptions({ rebuildStatus: { state: "idle" } }));
    const action = backupActionByTitle(page, "Rebuild index");
    expect(action.querySelector(".settings-backup-action-status")).toBeNull();
    const button = action.querySelector("button.settings-backup-action-button");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the button and shows the running status line while rebuilding", () => {
    const page = buildSettingsPage(
      baseOptions({ rebuildStatus: { state: "running" } }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toContain("Rebuilding");
  });

  it("re-enables the button and shows the done count after a rebuild completes", () => {
    const page = buildSettingsPage(
      baseOptions({ rebuildStatus: { state: "done", noteCount: 6470 } }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toBe("Done — refreshed 6470 notes.");
  });

  it("re-enables the button and surfaces the error message when a rebuild fails", () => {
    const page = buildSettingsPage(
      baseOptions({
        rebuildStatus: { state: "error", message: "Network request failed" },
      }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toBe("Rebuild failed: Network request failed");
  });
});
