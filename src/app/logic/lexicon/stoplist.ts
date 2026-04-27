/**
 * Hardcoded Czech stoplist for the Topic Lexicon Builder.
 *
 * Hand-picked frequent function words that almost never want to be a topic
 * tag — pronouns, auxiliaries, conjunctions, common prepositions, the most
 * frequent adverbs of degree. Diacritics are included because tokenization
 * preserves diacritics; the list is matched after NFC + lowercase.
 *
 * Intentionally short. The spec says non-Czech and other off-topic forms
 * should just be `Reject`-ed by the user, so this list only needs to keep
 * the worst of the high-frequency function-word noise out of the queue.
 *
 * Forms shorter than three characters are filtered separately by the
 * tokenizer (they would dominate any reasonable list and are rarely useful
 * as tags), so single-letter pronouns / particles like "a", "i", "o", "u",
 * "v", "z", "se", "si", "už", "by" don't appear here.
 */
export const CZECH_STOPLIST: ReadonlySet<string> = new Set<string>([
  // Auxiliaries + frequent verbs of being / having.
  "jsem", "jsi", "jsme", "jste", "jsou",
  "byl", "byla", "bylo", "byli", "byly", "být", "byt",
  "bude", "budu", "budeš", "budete", "budou",
  "mám", "máš", "máme", "máte", "mají",
  "měl", "měla", "mělo", "měli", "mít",
  // Pronouns + possessives.
  "ten", "ta", "tom", "tu", "tě",
  "tato", "tohle", "této", "toto", "tento", "tyto",
  "ono", "oni", "ony", "ona", "jeho", "její", "jejich",
  "můj", "moje", "tvůj", "tvoje",
  "náš", "naše", "váš", "vaše", "svůj", "svoje",
  "sám", "sama", "samo", "sami", "samy",
  "kdo", "kdy", "kde", "jak", "proč", "což",
  "který", "která", "které", "kteří", "kterého", "kterou",
  "jaký", "jaká", "jaké",
  // Conjunctions and discourse particles.
  "ale", "nebo", "anebo", "tak", "také", "taky", "však",
  "totiž", "nýbrž", "ani", "aby", "kdyby", "pokud",
  "protože", "proto", "neboť", "tedy", "tudíž", "takže",
  "jenže", "ovšem", "přesto", "potom", "pak",
  "nyní", "teď", "dnes", "včera", "zítra",
  "vždy", "nikdy", "občas",
  // Prepositions (multi-letter).
  "pro", "při", "před", "přes", "podle", "pode",
  "kolem", "okolo", "mezi", "místo", "kromě", "krom",
  "během", "uvnitř", "vedle", "naproti", "skrz", "skrze",
  "bez", "nad", "pod", "ode",
  // Common adverbs / particles of degree.
  "moc", "hodně", "více", "méně", "stejně",
  "jenom", "jen", "asi", "snad", "možná",
  "určitě", "samozřejmě", "vlastně", "zase", "ještě", "už",
]);
