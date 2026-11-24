import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Newspaper, Share2 } from "lucide-react";
import { motion } from "motion/react";
import { PeasErrorState } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { NewsPreviewCard } from "../../components/public/NewsPreviewCard";
import { NewsArticleBody } from "../../components/news/NewsArticleBody";
import { NewsShareOptions } from "../../components/news/NewsShareOptions";
import { NewsArticleAuthors, NewsArticleWorks } from "../../components/news/NewsArticleReferences";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { PeasToaster } from "../../components/ui/toast";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import { fetchPublishedNews, fetchPublishedNewsPost, type NewsPost } from "../../lib/api/news";

const PAGE_SIZE = 9;

export function PublicNewsPage() {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadNews = useCallback(() => {
    setLoading(true);
    setError("");
    fetchPublishedNews(page, PAGE_SIZE).then((result) => {
      setPosts(result.posts);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
    }).catch((caughtError) => setError(getErrorMessage(caughtError))).finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { loadNews(); }, [loadNews]);

  return (
    <PublicPageShell mainClassName="peas-news-shell peas-news-page">
      {loading ? <NewsSkeleton /> : error ? (
        <PeasErrorState title="Unable to load news" message={error} onRetry={loadNews} />
      ) : (
        <NewsFeed posts={posts} page={page} totalCount={totalCount} totalPages={totalPages} onPageChange={setPage} />
      )}
    </PublicPageShell>
  );
}

export function PublicNewsArticlePage({ slug, standalone }: { slug: string; standalone: boolean }) {
  const [post, setPost] = useState<NewsPost | null>(null);
  const [loading, setLoading] = useState(Boolean(slug));
  const [requestFailed, setRequestFailed] = useState(false);

  const loadArticle = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setRequestFailed(false);
    try {
      const article = await fetchPublishedNewsPost(slug);
      setPost(article);
      document.title = `${article.title} | PeAS`;
    } catch (error) {
      setPost(null);
      setRequestFailed(!(error instanceof ApiError && error.status === 404));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void loadArticle(); }, [loadArticle]);

  return (
    <PublicPageShell mainClassName="peas-news-shell peas-news-page" showNavbar={!standalone} showFooter={!standalone}>
      {loading ? <NewsSkeleton article /> : post ? (
        <NewsArticle post={post} standalone={standalone} />
      ) : (
        <PeasErrorState
          title="Article unavailable"
          message={requestFailed ? "The article could not be loaded. Try again shortly." : "This article is no longer available or has not been published."}
          onRetry={requestFailed ? loadArticle : undefined}
        />
      )}
    </PublicPageShell>
  );
}

function NewsFeed({ posts, page, totalCount, totalPages, onPageChange }: {
  posts: NewsPost[];
  page: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <>
      <section className="peas-news-hero" aria-labelledby="news-title">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <span>Office of Research &amp; Publications</span>
          <h1 id="news-title">News from Research &amp; Publications</h1>
          <p>Department announcements, research activities, publication milestones, events, and opportunities for the Paulinian community.</p>
        </motion.div>
      </section>

      <section className="peas-news-feed" aria-labelledby="latest-news-title">
        <div className="peas-news-feed__heading">
          <span>Department Updates</span>
          <h2 id="latest-news-title">Latest news</h2>
        </div>
        {posts.length ? (
          <div className="peas-news-grid">
            {posts.map((post, index) => <NewsPreviewCard post={post} index={index} key={post.id} />)}
          </div>
        ) : (
          <div className="peas-news-empty">
            <Newspaper aria-hidden="true" />
            <h3>No published news yet</h3>
            <p>Updates from the Office of Research &amp; Publications will appear here.</p>
          </div>
        )}
        {posts.length ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={posts.length} label="News pages" onPageChange={onPageChange} /> : null}
      </section>
    </>
  );
}

function NewsArticle({ post, standalone }: { post: NewsPost; standalone: boolean }) {
  return (
    <article className="peas-news-article">
      <PeasToaster />
      {standalone ? null : <a className="peas-news-back" href="/news.html"><ArrowLeft aria-hidden="true" /> All news</a>}
      <header>
        <span>Office of Research &amp; Publications</span>
        <h1>{post.title}</h1>
        <NewsMeta post={post} />
        <NewsArticleActions post={post} />
        <p>{post.excerpt}</p>
        <NewsArticleAuthors authors={post.taggedAuthors || []} standalone={standalone} />
      </header>
      <NewsCoverMedia post={post} />
      <div className="peas-news-article__content">
        <NewsArticleBody
          body={post.body}
          format={post.bodyFormat}
          authors={post.taggedAuthors || []}
          media={post.media || []}
          standalone={standalone}
        />
      </div>
      <NewsArticleWorks works={post.taggedWorks || []} standalone={standalone} />
    </article>
  );
}

function NewsCoverMedia({ post }: { post: NewsPost }) {
  const cover = post.coverMediaId ? (post.media || []).find((asset) => asset.id === post.coverMediaId) : null;
  const variants = cover?.variants.filter((variant) => variant.key.startsWith("image-") && variant.mimeType === "image/webp").sort((a, b) => (b.width || 0) - (a.width || 0)) || [];
  const fallback = cover?.variants.find((variant) => variant.mimeType === "image/jpeg" || variant.mimeType === "image/png") || variants[0];
  if (!cover && !post.coverImageUrl) return null;
  if (!cover) return <img className="peas-news-article__cover" src={post.coverImageUrl || ""} alt={post.coverImageAlt || ""} />;
  return <picture className="peas-news-article__cover"><source type="image/webp" srcSet={variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ")} sizes="(max-width: 860px) 100vw, 860px" /><img src={fallback?.url || post.coverImageUrl || ""} alt={cover.isDecorative ? "" : cover.altText || post.coverImageAlt || ""} width={cover.width || undefined} height={cover.height || undefined} loading="eager" decoding="async" /></picture>;
}

function NewsArticleActions({ post }: { post: NewsPost }) {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <div className="peas-news-article__actions" aria-label="Article actions">
      <div className="peas-news-share">
        <Button variant="outline" aria-expanded={shareOpen} aria-controls="news-share-options"
          onClick={() => setShareOpen((open) => !open)}>
          <Share2 aria-hidden="true" /> Share
          <ChevronRight className={`peas-news-share__chevron${shareOpen ? " is-open" : ""}`} aria-hidden="true" />
        </Button>
        {shareOpen ? <NewsShareOptions post={post} id="news-share-options" /> : null}
      </div>
    </div>
  );
}

function NewsMeta({ post }: { post: NewsPost }) {
  const timestamp = post.publishedAt || post.createdAt;
  return (
    <div className="peas-news-meta">
      <span><CalendarDays aria-hidden="true" /> <time dateTime={timestamp}>{formatNewsDate(timestamp)}</time></span>
      <span>By {post.authorName}</span>
    </div>
  );
}

function NewsSkeleton({ article = false }: { article?: boolean }) {
  return (
    <div className={article ? "peas-news-article" : "peas-news-feed"} aria-label="Loading news">
      <Skeleton className="peas-skeleton-line peas-skeleton-line--wide" />
      <Skeleton className="peas-skeleton-line" />
      <Skeleton className="peas-news-skeleton-block" />
    </div>
  );
}

function formatNewsDate(value: string | null) {
  if (!value) return "Publication date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Publication date unavailable";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeStyle: "short" }).format(date);
}
