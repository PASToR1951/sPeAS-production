import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { searchTopics, proposeTopic } from "../../lib/api/upload";
import { normalizeClassificationTerm } from "../../../../shared/classification";

export interface DocumentClassificationEditorValue {
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
}

export function DocumentClassificationEditor({
  value,
  disabled = false,
  idPrefix = "classification",
  onChange,
}: {
  value: DocumentClassificationEditorValue;
  disabled?: boolean;
  idPrefix?: string;
  onChange: (value: DocumentClassificationEditorValue) => void;
}) {
  const [topicQuery, setTopicQuery] = useState("");
  const [topicMatches, setTopicMatches] = useState<Array<{ id: number; name: string; status?: string }>>([]);
  const [topicBusy, setTopicBusy] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState("");

  useEffect(() => {
    const query = topicQuery.trim();
    if (disabled || query.length < 2) {
      setTopicMatches([]);
      setTopicBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setTopicBusy(true);
      void searchTopics(query)
        .then((matches) => {
          if (active) setTopicMatches(matches);
        })
        .catch(() => {
          if (active) setTopicMatches([]);
        })
        .finally(() => {
          if (active) setTopicBusy(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [disabled, topicQuery]);

  function addTopic(id: number, name: string) {
    if (value.topicIds.includes(id) || value.topicIds.length >= 5) return;
    onChange({ ...value, topicIds: [...value.topicIds, id], topicNames: [...value.topicNames, name] });
    setTopicQuery("");
    setTopicMatches([]);
  }

  async function proposeCurrentTopic() {
    const name = topicQuery.trim();
    if (name.length < 2 || value.topicIds.length >= 5) return;
    setTopicBusy(true);
    try {
      const proposal = await proposeTopic(name);
      addTopic(Number(proposal.id), proposal.name);
    } finally {
      setTopicBusy(false);
    }
  }

  function addKeyword(raw: string) {
    const term = raw.trim().replace(/\s+/gu, " ");
    if (!term || value.keywords.some((keyword) => normalizeClassificationTerm(keyword) === normalizeClassificationTerm(term))) return;
    onChange({ ...value, keywords: [...value.keywords, term] });
    setKeywordDraft("");
  }

  return <div className="peas-classification-editor" aria-label="Document classification editor">
    <fieldset className="peas-classification-editor__group">
      <legend>Topics</legend>
      <p>Curated subject headings. Select 1–5 approved topics; pending proposals can be replaced during review.</p>
      {value.topicNames.length ? <div className="peas-keyword-input__badges" role="list" aria-label="Selected topics">{value.topicNames.map((name, index) => <Badge key={`${name}-${index}`} tone="blue" role="listitem">{name}<button className="peas-classification-editor__remove" type="button" aria-label={`Remove topic ${name}`} disabled={disabled} onClick={() => onChange({ ...value, topicIds: value.topicIds.filter((_, itemIndex) => itemIndex !== index), topicNames: value.topicNames.filter((_, itemIndex) => itemIndex !== index) })}><X aria-hidden="true" /></button></Badge>)}</div> : null}
      <div className="peas-document-tag-editor__input">
        <Input id={`${idPrefix}-topic-search`} aria-label="Search approved topics" value={topicQuery} disabled={disabled || value.topicIds.length >= 5} placeholder="Search approved topics…" onChange={(event) => setTopicQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (topicMatches[0]) addTopic(topicMatches[0].id, topicMatches[0].name); else void proposeCurrentTopic(); } }} />
        {topicQuery.trim().length >= 2 ? <div className="peas-document-tag-editor__suggestions" role="listbox" aria-label="Topic suggestions">{topicBusy ? <span>Searching topics…</span> : topicMatches.map((topic) => <button type="button" role="option" key={topic.id} onMouseDown={(event) => { event.preventDefault(); addTopic(topic.id, topic.name); }}>{topic.name}{topic.status === "pending" ? " · pending" : ""}</button>)}{!topicBusy && !topicMatches.length ? <button type="button" onMouseDown={(event) => { event.preventDefault(); void proposeCurrentTopic(); }}>Propose “{topicQuery.trim()}”</button> : null}</div> : null}
      </div>
    </fieldset>

    <fieldset className="peas-classification-editor__group">
      <legend>Keywords</legend>
      {value.keywords.length ? <div className="peas-keyword-input__badges" role="list" aria-label="Selected keywords">{value.keywords.map((keyword, index) => <Badge key={`${keyword}-${index}`} tone="green" role="listitem">{keyword}<button className="peas-classification-editor__remove" type="button" aria-label={`Remove keyword ${keyword}`} disabled={disabled} onClick={() => onChange({ ...value, keywords: value.keywords.filter((_, itemIndex) => itemIndex !== index) })}><X aria-hidden="true" /></button></Badge>)}</div> : null}
      <Input id={`${idPrefix}-keyword-input`} aria-label="Add keyword" value={keywordDraft} disabled={disabled} placeholder="Add keyword and press Enter" onChange={(event) => { const next = event.currentTarget.value; if (next.includes(";")) { const parts = next.split(";"); parts.slice(0, -1).forEach(addKeyword); setKeywordDraft(parts[parts.length - 1]?.trim() ?? ""); } else setKeywordDraft(next); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === ";") && keywordDraft.trim()) { event.preventDefault(); addKeyword(keywordDraft); } else if (event.key === "Backspace" && !keywordDraft && value.keywords.length) { onChange({ ...value, keywords: value.keywords.slice(0, -1) }); } }} onBlur={() => addKeyword(keywordDraft)} />
    </fieldset>
  </div>;
}
