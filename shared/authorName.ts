export const AUTHOR_NAME_MAX_LENGTH = 255;

const LOWERCASE_PARTICLES = new Set([
  "da", "de", "del", "della", "der", "di", "dos", "du", "la", "las", "le", "los", "van", "von", "y",
]);

const CREDENTIALS: Record<string, string> = {
  cpa: "CPA",
  edd: "EdD",
  edd_: "EdD",
  gc: "GC",
  jd: "JD",
  lpt: "LPT",
  ma: "MA",
  maed: "MAEd",
  mba: "MBA",
  md: "MD",
  ms: "MS",
  phd: "PhD",
  rn: "RN",
  rgc: "RGC",
  rsw: "RSW",
  spc: "SPC",
};

const ROMAN_SUFFIXES = new Set(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);

export class AuthorNameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorNameValidationError";
  }
}

/**
 * Normalize an author name for display. Existing directory values are not
 * rewritten; this is used for new values and for the client preview.
 */
export function normalizeAuthorName(value: unknown): string {
  const normalized = String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized) throw new AuthorNameValidationError("Author name is required.");
  if (normalized.length > AUTHOR_NAME_MAX_LENGTH) {
    throw new AuthorNameValidationError(`Author name must be ${AUTHOR_NAME_MAX_LENGTH} characters or fewer.`);
  }
  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new AuthorNameValidationError("Author name contains unsupported control characters.");
  }

  const letters = normalized.match(/\p{L}/gu) ?? [];
  const allLower = letters.length > 0 && letters.every((letter) => letter === letter.toLocaleLowerCase("en-US"));
  const allUpper = letters.length > 0 && letters.every((letter) => letter === letter.toLocaleUpperCase("en-US"));
  if (!allLower && !allUpper) return normalized;

  const lower = normalized.toLocaleLowerCase("en-US");
  return lower.split(" ").map((word, index) => smartCaseWord(word, index === 0)).join(" ");
}

/**
 * Return the comparison key used to reuse an existing directory record.
 */
export function authorNameKey(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function smartCaseWord(word: string, isFirstWord: boolean): string {
  const match = word.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’.-]*?)([^\p{L}\p{N}]*)$/u);
  if (!match) return word;

  const [, prefix, rawCore, trailing] = match;
  const coreWithoutPeriods = rawCore.replace(/\.+$/u, "");
  const periods = rawCore.slice(coreWithoutPeriods.length) + trailing;
  const key = coreWithoutPeriods.replace(/\./gu, "").toLocaleLowerCase("en-US");

  if (CREDENTIALS[key]) return `${prefix}${CREDENTIALS[key]}${periods}`;
  if (ROMAN_SUFFIXES.has(key)) return `${prefix}${key.toUpperCase()}${periods}`;
  if (key === "jr" || key === "sr") return `${prefix}${key === "jr" ? "Jr" : "Sr"}.${periods.replace(/^\./u, "")}`;
  if (!isFirstWord && LOWERCASE_PARTICLES.has(key)) return `${prefix}${key}${periods}`;

  return `${prefix}${smartCaseComposite(coreWithoutPeriods)}${periods}`;
}

function smartCaseComposite(value: string): string {
  return value.split(/([-'’])/u).map((part) => {
    if (part === "-" || part === "'" || part === "’") return part;
    if (!part) return part;
    if (part.length === 1) return part.toLocaleUpperCase("en-US");
    if (part.toLocaleLowerCase("en-US").startsWith("mc") && part.length > 2) {
      const lower = part.toLocaleLowerCase("en-US");
      return `Mc${lower.charAt(2).toLocaleUpperCase("en-US")}${lower.slice(3)}`;
    }
    return `${part.charAt(0).toLocaleUpperCase("en-US")}${part.slice(1).toLocaleLowerCase("en-US")}`;
  }).join("");
}
