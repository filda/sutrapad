/**
 * Evaluator for the subset of the Google Drive `files.list` query language
 * SutraPad's stores emit. `FakeDrive` runs every query through it, so a
 * store query the grammar does not cover fails loudly (a `DriveQueryError`)
 * instead of silently matching nothing.
 *
 * Grammar (whitespace-insensitive):
 *
 *   expr   := or
 *   or     := and ("or" and)*
 *   and    := term ("and" term)*
 *   term   := "(" expr ")"
 *           | "trashed" "=" ("true" | "false")
 *           | STRING "in" "parents"
 *           | ("mimeType" | "name") ("=" | "!=" | "contains") STRING
 *           | "appProperties" "has" "{" "key" "=" STRING "and" "value" "=" STRING "}"
 *   STRING := '…' with `\'` and `\\` escapes (see `escapeDriveQueryValue`)
 */

export interface QueryableFile {
  readonly name: string;
  readonly mimeType?: string;
  readonly appProperties?: Readonly<Record<string, string>>;
  readonly parents?: readonly string[];
  readonly trashed?: boolean;
}

export type DriveQueryPredicate = (file: QueryableFile) => boolean;

export class DriveQueryError extends Error {
  constructor(message: string, readonly query: string) {
    super(`${message} in Drive query: ${query}`);
    this.name = "DriveQueryError";
  }
}

type Token =
  | { kind: "string"; value: string }
  | { kind: "word"; value: string }
  | { kind: "punct"; value: "(" | ")" | "{" | "}" | "=" | "!=" };

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= query.length) throw new DriveQueryError("Unterminated string", query);
        const c = query[i];
        if (c === "\\") {
          value += query[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === "'") {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (ch === "!" && query[i + 1] === "=") {
      tokens.push({ kind: "punct", value: "!=" });
      i += 2;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === "=") {
      tokens.push({ kind: "punct", value: ch });
      i += 1;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(query.slice(i));
    if (!match) throw new DriveQueryError(`Unexpected character '${ch}'`, query);
    tokens.push({ kind: "word", value: match[0] });
    i += match[0].length;
  }
  return tokens;
}

class Parser {
  #pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly query: string,
  ) {}

  parse(): DriveQueryPredicate {
    const predicate = this.parseOr();
    if (this.#pos !== this.tokens.length) this.fail("Trailing tokens");
    return predicate;
  }

  private fail(message: string): never {
    throw new DriveQueryError(message, this.query);
  }

  private peek(): Token | undefined {
    return this.tokens[this.#pos];
  }

  private next(): Token {
    const token = this.tokens[this.#pos];
    if (token === undefined) this.fail("Unexpected end of query");
    this.#pos += 1;
    return token;
  }

  private expectWord(word: string): void {
    const token = this.next();
    if (token.kind !== "word" || token.value !== word) this.fail(`Expected '${word}'`);
  }

  private expectPunct(value: Token["value"]): void {
    const token = this.next();
    if (token.kind !== "punct" || token.value !== value) this.fail(`Expected '${value}'`);
  }

  private expectString(): string {
    const token = this.next();
    if (token.kind !== "string") this.fail("Expected a quoted string");
    return token.value;
  }

  private atWord(word: string): boolean {
    const token = this.peek();
    return token?.kind === "word" && token.value === word;
  }

  private parseOr(): DriveQueryPredicate {
    const parts = [this.parseAnd()];
    while (this.atWord("or")) {
      this.next();
      parts.push(this.parseAnd());
    }
    return (file) => parts.some((part) => part(file));
  }

  private parseAnd(): DriveQueryPredicate {
    const parts = [this.parseTerm()];
    while (this.atWord("and")) {
      this.next();
      parts.push(this.parseTerm());
    }
    return (file) => parts.every((part) => part(file));
  }

  private parseTerm(): DriveQueryPredicate {
    const token = this.next();
    if (token.kind === "punct" && token.value === "(") {
      const inner = this.parseOr();
      this.expectPunct(")");
      return inner;
    }
    if (token.kind === "string") {
      this.expectWord("in");
      this.expectWord("parents");
      const parentId = token.value;
      return (file) => (file.parents ?? []).includes(parentId);
    }
    if (token.kind !== "word") this.fail("Expected a field name");
    switch (token.value) {
      case "trashed": {
        this.expectPunct("=");
        const value = this.next();
        if (value.kind !== "word" || (value.value !== "true" && value.value !== "false")) {
          this.fail("Expected true or false after 'trashed ='");
        }
        const expected = value.value === "true";
        return (file) => (file.trashed ?? false) === expected;
      }
      case "mimeType":
      case "name": {
        const field = token.value;
        const op = this.next();
        const operator =
          op.kind === "punct" && (op.value === "=" || op.value === "!=")
            ? op.value
            : op.kind === "word" && op.value === "contains"
              ? "contains"
              : this.fail(`Unsupported operator for '${field}'`);
        const value = this.expectString();
        return (file) => {
          const actual = field === "name" ? file.name : (file.mimeType ?? "");
          if (operator === "=") return actual === value;
          if (operator === "!=") return actual !== value;
          return actual.includes(value);
        };
      }
      case "appProperties": {
        this.expectWord("has");
        this.expectPunct("{");
        this.expectWord("key");
        this.expectPunct("=");
        const key = this.expectString();
        this.expectWord("and");
        this.expectWord("value");
        this.expectPunct("=");
        const value = this.expectString();
        this.expectPunct("}");
        return (file) => file.appProperties?.[key] === value;
      }
      default:
        return this.fail(`Unsupported field '${token.value}'`);
    }
  }
}

/** Compiles a Drive query into a predicate; throws `DriveQueryError` on unsupported syntax. */
export function compileDriveQuery(query: string): DriveQueryPredicate {
  return new Parser(tokenize(query), query).parse();
}
