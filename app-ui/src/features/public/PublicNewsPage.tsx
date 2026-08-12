import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Link2, Mail, Newspaper, Share2 } from "lucide-react";
import { FaFacebookF, FaLinkedinIn, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import { motion } from "motion/react";
import { PeasErrorState } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { NewsPreviewCard } from "../../components/public/NewsPreviewCard";
import { NewsArticleBody } from "../../components/news/NewsArticleBody";
import { NewsArticleAuthors, NewsArticleWorks } from "../../components/news/NewsArticleReferences";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { NewsletterSignup } from "../../components/public/NewsletterSignup";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { PeasToaster, toast } from "../../components/ui/toast";
import { getErrorMessage } from "../../lib/api/http";
import { fetchPublishedNews, fetchPublishedNewsPost, type NewsPost } from "../../lib/api/news";

const PAGE_SIZE = 9;

export function PublicNewsPage() {
  const slug = useMemo(() => new URLSearchParams(window.location.search).get("slug")?.trim() || "", []);
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [article, setArticle] = useState<NewsPost | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadNews = useCallback(() => {
    setLoading(true);
    setError("");
    const request = slug
      ? fetchPublishedNewsPost(slug).then((post) => setArticle(post))
      : fetchPublishedNews(page, PAGE_SIZE).then((result) => {
        setPosts(result.posts);
        setTotalCount(result.totalCount);
        setTotalPages(result.totalPages);
      });

    request.catch((caughtError) => setError(getErrorMessage(caughtError))).finally(() => setLoading(false));
  }, [page, slug]);

  useEffect(() => { loadNews(); }, [loadNews]);

  return (
    <PublicPageShell mainClassName="peas-news-shell peas-news-page">
        {loading ? <NewsSkeleton article={Boolean(slug)} /> : error ? (
          <PeasErrorState title="Unable to load news" message={error} onRetry={loadNews} />
        ) : article ? <NewsArticle post={article} /> : (
          <NewsFeed posts={posts} page={page} totalCount={totalCount} totalPages={totalPages} onPageChange={setPage} />
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
      <NewsletterSignup />
    </>
  );
}

function NewsArticle({ post }: { post: NewsPost }) {
  return (
    <article className="peas-news-article">
      <PeasToaster />
      <a className="peas-news-back" href="/news.html"><ArrowLeft aria-hidden="true" /> All news</a>
      <header>
        <span>Office of Research &amp; Publications</span>
        <h1>{post.title}</h1>
        <NewsMeta post={post} />
        <NewsArticleActions post={post} />
        <p>{post.excerpt}</p>
        <NewsArticleAuthors authors={post.taggedAuthors || []} />
      </header>
      <NewsCoverMedia post={post} />
      <div className="peas-news-article__content">
        <NewsArticleBody
          body={post.body}
          format={post.bodyFormat}
          authors={post.taggedAuthors || []}
          media={post.media || []}
        />
      </div>
      <NewsArticleWorks
        works={post.taggedWorks || []}
        authenticated={false}
      />
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
  const [nativeShare, setNativeShare] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canonicalUrl = useMemo(() => new URL(`/news.html?slug=${encodeURIComponent(post.slug)}`, window.location.origin).toString(), [post.slug]);

  useEffect(() => {
    setNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const shareData = { title: post.title, text: post.excerpt, url: canonicalUrl };
  const share = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share(shareData);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        toast.error("Sharing is unavailable right now");
      }
    }
  };

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(canonicalUrl);
        } catch {
          copyTextWithSelection(canonicalUrl);
        }
      } else {
        copyTextWithSelection(canonicalUrl);
      }
      toast.success("Article link copied");
    } catch {
      toast.error("Unable to copy the article link");
    }
  };

  const emailArticle = () => {
    window.location.assign(`mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(`${post.excerpt}\n\n${canonicalUrl}`)}`);
  };

  const openSocialShare = (platform: SocialPlatform) => {
    const encodedUrl = encodeURIComponent(canonicalUrl);
    const encodedTitle = encodeURIComponent(post.title);
    const encodedMessage = encodeURIComponent(`${post.title}\n${canonicalUrl}`);
    const shareUrls = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      x: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
      whatsapp: `https://wa.me/?text=${encodedMessage}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    };
    window.open(shareUrls[platform], "_blank", "noopener,noreferrer");
  };

  return (
    <div className="peas-news-article__actions" aria-label="Article actions">
      <div className="peas-news-share">
        <Button
          variant="outline"
          aria-expanded={shareOpen}
          aria-controls="news-share-options"
          onClick={() => setShareOpen((open) => !open)}
        >
          <Share2 aria-hidden="true" /> Share
          <ChevronRight className={`peas-news-share__chevron${shareOpen ? " is-open" : ""}`} aria-hidden="true" />
        </Button>
        {shareOpen ? (
          <div id="news-share-options" className="peas-news-share__options" role="group" aria-label="Share options">
            {nativeShare ? (
              <Button className="peas-news-share__option" size="icon" variant="ghost" aria-label="Use device share" title="Use device share" onClick={() => void share()}>
                <Share2 aria-hidden="true" />
              </Button>
            ) : null}
            <SocialShareButton platform="facebook" onShare={openSocialShare} />
            <SocialShareButton platform="x" onShare={openSocialShare} />
            <SocialShareButton platform="whatsapp" onShare={openSocialShare} />
            <SocialShareButton platform="linkedin" onShare={openSocialShare} />
            <Button className="peas-news-share__option" size="icon" variant="ghost" aria-label="Copy link" title="Copy link" onClick={() => void copyLink()}>
              <Link2 aria-hidden="true" />
            </Button>
            <Button className="peas-news-share__option" size="icon" variant="ghost" aria-label="Email article" title="Email article" onClick={emailArticle}>
              <Mail aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type SocialPlatform = "facebook" | "x" | "whatsapp" | "linkedin";

function SocialShareButton({ platform, onShare }: { platform: SocialPlatform; onShare: (platform: SocialPlatform) => void }) {
  const label = {
    facebook: "Facebook",
    x: "X (Twitter)",
    whatsapp: "WhatsApp",
    linkedin: "LinkedIn",
  }[platform];
  return (
    <Button
      className="peas-news-share__option"
      data-platform={platform}
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => onShare(platform)}
    >
      <SocialIcon platform={platform} />
    </Button>
  );
}

function SocialIcon({ platform }: { platform: SocialPlatform }) {
  if (platform === "facebook") {
    return <FaFacebookF aria-hidden="true" focusable="false" />;
  }
  if (platform === "x") {
    return <FaXTwitter aria-hidden="true" focusable="false" />;
  }
  if (platform === "whatsapp") {
    return <FaWhatsapp aria-hidden="true" focusable="false" />;
  }
  return <FaLinkedinIn aria-hidden="true" focusable="false" />;
}

function copyTextWithSelection(value: string) {
  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  try {
    fallback.focus();
    fallback.select();
    if (!document.execCommand("copy")) throw new Error("Copy command was rejected");
  } finally {
    fallback.remove();
  }
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

function NewsSkeleton({ article }: { article: boolean }) {
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
