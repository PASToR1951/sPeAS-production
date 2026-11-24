import { useState } from "react";
import { Link2, Mail, Share2 } from "lucide-react";
import { FaFacebookF, FaLinkedinIn, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import type { NewsPost } from "../../lib/api/news";
import { getSharedNewsArticlePath } from "../../../../shared/newsArticlePaths";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toast } from "../ui/toast";

export function NewsShareOptions({ post, id }: {
  post: Pick<NewsPost, "slug" | "title" | "excerpt">;
  id?: string;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  const url = new URL(getSharedNewsArticlePath(post.slug), window.location.origin).href;
  const encodedUrl = encodeURIComponent(url);
  const platforms = [
    { key: "facebook", label: "Facebook", Icon: FaFacebookF, url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { key: "linkedin", label: "LinkedIn", Icon: FaLinkedinIn, url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { key: "x", label: "X (Twitter)", Icon: FaXTwitter, url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodedUrl}` },
    { key: "whatsapp", label: "WhatsApp", Icon: FaWhatsapp, url: `https://wa.me/?text=${encodeURIComponent(`${post.title}\n${url}`)}` },
  ];

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url).catch(() => copyTextWithSelection(url));
      } else {
        copyTextWithSelection(url);
      }
      setCopyFailed(false);
      toast.success("Article link copied");
    } catch {
      setCopyFailed(true);
    }
  }

  async function shareOnDevice() {
    try {
      await navigator.share({ title: post.title, text: post.excerpt, url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Sharing is unavailable right now");
      }
    }
  }

  return (
    <div id={id} className="peas-news-share__options" role="group" aria-label="Share options">
      <Button variant="outline" size="sm" onClick={() => void copyLink()}>
        <Link2 aria-hidden="true" /> Copy link
      </Button>
      {platforms.map(({ key, label, Icon, url: shareUrl }) => (
        <Button key={key} className="peas-news-share__option" size="icon" variant="ghost"
          data-platform={key} aria-label={label} title={label}
          onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
          <Icon aria-hidden="true" focusable="false" />
        </Button>
      ))}
      {typeof navigator.share === "function" ? (
        <Button className="peas-news-share__option" size="icon" variant="ghost" aria-label="Use device share" title="Use device share" onClick={() => void shareOnDevice()}>
          <Share2 aria-hidden="true" />
        </Button>
      ) : null}
      <Button className="peas-news-share__option" size="icon" variant="ghost" aria-label="Email article" title="Email article"
        onClick={() => window.location.assign(`mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(`${post.excerpt}\n\n${url}`)}`)}>
        <Mail aria-hidden="true" />
      </Button>
      {copyFailed ? (
        <div className="peas-news-share__fallback">
          <p role="status">Clipboard unavailable. Select and copy the article link.</p>
          <Input aria-label="Article link" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
        </div>
      ) : null}
    </div>
  );
}

function copyTextWithSelection(value: string) {
  const previousFocus = document.activeElement;
  const input = document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  // Keep the selection inside the active dialog's focus trap.
  (previousFocus?.closest('[role="dialog"]') ?? document.body).appendChild(input);
  try {
    input.focus();
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}
