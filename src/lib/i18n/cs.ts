import type { Messages } from "./en";

/**
 * Czech catalog. Typed as `Messages`, which is derived from the English
 * object — so a key that is missing, misspelled or the wrong shape fails
 * `tsc` instead of reaching a user as an empty string. That type annotation
 * is the entire completeness story: there is no fallback chain and no
 * missing-key path to test for.
 *
 * Tone: second-person singular, matching the Czech how-to in
 * `docs/navod-pro-babicku.md`. This is a personal notebook, not enterprise
 * software.
 */
export const CS: Messages = {
  localeName: {
    en: "English",
    cs: "Čeština",
  },

  theme: {
    auto: {
      label: "Automaticky",
      description: "Řídí se světlým/tmavým režimem systému.",
    },
    sand: {
      label: "Písek",
      description: "Původní teplá krémová a terakotová paleta.",
    },
    paper: {
      label: "Papír",
      description: "Jasná neutrální bílá s chladným břidlicovým akcentem.",
    },
    forest: {
      label: "Les",
      description: "Hluboká borovice a mech, šetrné k očím při dlouhé práci.",
    },
    midnight: {
      label: "Půlnoc",
      description: "Chladná indigová noční obloha s fialovým akcentem.",
    },
    dark: {
      label: "Tmavý",
      description: "Neutrální tmavé plochy s teplým terakotovým akcentem.",
    },
    parchment: {
      label: "Pergamen",
      description:
        "Teplý sešitový papír s patkovými nadpisy — paleta z redesignu.",
    },
    "parchment-dark": {
      label: "Pergamen tmavý",
      description:
        "Pergamen v režimu hlubokého inkoustu: tóny papíru při svíčce na teplé černi.",
    },
  },

  rebuild: {
    running:
      "Přestavuje se… projde to každou poznámku a může to trvat několik minut. Klidně SutraPad mezitím dál používej.",
    // Czech `many` is the decimal category ("1,5 poznámky"), not "5 and up"
    // — that is `other`. See `plural.ts`.
    done: {
      one: "Hotovo — obnovena {count} poznámka.",
      few: "Hotovo — obnoveny {count} poznámky.",
      many: "Hotovo — obnoveno {count} poznámky.",
      other: "Hotovo — obnoveno {count} poznámek.",
    },
    error: (message: string) => `Přestavba selhala: ${message}`,
  },

  microphone: {
    label: "Snímání hluku u nových poznámek",
    enable: "Povolit přístup k mikrofonu",
    status: {
      granted:
        "Přístup k mikrofonu je zapnutý. Nové poznámky si můžou uložit přibližnou hladinu okolního hluku. SutraPad nikdy neukládá zvuk — jen jedno číslo hlasitosti.",
      prompt:
        "Vypnuto. Zapnutím dovolíš novým poznámkám ukládat přibližnou hladinu okolního hluku. SutraPad nikdy neukládá zvuk — jen jedno číslo hlasitosti.",
      denied:
        "Prohlížeč pro tenhle web mikrofon blokuje. Povol ho v nastavení webu ve svém prohlížeči a načti SutraPad znovu.",
      unsupported: "Tenhle prohlížeč neumí SutraPadu zpřístupnit mikrofon.",
    },
  },

  menu: {
    home: "Domů",
    add: "Přidat",
    notes: "Poznámky",
    links: "Odkazy",
    tags: "Štítky",
    tasks: "Úkoly",
    capture: "Zachytávání",
    settings: "Nastavení",
    privacy: "Soukromí",
    about: "O aplikaci",
    terms: "Podmínky",
    shortcuts: "Zkratky",
    lexicon: "Tvůrce lexikonu",
  },

  nav: {
    primaryLabel: "Hlavní navigace",
    mobileLabel: "Hlavní navigace (mobil)",
    today: "Dnes",
    brandHome: "Přejít na úvodní stránku SutraPadu",
    addNote: "Přidat novou poznámku",
  },

  sync: {
    loading: "Načítám",
    saving: "Ukládám",
    error: "Chyba",
    synced: "Synchronizováno",
  },

  pageHeader: {
    expandIntro: "Rozbalit úvod",
    collapseIntro: "Sbalit úvod",
  },

  footer: {
    tagline:
      "Zápisník pro to, jak stejně přemýšlíš — rukou, podle místa, podle nálady. Všechno se ukládá na tvůj vlastní disk. Nikdy ne jako systém záznamů.",
    columns: {
      product: "SutraPad",
      use: "Použití",
      sources: "Zdroje",
      legal: "Právní",
    },
    links: {
      captureSetup: "Nastavení zachytávání",
      github: "Repozitář na GitHubu",
      openStreetMap: "OpenStreetMap",
      nominatim: "Nominatim",
    },
    copyright: (year: number) => `© ${year} SutraPad · Licence MIT`,
  },

  palette: {
    label: "Příkazová paleta",
    placeholder: "Hledat poznámky a štítky…",
    searchLabel: "Hledat poznámky a štítky",
    noMatches: "Nic nenalezeno.",
    emptyNotebook: "Tenhle zápisník je prázdný. Začni poznámku nebo přidej štítek.",
    groupNotes: "Poznámky",
    groupTags: "Štítky",
    noteChip: "Poznámka",
    addFilter: "Přidat",
    removeFilter: "Odebrat",
    newNote: "Nová poznámka",
    close: "Zavřít",
  },

  empty: {
    today: {
      title: "Prázdné ráno.",
      sub: "Zatím nic zachyceného. Den je pořád tvůj, můžeš na něj psát.",
      cta: "Něco napiš",
      secondary: "Procházet záznamy",
    },
    add_intro: {
      title: "Řekni něco.",
      sub: "Vlož odkaz, hoď sem citát, načrtni seznam úkolů, nebo prostě začni psát. Editor se přizpůsobí.",
    },
    notes: {
      title: "Zatím žádné zápisníky.",
      sub: "Zápisníky vznikají ze štítků a času — objeví se samy, jakmile nasbíráš pár poznámek.",
      cta: "Napiš první poznámku",
    },
    notes_filtered: {
      title: "Pod tímhle filtrem tu nic není.",
      sub: "Zkus jiný štítek, nebo filtr zruš a uvidíš všechno.",
      secondary: "Zrušit filtr",
    },
    links: {
      title: "Žádné uložené odkazy.",
      sub: "Každá URL, kterou do SutraPadu vložíš, se stane odkazem. Nebo si nainstaluj bookmarklet a ukládej z jakékoli stránky.",
      cta: "Nastavit bookmarklet",
    },
    links_filtered: {
      title: "Žádný odkaz neodpovídá.",
      sub: "Filtr je moc těsný. Povol nějaký štítek, nebo si projdi všechno.",
      secondary: "Zrušit filtr",
    },
    tasks: {
      title: "Nic na práci.",
      sub: "Napiš poznámku s [ ] na začátku řádku a stane se z toho úkol. Nebo si prostě užij ticho.",
    },
    tasks_done: {
      title: "Hotovo.",
      sub: "Všechny úkoly, co jsi zachytil, jsou odškrtnuté. Vydechni.",
    },
    tags: {
      title: "Zatím žádné štítky.",
      sub: "Štítky vznikají z toho, co píšeš — místa, časy, témata. Objeví se samy.",
    },
    capture: {
      title: "Žádné nastavené zdroje.",
      sub: "SutraPad umí zachytávat z webu, z telefonu, z hlasu nebo z e-mailu. Vyber si, čím začneš.",
      cta: "Procházet zdroje",
    },
  },

  settings: {
    appearance: {
      eyebrow: "Vzhled",
      title: "Motiv",
      hint: "Motiv se ukládá jen na tomhle zařízení. Ostatní zařízení si drží vlastní volbu.",
      groupLabel: "Motiv",
    },
    language: {
      eyebrow: "Jazyk",
      title: "Jazyk aplikace",
      hint: "Mění text samotné aplikace. Ukládá se jen na tomhle zařízení a nikdy se nepoužije na tvoje poznámky ani tvoje vlastní štítky — ty zůstanou přesně tak, jak jsi je napsal.",
      groupLabel: "Jazyk aplikace",
    },
    persona: {
      eyebrow: "Zápisník",
      title: "Persona",
      hint: "Obarví každou kartu poznámky papírovou barvou a lehce ji natočí podle toho, kdy jsi ji psal, a přidá malé nálepky k poznámkám s otevřenými úkoly nebo nočním záznamem. Ukládá se pro každé zařízení zvlášť.",
      groupLabel: "Persona zápisníku",
      off: {
        label: "Vypnuto",
        description: "Nech poznámky jako prosté ploché karty.",
      },
      on: {
        label: "Zapnuto",
        description: "Zobrazit barvy papíru, nálepky a jemné opotřebení.",
      },
    },
    tagHygiene: {
      eyebrow: "Zápisník",
      title: "Hygiena štítků",
      hint: "Štítky, které vypadají jako různé zápisy téhož. Sloučení zachová historii každé poznámky — poznámky se jen přeznačí na kanonický štítek.",
      empty: "Teď není co uklízet.",
      candidateCount: {
        one: "{count} kandidát",
        few: "{count} kandidáti",
        many: "{count} kandidáta",
        other: "{count} kandidátů",
      },
      merge: "Sloučit",
      mergeLabel: (alias: string, canonical: string) =>
        `Sloučit ${alias} do ${canonical}`,
      dismiss: "Nechat zvlášť",
      dismissLabel: (canonical: string, alias: string) =>
        `Nechat ${canonical} a ${alias} zvlášť`,
    },
    backup: {
      eyebrow: "Záloha",
      title: "Google Drive",
      intro:
        "Tvůj zápisník je uložený v tomhle prohlížeči, a když jsi přihlášený, automaticky se synchronizuje na Google Drive. Tlačítka níž běžně nepotřebuješ — jsou tu pro vzácné případy, kdy chceš stažení nebo nahrání vynutit ručně.",
      signedOut: "Přihlas se přes Google, ať můžeš ručně načítat a ukládat.",
      signIn: "Přihlásit se přes Google",
      load: {
        title: "Načíst z Drive",
        description:
          "Stáhne zápisník, který je právě uložený na Google Drive, a nahradí jím to, co je v tomhle prohlížeči. Hodí se, když jsi něco měnil na jiném zařízení a chceš to mít i tady, nebo když v tomhle prohlížeči něco vypadá špatně a chceš se vrátit k poslední uložené kopii.",
        button: "Načíst",
      },
      save: {
        title: "Uložit na Drive",
        description:
          "Nahraje zápisník z tohohle prohlížeče rovnou na Google Drive. Obvykle to zvládne automatická synchronizace, takže po tomhle sáhni hlavně když se synchronizace zasekne nebo si chceš před přechodem na jiné zařízení potvrdit, že se snímek zapsal.",
        button: "Uložit",
      },
      rebuild: {
        title: "Přestavět index",
        description:
          "Projde jednou každou poznámku na Drive a znovu od nuly sestaví indexy štítků, odkazů a úkolů. Použij to, když štítky, úkoly nebo odkazy u poznámky vypadají zastarale a běžné načtení/uložení to nespraví. U velkého zápisníku to může trvat několik minut.",
        button: "Přestavět",
      },
    },
    diagnostics: {
      eyebrow: "Diagnostika",
      title: "Synchronizace a výkon",
      intro:
        "Živá čísla za tuhle relaci: kolik požadavků na Google Drive udělala každá synchronizační operace, jestli některé uložení překročilo bezpečnostní rozpočet a jak se daří hlavnímu vláknu stránky. Nic z toho se neukládá ani nikam neposílá.",
      rows: {
        lastLoad: "Poslední načtení",
        lastSave: "Poslední uložení",
        lastRefresh: "Poslední obnovení",
        lastRebuild: "Poslední přestavba",
        session: "Tahle relace",
        overruns: "Překročení rozpočtu",
        mainThread: "Hlavní vlákno",
        memory: "Paměť JavaScriptu",
      },
      none: "—",
      requests: {
        one: "{count} požadavek",
        few: "{count} požadavky",
        many: "{count} požadavku",
        other: "{count} požadavků",
      },
      noteUploads: {
        one: "{count} poznámka nahrána",
        few: "{count} poznámky nahrány",
        many: "{count} poznámky nahráno",
        other: "{count} poznámek nahráno",
      },
      operations: {
        one: "{count} operace",
        few: "{count} operace",
        many: "{count} operace",
        other: "{count} operací",
      },
      failed: "selhalo",
      noOverruns: "Žádná",
      overrunCount: {
        one: "{count} překročení",
        few: "{count} překročení",
        many: "{count} překročení",
        other: "{count} překročení",
      },
      longTasks: (count: number, max: string) => `${count} dlouhých úloh (nejdelší ${max})`,
      interactions: (count: number, max: string) => `${count} interakcí (nejpomalejší ${max})`,
      notAvailable: "V tomhle prohlížeči není k dispozici",
    },
    privacy: {
      title: "Soukromí",
      summary:
        "SutraPad běží ve tvém prohlížeči a poznámky drží na tvém vlastním Google Drive. Když se dané funkce použijí, mluví aplikace přímo z tvého prohlížeče s Google Identity, Google Drive, Nominatim (názvy míst) a Open-Meteo (počasí).",
      readFullPolicy: "Přečíst celou stránku o soukromí →",
      captureLocation: {
        label: "Zaznamenávat polohu u nových poznámek",
        hint: "Když je zapnuto, vytvoření nové poznámky se zeptá prohlížeče na tvoji aktuální polohu a přidá název místa. Když je vypnuto, výzva k poloze se přeskočí a k novým poznámkám se nezaznamenají žádné souřadnice. Stávající poznámky si nechají polohu, kterou už mají. Při prvním spuštění se souhlas řeší kartou přímo v editoru, než se tenhle přepínač uzamkne.",
        off: {
          label: "Vypnuto",
          description: "Neptat se na polohu.",
        },
        on: {
          label: "Zapnuto",
          description: "Zeptat se na polohu a přidat název místa.",
        },
      },
    },
    workbench: {
      eyebrow: "Dílna",
      title: "Interní nástroje",
      hint: "Interní nástroje hostované uvnitř SutraPadu. Sdílejí shell aplikace a synchronizaci s Google Drive, ale nejsou součástí běžné práce se zápisníkem.",
      lexiconLink: "Tvůrce tematického lexikonu →",
    },
  },
};
