import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import XHRUpload from "@uppy/xhr-upload";
import React, { createContext, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  defaultExperienceConfig,
  FAQ_CATEGORY_LIMITS,
  EXPERIENCE_FIXED_THEME,
  ExperienceConfig,
  ExperienceConfigSchema,
  type ExperiencePageKey,
  getExperiencePublishIssues,
  migrateExperienceConfigToV6,
} from "../../../Deno/shared/experienceConfig";
import { experiencePuckConfig } from "../shared/puckConfig";

type PageKey = ExperiencePageKey;
type DeviceKey = "desktop" | "tablet" | "mobile";
const previewWidths: Record<DeviceKey, number> = { desktop: 1440, tablet: 820, mobile: 390 };
type Screen = "pages" | "sections" | "edit" | "review" | "tools";
type EditorLocation = { page: PageKey; section: string };
const UploadActivity = createContext<(change: number) => void>(() => {});

type DraftPayload = {
  config: ExperienceConfig;
  publishedConfig: ExperienceConfig;
  version: number;
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

const componentMap = experiencePuckConfig.components as Record<string, any>;

const pages = {
  landing: { name: "Home page", description: "Welcome message, photos, mission, and office team.", url: "/index.html" },
  login: { name: "Sign-in page", description: "Branding, logos, and password reset instructions.", url: "/log-in.html" },
  faq: { name: "Frequently asked questions", description: "Questions, answers, and how to contact the office.", url: "/faq.html" },
};
const pageKeys = Object.keys(pages) as PageKey[];

const sections: Record<string, { name: string; description: string; preview: string }> = {
  HeroBlock: { name: "Welcome message and photos", description: "The headline, introduction, and slideshow at the top of Home.", preview: ".peas-public-hero" },
  OverviewBlock: { name: "What is PeAS?", description: "How PeAS helps visitors preserve, discover, and access research.", preview: "#peas-overview-title" },
  QuickLinksBlock: { name: "Explore PeAS links", description: "The text on links to the mission, team, and research agenda.", preview: "#quick-links-title" },
  RichTextBlock: { name: "Our mission", description: "The heading and introduction under Mission.", preview: "#mission-title" },
  ImageFeatureBlock: { name: "Organizational chart", description: "Office roles, names, and profile photos.", preview: "#org-title" },
  ResearchAgendaBlock: { name: "Research agenda introduction", description: "The heading and introduction above the official research priorities.", preview: "#agenda-title" },
  CtaBlock: { name: "Contact invitation", description: "The message and button that invite visitors to contact the office.", preview: "#public-contact-cta-title" },
  FooterLinksBlock: { name: "Footer", description: "PeAS manages the footer across the website.", preview: "footer" },
  LoginShellBlock: { name: "Sign-in content", description: "Branding and password reset copy.", preview: ".peas-login-heading" },
  FaqBlock: { name: "Questions and answers", description: "Manage questions, answers, and related page copy.", preview: ".peas-faq-content" },
};

const sectionName = (type: string) => sections[type]?.name ?? "Website section";
const editableFields: Record<string, readonly string[]> = {
  HeroBlock: ["eyebrow", "title", "body", "images"],
  OverviewBlock: ["eyebrow", "title", "summary", "pillars"],
  QuickLinksBlock: ["title", "links"],
  RichTextBlock: ["title", "body"],
  ImageFeatureBlock: ["title", "body", "roles"],
  ResearchAgendaBlock: ["title", "body"],
  CtaBlock: ["title", "body", "label"],
  LoginShellBlock: ["brandText", "forgotPasswordTitle", "forgotPasswordSubtitle", "footerText", "backgroundImageUrl", "graphicLogoUrl", "logoUrl"],
  FaqBlock: ["categories", "eyebrow", "title", "description", "contactTitle", "contactBody", "contactLabel"],
};

const locationKey = "peas-experience-editor-location";

class ExperienceRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

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
    throw new ExperienceRequestError(data.details || data.error || `Request failed: ${response.status}`, response.status);
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

function ImageUrlField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  uploadKind?: string;
  altText?: string;
  allowManualPath?: boolean;
  onReplace?: (value: string) => void;
  clearLabel?: string;
  onClear?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const reportUpload = useContext(UploadActivity);
  const replaceImage = props.onReplace ?? props.onChange;
  const changeImage = useRef(replaceImage);
  useLayoutEffect(() => { changeImage.current = replaceImage; }, [replaceImage]);
  const uploadId = useId();
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    reportUpload(1);
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
      if (!data.asset?.file_path) throw new Error("The upload did not return a photo. Try replacing it again.");
      changeImage.current(data.asset.file_path);
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
      reportUpload(-1);
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
      <button
        className="xp-studio-button"
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-label={`${uploading ? "Uploading" : props.value ? "Replace photo" : "Upload photo"} · ${props.label}`}
        aria-describedby={uploadId}
      >
        {uploading ? "Uploading…" : props.value ? "Replace photo" : "Upload photo"}
      </button>
      {props.allowManualPath !== false && (
        <details>
          <summary>Use an existing PeAS image</summary>
          <label>
            <span>{props.label} path</span>
            <input value={props.value || ""} onChange={(event) => props.onChange(event.target.value)} />
          </label>
        </details>
      )}
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
        ? <small className="xp-field-error" role="alert" id={uploadId}>{uploadError}</small>
        : <small className="xp-field-help" id={uploadId}>JPG, PNG, or WebP up to 8 MB.</small>}
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
                  onReplace={(value) => props.onChange(roles.map((item, roleIndex) =>
                    roleIndex === index ? { ...item, photo: value, photoAlt: "" } : item
                  ))}
                />
                <label>
                  <span>Photo description</span>
                  <input
                    id={`roles-${index}-photoAlt`}
                    aria-describedby={`roles-${index}-photoAlt-help`}
                    value={role.photoAlt || ""}
                    placeholder={fieldPlaceholders.photoAlt}
                    maxLength={255}
                    onChange={(event) => updateRole(index, "photoAlt", event.target.value)}
                  />
                  <small className="xp-field-help" id={`roles-${index}-photoAlt-help`}>Required when a photo is used. Describe what the photo shows.</small>
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

  const updateImage = (index: number, update: Partial<HeroImage>) => {
    props.onChange(images.map((image, imageIndex) =>
      imageIndex === index ? { ...image, ...update } : image
    ));
  };

  return (
    <details className="xp-slideshow">
      <summary>Welcome slideshow <small>4 photos</small></summary>
      <div className="xp-array-field">
        <p className="xp-help-text">Replace any of the four photos shown in the Home page slideshow.</p>
        {images.map((image, index) => {
          const slotNumber = index + 1;
          return (
            <div className="xp-array-item" key={`hero-slot-${slotNumber}`}>
              <div className="xp-array-item-top">
                <strong>Slideshow photo {slotNumber}</strong>

              </div>
              <ImageUrlField
                label={`Slideshow photo ${slotNumber}`}
                value={image.url || ""}
                uploadKind={`hero-slot-${slotNumber}`}
                altText={image.alt}
                allowManualPath={false}
                onChange={(value) => updateImage(index, { url: value, alt: "" })}
              />
              <label>
                <span>Photo description</span>
                <input
                  id={`images-${index}-alt`}
                  aria-describedby={`images-${index}-alt-help`}
                  value={image.alt || ""}
                  maxLength={255}
                  placeholder={`Describe slideshow photo ${slotNumber}`}
                  onChange={(event) => updateImage(index, { alt: event.target.value })}
                />
                <small className="xp-field-help" id={`images-${index}-alt-help`}>Required before publishing. Describe what this photo shows.</small>
              </label>
            </div>
          );
        })}
      </div>
    </details>
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
    <section className="xp-array-field xp-faq-editor" aria-labelledby="categories" id="categories-editor">
      <div className="xp-array-heading">
        <span id="categories" tabIndex={-1}>FAQ categories and questions</span>
        <small>{categories.length} categories · {totalItems} questions</small>
      </div>
      <p className="xp-help-text">Open a category and choose a question to edit its answer.</p>
      <div className="xp-faq-editor__categories">
        {categories.map((category, categoryIndex) => (
          <details className="xp-array-item xp-faq-editor__category" key={category.id}>
            <summary>
              <strong>{category.label || `Category ${categoryIndex + 1}`}</strong>
              <small>{category.items.length} {category.items.length === 1 ? "question" : "questions"}</small>
            </summary>
            <div className="xp-faq-editor__category-body">
              <label>
                <span>Category name</span>
                <input id={`categories-${categoryIndex}-label`} value={category.label} maxLength={80} onChange={(event) => updateCategory(categoryIndex, { label: event.currentTarget.value })} />
              </label>
              <div className="xp-faq-editor__controls" aria-label={`Move or remove ${category.label || "category"}`}>
                <button type="button" className="xp-array-control" onClick={() => moveCategory(categoryIndex, -1)} disabled={categoryIndex === 0}>Move up</button>
                <button type="button" className="xp-array-control" onClick={() => moveCategory(categoryIndex, 1)} disabled={categoryIndex === categories.length - 1}>Move down</button>
                <button type="button" className="xp-array-control is-danger" onClick={() => props.onChange(categories.filter((_, index) => index !== categoryIndex))} disabled={categories.length <= FAQ_CATEGORY_LIMITS.min}>Remove category</button>
              </div>
              <div className="xp-faq-editor__items">
                {category.items.map((item, itemIndex) => (
                  <details className="xp-array-item xp-faq-editor__item" key={item.id}>
                    <summary>{item.question || "Untitled question"}</summary>
                    <div className="xp-faq-editor__category-body">
                      <label>
                        <span>Question</span>
                        <input id={`categories-${categoryIndex}-items-${itemIndex}-question`} value={item.question} maxLength={180} onChange={(event) => updateItem(categoryIndex, itemIndex, { question: event.currentTarget.value })} />
                      </label>
                      <label>
                        <span>Answer</span>
                        <textarea id={`categories-${categoryIndex}-items-${itemIndex}-answer`} value={item.answer} maxLength={2000} rows={5} onChange={(event) => updateItem(categoryIndex, itemIndex, { answer: event.currentTarget.value })} />
                      </label>
                      <div className="xp-faq-editor__controls">
                        <button type="button" className="xp-array-control" onClick={() => moveItem(categoryIndex, itemIndex, -1)} disabled={itemIndex === 0}>Move up</button>
                        <button type="button" className="xp-array-control" onClick={() => moveItem(categoryIndex, itemIndex, 1)} disabled={itemIndex === category.items.length - 1}>Move down</button>
                        <button type="button" className="xp-array-control is-danger" onClick={() => updateCategory(categoryIndex, { items: category.items.filter((_, index) => index !== itemIndex) })} disabled={category.items.length <= 1}>Remove question</button>
                      </div>
                    </div>
                  </details>
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
  id?: string;
  name: string;
  field: any;
  value: any;
  onChange: (value: any) => void;
}) {
  const { name, field, value, onChange } = props;
  const label = friendlyLabel(name);
  const help = fieldHelp[name];
  const controlId = useId();
  const helpId = help ? `${controlId}-help` : undefined;
  const helpLine = help ? <small className="xp-field-help" id={helpId}>{help}</small> : null;
  const fieldId = props.id || controlId;
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
        <textarea rows={name === "title" ? 2 : 5} id={fieldId} aria-describedby={helpId} value={value || ""} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
        {helpLine}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label>
        <span>{label}</span>
        <select id={fieldId} aria-describedby={helpId} value={value || ""} onChange={(event) => onChange(event.target.value)}>
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
        id={fieldId}
        aria-describedby={helpId}
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
  block: BlockData;
  onChange: (props: Record<string, any>) => void;
}) {
  const { block, onChange } = props;
  const fields = componentMap[block.type]?.fields ?? {};
  const allowed = editableFields[block.type] ?? [];
  const update = (name: string, value: unknown) => onChange({ ...block.props, [name]: value });

  return (
    <div className="xp-field-stack">
      {block.type === "LoginShellBlock" && (
        <p className="xp-help-text">PeAS supplies the staff sign-in heading and instructions. To see the password reset copy, open Preview and choose Forgot password.</p>
      )}
      {block.type === "ResearchAgendaBlock" && (
        <p className="xp-help-text">Update the introduction here. To change the official list, open Research Agenda in Admin Settings.</p>
      )}
      {allowed.map((name) => fields[name] && (
        <FieldEditor key={name} id={name} name={name} field={fields[name]} value={block.props[name]} onChange={(value) => update(name, value)} />
      ))}
      {block.props.imageUrl && "imageAlt" in block.props && (
        <details>
          <summary>Archived image settings</summary>
          <label>
            <span>Archived image description</span>
            <input id="imageAlt" value={block.props.imageAlt} onChange={(event) => update("imageAlt", event.target.value)} />
          </label>
        </details>
      )}
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

function readEditorLocation(): EditorLocation | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(locationKey) || "null") as EditorLocation | null;
    return stored && pageKeys.includes(stored.page) && editableFields[stored.section] ? stored : null;
  } catch {
    return null;
  }
}

function issueLabel(issue: ReturnType<typeof getExperiencePublishIssues>[number]) {
  const [, index] = issue.field.split("-");
  if (issue.field.startsWith("images-")) return `Slideshow photo ${Number(index) + 1} needs a description.`;
  if (issue.field === "imageAlt") return "The archived image needs a description.";
  return issue.message.replace("requires alternative text", "needs a description");
}

export default function App() {
  const [config, setConfig] = useState<ExperienceConfig>(defaultExperienceConfig);
  const [savedConfig, setSavedConfig] = useState(config);
  const [published, setPublished] = useState<ExperienceConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [screen, setScreen] = useState<Screen>("pages");
  const [activePage, setActivePage] = useState<PageKey>("landing");
  const [section, setSection] = useState("HeroBlock");
  const [resume, setResume] = useState(readEditorLocation);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [device, setDevice] = useState<DeviceKey>(() =>
    window.innerWidth < 640 ? "mobile" : window.innerWidth < 1100 ? "tablet" : "desktop"
  );
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "restore" | null>(null);
  const operation = useRef(false);
  const [uploads, setUploads] = useState(0);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; action: () => void } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLIFrameElement>(null);
  const lastField = useRef("");
  const leaveConfirmed = useRef(false);
  const history = useRef<{ past: ExperienceConfig[]; future: ExperienceConfig[]; lastEdit: number }>({ past: [], future: [], lastEdit: 0 });

  const dirty = config !== savedConfig;
  const working = busy !== null || uploads > 0;
  const selected = config.pages[activePage].data.content.find((block) => block.type === section);
  const issues = useMemo(() => getExperiencePublishIssues(config), [config]);
  const invalidDraft = issues.some((issue) => issue.page === "faq");
  const changes = useMemo(() => {
    if (!published || (screen !== "review" && screen !== "pages")) return [];
    const normalized = invalidDraft ? config : migrateExperienceConfigToV6(config);
    return pageKeys.flatMap((page) => normalized.pages[page].data.content
      .filter((block) => {
        const live = published.pages[page].data.content.find((item) => item.type === block.type);
        return JSON.stringify(block.props) !== JSON.stringify(live?.props);
      })
      .map((block) => ({ page, section: block.type })));
  }, [config, invalidDraft, published, screen]);

  const statusText = busy === "publish" ? "Publishing changes…" : busy === "restore" ? "Restoring draft…" : busy === "save"
    ? "Saving draft…" : uploads ? "Uploading photo…" : status || (dirty ? "Unsaved changes" : hasDraft ? "Draft saved" : "Viewing published content");

  async function loadDraft() {
    setLoadState("loading");
    setError("");
    try {
      const data = await fetchJson<DraftPayload>("/api/admin/experience/draft");
      const draft = ExperienceConfigSchema.parse(data.config);
      const live = ExperienceConfigSchema.parse(data.publishedConfig);
      setConfig(draft);
      setSavedConfig(draft);
      setPublished(live);
      setVersion(data.version);
      setHasDraft(data.status === "draft");
      setConflict(false);
      setStatus("");
      history.current = { past: [], future: [], lastEdit: 0 };
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  const loadOnMount = useEffectEvent(loadDraft);
  useEffect(() => {
    applyThemeVars(EXPERIENCE_FIXED_THEME);
    void loadOnMount();
  }, []);

  async function loadVersions() {
    setHistoryStatus("loading");
    try {
      const payload = await fetchJson<{ versions: VersionSummary[] }>("/api/admin/experience/versions?limit=8");
      setVersions(payload.versions);
      setHistoryStatus("ready");
    } catch {
      setHistoryStatus("error");
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (confirm && dialog && !dialog.open) dialog.showModal();
  }, [confirm]);

  useEffect(() => {
    if (!focusRequest) return;
    const field = document.getElementById(focusRequest.id) ?? document.getElementById("studio-title");
    if (!field) return;
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: "nearest" });
  }, [focusRequest, loadState]);

  useEffect(() => {
    if (!dirty && !working) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leaveConfirmed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, working]);

  function navigate(next: Screen, id = "studio-title") {
    setPreview(false);
    setScreen(next);
    setFocusRequest({ id });
  }

  function openSection(location: EditorLocation, field?: string) {
    setActivePage(location.page);
    setSection(location.section);
    setResume(location);
    try { sessionStorage.setItem(locationKey, JSON.stringify(location)); } catch { /* Storage is optional. */ }
    lastField.current = "";
    history.current.lastEdit = 0;
    navigate("edit", field || "studio-title");
  }

  function openPage(page: PageKey) {
    if (page === "login" || page === "faq") {
      openSection({ page, section: page === "login" ? "LoginShellBlock" : "FaqBlock" });
    } else {
      setActivePage(page);
      navigate("sections");
    }
  }

  function exit() {
    const leave = () => {
      leaveConfirmed.current = true;
      window.location.assign("/admin/Components/admin_settings.html");
    };
    if (dirty) setConfirm({ title: "Leave without saving?", body: "Changes since the last successful save will be lost.", label: "Leave studio", action: leave });
    else leave();
  }

  function updateBlock(props: Record<string, unknown>) {
    if (!selected) return;
    const now = Date.now();
    if (now - history.current.lastEdit > 700) {
      history.current.past = [...history.current.past.slice(-59), config];
    }
    history.current.lastEdit = now;
    history.current.future = [];
    setConfig({
      ...config,
      pages: {
        ...config.pages,
        [activePage]: {
          ...config.pages[activePage],
          data: {
            ...config.pages[activePage].data,
            content: config.pages[activePage].data.content.map((block) => block.type === section ? { ...block, props } : block),
          },
        },
      },
    });
    setError("");
    setStatus("");
  }

  function undoOrRedo(direction: "past" | "future") {
    if (working) return;
    const step = history.current[direction].pop();
    if (!step) return;
    history.current[direction === "past" ? "future" : "past"].push(config);
    history.current.lastEdit = 0;
    setConfig(step);
    setStatus("");
    setError("");
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (screen !== "edit" || confirm || working || !(event.metaKey || event.ctrlKey)) return;
    if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    undoOrRedo(key === "y" || event.shiftKey ? "future" : "past");
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function persistDraft() {
    const data = await fetchJson<DraftPayload>("/api/admin/experience/draft", {
      method: "PUT",
      body: JSON.stringify({ config, expectedVersion: version }),
    });
    const saved = ExperienceConfigSchema.parse(data.config);
    setConfig((current) => current === config ? saved : current);
    setSavedConfig(saved);
    setVersion(data.version);
    setHasDraft(true);
    return data.version;
  }

  async function runAction(action: NonNullable<typeof busy>, operationBody: () => Promise<void>) {
    if (operation.current || loadState !== "ready" || conflict || uploads) return;
    operation.current = true;
    setBusy(action);
    setError("");
    try {
      await operationBody();
    } catch (failure) {
      const code = failure instanceof ExperienceRequestError ? failure.status : 0;
      setConflict(code === 409);
      setError(code === 409
        ? "Another administrator or tab updated the draft. Load the latest draft to continue."
        : `Couldn't ${action === "save" ? "save the draft" : action === "publish" ? "publish the draft" : "restore this version"}. Try again.`);
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  function saveDraft() {
    if (invalidDraft) {
      navigate("review");
      return;
    }
    void runAction("save", async () => {
      await persistDraft();
      setStatus("");
    });
  }

  const autosave = useEffectEvent(() => {
    void runAction("save", async () => {
      await persistDraft();
      setStatus("");
    });
  });
  useEffect(() => {
    if (!dirty || invalidDraft || working || conflict || loadState !== "ready" || error || confirm || screen === "review") return;
    const timer = setTimeout(() => autosave(), 25000);
    return () => clearTimeout(timer);
  }, [config, dirty, invalidDraft, working, conflict, loadState, error, confirm, screen]);

  function publishChanges() {
    if (issues.length || !changes.length) return;
    void runAction("publish", async () => {
      const expectedVersion = dirty || !hasDraft ? await persistDraft() : version;
      const result = await fetchJson<DraftPayload>("/api/admin/experience/publish", {
        method: "POST",
        body: JSON.stringify({ expectedVersion }),
      });
      const live = ExperienceConfigSchema.parse(result.config);
      setConfig(live);
      setSavedConfig(live);
      setPublished(live);
      setVersion(result.version);
      setHasDraft(false);
      setStatus("Changes published. Visitors can see the updated website.");
      navigate("pages");
    });
  }

  function restore(item: VersionSummary) {
    setConfirm({
      title: `Restore version ${item.version} to the draft?`,
      body: "This replaces the current draft. Visitors will see the restored content after you review and publish it.",
      label: "Restore to draft",
      action: () => void runAction("restore", async () => {
        const data = await fetchJson<DraftPayload>("/api/admin/experience/rollback", {
          method: "POST",
          body: JSON.stringify({ versionId: item.id, expectedVersion: version }),
        });
        history.current.past = [...history.current.past.slice(-59), config];
        history.current.future = [];
        const restored = ExperienceConfigSchema.parse(data.config);
        setConfig(restored);
        setSavedConfig(restored);
        setVersion(data.version);
        setHasDraft(true);
        setStatus(`Version ${item.version} restored to the draft.`);
        navigate("review");
      }),
    });
  }

  function sendPreview(scroll: boolean) {
    const iframe = canvasRef.current;
    iframe?.contentWindow?.postMessage({ type: "experience-config", config }, window.location.origin);
    if (scroll && iframe?.contentWindow) {
      const target = iframe.contentDocument?.querySelector(sections[section]?.preview);
      if (target) iframe.contentWindow.scrollTo(0, iframe.contentWindow.scrollY + target.getBoundingClientRect().top - 96);
    }
  }

  const refreshPreview = useEffectEvent((event: MessageEvent) => {
    if (event.origin === window.location.origin && event.source === canvasRef.current?.contentWindow && event.data?.type === "experience-canvas-ready") {
      sendPreview(true);
    }
  });
  const syncPreview = useEffectEvent(() => sendPreview(false));
  useEffect(() => {
    const listener = (event: MessageEvent) => refreshPreview(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (preview) syncPreview();
  }, [config, preview]);

  useLayoutEffect(() => {
    const frame = canvasRef.current?.parentElement;
    if (!preview || !frame) return;
    const width = previewWidths[device];
    const fitPreview = () => {
      frame.style.setProperty("--preview-width", `${width}px`);
      frame.style.setProperty("--preview-scale", String(Math.min(1, frame.clientWidth / width)));
    };
    fitPreview();
    const observer = new ResizeObserver(fitPreview);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [preview, device]);

  function togglePreview() {
    setPreview(!preview);
    setFocusRequest({ id: preview ? lastField.current || "studio-title" : "preview-heading" });
  }

  const resumeLocation = resume ?? changes.find((change) => editableFields[change.section]);
  const pageName = pages[activePage].name;
  const title = screen === "pages" ? "Which page do you want to update?"
    : screen === "sections" ? `${pageName} sections`
    : screen === "review" ? "Review changes"
    : screen === "tools" ? "Version history and images"
    : sectionName(section);

  return (
    <div className="xp-studio-shell">
      <header className="xp-workspace-header">
        <button className="xp-studio-button" type="button" onClick={exit} disabled={working}>Exit to Admin</button>
        <strong>Edit website pages</strong>
        {loadState === "ready" && (
          <p role="status">
            {statusText}
          </p>
        )}
      </header>
      <main className="xp-workspace-main">
        {loadState === "loading" && <p role="status">Loading website pages…</p>}
        {loadState === "error" && (
          <div className="xp-workspace-notice">
            <h1>Couldn't load the website draft</h1>
            <p role="alert">Try loading it again before making changes.</p>
            <button className="xp-studio-button primary" type="button" onClick={() => {
              setFocusRequest({ id: "studio-title" });
              void loadDraft();
            }}>Retry</button>
          </div>
        )}
        {loadState === "ready" && <>
          {screen !== "pages" && (
            <nav aria-label="Website editor navigation" className="xp-workspace-nav">
              <button className="xp-text-button" type="button" disabled={working} onClick={() => navigate("pages")}>Website pages</button>
              {screen === "edit" && activePage === "landing" && (
                <button className="xp-text-button" type="button" disabled={working} onClick={() => navigate("sections", `section-${section}`)}>Home page sections</button>
              )}
            </nav>
          )}
          {error && <p className="xp-workspace-error" role="alert">{error}</p>}
          {conflict && (
            <button className="xp-studio-button" type="button" onClick={() => {
              const reload = () => { navigate("pages"); void loadDraft(); };
              if (dirty) setConfirm({ title: "Load the latest draft?", body: "This will discard your unsaved edits in this tab.", label: "Load draft", action: reload });
              else reload();
            }}>Load latest draft</button>
          )}
          <div className="xp-workspace-title">
            <h1 id="studio-title" tabIndex={-1}>{title}</h1>
            {screen === "edit" && activePage !== "landing" && <p>{pageName}</p>}
          </div>

          {screen === "pages" && <>
            <ul className="xp-choice-list">
              {pageKeys.map((page) => (
                <li key={page}>
                  <button className="xp-choice" type="button" onClick={() => openPage(page)}>
                    <strong>{pages[page].name}</strong>
                    <span>{pages[page].description}</span>
                  </button>
                </li>
              ))}
            </ul>
            {resumeLocation && (hasDraft || dirty) && (
              <button className="xp-studio-button" type="button" onClick={() => openSection(resumeLocation)}>
                Continue editing {pages[resumeLocation.page].name} · {sectionName(resumeLocation.section)}
              </button>
            )}
            <div className="xp-workspace-actions">
              {(dirty || hasDraft) && <button className="xp-studio-button primary" type="button" disabled={working} onClick={() => navigate("review")}>Review changes</button>}
              <button className="xp-text-button" type="button" disabled={working} onClick={() => { navigate("tools"); void loadVersions(); }}>Version history and images</button>
            </div>
          </>}

          {screen === "sections" && (
            <ul className="xp-choice-list">
              {config.pages[activePage].data.content.map((block) => (
                <li key={block.type}>
                  {editableFields[block.type]
                    ? <button id={`section-${block.type}`} className="xp-choice" type="button" onClick={() => openSection({ page: activePage, section: block.type })}>
                      <strong>{sectionName(block.type)}</strong>
                      <span>{sections[block.type]?.description}</span>
                    </button>
                    : <div className="xp-choice xp-choice-readonly">
                      <strong>{sectionName(block.type)} <small>Read-only</small></strong>
                      <span>{sections[block.type]?.description}</span>
                    </div>}
                </li>
              ))}
            </ul>
          )}

          {screen === "edit" && selected && <>
            <div className="xp-workspace-actions">
              <button className="xp-studio-button" type="button" onClick={togglePreview} disabled={working}>{preview ? "Back to editing" : "Preview"}</button>
              <button className="xp-studio-button" type="button" onClick={() => undoOrRedo("past")} disabled={working || !history.current.past.length}>Undo</button>
              <button className="xp-studio-button" type="button" onClick={() => undoOrRedo("future")} disabled={working || !history.current.future.length}>Redo</button>
            </div>
            <div className={`xp-editor-layout${preview ? " is-previewing" : ""}`}>
              <div className="xp-editor-fields" onFocusCapture={(event) => {
                if (event.target.matches("input[id], textarea[id], select[id]")) lastField.current = event.target.id;
              }}>
                <fieldset disabled={busy === "publish" || busy === "restore"}>
                  <legend className="xp-sr-only">{sectionName(section)} fields</legend>
                  <UploadActivity.Provider value={(change) => setUploads((count) => count + change)}>
                    <BlockInspector key={section} block={selected} onChange={updateBlock} />
                  </UploadActivity.Provider>
                </fieldset>
                <div className="xp-workspace-actions">
                  <button className="xp-studio-button" type="button" disabled={working || conflict || !dirty} onClick={saveDraft}>Save draft</button>
                  <button className="xp-studio-button primary" type="button" disabled={working || (!dirty && !hasDraft && !issues.length)} onClick={() => navigate("review")}>Review changes</button>
                </div>
                <p className="xp-help-text">Visitors see the published version until you publish your changes.</p>
              </div>
              {preview && (
                <section className="xp-workspace-preview" aria-labelledby="preview-heading">
                  <div className="xp-preview-controls">
                    <h2 tabIndex={-1} id="preview-heading">Draft preview</h2>
                    <label>Preview width
                      <select value={device} onChange={(event) => setDevice(event.target.value as DeviceKey)}>
                        <option value="desktop">Desktop</option>
                        <option value="tablet">Tablet</option>
                        <option value="mobile">Mobile</option>
                      </select>
                    </label>
                  </div>
                  <div className={`xp-preview-frame ${device}`}>
                    <iframe ref={canvasRef} title={`Draft preview of ${pageName}`} src={`${pages[activePage].url}?experienceCanvas=1`} onLoad={() => sendPreview(true)} />
                  </div>
                </section>
              )}
            </div>
          </>}

          {screen === "review" && <section className="xp-workspace-surface">
            <p>Publishing applies the shared draft to the public website.</p>
            {changes.length ? <ul className="xp-review-list">
              {pageKeys.filter((page) => changes.some((change) => change.page === page)).map((page) => (
                <li key={page}>
                  <strong>{pages[page].name}</strong>
                  <ul>{changes.filter((change) => change.page === page).map((change) => (
                    <li key={change.section}>
                      <button className="xp-text-button" type="button" disabled={working} onClick={() => openSection(change)}>{sectionName(change.section)}</button>
                    </li>
                  ))}</ul>
                </li>
              ))}
            </ul> : <p>The draft matches the published pages.</p>}
            {issues.length > 0 && <>
              <h2>Fix before publishing</h2>
              <ul className="xp-review-list">
                {issues.map((issue, index) => (
                  <li key={`${issue.page}-${issue.block}-${issue.field}-${index}`}>
                    <button className="xp-text-button" type="button" onClick={() => openSection({ page: issue.page, section: issue.block }, issue.field)}>
                      {pages[issue.page].name} · {sectionName(issue.block)} · {issueLabel(issue)}
                    </button>
                  </li>
                ))}
              </ul>
            </>}
            <div className="xp-workspace-actions">
              <button className="xp-studio-button" type="button" disabled={working} onClick={() => resumeLocation ? openSection(resumeLocation) : navigate("pages")}>{resumeLocation ? "Back to editing" : "Back to pages"}</button>
              <button className="xp-studio-button primary" type="button" disabled={working || conflict || !changes.length || issues.length > 0} onClick={publishChanges}>Publish changes</button>
            </div>
          </section>}

          {screen === "tools" && <div className="xp-workspace-surface">
            <h2>Version history</h2>
            {historyStatus === "loading" && <p role="status">Loading versions…</p>}
            {historyStatus === "error" && <button className="xp-studio-button" type="button" onClick={loadVersions}>Retry loading versions</button>}
            {historyStatus === "ready" && !versions.length && <p>No versions available.</p>}
            <ul className="xp-version-list">
              {versions.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>Version {item.version}</strong> · {item.status === "published" ? "Published" : item.status === "draft" ? "Saved draft" : "Archived"}
                    {(item.publishedAt || item.updatedAt) && <small>{new Date((item.publishedAt || item.updatedAt)!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</small>}
                  </span>
                  {item.status !== "published" && <button className="xp-studio-button" type="button" disabled={working || conflict} onClick={() => restore(item)} aria-label={`Restore version ${item.version} to draft`}>Restore to draft</button>}
                </li>
              ))}
            </ul>
            <details className="xp-image-tools">
              <summary>Upload reusable images</summary>
              <AssetUploader />
            </details>
          </div>}
        </>}
      </main>
      {confirm && (
        <dialog ref={dialogRef} className="xp-modal" aria-labelledby="studio-dialog-title" aria-describedby="studio-dialog-description" onClose={() => setConfirm(null)}>
          <h2 id="studio-dialog-title">{confirm.title}</h2>
          <p id="studio-dialog-description">{confirm.body}</p>
          <div className="xp-modal-actions">
            <form method="dialog"><button className="xp-studio-button" autoFocus>Go back</button></form>
            <button className="xp-studio-button primary" type="button" onClick={() => { dialogRef.current?.close(); confirm.action(); }}>{confirm.label}</button>
          </div>
        </dialog>
      )}
    </div>
  );
}
