import {
  CLASSIFICATION_LIMITS,
  isClassificationComplete,
  normalizeClassificationTerm,
} from "../../shared/classification.ts";
import type { ClassificationTerm } from "../../shared/classification.ts";

Deno.test("classification normalization preserves display values while comparing exact normalized values", () => {
  const left = normalizeClassificationTerm("Rice Hull");
  const right = normalizeClassificationTerm("  rice   hull ");
  const related = normalizeClassificationTerm("rice hull concrete");

  if (left !== "rice hull" || left !== right) throw new Error("Equivalent classification terms did not normalize equally");
  if (left === related) throw new Error("Substring/related terms must not be treated as exact duplicates");
});

Deno.test("classification limits match the implementation contract", () => {
  if (CLASSIFICATION_LIMITS.agendasMin !== 0 || CLASSIFICATION_LIMITS.agendasMax !== 3) throw new Error("Agenda limits changed");
  if (CLASSIFICATION_LIMITS.topicsMin !== 1 || CLASSIFICATION_LIMITS.topicsMax !== 5) throw new Error("Topic limits changed");
});

Deno.test("approved topics complete document and collection classification without research agendas", () => {
  const topics: ClassificationTerm[] = [{ id: 1, name: "Community health", status: "approved" }];
  for (const source of ["document", "aggregated_children"] as const) {
    if (!isClassificationComplete([], topics, source)) throw new Error(`${source} still requires an agenda`);
    if (isClassificationComplete([], [], source)) throw new Error(`${source} accepted missing topics`);
    if (isClassificationComplete([], [{ ...topics[0], status: "pending" }], source)) throw new Error(`${source} accepted a pending topic`);
    if (isClassificationComplete([], [{ ...topics[0], status: "retired" }], source)) throw new Error(`${source} accepted a retired topic`);
  }
});

Deno.test("optional agendas preserve per-document limits and collection aggregation", () => {
  const agendas = Array.from({ length: 4 }, (_, id) => ({ id: id + 1, name: `Agenda ${id + 1}` }));
  const topics: ClassificationTerm[] = Array.from({ length: 6 }, (_, id) => ({ id: id + 1, name: `Topic ${id + 1}`, status: "approved" }));
  if (!isClassificationComplete(agendas.slice(0, 3), topics.slice(0, 5))) throw new Error("Existing classifications became incomplete");
  if (isClassificationComplete(agendas, topics.slice(0, 1))) throw new Error("Agenda maximum was lost");
  if (isClassificationComplete([], topics)) throw new Error("Topic maximum was lost");
  if (!isClassificationComplete(agendas, topics, "aggregated_children")) throw new Error("Collection terms should aggregate beyond individual document limits");
});
