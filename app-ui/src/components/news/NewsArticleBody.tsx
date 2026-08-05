import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { NewsAuthorReference, NewsBodyFormat, NewsMediaAsset } from "../../lib/api/news";
import { NewsAuthorReferenceTag } from "./NewsArticleReferences";

export function NewsArticleBody(
  { body, format = "plain", authors = [], media = [] }: {
    body: string;
    format?: NewsBodyFormat;
    authors?: NewsAuthorReference[];
    media?: NewsMediaAsset[];
  },
) {
  if (format !== "markdown") {
    if (/^\[\[media:[0-9a-f-]{36}\]\]$/im.test(body)) return <>{parsePlainBlocks(body, media)}</>;
    const paragraphs = body.split(/\n\s*\n/).map((paragraph) =>
      paragraph.trim()
    ).filter(Boolean);
    return (
      <>
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </>
    );
  }

  return <>{parseMarkdownBlocks(body, authors, media)}</>;
}

function parsePlainBlocks(body: string, media: NewsMediaAsset[]): ReactNode[] {
  return body.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((paragraph, index) => {
    const token = /^\[\[media:([0-9a-f-]{36})\]\]$/i.exec(paragraph.trim());
    if (token) {
      const asset = media.find((item) => item.id.toLowerCase() === token[1].toLowerCase());
      return asset ? <NewsInlineMedia key={`plain-media-${index}`} asset={asset} /> : <p className="peas-news-media-unavailable" key={`plain-media-missing-${index}`}>Media unavailable</p>;
    }
    return <p key={`plain-p-${index}`}>{paragraph.trim()}</p>;
  }).filter((node) => node !== null);
}

function parseMarkdownBlocks(markdown: string, authors: NewsAuthorReference[], media: NewsMediaAsset[]): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const mediaToken = /^\[\[media:([0-9a-f-]{36})\]\]$/i.exec(line.trim());
    if (mediaToken) {
      const asset = media.find((item) => item.id.toLowerCase() === mediaToken[1].toLowerCase());
      blocks.push(asset ? <NewsInlineMedia key={`media-${index}`} asset={asset} /> : <p className="peas-news-media-unavailable" key={`media-missing-${index}`}>Media unavailable</p>);
      index += 1;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = renderInline(heading[2], `heading-${index}`, authors);
      blocks.push(
        heading[1].length === 2
          ? <h2 key={`h-${index}`}>{content}</h2>
          : <h3 key={`h-${index}`}>{content}</h3>,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {renderInline(quote.join(" "), `quote-${index}`, authors)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInline(item, `ul-${index}-${itemIndex}`, authors)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInline(item, `ol-${index}-${itemIndex}`, authors)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length && lines[index].trim() && !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`}>
        {renderInline(paragraph.join(" "), `p-${index}`, authors)}
      </p>,
    );
  }

  return blocks;
}

function NewsInlineMedia({ asset }: { asset: NewsMediaAsset }) {
  const caption = asset.caption ? <figcaption>{asset.caption}{asset.credit ? ` · ${asset.credit}` : ""}</figcaption> : null;
  if (asset.mediaType === "image") {
    const sources = asset.variants.filter((variant) => variant.key.startsWith("image-") && variant.mimeType === "image/webp").sort((a, b) => (b.width || 0) - (a.width || 0));
    const fallback = asset.variants.find((variant) => variant.mimeType === "image/jpeg" || variant.mimeType === "image/png") || sources[0];
    if (!fallback) return <p className="peas-news-media-unavailable">Media unavailable</p>;
    return <figure className="peas-news-inline-media peas-news-inline-media--image"><picture>{sources.length ? <source type="image/webp" srcSet={sources.map((variant) => `${variant.url} ${variant.width}w`).join(", ")} sizes="(max-width: 860px) 100vw, 860px" /> : null}<img src={fallback?.url || ""} alt={asset.isDecorative ? "" : asset.altText || asset.title || ""} width={asset.width || undefined} height={asset.height || undefined} loading="lazy" decoding="async" /> </picture>{caption}</figure>;
  }
  if (asset.mediaType === "audio") {
    const sources = asset.variants.filter((variant) => variant.key.startsWith("audio-"));
    if (!sources.length) return <p className="peas-news-media-unavailable">Media unavailable</p>;
    return <figure className="peas-news-inline-media peas-news-inline-media--audio"><audio controls preload="metadata">{sources.map((source) => <source key={source.key} src={source.url} type={source.mimeType} />)}</audio>{asset.transcript ? <details><summary>Read transcript</summary><p>{asset.transcript}</p></details> : null}{caption}</figure>;
  }
  const videoSources = asset.variants.filter((variant) => variant.mimeType === "video/mp4");
  const hlsSource = asset.variants.find((variant) => variant.key === "video-hls");
  const poster = asset.variants.find((variant) => variant.key === "video-poster");
  if (!videoSources.length && !hlsSource) return <p className="peas-news-media-unavailable">Media unavailable</p>;
  return <NewsInlineVideo asset={asset} videoSources={videoSources} hlsSource={hlsSource} poster={poster} caption={caption} />;
}

function NewsInlineVideo({ asset, videoSources, hlsSource, poster, caption }: {
  asset: NewsMediaAsset;
  videoSources: NewsMediaAsset["variants"];
  hlsSource?: NewsMediaAsset["variants"][number];
  poster?: NewsMediaAsset["variants"][number];
  caption: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsSource) return;
    if (typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const hlsMime = "application/vnd.apple.mpegurl";
    if (video.canPlayType(hlsMime)) {
      video.src = hlsSource.url;
      return;
    }
    let hls: { destroy: () => void; loadSource: (url: string) => void; attachMedia: (element: HTMLMediaElement) => void } | null = null;
    let cancelled = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(hlsSource.url);
      hls.attachMedia(video);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [hlsSource]);
  return <figure className="peas-news-inline-media peas-news-inline-media--video"><video ref={videoRef} controls playsInline preload="metadata" poster={poster?.url}>{videoSources.map((source) => <source key={source.key} src={source.url} type={source.mimeType} />)}{(asset.tracks || []).filter((track) => track.trackType === "captions" && track.url).map((track) => <track key={track.id} kind="captions" src={track.url || ""} srcLang={track.language} label={track.label} default={track.isDefault} />)}</video>{caption}</figure>;
}

function isBlockStart(line: string) {
  return /^(#{2,3})\s+|^>\s?|^[-*]\s+|^\d+\.\s+|^---\s*$/.test(line);
}

function renderInline(value: string, keyPrefix: string, authors: NewsAuthorReference[]): ReactNode[] {
  const pattern = /(@\[[^\]]+\](?:\(author:[0-9a-f-]+\))?|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/gi;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    const mention = /^@\[([^\]]+)\](?:\(author:([0-9a-f-]+)\))?$/i.exec(token);
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (mention) {
      const author = mention[2]
        ? authors.find((item) => item.id.toLowerCase() === mention[2].toLowerCase())
        : authors.find((item) => item.fullName.replace(/[\[\]()]/g, "").trim().toLowerCase() === mention[1].trim().toLowerCase());
      nodes.push(author ? (
        <NewsAuthorReferenceTag
          author={author}
          inline
          key={key}
          tooltipId={`inline-author-${key.replace(/[^a-z0-9]/gi, "")}`}
        />
      ) : <Fragment key={key}>@{mention[1]}</Fragment>);
    } else if (link) {
      const href = safeHref(link[2]);
      nodes.push(
        href
          ? (
            <a
              href={href}
              key={key}
              rel={href.startsWith("http") ? "noreferrer" : undefined}
            >
              {link[1]}
            </a>
          )
          : <Fragment key={key}>{link[1]}</Fragment>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function safeHref(value: string) {
  const href = value.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(href)) return href;
  return "";
}
