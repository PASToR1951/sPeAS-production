import { ArrowUpRight, BookOpen, Files, Hash } from "lucide-react";
import { AuthorImage } from "../authors/AuthorImage";
import type {
  NewsAuthorReference,
  NewsWorkReference,
} from "../../lib/api/news";

export function NewsArticleAuthors({ authors, standalone }: { authors: NewsAuthorReference[]; standalone: boolean }) {
  if (!authors.length) return null;
  return (
    <div className="peas-news-tagged-authors" aria-label="Authors featured in this article">
      <span>Featuring</span>
      <div>
        {authors.map((author) => standalone
          ? <NewsArticleAuthorName author={author} key={author.id} />
          : <NewsAuthorReferenceTag author={author} tooltipId={`news-author-${author.id}`} key={author.id} />)}
      </div>
    </div>
  );
}

export function NewsArticleAuthorName({ author, inline = false }: { author: NewsAuthorReference; inline?: boolean }) {
  return (
    <span className={`peas-news-author-reference${inline ? " is-inline" : ""}`}>
      <span className="peas-news-author-name"><AuthorAvatar author={author} />{inline ? `@${author.fullName}` : author.fullName}</span>
    </span>
  );
}

export function NewsAuthorReferenceTag({
  author,
  tooltipId,
  inline = false,
}: {
  author: NewsAuthorReference;
  tooltipId: string;
  inline?: boolean;
}) {
  const label = inline ? `@${author.fullName}` : author.fullName;
  return (
    <span className={`peas-news-author-reference${inline ? " is-inline" : ""}`}>
      <a
        href={`/pages/authorprofile.html?id=${encodeURIComponent(author.id)}`}
        aria-label={label}
        aria-describedby={tooltipId}
      >
        <AuthorAvatar author={author} />
        {label}
      </a>
      <span className="peas-news-author-card" id={tooltipId} role="tooltip">
        <span className="peas-news-author-card__head">
          <AuthorAvatar author={author} large />
          <span>
            <strong>{author.fullName}</strong>
            <small>{author.department || author.affiliation || "Research author"}</small>
          </span>
        </span>
        {author.biography ? <p>{author.biography}</p> : (
          <p>View this author’s profile and research contributions in PeAS.</p>
        )}
        <span className="peas-news-author-card__foot">
          <span><BookOpen aria-hidden="true" /> {author.worksCount} {author.worksCount === 1 ? "work" : "works"}</span>
          <span>View profile <ArrowUpRight aria-hidden="true" /></span>
        </span>
      </span>
    </span>
  );
}

export function NewsArticleWorks({
  works,
  standalone,
}: {
  works: NewsWorkReference[];
  standalone: boolean;
}) {
  if (!works.length) return null;
  return (
    <section className="peas-news-related-works" aria-labelledby="news-related-works-title">
      <div className="peas-news-related-works__heading">
        <span><BookOpen aria-hidden="true" /></span>
        <div>
          <small>From the repository</small>
          <h2 id="news-related-works-title">Works mentioned in this story</h2>
        </div>
      </div>
      <div className="peas-news-related-works__grid">
        {works.map((work) => {
          const key = `${work.recordType}:${work.id}`;
          const content = <>
            <span className="peas-news-related-works__label">
              {work.category || (work.recordType === "compiled" ? "Collection" : "Research work")}
            </span>
            <h3>{work.title}</h3>
            {work.description ? <p>{work.description}</p> : null}
            <span className="peas-news-related-works__meta">
              <span><Hash aria-hidden="true" /> Record {work.id}</span>
              {work.recordType === "compiled" ? (
                <span><Files aria-hidden="true" /> {work.childCount} {work.childCount === 1 ? "item" : "items"}</span>
              ) : null}
              {standalone ? null : <ArrowUpRight aria-hidden="true" />}
            </span>
          </>;
          if (standalone) return <div className="peas-news-related-works__work" key={key}>{content}</div>;
          const page = work.recordType === "compiled" ? "guest-compiled" : "guest-single";
          return <a className="peas-news-related-works__work" href={`/pages/${page}.html?id=${encodeURIComponent(String(work.id))}`} key={key}>{content}</a>;
        })}
      </div>
    </section>
  );
}

function AuthorAvatar({ author, large = false }: { author: NewsAuthorReference; large?: boolean }) {
  return <AuthorImage className={large ? "is-large" : ""} src={author.profilePicture} name={author.fullName} alt="" />;
}
