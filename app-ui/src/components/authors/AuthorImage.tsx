import { useEffect, useState } from "react";

interface AuthorImageProps {
  src?: unknown;
  name?: unknown;
  alt?: string;
  className?: string;
}

export function AuthorImage({ src, name, alt = "", className }: AuthorImageProps) {
  const [imageSource, setImageSource] = useState(() => normalizeAuthorImage(src));
  const [imageFailed, setImageFailed] = useState(() => !normalizeAuthorImage(src));

  useEffect(() => {
    const normalized = normalizeAuthorImage(src);
    setImageSource(normalized);
    setImageFailed(!normalized);
  }, [src]);

  const initials = getInitials(name);
  if (imageFailed || !imageSource) {
    return (
      <span
        className={`peas-author-initials${className ? ` ${className}` : ""}`}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={imageSource}
      alt={alt}
      className={className}
      onError={() => {
        setImageFailed(true);
      }}
    />
  );
}

export function normalizeAuthorImage(value: unknown): string | null {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  if (/^(https?:|data:|blob:)/i.test(raw) || raw.startsWith("/")) return raw;
  if (raw.startsWith("storage/")) return `/${raw}`;
  return `/storage/authors/profile-pictures/${raw}`;
}

export function getInitials(value: unknown) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
