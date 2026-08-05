import type { Config } from "@puckeditor/core";
import React from "react";

type LinkItem = {
  label?: string;
  href?: string;
  description?: string;
};

type ImageItem = {
  url?: string;
  alt?: string;
};

type OrganizationRoleItem = {
  title?: string;
  label?: string;
  name?: string;
};

type OverviewPillarItem = {
  id?: string;
  label?: string;
  description?: string;
};

const safeHref = (href?: string) => {
  const value = String(href || "").trim();
  if (!value) return "#";
  if (
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.startsWith("mailto:") ||
    value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    return value;
  }
  return "#";
};

const paragraphLines = (text?: string) =>
  String(text || "")
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function SectionHeader(props: { eyebrow?: string; title?: string; body?: string }) {
  return (
    <div className="xp-section-header">
      {props.eyebrow ? <span className="xp-eyebrow">{props.eyebrow}</span> : null}
      {props.title ? <h2>{props.title}</h2> : null}
      {props.body ? <p>{props.body}</p> : null}
    </div>
  );
}

function Arrow() {
  return <span aria-hidden="true" className="xp-arrow">-&gt;</span>;
}

const linkArrayField = {
  type: "array",
  arrayFields: {
    label: { type: "text" },
    href: { type: "text" },
    description: { type: "textarea" },
  },
  defaultItemProps: { label: "New link", href: "#", description: "" },
  getItemSummary: (item: LinkItem) => item.label || "Link",
} as const;

const imageArrayField = {
  type: "array",
  arrayFields: {
    url: { type: "text" },
    alt: { type: "text" },
  },
  defaultItemProps: { url: "/Components/images/image-placeholder.svg", alt: "Image" },
  getItemSummary: (item: ImageItem) => item.alt || item.url || "Image",
} as const;

const organizationRoleArrayField = {
  type: "array",
  arrayFields: {
    title: { type: "text" },
    label: { type: "text" },
    caption: { type: "text" },
    name: { type: "text" },
    photo: { type: "text" },
    photoAlt: { type: "text" },
  },
  defaultItemProps: {
    title: "",
    label: "",
    caption: "",
    name: "",
    photo: "",
    photoAlt: "",
  },
  getItemSummary: (item: OrganizationRoleItem, index?: number) =>
    item.name || item.title || item.label || `Role ${(index || 0) + 1}`,
} as const;

const overviewPillarArrayField = {
  type: "array",
  arrayFields: {
    id: { type: "text" },
    label: { type: "text" },
    description: { type: "textarea" },
  },
  defaultItemProps: { id: "preserve", label: "Preserve", description: "" },
  getItemSummary: (item: OverviewPillarItem) => item.label || "Pillar",
} as const;

export const experiencePuckConfig: Config = {
  root: {
    fields: {
      title: { type: "text" },
    },
    render: ({ children }: { children: React.ReactNode }) => <main className="xp-page">{children}</main>,
  },
  categories: {
    content: {
      title: "Landing Content",
      components: [
        "AnnouncementBanner",
        "HeroBlock",
        "OverviewBlock",
        "GalleryBlock",
        "QuickLinksBlock",
        "RichTextBlock",
        "ImageFeatureBlock",
        "ResearchAgendaBlock",
        "CtaBlock",
        "FooterLinksBlock",
      ],
      defaultExpanded: true,
    },
    login: {
      title: "Login",
      components: ["LoginShellBlock", "BrandPanelBlock", "HelpPanelBlock"],
      defaultExpanded: true,
    },
  },
  components: {
    AnnouncementBanner: {
      label: "Announcement Banner",
      fields: {
        id: { type: "text" },
        tone: {
          type: "select",
          options: [
            { label: "Green", value: "green" },
            { label: "Gold", value: "gold" },
            { label: "Neutral", value: "neutral" },
          ],
        },
        text: { type: "textarea" },
        href: { type: "text" },
        linkLabel: { type: "text" },
      },
      defaultProps: {
        id: "announcement",
        tone: "green",
        text: "New research updates are available.",
        href: "/news.html",
        linkLabel: "Read updates",
      },
      render: ({ id, tone, text, href, linkLabel }) => (
        <section id={id} className={`xp-announcement is-${tone || "green"}`}>
          <span>{text}</span>
          {linkLabel ? <a href={safeHref(href)}>{linkLabel}<Arrow /></a> : null}
        </section>
      ),
    },
    HeroBlock: {
      label: "Hero",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "textarea" },
        body: { type: "textarea" },
        logoUrl: { type: "text" },
        images: imageArrayField,
        variant: {
          type: "select",
          options: [
            { label: "Background Slideshow", value: "background-slideshow" },
          ],
        },
      },
      defaultProps: {
        id: "hero",
        eyebrow: "St. Paul University Dumaguete",
        title: "Welcome to PeAS",
        body: "A configurable research and publications portal.",
        logoUrl: "/Components/images/peas.png",
        images: [{ url: "/Components/images/1.jpg", alt: "Research photo" }],
        variant: "background-slideshow",
      },
      render: ({ id, eyebrow, title, body, logoUrl, images, variant }) => {
        const safeImages = asArray<ImageItem>(images);
        return (
          <section id={id} className={`xp-hero xp-hero-${variant || "background-slideshow"}`}>
            <div className="xp-hero-media" aria-label="Featured images">
              {safeImages.slice(0, 4).map((image, index) => (
                <img key={`${image.url}-${index}`} src={image.url} alt={image.alt || ""} />
              ))}
            </div>
            <div className="xp-hero-copy">
              {logoUrl ? <img className="xp-hero-logo" src={logoUrl} alt="" /> : null}
              {eyebrow ? <span className="xp-eyebrow">{eyebrow}</span> : null}
              <h1>{title}</h1>
              <p>{body}</p>
              <nav className="xp-hero-categories" aria-label="Browse repository by category">
                <span>Browse by category</span>
                {[
                  ["CONFLUENCE", "Confluence"],
                  ["SYNERGY", "Synergy"],
                  ["DISSERTATION", "Dissertation"],
                  ["THESIS", "Thesis"],
                ].map(([value, label]) => (
                  <a href={`/pages/searchResultsPage.html?category=${value}`} key={value}>{label}</a>
                ))}
              </nav>
            </div>
          </section>
        );
      },
    },
    OverviewBlock: {
      label: "PeAS Overview",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "text" },
        summary: { type: "textarea" },
        pillars: overviewPillarArrayField,
        ctaLabel: { type: "text" },
        ctaHref: { type: "text" },
        visualStyle: {
          type: "select",
          options: [{ label: "Archive rings", value: "archive-rings" }],
        },
      },
      defaultProps: {
        id: "peas-overview",
        eyebrow: "What is PeAS?",
        title: "A digital home for Paulinian research",
        summary: "The Paulinian electronic Archiving System preserves the university's academic works, makes scholarship easier to discover, and provides role-appropriate access to repository materials.",
        pillars: [
          { id: "preserve", label: "Preserve", description: "Safeguards theses, dissertations, Confluence, Synergy, and other scholarly outputs in one organized repository." },
          { id: "discover", label: "Discover", description: "Connects readers with research through structured metadata, authors, topics, keywords, and collection filters." },
          { id: "access", label: "Access", description: "Gives guests, registered readers, publishers, and administrators the right experience while protected files remain controlled." },
        ],
        ctaLabel: "Explore the repository",
        ctaHref: "/pages/searchResultsPage.html",
        visualStyle: "archive-rings",
      },
      render: ({ id, eyebrow, title, summary, pillars }) => (
        <section id={id} className="xp-overview">
          <SectionHeader eyebrow={eyebrow} title={title} body={summary} />
          <div className="xp-overview-preview">
            <div className="xp-overview-preview__copy">
              <strong>Interactive archive rings</strong>
              <p>Visitors can focus each pillar to explore how PeAS preserves, discovers, and governs access to research.</p>
            </div>
            <div className="xp-overview-preview__pillars">
              {asArray<OverviewPillarItem>(pillars).map((pillar) => (
                <div className="xp-overview-preview__pillar" key={pillar.id || pillar.label}>
                  <strong>{pillar.label}</strong>
                  <span>{pillar.description}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ),
    },
    GalleryBlock: {
      label: "Gallery",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        images: imageArrayField,
      },
      defaultProps: {
        id: "gallery",
        eyebrow: "Highlights",
        title: "Research in motion",
        body: "A visual snapshot of the office's work.",
        images: [{ url: "/Components/images/1.jpg", alt: "Research photo" }],
      },
      render: ({ id, eyebrow, title, body, images }) => (
        <section id={id} className="xp-section">
          <SectionHeader eyebrow={eyebrow} title={title} body={body} />
          <div className="xp-gallery">
            {asArray<ImageItem>(images).map((image, index) => (
              <img key={`${image.url}-${index}`} src={image.url} alt={image.alt || ""} />
            ))}
          </div>
        </section>
      ),
    },
    QuickLinksBlock: {
      label: "Quick Links",
      fields: {
        id: { type: "text" },
        title: { type: "text" },
        links: linkArrayField,
      },
      defaultProps: {
        id: "quick-links",
        title: "Explore",
        links: [{ label: "Research Agenda", href: "#research-agenda", description: "Explore focus areas." }],
      },
      render: ({ id, title, links }) => (
        <section id={id} className="xp-section xp-quick-links">
          {title ? <h2>{title}</h2> : null}
          <div className="xp-card-grid">
            {asArray<LinkItem>(links).map((link, index) => (
              <a key={`${link.label}-${index}`} className="xp-link-card" href={safeHref(link.href)}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
                <Arrow />
              </a>
            ))}
          </div>
        </section>
      ),
    },
    RichTextBlock: {
      label: "Rich Text",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
      },
      defaultProps: {
        id: "rich-text",
        eyebrow: "About",
        title: "Section title",
        body: "Write section copy here.",
      },
      render: ({ id, eyebrow, title, body }) => (
        <section id={id} className="xp-section">
          <SectionHeader eyebrow={eyebrow} title={title} />
          <div className="xp-prose">
            {paragraphLines(body).map((line) => <p key={line}>{line}</p>)}
          </div>
        </section>
      ),
    },
    ImageFeatureBlock: {
      label: "Image Feature",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        imageUrl: { type: "text" },
        imageAlt: { type: "text" },
        caption: { type: "text" },
        roles: organizationRoleArrayField,
      },
      defaultProps: {
        id: "image-feature",
        eyebrow: "Feature",
        title: "Image feature",
        body: "Describe this image.",
        imageUrl: "/Components/images/image-placeholder.svg",
        imageAlt: "Feature image",
        caption: "",
        roles: [],
      },
      render: ({ id, eyebrow, title, body, imageUrl, imageAlt, caption }) => (
        <section id={id} className="xp-section">
          <SectionHeader eyebrow={eyebrow} title={title} body={body} />
          <figure className="xp-image-feature">
            <img src={imageUrl} alt={imageAlt || ""} />
            {caption ? <figcaption>{caption}</figcaption> : null}
          </figure>
        </section>
      ),
    },
    ResearchAgendaBlock: {
      label: "Research Agenda",
      fields: {
        id: { type: "text" },
        eyebrow: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        imageUrl: { type: "text" },
        imageAlt: { type: "text" },
      },
      defaultProps: {
        id: "research-agenda",
        eyebrow: "Focus Areas",
        title: "Research Agenda",
        body: "Priority areas guiding faculty and student research.",
        imageUrl: "/Components/images/prism.png",
        imageAlt: "Research prism diagram",
      },
      render: ({ id, eyebrow, title, body, imageUrl, imageAlt }) => (
        <section id={id} className="xp-section xp-agenda">
          <SectionHeader eyebrow={eyebrow} title={title} body={body} />
          {imageUrl ? <img className="xp-agenda-image" src={imageUrl} alt={imageAlt || ""} /> : null}
          <p className="xp-managed-list-note">Official research agenda items are managed in Classification Management.</p>
        </section>
      ),
    },
    CtaBlock: {
      label: "Call to Action",
      fields: {
        id: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        label: { type: "text" },
        href: { type: "text" },
      },
      defaultProps: {
        id: "cta",
        title: "Ready to collaborate?",
        body: "Reach out to the office.",
        label: "Contact us",
        href: "/contact.html",
      },
      render: ({ id, title, body, label, href }) => (
        <section id={id} className="xp-cta">
          <h2>{title}</h2>
          <p>{body}</p>
          {label ? <a className="xp-button-primary" href={safeHref(href)}>{label}</a> : null}
        </section>
      ),
    },
    FooterLinksBlock: {
      label: "Footer Links",
      fields: {
        id: { type: "text" },
        logoUrl: { type: "text" },
        copyrightLabel: { type: "text" },
        links: linkArrayField,
      },
      defaultProps: {
        id: "footer",
        logoUrl: "/Components/images/spud-logo.png",
        copyrightLabel: "PeAS. All Rights Reserved.",
        links: [{ label: "Home", href: "/index.html", description: "" }],
      },
      render: ({ id, logoUrl, copyrightLabel, links }) => (
        <footer id={id} className="xp-footer">
          {logoUrl ? <img src={logoUrl} alt="" /> : null}
          <small>© {new Date().getFullYear()} {copyrightLabel}</small>
          <nav>
            {asArray<LinkItem>(links).map((link, index) => (
              <a key={`${link.href}-${index}`} href={safeHref(link.href)}>{link.label}</a>
            ))}
          </nav>
        </footer>
      ),
    },
    LoginShellBlock: {
      label: "Login Shell",
      fields: {
        id: { type: "text" },
        brandText: { type: "textarea" },
        logoUrl: { type: "text" },
        title: { type: "text" },
        subtitle: { type: "textarea" },
        schoolIdLabel: { type: "text" },
        schoolIdPlaceholder: { type: "text" },
        passwordLabel: { type: "text" },
        passwordPlaceholder: { type: "text" },
        submitLabel: { type: "text" },
        forgotPasswordLabel: { type: "text" },
        forgotPasswordTitle: { type: "text" },
        forgotPasswordSubtitle: { type: "textarea" },
        backgroundImageUrl: { type: "text" },
        graphicLogoUrl: { type: "text" },
        footerText: { type: "textarea" },
        layout: {
          type: "select",
          options: [
            { label: "Split", value: "split" },
            { label: "Focused", value: "focused" },
            { label: "Editorial", value: "editorial" },
          ],
        },
      },
      defaultProps: {
        id: "login-shell",
        brandText: "Paulinian electronic\nArchiving System (PeAS)",
        logoUrl: "/Components/images/peas_logo.png",
        title: "Welcome back",
        subtitle: "Please enter your details to access PeAS.",
        schoolIdLabel: "School ID",
        schoolIdPlaceholder: "Enter your School ID",
        passwordLabel: "Password",
        passwordPlaceholder: "Enter your password",
        submitLabel: "Sign in",
        forgotPasswordLabel: "Forgot Password?",
        forgotPasswordTitle: "Forgot Password?",
        forgotPasswordSubtitle: "No worries, we'll send you reset instructions.",
        backgroundImageUrl: "/Components/images/spud_facade.jpg",
        graphicLogoUrl: "/Components/images/spud-logo.png",
        footerText: "PeAS. All Rights Reserved.",
        layout: "split",
      },
      render: (props) => (
        <section id={props.id} className={`xp-login-shell xp-login-${props.layout || "split"}`}>
          <div className="xp-login-form-surface" data-login-form-slot="true">
            <div className="xp-login-brand">
              {props.logoUrl ? <img src={props.logoUrl} alt="" /> : null}
              <span>{props.brandText}</span>
            </div>
            <h1>{props.title}</h1>
            <p>{props.subtitle}</p>
            <div className="xp-login-placeholder">
              <label>{props.schoolIdLabel}</label>
              <div>{props.schoolIdPlaceholder}</div>
              <label>{props.passwordLabel}</label>
              <div>{props.passwordPlaceholder}</div>
              <button type="button">{props.submitLabel}</button>
              <small>{props.forgotPasswordLabel}</small>
            </div>
            <small className="xp-login-footer">{props.footerText}</small>
          </div>
          <div className="xp-login-graphic" style={{ backgroundImage: `url(${props.backgroundImageUrl})` }}>
            {props.graphicLogoUrl ? <img src={props.graphicLogoUrl} alt="" /> : null}
          </div>
        </section>
      ),
    },
    BrandPanelBlock: {
      label: "Brand Panel",
      fields: {
        id: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        imageUrl: { type: "text" },
        imageAlt: { type: "text" },
      },
      defaultProps: {
        id: "brand-panel",
        title: "Built for Paulinian research",
        body: "Use this panel to explain the system's purpose.",
        imageUrl: "/Components/images/peas.png",
        imageAlt: "PeAS logo",
      },
      render: ({ id, title, body, imageUrl, imageAlt }) => (
        <section id={id} className="xp-brand-panel">
          {imageUrl ? <img src={imageUrl} alt={imageAlt || ""} /> : null}
          <h2>{title}</h2>
          <p>{body}</p>
        </section>
      ),
    },
    HelpPanelBlock: {
      label: "Help Panel",
      fields: {
        id: { type: "text" },
        title: { type: "text" },
        body: { type: "textarea" },
        links: linkArrayField,
      },
      defaultProps: {
        id: "help-panel",
        title: "Need help signing in?",
        body: "Contact the Office of Research & Publications for access concerns.",
        links: [{ label: "Contact the Office", href: "/contact.html", description: "" }],
      },
      render: ({ id, title, body, links }) => (
        <section id={id} className="xp-help-panel">
          <h2>{title}</h2>
          <p>{body}</p>
          {asArray<LinkItem>(links).map((link, index) => (
            <a key={`${link.href}-${index}`} href={safeHref(link.href)}>{link.label}<Arrow /></a>
          ))}
        </section>
      ),
    },
  },
};
