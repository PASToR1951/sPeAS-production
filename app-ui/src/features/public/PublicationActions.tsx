import { BookOpen, Download } from "lucide-react";
import { Button, buttonVariants } from "../../components/ui/button";

type ActionLink = {
  href: string;
  label: string;
  accessibleLabel?: string;
};

type ReaderToggle = {
  label: string;
  expanded: boolean;
  onClick: () => void;
};

export function PublicationActions({ read, download }: {
  read?: ActionLink | ReaderToggle;
  download?: ActionLink;
}) {
  return (
    <div className="peas-publication-actions">
      {read && ("href" in read ? (
        <a className={buttonVariants()} href={read.href} aria-label={read.accessibleLabel}>
          <BookOpen aria-hidden="true" />{read.label}
        </a>
      ) : (
        <Button aria-expanded={read.expanded} onClick={read.onClick}>
          <BookOpen aria-hidden="true" />{read.label}
        </Button>
      ))}
      {download && (
        <a className={buttonVariants({ variant: "outline" })} href={download.href} aria-label={download.accessibleLabel}>
          <Download aria-hidden="true" />{download.label}
        </a>
      )}
    </div>
  );
}
