import {
  CLASSIFICATION_LIMITS,
  normalizeClassificationTerm,
} from "../../shared/classification.ts";

Deno.test("classification normalization preserves display values while comparing exact normalized values", () => {
  const left = normalizeClassificationTerm("Rice Hull");
  const right = normalizeClassificationTerm("  rice   hull ");
  const related = normalizeClassificationTerm("rice hull concrete");

  if (left !== "rice hull" || left !== right) throw new Error("Equivalent classification terms did not normalize equally");
  if (left === related) throw new Error("Substring/related terms must not be treated as exact duplicates");
});

Deno.test("classification limits match the implementation contract", () => {
  if (CLASSIFICATION_LIMITS.agendasMin !== 1 || CLASSIFICATION_LIMITS.agendasMax !== 3) throw new Error("Agenda limits changed");
  if (CLASSIFICATION_LIMITS.topicsMin !== 1 || CLASSIFICATION_LIMITS.topicsMax !== 5) throw new Error("Topic limits changed");
});
