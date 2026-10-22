import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Bookmark, Eye } from "lucide-react";
import { AuthorImage } from "../authors/AuthorImage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { fetchAuthorPreview, type AuthorPreview } from "../../lib/api/authors";

type AuthorReference = { id?: string; full_name: string };

export function AuthorPreviewLink({ author, refreshKey = 0 }: { author: AuthorReference; refreshKey?: number }) {
  const id = String(author.id ?? "").trim();
  const name = author.full_name || "Unknown author";
  const profileHref = id ? `/pages/authorprofile.html?id=${encodeURIComponent(id)}` : null;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AuthorPreview | null>(null);
  const [loadedRefreshKey, setLoadedRefreshKey] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const needsRefresh = Boolean(preview && loadedRefreshKey !== refreshKey);
    if (!id || (!open && !needsRefresh) || (preview && loadedRefreshKey === refreshKey)) return;
    let active = true;
    setLoading(true);
    setError(false);
    fetchAuthorPreview(id, refreshKey > loadedRefreshKey)
      .then((next) => {
        if (!active) return;
        setPreview(next);
        setLoadedRefreshKey(refreshKey);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, loadedRefreshKey, open, preview, refreshKey]);

  if (!profileHref) {
    return <span className="peas-document-author-chip is-static"><AuthorImage name={name} alt="" />{name}</span>;
  }

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <a className="peas-document-author-chip" href={profileHref}>
            <AuthorImage src={preview?.profilePicture} name={preview?.fullName ?? name} alt="" />
            <span>{name}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" collisionPadding={16} className="peas-author-preview-card">
          <AuthorPreviewContent fallback={{ ...author, id, full_name: name }} profileHref={profileHref} preview={preview} loading={loading} error={error} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
function AuthorPreviewContent({ fallback, profileHref, preview, loading, error }: { fallback: AuthorReference; profileHref: string; preview: AuthorPreview | null; loading: boolean; error: boolean }) {
  const name = preview?.fullName ?? String(fallback.full_name ?? "Author");
  const image = preview?.profilePicture;
  const affiliation = preview?.affiliation ?? null;
  const department = preview?.department ?? null;
  const biography = preview?.biography ?? null;
  const categories = preview?.researchCategories ?? [];
  const activity = preview?.viewerActivity;
  const hasActivity = Boolean(activity && (activity.savedWorksCount || activity.viewedWorksCount));

  return <div className="peas-author-preview-card__inner">
    <div className="peas-author-preview-card__head">
      <AuthorImage className="is-large" src={image} name={name} alt="" />
      <div><strong>{name}</strong><small>{[department, affiliation].filter(Boolean).join(" · ") || "Research author"}</small></div>
    </div>
    {loading && !preview ? <p className="peas-author-preview-card__loading">Loading author details…</p> : null}
    {error && !preview ? <p className="peas-author-preview-card__loading">Author details are temporarily unavailable.</p> : null}
    {biography ? <p className="peas-author-preview-card__bio">{biography}</p> : null}
    {preview ? <>
      <div className="peas-author-preview-card__stats"><span><BookOpen aria-hidden="true" /><strong>{preview.publicWorksCount}</strong> {preview.publicWorksCount === 1 ? "work" : "works"}</span>{categories.length ? <span>{categories.slice(0, 3).map((category) => `${category.name} (${category.worksCount})`).join(" · ")}{categories.length > 3 ? ` +${categories.length - 3}` : ""}</span> : null}</div>
      {hasActivity ? <div className="peas-author-preview-card__activity"><span><Bookmark aria-hidden="true" /> You saved {activity?.savedWorksCount} {activity?.savedWorksCount === 1 ? "work" : "works"}</span><span><Eye aria-hidden="true" /> You viewed {activity?.viewedWorksCount} {activity?.viewedWorksCount === 1 ? "work" : "works"}</span></div> : null}
    </> : null}
    <a className="peas-author-preview-card__profile" href={profileHref}>View profile <ArrowUpRight aria-hidden="true" /></a>
  </div>;
}
// Public attribution deliberately carries no directory-only fallback fields.
