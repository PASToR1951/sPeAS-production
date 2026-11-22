/** Source-layout review prompts; these do not establish PDF rendering fidelity. */
export function wordImageLayoutWarnings(xml: string): string[] {
  const warnings: string[] = [];
  if (/<(?:wp:anchor|w:pict)\b/u.test(xml)) {
    warnings.push(
      "Floating or anchored Word images: compare their full bounds with the original.",
    );
  }
  if (/<wp:anchor\b[^>]*\bbehindDoc=["'](?:1|true)["']/u.test(xml)) {
    warnings.push(
      "Behind-text Word images can be clipped by their paragraph position. Compare the entire scan, including its lower edge, with the original.",
    );
  }
  const attribute = (tag: string, name: string) =>
    Number(tag.match(new RegExp(`\\b${name}=["'](\\d+)["']`, "u"))?.[1]);
  let start = 0;
  for (
    const section of xml.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/gu)
  ) {
    const content = xml.slice(start, section.index);
    start = section.index + section[0].length;
    const size = section[0].match(/<w:pgSz\b[^>]*\/?\s*>/u)?.[0] ?? "";
    const margins = section[0].match(/<w:pgMar\b[^>]*\/?\s*>/u)?.[0] ?? "";
    const width = attribute(size, "w:w") - attribute(margins, "w:left") -
      attribute(margins, "w:right") - (attribute(margins, "w:gutter") || 0);
    const height = attribute(size, "w:h") - attribute(margins, "w:top") -
      attribute(margins, "w:bottom");
    if (!(width > 0 && height > 0)) continue;
    // Word page geometry is in twips; DrawingML extents are in EMUs (635/twip).
    const oversized = [
      ...content.matchAll(/<wp:inline\b[\s\S]*?<\/wp:inline>/gu),
    ].some(([inline]) => {
      const extent = inline.match(/<wp:extent\b[^>]*\/?\s*>/u)?.[0] ?? "";
      return attribute(extent, "cx") > width * 635 ||
        attribute(extent, "cy") > height * 635;
    });
    if (oversized) {
      warnings.push(
        "An inline Word image exceeds the available page body. It may disappear or be clipped during conversion. Compare every source scan with the prepared PDF.",
      );
      break;
    }
  }
  return warnings;
}
