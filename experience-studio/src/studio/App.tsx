import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import XHRUpload from "@uppy/xhr-upload";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultExperienceConfig,
  FAQ_CATEGORY_LIMITS,
  EXPERIENCE_FIXED_THEME,
  ExperienceConfig,
  ExperienceConfigSchema,
} from "../../../Deno/shared/experienceConfig";
import { experiencePuckConfig } from "../shared/puckConfig";

type PageKey = "landing" | "login" | "faq";
type DeviceKey = "desktop" | "tablet" | "mobile";
type InspectorTab = "content" | "checks" | "assets";

type DraftPayload = {
  config: ExperienceConfig;
  version?: number;
  status?: string;
};

type VersionSummary = {
  id: number;
  status: string;
  version: number;
  updatedBy?: string | null;
  publishedBy?: string | null;
  updatedAt?: string;
  publishedAt?: string | null;
};

type UploadedAsset = {
  file_path?: string;
  kind?: string;
  alt_text?: string | null;
};

type BlockData = {
  type: string;
  props: Record<string, any>;
};

type OrganizationRole = {
  id?: string;
  title?: string;
  label?: string;
  caption?: string;
  name?: string;
  photo?: string;
  photoAlt?: string;
  group?: boolean;
};

type OverviewPillar = {
  id?: string;
  label?: string;
  description?: string;
};

type HeroImage = {
  url?: string;
  alt?: string;
};

type FaqItem = { id: string; question: string; answer: string };
type FaqCategory = { id: string; label: string; items: FaqItem[] };

const landingBlocks = [
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
];

const loginBlocks = ["LoginShellBlock", "BrandPanelBlock", "HelpPanelBlock"];
const faqBlocks = ["FaqBlock"];

const cloneConfig = (config: ExperienceConfig): ExperienceConfig =>
  JSON.parse(JSON.stringify(config));

const componentMap = experiencePuckConfig.components as Record<string, any>;

const pageNames: Record<PageKey, string> = {
  landing: "Home page",
  login: "Sign-in page",
  faq: "FAQ page",
};

// Plain-language names and one-line explanations for every section type,
// shown in the section list and the "Add a section" menu.
const sectionMeta: Record<string, { name: string; description: string }> = {
  AnnouncementBanner: { name: "Announcement Bar", description: "A thin colored strip at the top for short news." },
  HeroBlock: { name: "Welcome Banner", description: "The big opening area with a title, photos, search, and category links." },
  OverviewBlock: { name: "PeAS Overview", description: "An interactive explanation of how PeAS preserves, discovers, and provides access to research." },
  GalleryBlock: { name: "Photo Gallery", description: "A row of pictures with a short introduction." },
  QuickLinksBlock: { name: "Quick Links", description: "Cards that take visitors to other pages or sections." },
  RichTextBlock: { name: "Text Section", description: "A heading with paragraphs of plain text." },
  ImageFeatureBlock: { name: "Organizational Chart", description: "The people, offices, and boards in the office structure." },
  ResearchAgendaBlock: { name: "Research Agenda", description: "Presentation for the database-managed research priorities." },
  CtaBlock: { name: "Call to Action", description: "A banner inviting visitors to do something, like contacting you." },
  FooterLinksBlock: { name: "Footer", description: "The logo, copyright line, and links at the very bottom." },
  LoginShellBlock: { name: "Sign-in Box", description: "The form where users enter their School ID and password." },
  BrandPanelBlock: { name: "Side Brand Panel", description: "A decorative panel shown beside the sign-in box." },
  HelpPanelBlock: { name: "Help Panel", description: "Help text and links for users who can't sign in." },
  FaqBlock: { name: "FAQ Content", description: "Searchable questions and answers for public readers." },
};

const sectionName = (type: string) =>
  sectionMeta[type]?.name || (componentMap[type]?.label as string) || type;

const editableFields: Record<string, readonly string[]> = {
  HeroBlock: ["eyebrow", "title", "body", "images"],
  OverviewBlock: ["eyebrow", "title", "summary", "pillars"],
  QuickLinksBlock: ["title", "links"],
  RichTextBlock: ["eyebrow", "title", "body"],
  ImageFeatureBlock: ["eyebrow", "title", "body", "roles"],
  ResearchAgendaBlock: ["eyebrow", "title", "body", "imageUrl", "imageAlt"],
  CtaBlock: ["title", "body", "label"],
  LoginShellBlock: ["brandText", "title", "subtitle", "forgotPasswordTitle", "forgotPasswordSubtitle", "footerText", "backgroundImageUrl", "graphicLogoUrl", "logoUrl"],
  FaqBlock: ["eyebrow", "title", "description", "categories", "contactTitle", "contactBody", "contactLabel"],
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

function applyThemeVars(theme: typeof EXPERIENCE_FIXED_THEME) {
  const root = document.documentElement;
  root.style.setProperty("--xp-primary", theme.primaryColor);
  root.style.setProperty("--xp-primary-dark", theme.primaryDarkColor);
  root.style.setProperty("--xp-accent", theme.accentColor);
  root.style.setProperty("--xp-surface", theme.surfaceColor);
  root.style.setProperty("--xp-text", theme.textColor);
  root.style.setProperty("--xp-muted", theme.mutedTextColor);
  root.style.setProperty("--xp-bg", theme.pageBackground);
  root.style.setProperty("--xp-radius", theme.radius === "compact" ? "8px" : theme.radius === "rounded" ? "18px" : "14px");
}

function niceLabel(value: string) {
  return value
    .replace(/Block$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Url/g, "URL")
    .replace(/^./, (letter) => letter.toUpperCase());
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Friendlier names for fields whose auto-generated label reads as jargon.
const fieldLabels: Record<string, string> = {
  eyebrow: "Small line above the title",
  body: "Text",
  text: "Text",
  href: "Where the link goes",
  linkLabel: "Link text",
  label: "Button text",
  logoUrl: "Logo image",
  imageUrl: "Picture",
  url: "Picture",
  backgroundImageUrl: "Background picture",
  graphicLogoUrl: "Side panel logo",
  alt: "Picture description",
  imageAlt: "Picture description",
  photo: "Profile photo",
  photoAlt: "Photo description",
  variant: "Layout style",
  layout: "Layout style",
  tone: "Color",
  copyrightLabel: "Copyright line",
  caption: "Caption under the picture",
  images: "Pictures",
  links: "Links",
  items: "List items",
  summary: "Overview summary",
  pillars: "Overview pillars",
  roles: "Organizational chart roles",
  subtitle: "Subtitle",
  description: "Short description",
  brandText: "Brand name shown on the form",
  schoolIdLabel: "School ID box label",
  schoolIdPlaceholder: "School ID example text",
  passwordLabel: "Password box label",
  passwordPlaceholder: "Password example text",
  submitLabel: "Sign-in button text",
  forgotPasswordLabel: "“Forgot password” link text",
  forgotPasswordTitle: "Forgot-password window title",
  forgotPasswordSubtitle: "Forgot-password window message",
  footerText: "Small print at the bottom",
};

const fieldHelp: Record<string, string> = {
  eyebrow: "Optional. Leave blank to hide it.",
  body: "Plain text. Press Enter twice to start a new paragraph.",
  href: "A page like /contact.html, a section like #research-agenda, or a full https:// address.",
  linkLabel: "The clickable words. Leave blank to show no link.",
  alt: "A few words describing the picture, read aloud for blind visitors.",
  imageAlt: "A few words describing the picture, read aloud for blind visitors.",
  photoAlt: "Describe the person or group shown. This is read aloud when the photo cannot be seen.",
  variant: "How this section is arranged. Try each one and watch the preview.",
  layout: "How this section is arranged. Try each one and watch the preview.",
  tone: "The color style of this strip.",
  caption: "Optional small text under the picture. Leave blank to hide.",
  summary: "Describe PeAS in one concise paragraph.",
  id: "Only change this if you know a link points here.",
};

const fieldPlaceholders: Record<string, string> = {
  href: "/contact.html or https://example.com",
  alt: "e.g. Students collaborating in the library",
  imageAlt: "e.g. Students collaborating in the library",
  photoAlt: "e.g. Portrait of Juan Dela Cruz",
};

const friendlyLabel = (name: string) => fieldLabels[name] || niceLabel(name);

function buildRecipe(name: string, base: ExperienceConfig): ExperienceConfig {
  const next = cloneConfig(base);

  if (name === "Minimal Academic") {
    next.title = "Minimal Academic";
    next.pages.landing.data.content = next.pages.landing.data.content.filter((block) =>
      ["HeroBlock", "QuickLinksBlock", "RichTextBlock", "ResearchAgendaBlock", "FooterLinksBlock"].includes(block.type)
    );
  }

  if (name === "Visual Research Portal") {
    next.title = "Visual Research Portal";
    next.pages.landing.data.content.splice(1, 0, {
      type: "GalleryBlock",
      props: {
        id: "visual-gallery",
        eyebrow: "Highlights",
        title: "Research in motion",
        body: "A visual look at the office's activities, publications, and collaborations.",
        images: [
          { url: "/Components/images/PeAS-news-1.png", alt: "PeAS news image" },
          { url: "/Components/images/PeAS-news-2.png", alt: "PeAS news image" },
          { url: "/Components/images/PeAS-news-3.png", alt: "PeAS news image" },
        ],
      },
    });
  }

  if (name === "Announcement Campaign") {
    next.title = "Announcement Campaign";
    next.pages.landing.data.content.unshift({
      type: "AnnouncementBanner",
      props: {
        id: "campaign-announcement",
        tone: "gold",
        text: "New publication updates are available from the Office of Research & Publications.",
        href: "/news.html",
        linkLabel: "View updates",
      },
    });
  }

  if (name === "Focused Login") {
    next.title = "Focused Login";
    const loginShell = next.pages.login.data.content.find((block) => block.type === "LoginShellBlock");
    if (loginShell) {
      loginShell.props = {
        ...loginShell.props,
        layout: "focused",
        title: "Sign in to PeAS",
        subtitle: "Access your saved documents, history, and research tools.",
      };
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function getGuardrails(config: ExperienceConfig, page: PageKey): string[] {
  const warnings: string[] = [];
  const data = config.pages[page].data;
  const json = JSON.stringify(data);
  const linkMatches = json.match(/"href"\s*:\s*"([^"]+)"/g) || [];

  data.content.forEach((block) => {
    const props = block.props || {};
    if ("imageUrl" in props && props.imageUrl && !props.imageAlt) {
      warnings.push(`${sectionName(block.type)}: the picture has no description for blind visitors.`);
    }
    if ("images" in props && Array.isArray(props.images)) {
      props.images.forEach((image: any, index: number) => {
        if (image?.url && !image?.alt) warnings.push(`${sectionName(block.type)}: picture ${index + 1} has no description for blind visitors.`);
      });
    }
    if ("roles" in props && Array.isArray(props.roles)) {
      props.roles.forEach((role: OrganizationRole, index: number) => {
        const roleName = role.name || role.title || role.label || `Role ${index + 1}`;
        if (role.photo && !role.photoAlt?.trim()) {
          warnings.push(`${roleName}: the profile photo has no description for blind visitors.`);
        }
        const requiredRoleFields: Array<[keyof OrganizationRole, string]> = [
          ["title", "position or board name"],
          ["label", "short chart label"],
          ["caption", "office or unit"],
        ];
        requiredRoleFields.forEach(([field, fieldLabel]) => {
          if (!String(role[field] || "").trim()) {
            warnings.push(`${roleName}: ${fieldLabel} is required.`);
          }
        });
        if (role.title && role.title.length > 100) {
          warnings.push(`${roleName}: the position is very long and may not fit on phones.`);
        }
      });
    }
    if (typeof props.title === "string" && props.title.length > 110) {
      warnings.push(`${sectionName(block.type)}: the title is very long and may not fit on phones.`);
    }
  });

  linkMatches.forEach((match) => {
    const href = match.replace(/^"href"\s*:\s*"/, "").replace(/"$/, "");
    const safe = href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:") ||
      href.startsWith("https://") || href.startsWith("http://");
    if (!safe) warnings.push(`A link points to “${href}”, which doesn't look like a valid address.`);
  });

  return warnings.length ? warnings : ["No issues found for this page."];
}

function ImageUrlField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  uploadKind?: string;
  altText?: string;
  storageHint?: string;
  allowManualPath?: boolean;
  clearLabel?: string;
  onClear?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", props.uploadKind || "branding");
      if (props.altText?.trim()) formData.append("altText", props.altText.trim());
      const response = await fetch("/api/admin/experience/assets", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.details || data.error || "Upload failed");
      if (data.asset?.file_path) props.onChange(data.asset.file_path);
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="xp-image-field">
      <span>{props.label}</span>
      {props.value ? (
        <img
          key={props.value}
          className="xp-image-preview"
          src={props.value}
          alt=""
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
      <div className="xp-copy-row">
        <input
          value={props.value || ""}
          readOnly={props.allowManualPath === false}
          aria-label={props.allowManualPath === false ? `${props.label} storage path` : undefined}
          placeholder="Upload or use an existing PeAS image path"
          onChange={(event) => {
            if (props.allowManualPath !== false) props.onChange(event.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadFile(file);
          event.target.value = "";
        }}
      />
      {props.value && props.clearLabel ? (
        <button
          className="xp-image-clear"
          type="button"
          onClick={() => {
            setUploadError("");
            (props.onClear || (() => props.onChange("")))();
          }}
        >
          {props.clearLabel}
        </button>
      ) : null}
      {uploadError
        ? <small className="xp-field-error">{uploadError}</small>
        : <small className="xp-field-help">{props.storageHint || "JPG, PNG, or WEBP up to 8MB."}</small>}
    </div>
  );
}

function OrganizationRoleDetails(props: {
  children: React.ReactNode;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(props.initiallyOpen);

  return (
    <details
      className="xp-org-role-card"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {props.children}
    </details>
  );
}

function OrganizationRolesField(props: {
  value: unknown;
  onChange: (value: OrganizationRole[]) => void;
}) {
  const roles = Array.isArray(props.value) ? props.value as OrganizationRole[] : [];
  const updateRole = (index: number, key: keyof OrganizationRole, value: string) => {
    props.onChange(roles.map((role, roleIndex) =>
      roleIndex === index ? { ...role, [key]: value } : role
    ));
  };

  return (
    <section className="xp-org-role-editor" aria-labelledby="xp-org-roles-title">
      <div className="xp-array-heading">
        <span id="xp-org-roles-title">Organizational chart roles</span>
        <small>{roles.length} fixed roles</small>
      </div>
      <p className="xp-org-role-note">
        Names, positions, office or unit labels, and photos can be updated. Placement and reporting lines stay locked so the chart remains consistent on every device.
      </p>
      <div className="xp-org-role-list">
        {roles.map((role, index) => {
          const summary = role.name?.trim() || role.title?.trim() || role.label?.trim() || `Role ${index + 1}`;
          const group = role.group ? "Board / committee" : "Individual role";
          return (
            <OrganizationRoleDetails key={role.id || index} initiallyOpen={index === 0}>
              <summary>
                <span className="xp-org-role-number" aria-hidden="true">{index + 1}</span>
                <span className="xp-org-role-summary">
                  <strong>{summary}</strong>
                  <small>{group} · Placement locked</small>
                </span>
              </summary>
              <div className="xp-org-role-fields">
                <ImageUrlField
                  label="Profile photo"
                  value={role.photo || ""}
                  uploadKind="org-chart"
                  altText={role.photoAlt}
                  clearLabel="Remove photo"
                  onClear={() => props.onChange(roles.map((item, roleIndex) =>
                    roleIndex === index ? { ...item, photo: "", photoAlt: "" } : item
                  ))}
                  onChange={(value) => updateRole(index, "photo", value)}
                />
                <label>
                  <span>Photo description</span>
                  <input
                    value={role.photoAlt || ""}
                    placeholder={fieldPlaceholders.photoAlt}
                    maxLength={255}
                    onChange={(event) => updateRole(index, "photoAlt", event.target.value)}
                  />
                  <small className="xp-field-help">Required when a photo is used. Describe what the photo shows.</small>
                </label>
                <label>
                  <span>Person's name</span>
                  <input
                    value={role.name || ""}
                    placeholder="e.g. Dr. Juan Dela Cruz"
                    maxLength={160}
                    onChange={(event) => updateRole(index, "name", event.target.value)}
                  />
                  <small className="xp-field-help">Leave blank for a committee or board without one named person.</small>
                </label>
                <label>
                  <span>Position or board name (required)</span>
                  <input
                    value={role.title || ""}
                    placeholder="e.g. Director of Research and Publications"
                    maxLength={160}
                    required
                    onChange={(event) => updateRole(index, "title", event.target.value)}
                  />
                </label>
                <label>
                  <span>Short chart label (required)</span>
                  <input
                    value={role.label || ""}
                    placeholder="e.g. Director"
                    maxLength={120}
                    required
                    onChange={(event) => updateRole(index, "label", event.target.value)}
                  />
                  <small className="xp-field-help">A compact label used where the full position would not fit.</small>
                </label>
                <label>
                  <span>Office or unit (required)</span>
                  <input
                    value={role.caption || ""}
                    placeholder="e.g. Research & Publications"
                    maxLength={120}
                    required
                    onChange={(event) => updateRole(index, "caption", event.target.value)}
                  />
                </label>
              </div>
            </OrganizationRoleDetails>
          );
        })}
      </div>
      {!roles.length ? (
        <p className="xp-field-error">The organizational chart roles could not be loaded. Refresh the studio before editing this section.</p>
      ) : null}
    </section>
  );
}

function HeroImagesField(props: {
  value: unknown;
  onChange: (value: HeroImage[]) => void;
}) {
  const defaultHero = defaultExperienceConfig.pages.landing.data.content.find((block) =>
    block.type === "HeroBlock"
  );
  const defaultImages = Array.isArray(defaultHero?.props.images)
    ? defaultHero.props.images as HeroImage[]
    : [];
  const currentImages = Array.isArray(props.value) ? props.value as HeroImage[] : [];
  const images = Array.from({ length: 4 }, (_, index) => ({
    ...(defaultImages[index] || {}),
    ...(currentImages[index] || {}),
  }));

  const updateImage = (index: number, key: keyof HeroImage, value: string) => {
    props.onChange(images.map((image, imageIndex) =>
      imageIndex === index ? { ...image, [key]: value } : image
    ));
  };

  return (
    <section className="xp-array-field" aria-labelledby="xp-hero-images-title">
      <div className="xp-array-heading">
        <span id="xp-hero-images-title">Hero background photos</span>
        <small>4 fixed slideshow slots</small>
      </div>
      <p className="xp-help-text">
        Replace each slot independently. Uploads stay in that slot's dedicated hero folder, and the public page fades through the slots in this order.
      </p>
      {images.map((image, index) => {
        const slotNumber = index + 1;
        return (
          <div className="xp-array-item" key={`hero-slot-${slotNumber}`}>
            <div className="xp-array-item-top">
              <strong>Slideshow photo {slotNumber}</strong>
              <small>Slot {slotNumber}</small>
            </div>
            <ImageUrlField
              label="Photo"
              value={image.url || ""}
              uploadKind={`hero-slot-${slotNumber}`}
              altText={image.alt}
              storageHint={`JPG, PNG, or WEBP up to 8MB. Stored in hero/slot-${slotNumber}.`}
              allowManualPath={false}
              onChange={(value) => updateImage(index, "url", value)}
            />
            <label>
              <span>Photo description</span>
              <input
                value={image.alt || ""}
                maxLength={255}
                placeholder={`Describe slideshow photo ${slotNumber}`}
                onChange={(event) => updateImage(index, "alt", event.target.value)}
              />
              <small className="xp-field-help">Required before publishing. Describe what this photo shows.</small>
            </label>
          </div>
        );
      })}
    </section>
  );
}

function OverviewPillarsField(props: {
  value: unknown;
  onChange: (value: OverviewPillar[]) => void;
}) {
  const defaultOverview = defaultExperienceConfig.pages.landing.data.content.find((block) => block.type === "OverviewBlock");
  const defaults = Array.isArray(defaultOverview?.props.pillars)
    ? defaultOverview.props.pillars as OverviewPillar[]
    : [];
  const current = Array.isArray(props.value) ? props.value as OverviewPillar[] : [];
  const pillars = defaults.map((fallback, index) => ({
    ...fallback,
    ...(current.find((item) => item?.id === fallback.id) || current[index] || {}),
    id: fallback.id,
    label: fallback.label,
  }));

  return (
    <section className="xp-array-field" aria-labelledby="xp-overview-pillars-title">
      <div className="xp-array-heading">
        <span id="xp-overview-pillars-title">Overview pillars</span>
        <small>3 fixed pillars</small>
      </div>
      <p className="xp-help-text">
        Pillar names, icons, order, and behavior stay locked. Edit only the explanatory text shown when visitors focus a pillar.
      </p>
      {pillars.map((pillar, index) => (
        <div className="xp-array-item" key={pillar.id || index}>
          <div className="xp-array-item-top">
            <strong>{pillar.label}</strong>
            <small>Structure locked</small>
          </div>
          <label>
            <span>Description</span>
            <textarea
              value={pillar.description || ""}
              maxLength={320}
              onChange={(event) => props.onChange(pillars.map((item, itemIndex) =>
                itemIndex === index ? { ...item, description: event.target.value } : item
              ))}
            />
            <small className="xp-field-help">Up to 320 characters.</small>
          </label>
        </div>
      ))}
    </section>
  );
}

function createFaqId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`.slice(0, 96);
}

function FaqCategoriesField(props: {
  value: unknown;
  onChange: (value: FaqCategory[]) => void;
}) {
  const categories = Array.isArray(props.value) ? props.value as FaqCategory[] : [];
  const totalItems = categories.reduce((sum, category) => sum + (category.items?.length || 0), 0);

  const updateCategory = (index: number, update: Partial<FaqCategory>) => {
    props.onChange(categories.map((category, categoryIndex) => categoryIndex === index ? { ...category, ...update } : category));
  };
  const updateItem = (categoryIndex: number, itemIndex: number, update: Partial<FaqItem>) => {
    props.onChange(categories.map((category, currentCategoryIndex) => currentCategoryIndex === categoryIndex
      ? { ...category, items: category.items.map((item, currentItemIndex) => currentItemIndex === itemIndex ? { ...item, ...update } : item) }
      : category));
  };
  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    props.onChange(next);
  };
  const moveItem = (categoryIndex: number, itemIndex: number, direction: -1 | 1) => {
    const category = categories[categoryIndex];
    if (!category) return;
    const target = itemIndex + direction;
    if (target < 0 || target >= category.items.length) return;
    const items = [...category.items];
    const [item] = items.splice(itemIndex, 1);
    items.splice(target, 0, item);
    updateCategory(categoryIndex, { items });
  };
  const addCategory = () => {
    if (categories.length >= FAQ_CATEGORY_LIMITS.max) return;
    props.onChange([...categories, { id: createFaqId("faq-category"), label: "New category", items: [{ id: createFaqId("faq-item"), question: "New question", answer: "Write a plain-text answer here." }] }]);
  };
  const addItem = (categoryIndex: number) => {
    if (totalItems >= FAQ_CATEGORY_LIMITS.maxTotalItems || (categories[categoryIndex]?.items.length || 0) >= FAQ_CATEGORY_LIMITS.maxItems) return;
    const category = categories[categoryIndex];
    if (!category) return;
    updateCategory(categoryIndex, { items: [...category.items, { id: createFaqId("faq-item"), question: "New question", answer: "Write a plain-text answer here." }] });
  };

  return (
    <section className="xp-array-field xp-faq-editor" aria-labelledby="xp-faq-categories-title">
      <div className="xp-array-heading">
        <span id="xp-faq-categories-title">FAQ categories and questions</span>
        <small>{categories.length} categories · {totalItems} questions</small>
      </div>
      <p className="xp-help-text">Answers are plain text. Categories and questions can be reordered; their IDs stay stable so public links and saved drafts remain consistent.</p>
      <div className="xp-faq-editor__categories">
        {categories.map((category, categoryIndex) => (
          <details className="xp-array-item xp-faq-editor__category" key={category.id}>
            <summary>
              <strong>{category.label || `Category ${categoryIndex + 1}`}</strong>
              <small>{category.items.length} questions</small>
            </summary>
            <div className="xp-faq-editor__category-body">
              <label>
                <span>Category name</span>
                <input value={category.label} maxLength={80} onChange={(event) => updateCategory(categoryIndex, { label: event.currentTarget.value })} />
              </label>
              <div className="xp-faq-editor__controls" aria-label={`Move or remove ${category.label || "category"}`}>
                <button type="button" className="xp-array-control" onClick={() => moveCategory(categoryIndex, -1)} disabled={categoryIndex === 0}>Move up</button>
                <button type="button" className="xp-array-control" onClick={() => moveCategory(categoryIndex, 1)} disabled={categoryIndex === categories.length - 1}>Move down</button>
                <button type="button" className="xp-array-control is-danger" onClick={() => props.onChange(categories.filter((_, index) => index !== categoryIndex))} disabled={categories.length <= FAQ_CATEGORY_LIMITS.min}>Remove category</button>
              </div>
              <div className="xp-faq-editor__items">
                {category.items.map((item, itemIndex) => (
                  <div className="xp-array-item xp-faq-editor__item" key={item.id}>
                    <div className="xp-faq-editor__item-heading"><strong>Question {itemIndex + 1}</strong><small>Plain text</small></div>
                    <label>
                      <span>Question</span>
                      <input value={item.question} maxLength={180} onChange={(event) => updateItem(categoryIndex, itemIndex, { question: event.currentTarget.value })} />
                    </label>
                    <label>
                      <span>Answer</span>
                      <textarea value={item.answer} maxLength={2000} rows={5} onChange={(event) => updateItem(categoryIndex, itemIndex, { answer: event.currentTarget.value })} />
                    </label>
                    <div className="xp-faq-editor__controls">
                      <button type="button" className="xp-array-control" onClick={() => moveItem(categoryIndex, itemIndex, -1)} disabled={itemIndex === 0}>Move up</button>
                      <button type="button" className="xp-array-control" onClick={() => moveItem(categoryIndex, itemIndex, 1)} disabled={itemIndex === category.items.length - 1}>Move down</button>
                      <button type="button" className="xp-array-control is-danger" onClick={() => updateCategory(categoryIndex, { items: category.items.filter((_, index) => index !== itemIndex) })} disabled={category.items.length <= 1}>Remove question</button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="xp-studio-button" onClick={() => addItem(categoryIndex)} disabled={totalItems >= FAQ_CATEGORY_LIMITS.maxTotalItems || category.items.length >= FAQ_CATEGORY_LIMITS.maxItems}>Add question</button>
            </div>
          </details>
        ))}
      </div>
      <button type="button" className="xp-studio-button" onClick={addCategory} disabled={categories.length >= FAQ_CATEGORY_LIMITS.max}>Add category</button>
    </section>
  );
}

function FieldEditor(props: {
  name: string;
  field: any;
  value: any;
  onChange: (value: any) => void;
}) {
  const { name, field, value, onChange } = props;
  const label = friendlyLabel(name);
  const help = fieldHelp[name];
  const helpLine = help ? <small className="xp-field-help">{help}</small> : null;
  const maxLength = name === "eyebrow" ? 80 : name === "title" ? 140 : name === "summary" ? 600 : undefined;

  if (field.type === "text" && (name === "url" || name === "photo" || name.endsWith("Url"))) {
    return <ImageUrlField label={label} value={value || ""} uploadKind={name === "photo" ? "org-chart" : undefined} onChange={onChange} />;
  }

  if (field.type === "array" && name === "roles") {
    return <OrganizationRolesField value={value} onChange={onChange} />;
  }

  if (field.type === "array" && name === "images") {
    return <HeroImagesField value={value} onChange={onChange} />;
  }

  if (field.type === "array" && name === "pillars") {
    return <OverviewPillarsField value={value} onChange={onChange} />;
  }

  if (field.type === "array" && name === "categories") {
    return <FaqCategoriesField value={value} onChange={onChange} />;
  }

  if (field.type === "textarea") {
    return (
      <label>
        <span>{label}</span>
        <textarea value={value || ""} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
        {helpLine}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label>
        <span>{label}</span>
        <select value={value || ""} onChange={(event) => onChange(event.target.value)}>
          {(field.options || []).map((option: any) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {helpLine}
      </label>
    );
  }

  if (field.type === "array") {
    const items = Array.isArray(value) ? value : [];
    const updateItem = (index: number, key: string, itemValue: any) => {
      onChange(items.map((item: any, itemIndex: number) =>
        itemIndex === index ? { ...item, [key]: itemValue } : item
      ));
    };

    return (
      <div className="xp-array-field">
        <div className="xp-array-heading">
          <span>{label}</span>
          <small>Fixed list</small>
        </div>
        {items.map((item: any, index: number) => (
          <div className="xp-array-item" key={index}>
            <div className="xp-array-item-top"><strong>{field.getItemSummary ? field.getItemSummary(item, index) : `${label} ${index + 1}`}</strong></div>
            {Object.entries(field.arrayFields || {}).filter(([itemKey]) => itemKey !== "href").map(([itemKey, itemField]: [string, any]) => (
              <FieldEditor
                key={itemKey}
                name={itemKey}
                field={itemField}
                value={item?.[itemKey]}
                onChange={(itemValue) => updateItem(index, itemKey, itemValue)}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <label>
      <span>{label}</span>
      <input
        value={value || ""}
        maxLength={maxLength}
        placeholder={fieldPlaceholders[name] || ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {helpLine}
    </label>
  );
}

function BlockInspector(props: {
  block?: BlockData;
  onChange: (props: Record<string, any>) => void;
}) {
  if (!props.block) {
    return <div className="xp-empty-state">Choose a section from the left to edit its text, links, images, and layout.</div>;
  }

  const component = componentMap[props.block.type] || {};
  const allowed = editableFields[props.block.type] ?? [];
  const fields = Object.entries(component.fields || {}).filter(([name]) => allowed.includes(name));

  return (
    <div className="xp-field-stack">
      <div className="xp-inspector-title">
        <span>{sectionName(props.block.type)}</span>
      </div>
      {fields.map(([name, field]: [string, any]) => (
        <FieldEditor
          key={name}
          name={name}
          field={field}
          value={props.block?.props?.[name]}
          onChange={(value) => props.onChange({ ...(props.block?.props || {}), [name]: value })}
        />
      ))}
      {!fields.length ? <p className="xp-help-text">This system section is locked and has no editable content.</p> : null}
    </div>
  );
}

function AssetUploader() {
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);

  useEffect(() => {
    const uppy = new Uppy({
      restrictions: {
        maxFileSize: 8 * 1024 * 1024,
        allowedFileTypes: ["image/jpeg", "image/png", "image/webp"],
      },
      meta: {
        kind: "branding",
      },
    })
      .use(Dashboard, {
        target: "#experience-uppy",
        inline: true,
        height: 220,
        proudlyDisplayPoweredByUppy: false,
        note: "JPG, PNG, or WEBP up to 8MB.",
      })
      .use(XHRUpload, {
        endpoint: "/api/admin/experience/assets",
        fieldName: "file",
        formData: true,
        withCredentials: true,
      });

    uppy.on("complete", (result) => {
      const assets = (result.successful ?? [])
        .map((file: any) => file.response?.body?.asset)
        .filter(Boolean);
      if (assets.length) setUploadedAssets((current) => [...assets, ...current]);
    });

    return () => {
      uppy.destroy();
    };
  }, []);

  return (
    <div className="xp-assets">
      <div id="experience-uppy" />
      {uploadedAssets.length ? (
        <div className="xp-asset-results">
          {uploadedAssets.map((asset, index) => (
            <div className="xp-copy-row" key={`${asset.file_path}-${index}`}>
              <input readOnly value={asset.file_path || ""} />
              <button type="button" onClick={() => navigator.clipboard?.writeText(asset.file_path || "")}>Copy</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="xp-help-text">After you upload a reusable picture, press Copy next to it and paste it into a compatible picture box. Hero photos should be uploaded directly in their fixed slideshow slots.</p>
      )}
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<ExperienceConfig>(() => cloneConfig(defaultExperienceConfig));
  const [activePage, setActivePage] = useState<PageKey>("landing");
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
  const [status, setStatus] = useState("Loading your pages…");
  const [version, setVersion] = useState<number | undefined>();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [busy, setBusy] = useState<"save" | "publish" | "preview" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [confirmState, setConfirmState] = useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Undo/redo: bounded snapshots of the whole config. Typing bursts are
  // coalesced so one undo step reverts a phrase, not a keystroke.
  const historyRef = useRef<{ past: ExperienceConfig[]; future: ExperienceConfig[] }>({ past: [], future: [] });
  const lastHistoryPushRef = useRef(0);
  const [, setHistoryTick] = useState(0);

  const pushHistory = (snapshot: ExperienceConfig, force = false) => {
    historyRef.current.future = [];
    const now = Date.now();
    if (!force && now - lastHistoryPushRef.current < 700) {
      setHistoryTick((tick) => tick + 1);
      return;
    }
    lastHistoryPushRef.current = now;
    historyRef.current.past.push(cloneConfig(snapshot));
    if (historyRef.current.past.length > 60) historyRef.current.past.shift();
    setHistoryTick((tick) => tick + 1);
  };

  const undo = () => {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(cloneConfig(config));
    lastHistoryPushRef.current = 0;
    setConfig(previous);
    setDirty(true);
    setStatus("Undone");
    setHistoryTick((tick) => tick + 1);
  };

  const redo = () => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(cloneConfig(config));
    lastHistoryPushRef.current = 0;
    setConfig(next);
    setDirty(true);
    setStatus("Redone");
    setHistoryTick((tick) => tick + 1);
  };

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  const allowedBlocks = activePage === "landing" ? landingBlocks : activePage === "login" ? loginBlocks : faqBlocks;
  const page = config.pages[activePage];
  const pageBlocks = page.data.content as BlockData[];
  const selectedBlock = pageBlocks[selectedIndex];

  const loadVersions = async () => {
    const payload = await fetchJson<{ versions: VersionSummary[] }>("/api/admin/experience/versions?limit=8");
    setVersions(payload.versions);
  };

  useEffect(() => {
    fetchJson<DraftPayload>("/api/admin/experience/draft")
      .then((payload) => {
        const parsed = ExperienceConfigSchema.parse(payload.config);
        setConfig(parsed);
        setVersion(payload.version);
        setStatus("All changes saved");
        applyThemeVars(EXPERIENCE_FIXED_THEME);
      })
      .catch((error) => {
        console.error("Failed to load draft:", error);
        setStatus("Couldn't load your saved draft — you're seeing the standard page. Refresh to try again.");
        applyThemeVars(EXPERIENCE_FIXED_THEME);
      });
    loadVersions().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchJson<{ user?: { name?: string; username?: string } }>("/api/auth/get-session"),
      fetchJson<{ first_name?: string; middle_name?: string; last_name?: string }>("/api/user/profile"),
    ]).then(([session, profile]) => {
      if (!mounted) return;
      const profileName = [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ").trim();
      setIdentityName(profileName || session.user?.name || session.user?.username || "Administrator");
    }).catch(() => { if (mounted) setIdentityName("Administrator"); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => { applyThemeVars(EXPERIENCE_FIXED_THEME); }, []);

  useEffect(() => {
    setSelectedIndex(0);
    setInspectorTab("content");
  }, [activePage]);

  // Set when the user has already confirmed leaving via the Exit button, so
  // the browser's own beforeunload dialog doesn't ask a second time.
  const leaveConfirmed = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (leaveConfirmed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  const exitStudio = () => {
    if (!dirty) {
      window.location.assign("/admin/Components/admin_settings.html");
      return;
    }
    setConfirmState({
      title: "Leave without saving?",
      body: <p>You have unsaved changes. If you leave now, they will be lost.</p>,
      confirmLabel: "Leave studio",
      danger: true,
      onConfirm: () => {
        leaveConfirmed.current = true;
        window.location.assign("/admin/Components/admin_settings.html");
      },
    });
  };

  // Cmd/Ctrl+Z to undo, Shift+Cmd/Ctrl+Z or Ctrl+Y to redo — except while
  // typing in a field, where the browser's own text undo should win.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Autosave the draft half a minute after the last change
  useEffect(() => {
    if (!dirty || busy !== null) return;
    const timer = setTimeout(() => {
      persistDraft()
        .then(() => setStatus("Saved automatically"))
        .catch((error) => {
          console.error("Autosave failed:", error);
          setStatus("Couldn't save automatically — click Save draft");
        });
    }, 25000);
    return () => clearTimeout(timer);
  }, [dirty, busy, config]);

  const guardrails = useMemo(() => getGuardrails(config, activePage), [config, activePage]);

  // The canvas is the real public page in an iframe; the draft config is
  // streamed into it so the preview matches what visitors will see exactly.
  const canvasRef = useRef<HTMLIFrameElement>(null);
  const canvasSrc = activePage === "login"
    ? "/log-in.html?experienceCanvas=1"
    : activePage === "faq"
      ? "/faq.html?experienceCanvas=1"
      : "/index.html?experienceCanvas=1";

  const postConfigToCanvas = () => {
    canvasRef.current?.contentWindow?.postMessage(
      { type: "experience-config", config },
      window.location.origin,
    );
  };

  useEffect(() => {
    postConfigToCanvas();
  }, [config, activePage]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "experience-canvas-ready") postConfigToCanvas();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  const setNextConfig = (next: ExperienceConfig, nextStatus = "You have unsaved changes") => {
    pushHistory(config);
    next.updatedAt = new Date().toISOString();
    setConfig(next);
    setStatus(nextStatus);
    setDirty(true);
  };

  const updatePageBlocks = (blocks: BlockData[]) => {
    const next = cloneConfig(config);
    next.pages[activePage].data.content = blocks as any;
    setNextConfig(next);
  };

  const updateSelectedBlock = (nextProps: Record<string, any>) => {
    if (!selectedBlock) return;
    updatePageBlocks(pageBlocks.map((block, index) =>
      index === selectedIndex ? { ...block, props: nextProps } : block
    ));
  };

  const addBlock = (type: string) => {
    const component = componentMap[type] || {};
    const nextBlock = {
      type,
      props: {
        ...(component.defaultProps || {}),
        id: `${type.replace(/Block$/, "").toLowerCase()}-${Date.now()}`,
      },
    };
    updatePageBlocks([...pageBlocks, nextBlock]);
    setSelectedIndex(pageBlocks.length);
    setInspectorTab("content");
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pageBlocks.length) return;
    const nextBlocks = [...pageBlocks];
    const [block] = nextBlocks.splice(index, 1);
    nextBlocks.splice(target, 0, block);
    updatePageBlocks(nextBlocks);
    setSelectedIndex(target);
  };

  const duplicateBlock = (index: number) => {
    const block = pageBlocks[index];
    if (!block) return;
    const nextBlock = JSON.parse(JSON.stringify(block));
    nextBlock.props = {
      ...nextBlock.props,
      id: `${nextBlock.props?.id || block.type}-${Date.now()}`,
    };
    updatePageBlocks([...pageBlocks.slice(0, index + 1), nextBlock, ...pageBlocks.slice(index + 1)]);
    setSelectedIndex(index + 1);
  };

  const deleteBlock = (index: number) => {
    const block = pageBlocks[index];
    if (!block) return;
    setConfirmState({
      title: `Delete “${sectionName(block.type)}”?`,
      body: <p>The section is removed from this page. If you change your mind, press Undo.</p>,
      confirmLabel: "Delete section",
      danger: true,
      onConfirm: () => {
        updatePageBlocks(pageBlocks.filter((_, itemIndex) => itemIndex !== index));
        setSelectedIndex(Math.max(0, index - 1));
      },
    });
  };

  const persistDraft = async () => {
    const parsed = ExperienceConfigSchema.parse(config);
    const result = await fetchJson<{ config: ExperienceConfig; version: number }>("/api/admin/experience/draft", {
      method: "PUT",
      body: JSON.stringify({ config: parsed }),
    });
    setConfig(ExperienceConfigSchema.parse(result.config));
    setVersion(result.version);
    setDirty(false);
    await loadVersions();
    return result;
  };

  const saveDraft = async () => {
    setBusy("save");
    setStatus("Saving…");
    try {
      await persistDraft();
      setStatus("All changes saved");
    } catch (error) {
      console.error("Save failed:", error);
      setStatus("Couldn't save — check your connection and try again");
    } finally {
      setBusy(null);
    }
  };

  const publish = () => {
    const pageWarnings = (page: PageKey) =>
      getGuardrails(config, page).filter((warning) => !warning.startsWith("No issues"));
    const allWarnings = [...pageWarnings("landing"), ...pageWarnings("login"), ...pageWarnings("faq")];

    setConfirmState({
      title: "Publish to the live site?",
      body: (
        <>
          <p>Your draft replaces the current public pages, and every visitor sees it right away.</p>
          {allWarnings.length ? (
            <>
              <p>You may want to fix these first:</p>
              <ul>
                {allWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </>
          ) : (
            <p>Checks found no issues.</p>
          )}
        </>
      ),
      confirmLabel: allWarnings.length ? "Publish anyway" : "Publish now",
      onConfirm: async () => {
        setBusy("publish");
        setStatus("Publishing…");
        try {
          await persistDraft();
          const result = await fetchJson<{ version: number }>("/api/admin/experience/publish", {
            method: "POST",
            body: JSON.stringify({}),
          });
          setVersion(result.version);
          setStatus("Published — the live site is updated");
          await loadVersions();
        } catch (error) {
          console.error("Publish failed:", error);
          setStatus("Couldn't publish — please try again");
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const previewDraft = async () => {
    setBusy("preview");
    setStatus("Saving your draft…");
    try {
      await persistDraft();
      setStatus("All changes saved");
      const target = activePage === "login" ? "/log-in.html" : activePage === "faq" ? "/faq.html" : "/index.html";
      window.open(`${target}?experiencePreview=draft`, "_blank");
    } catch (error) {
      console.error("Preview failed:", error);
      setStatus("Couldn't open the preview — please try again");
    } finally {
      setBusy(null);
    }
  };

  const formatWhen = (iso?: string | null) => {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  const rollback = (item: VersionSummary) => {
    const when = formatWhen(item.updatedAt);
    setConfirmState({
      title: "Restore this version?",
      body: (
        <p>
          Your draft becomes the version saved {when || "earlier"}. Nothing goes live until you
          publish, and you can undo this.
        </p>
      ),
      confirmLabel: "Restore version",
      onConfirm: async () => {
        try {
          const result = await fetchJson<{ config: ExperienceConfig; version: number; sourceVersion: number }>("/api/admin/experience/rollback", {
            method: "POST",
            body: JSON.stringify({ versionId: item.id }),
          });
          const parsed = ExperienceConfigSchema.parse(result.config);
          pushHistory(config, true);
          setConfig(parsed);
          setVersion(result.version);
          setDirty(false);
          setStatus("Version restored — click Publish to make it live");
          await loadVersions();
        } catch (error) {
          console.error("Restore failed:", error);
          setStatus("Couldn't restore that version — please try again");
        }
      },
    });
  };

  const applyRecipe = (recipe: string) => {
    setConfirmState({
      title: `Use the “${recipe}” starter?`,
      body: <p>It replaces the sections on your pages with the starter layout. If you change your mind, press Undo.</p>,
      confirmLabel: "Use starter",
      onConfirm: () => {
        const next = recipe === "Current PeAS" ? cloneConfig(defaultExperienceConfig) : buildRecipe(recipe, config);
        setNextConfig(next, "Starter applied — press Undo to go back");
      },
    });
  };

  return (
    <div className="xp-studio-shell">
      <header className="xp-studio-topbar">
        <button
          type="button"
          className="xp-studio-exit"
          onClick={exitStudio}
          title="Exit to PeAS Admin"
          aria-label="Exit to Admin"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6l6 6" />
          </svg>
          <span>Exit to Admin</span>
        </button>
        <div className="xp-studio-brand">
          <strong>PeAS Experience Studio</strong>
          <span>
            {dirty ? <em className="xp-dirty-dot" aria-hidden="true" /> : null}
            {status}
          </span>
        </div>

        <div className="xp-studio-center-actions">
          <div className="xp-studio-segment" aria-label="Page">
            <button className={activePage === "landing" ? "is-active" : ""} onClick={() => setActivePage("landing")}>{pageNames.landing}</button>
            <button className={activePage === "login" ? "is-active" : ""} onClick={() => setActivePage("login")}>{pageNames.login}</button>
            <button className={activePage === "faq" ? "is-active" : ""} onClick={() => setActivePage("faq")}>{pageNames.faq}</button>
          </div>
          <div className="xp-studio-segment" aria-label="Device preview">
            {(["desktop", "tablet", "mobile"] as DeviceKey[]).map((item) => (
              <button key={item} className={device === item ? "is-active" : ""} onClick={() => setDevice(item)} title={`See how the page looks on a ${item === "desktop" ? "computer" : item}`}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="xp-studio-actions">
          <div className="xp-studio-identity" aria-label="Authenticated identity">
            <strong>{identityName || "Loading identity…"}</strong>
            <small>Administrator</small>
          </div>
          <button className="xp-studio-button" onClick={undo} disabled={!canUndo} title="Undo the last change (Cmd/Ctrl+Z)">
            Undo
          </button>
          <button className="xp-studio-button" onClick={redo} disabled={!canRedo} title="Redo the change you undid">
            Redo
          </button>
          <button className="xp-studio-button" onClick={previewDraft} disabled={busy !== null} title="Saves your draft and opens it in a new tab">
            {busy === "preview" ? "Opening…" : "Preview draft"}
          </button>
          <button className="xp-studio-button primary" onClick={saveDraft} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button className="xp-studio-button gold" onClick={publish} disabled={busy !== null} title="Puts your draft on the public site">
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      <div className="xp-simple-studio">
        <aside className="xp-section-list" aria-label="Page sections">
          <div className="xp-panel-heading">
            <span>{pageNames[activePage]} sections</span>
            <small>{pageBlocks.length} {pageBlocks.length === 1 ? "section" : "sections"}</small>
          </div>

          <div className="xp-block-stack">
            {pageBlocks.map((block, index) => (
              <button
                key={`${block.type}-${block.props?.id || index}`}
                className={selectedIndex === index ? "is-active" : ""}
                type="button"
                onClick={() => {
                  setSelectedIndex(index);
                  setInspectorTab("content");
                }}
              >
                <span>{sectionName(block.type)}</span>
                <small>{block.props?.title || block.props?.text || block.props?.brandText || "Click to edit"}</small>
              </button>
            ))}
          </div>

          <p className="xp-locked-layout-note">Layout and section order are managed by the PeAS application. Select a section to edit its approved text and photos.</p>

          <details className="xp-sidebar-details">
            <summary>Version history{version ? ` (v${version})` : ""}</summary>
            <div className="xp-mini-list">
              {versions.map((item) => (
                <button key={item.id} type="button" onClick={() => rollback(item)} disabled={item.status === "published"}>
                  <strong>{item.status === "published" ? "Currently live" : "Restore this version"}</strong>
                  <small>
                    {formatWhen(item.publishedAt || item.updatedAt) || `Version ${item.version}`}
                    {(item.publishedBy || item.updatedBy) ? ` · by ${item.publishedBy || item.updatedBy}` : ""}
                  </small>
                </button>
              ))}
            </div>
          </details>
        </aside>

        <main className="xp-preview-workspace" aria-label="Live page preview">
          <div className="xp-preview-toolbar">
            <div>
              <strong>{page.title}</strong>
              <span>{activePage === "landing" ? "This is your public home page" : activePage === "faq" ? "This is your public FAQ page" : "This is your public sign-in page"}</span>
            </div>
            <span className="xp-layout-locked-badge">Layout locked</span>
          </div>
          <div className={`xp-preview-frame ${device} is-${activePage}`}>
            <iframe
              ref={canvasRef}
              title="Live page preview"
              src={canvasSrc}
              onLoad={postConfigToCanvas}
            />
          </div>
        </main>

        <aside className="xp-inspector" aria-label="Editor inspector">
          <div className="xp-inspector-tabs">
            {([
              ["content", "Edit"],
              ["checks", "Checks"],
              ["assets", "Images"],
            ] as Array<[InspectorTab, string]>).map(([key, label]) => (
              <button key={key} className={inspectorTab === key ? "is-active" : ""} type="button" onClick={() => setInspectorTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {inspectorTab === "content" ? <BlockInspector block={selectedBlock} onChange={updateSelectedBlock} /> : null}
          {inspectorTab === "checks" ? (
            <ul className="xp-guardrail-list">
              {guardrails.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          {inspectorTab === "assets" ? <AssetUploader /> : null}
        </aside>
      </div>

      {confirmState ? (
        <div className="xp-modal-overlay" role="dialog" aria-modal="true" aria-label={confirmState.title}>
          <div className="xp-modal">
            <h2>{confirmState.title}</h2>
            <div className="xp-modal-body">{confirmState.body}</div>
            <div className="xp-modal-actions">
              <button type="button" className="xp-studio-button" onClick={() => setConfirmState(null)}>
                Go back
              </button>
              <button
                type="button"
                className={`xp-studio-button ${confirmState.danger ? "danger" : "primary"}`}
                onClick={() => {
                  const action = confirmState.onConfirm;
                  setConfirmState(null);
                  action();
                }}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
