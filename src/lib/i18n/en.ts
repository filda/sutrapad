import type { PluralForms } from "./plural";

/**
 * The English message catalog — the source of truth for every user-facing
 * string it covers. Czech (`./cs`) is a translation of *this* object, typed
 * as `Messages`, so a missing or misnamed Czech key is a `tsc` error rather
 * than a runtime fallback.
 *
 * Two rules for anything added here:
 *
 * 1. **Copy only.** Values that are persisted, compared or round-tripped
 *    through the URL — theme ids, auto-tag facets like `date:today`, menu
 *    ids, preference values — are keys, and keys are never translated. This
 *    catalog holds their *labels*; the key itself stays put. Getting that
 *    backwards corrupts the tag index.
 * 2. **No `as const`.** The literal-widening is deliberate: `Messages` has
 *    to be "an object of strings in this shape", not "these exact English
 *    sentences", or every Czech value would fail to satisfy it.
 *
 * Coverage today is the Settings page and everything it renders. The rest of
 * the app migrates page by page — see `docs/i18n-plan.md`.
 */
export const EN = {
  /**
   * Language names, each written in its own language rather than translated.
   * A reader who lands in the wrong locale has to be able to find their way
   * out of it, which they can't do if Czech is labelled "Czech" on a screen
   * they can't read.
   */
  localeName: {
    en: "English",
    cs: "Čeština",
  },

  /**
   * Theme labels, keyed by `ThemeChoice`. The ids are persisted in
   * localStorage and written to `data-theme`; only these labels localize.
   */
  theme: {
    auto: {
      label: "Auto",
      description: "Follows your system light/dark preference.",
    },
    sand: {
      label: "Sand",
      description: "The original warm cream and terracotta palette.",
    },
    paper: {
      label: "Paper",
      description: "Bright neutral white with a cool slate accent.",
    },
    forest: {
      label: "Forest",
      description: "Deep pine and moss, easy on the eyes for long sessions.",
    },
    midnight: {
      label: "Midnight",
      description: "Cool indigo night sky with a violet accent.",
    },
    dark: {
      label: "Dark",
      description: "Neutral dark surfaces with the warm terracotta accent.",
    },
    parchment: {
      label: "Parchment",
      description:
        "Warm notebook paper with serif headings — the redesign palette.",
    },
    "parchment-dark": {
      label: "Parchment Dark",
      description:
        "Parchment in deep-ink mode: candlelit paper tones on a warm black.",
    },
  },

  /** Status line under the Backup card's "Rebuild index" action. */
  rebuild: {
    running:
      "Rebuilding… this reads every note and may take a few minutes. Feel free to keep using SutraPad while it runs.",
    done: {
      one: "Done — refreshed {count} note.",
      few: "Done — refreshed {count} notes.",
      many: "Done — refreshed {count} notes.",
      other: "Done — refreshed {count} notes.",
    } satisfies PluralForms,
    error: (message: string) => `Rebuild failed: ${message}`,
  },

  /** Microphone opt-in card, rendered inside the Settings privacy card. */
  microphone: {
    label: "Noise sensing on new notes",
    enable: "Enable microphone access",
    status: {
      granted:
        "Microphone access is on. New notes can record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.",
      prompt:
        "Off. Turn this on to let new notes record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.",
      denied:
        "Your browser is blocking the microphone for this site. Open your browser's site settings to allow it, then reload SutraPad.",
      unsupported: "This browser can't expose microphone access to SutraPad.",
    },
  },

  /**
   * Navigation labels, keyed by `MenuItemId`. The ids are routing keys —
   * they appear in the URL path and in the persisted last-page — so only
   * these labels localize.
   */
  menu: {
    home: "Home",
    add: "Add",
    notes: "Notes",
    links: "Links",
    tags: "Tags",
    tasks: "Tasks",
    capture: "Capture",
    settings: "Settings",
    privacy: "Privacy",
    about: "About",
    terms: "Terms",
    shortcuts: "Shortcuts",
    lexicon: "Lexicon Builder",
  },

  nav: {
    primaryLabel: "Primary",
    mobileLabel: "Mobile primary navigation",
    /** The mobile bar calls Home "Today", matching that page's own title. */
    mobileHome: "Today",
    brandHome: "Go to SutraPad home",
    addNote: "Add a new note",
  },

  /** Visible label on the topbar sync pill. */
  sync: {
    loading: "Loading",
    saving: "Saving",
    error: "Error",
    synced: "Synced",
  },

  pageHeader: {
    expandIntro: "Expand intro",
    collapseIntro: "Collapse intro",
  },

  footer: {
    tagline:
      "A notebook for the way you already think — by hand, by place, by mood. Save everything to your own drive. Never the system of record.",
    columns: {
      product: "SutraPad",
      use: "Use",
      sources: "Sources",
      legal: "Legal",
    },
    links: {
      captureSetup: "Capture setup",
      github: "GitHub repository",
      openStreetMap: "OpenStreetMap",
      nominatim: "Nominatim",
    },
    copyright: (year: number) => `© ${year} SutraPad · MIT license`,
  },

  settings: {
    appearance: {
      eyebrow: "Appearance",
      title: "Theme",
      hint: "The theme is saved on this device only. Other devices keep their own choice.",
      groupLabel: "Theme",
    },
    language: {
      eyebrow: "Language",
      title: "App language",
      hint: "Changes the app's own text. Saved on this device only, and never applied to your notes or your own tags — those stay exactly as you wrote them.",
      groupLabel: "App language",
    },
    persona: {
      eyebrow: "Notebook",
      title: "Persona",
      hint: "Paints each note card with a paper colour and a little rotation based on when you wrote it, plus small stickers for notes with open tasks or night-time capture. Saved per-device.",
      groupLabel: "Notebook persona",
      off: {
        label: "Off",
        description: "Keep notes as plain, flat cards.",
      },
      on: {
        label: "On",
        description: "Show paper colours, stickers, and subtle wear.",
      },
    },
    tagHygiene: {
      eyebrow: "Notebook",
      title: "Tag hygiene",
      hint: "Tags that look like different spellings of the same thing. Merging keeps every note's history — the notes just get relabeled to the canonical tag.",
      empty: "Nothing to clean up right now.",
      candidateCount: {
        one: "{count} candidate",
        few: "{count} candidates",
        many: "{count} candidates",
        other: "{count} candidates",
      } satisfies PluralForms,
      merge: "Merge",
      mergeLabel: (alias: string, canonical: string) =>
        `Merge ${alias} into ${canonical}`,
      dismiss: "Keep separate",
      dismissLabel: (canonical: string, alias: string) =>
        `Keep ${canonical} and ${alias} separate`,
    },
    backup: {
      eyebrow: "Backup",
      title: "Google Drive",
      intro:
        "Your notebook is stored in this browser and, when you're signed in, synced automatically to Google Drive. You normally don't need the buttons below — they're here for the rare cases when you want to force a pull or push by hand.",
      signedOut: "Sign in with Google to use manual load and save.",
      signIn: "Sign in with Google",
      load: {
        title: "Load from Drive",
        description:
          "Pull the notebook currently saved in Google Drive and replace what's in this browser. Useful if you've made changes on another device and want them here, or if something in this browser looks off and you want to reset to the last saved copy.",
        button: "Load",
      },
      save: {
        title: "Save to Drive",
        description:
          "Push the notebook in this browser up to Google Drive right now. Automatic sync usually handles this, so reach for it mostly if sync seems stuck or you want to confirm a snapshot was written before switching devices.",
        button: "Save",
      },
      rebuild: {
        title: "Rebuild index",
        description:
          "Walks every note in Drive once and rewrites the tag, link, and task indexes from scratch. Use this if a note's tags, tasks, or links look out of date and a normal load/save doesn't fix it. This can take a few minutes for a large notebook.",
        button: "Rebuild",
      },
    },
    privacy: {
      title: "Privacy",
      summary:
        "SutraPad runs in your browser and keeps your notes in your own Google Drive. The app talks to Google Identity, Google Drive, Nominatim (location labels) and Open-Meteo (weather context) directly from your browser when those features are used.",
      readFullPolicy: "Read the full Privacy page →",
      captureLocation: {
        label: "Capture location on new notes",
        hint: "When on, creating a new note asks the browser for your current location and adds a place label. When off, the geolocation prompt is skipped and no coordinates are recorded for new notes. Existing notes keep whatever location they already have. First-run users see a consent card inside the editor before this toggle locks in.",
        off: {
          label: "Off",
          description: "Don't ask for location.",
        },
        on: {
          label: "On",
          description: "Ask for location and add a place label.",
        },
      },
    },
    workbench: {
      eyebrow: "Workbench",
      title: "Internal tooling",
      hint: "Internal builders hosted inside SutraPad. They reuse the app shell and Google Drive sync, but are not part of the regular notebook flow.",
      lexiconLink: "Topic Lexicon Builder →",
    },
  },
};

/**
 * The shape every catalog has to satisfy. Derived from `EN` so adding a
 * message is a one-file edit here plus a compile error in `./cs` until it is
 * translated.
 */
export type Messages = typeof EN;
