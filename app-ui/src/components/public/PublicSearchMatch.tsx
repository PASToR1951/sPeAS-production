export function PublicSearchMatch({ text, query = "" }: { text: string; query?: string }) {
  const term = query.trim();
  if (!term) return text;

  const literal = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${literal})`, "iu"));

  return parts.map((part, index) => index % 2 === 0
    ? part
    : <mark className="peas-public-search-match" key={index}>{part}</mark>);
}
