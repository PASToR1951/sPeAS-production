import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import XHRUpload from "@uppy/xhr-upload";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, CircleCheck, CircleHelp, House,
  Image, LayoutTemplate, Monitor, PanelRight, Pencil, Redo2, Smartphone, Tablet, Type, Undo2,
} from "lucide-react";
import React, { createContext, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  defaultExperienceConfig,
  EXPERIENCE_DEFAULT_ORGANIZATION_PHOTO_POSITION,
  FAQ_CATEGORY_LIMITS,
  EXPERIENCE_EDITABLE_PAGES,
  EXPERIENCE_FIXED_THEME,
  EXPERIENCE_HERO_IMAGE_LIMIT,
  ExperienceConfig,
  ExperienceConfigSchema,
  type ExperienceOrganizationRole,
  type ExperiencePageKey,
  type ExperiencePublishIssue,
  getExperiencePublishIssues,
  migrateExperienceConfigToV6,
} from "../../../Deno/shared/experienceConfig";
import { ADMIN_COMPACT_VIEWPORT } from "../../../shared/adminViewport";
import { experiencePuckConfig } from "../shared/puckConfig";

type PageKey = ExperiencePageKey;
type DeviceKey = "desktop" | "tablet" | "mobile";
const previewDevices = [
  { value: "desktop", label: "Desktop", Icon: Monitor },
  { value: "tablet", label: "Tablet", Icon: Tablet },
  { value: "mobile", label: "Mobile", Icon: Smartphone },
] as const;
const previewWidths: Record<DeviceKey, number> = { desktop: 1440, tablet: 820, mobile: 390 };
type Screen = "pages" | "edit" | "review" | "published" | "tools";
type EditorLocation = { page: PageKey; section: string };
const UploadActivity = createContext<(change: number) => void>(() => {});
const SlideshowSelection = createContext({ index: 0, select: (_index: number) => {} });

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
  photoPosition?: ExperienceOrganizationRole["photoPosition"];
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
  faq: { name: "Frequently asked questions", description: "Questions, answers, and how to contact the office.", url: "/faq.html" },
};
const pageKeys = EXPERIENCE_EDITABLE_PAGES;

const sections: Record<string, { name: string; preview: string }> = {
  HeroBlock: { name: "Welcome message and photos", preview: ".peas-public-hero" },
  OverviewBlock: { name: "What is PeAS?", preview: "#peas-overview-title" },
  QuickLinksBlock: { name: "Explore PeAS links", preview: "#quick-links-title" },
  RichTextBlock: { name: "Our mission", preview: "#mission-title" },
  ImageFeatureBlock: { name: "Organizational chart", preview: "#org-title" },
  ResearchAgendaBlock: { name: "Research agenda introduction", preview: "#agenda-title" },
  CtaBlock: { name: "Contact invitation", preview: "#public-contact-cta-title" },
  FaqBlock: { name: "Questions and answers", preview: ".peas-faq-hero" },
};

const sectionName = (type: string) => sections[type]?.name ?? "Website section";
const editableFields: Record<string, readonly string[]> = {
  HeroBlock: ["images", "eyebrow", "title", "body"],
  OverviewBlock: ["eyebrow", "title", "summary", "pillars"],
  QuickLinksBlock: ["title", "links"],
  RichTextBlock: ["title", "body"],
  ImageFeatureBlock: ["title", "body", "roles"],
  ResearchAgendaBlock: ["title", "body"],
  CtaBlock: ["title", "body", "label"],
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
  imageUrl: "Picture",
  url: "Picture",
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

const sitePhotoTypes = "image/jpeg,image/png,image/webp";

async function uploadSitePhoto(file: File, kind: string, altText?: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", kind);
  if (altText?.trim()) body.append("altText", altText.trim());
  const response = await fetch("/api/admin/experience/assets", {
    method: "POST",
    credentials: "include",
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.details || data.error || "Upload failed");
  if (!data.asset?.file_path) throw new Error("The upload did not return a photo. Try uploading it again.");
  return data.asset.file_path;
}

function ImageUrlField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  uploadKind?: string;
  altText?: string;
  objectPosition?: string;
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
      const path = await uploadSitePhoto(file, props.uploadKind || "branding", props.altText);
      changeImage.current(path);
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
          style={props.objectPosition ? { objectPosition: props.objectPosition } : undefined}
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
        accept={sitePhotoTypes}
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
  const updateRole = (index: number, changes: Partial<OrganizationRole>) => {
    props.onChange(roles.map((role, roleIndex) =>
      roleIndex === index ? { ...role, ...changes } : role
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
          const position = role.photoPosition ?? EXPERIENCE_DEFAULT_ORGANIZATION_PHOTO_POSITION;
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
                  objectPosition={`${position.x}% ${position.y}%`}
                  clearLabel="Remove photo"
                  onClear={() => updateRole(index, { photo: "", photoAlt: "", photoPosition: undefined })}
                  onChange={(photo) => updateRole(index, { photo, photoPosition: undefined })}
                  onReplace={(photo) => updateRole(index, { photo, photoAlt: "", photoPosition: undefined })}
                />
                {role.photo ? (
                  <fieldset className="xp-org-photo-position">
                    <legend>Photo position</legend>
                    <label>
                      <span>Horizontal position</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={position.x}
                        onChange={(event) => updateRole(index, { photoPosition: { ...position, x: event.currentTarget.valueAsNumber } })}
                      />
                    </label>
                    <label>
                      <span>Vertical position</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={position.y}
                        onChange={(event) => updateRole(index, { photoPosition: { ...position, y: event.currentTarget.valueAsNumber } })}
                      />
                    </label>
                    <button
                      className="xp-text-button"
                      type="button"
                      disabled={!role.photoPosition}
                      onClick={() => updateRole(index, { photoPosition: undefined })}
                    >
                      Reset position
                    </button>
                  </fieldset>
                ) : null}
                <label>
                  <span>Photo description</span>
                  <input
                    id={`roles-${index}-photoAlt`}
                    aria-describedby={`roles-${index}-photoAlt-help`}
                    value={role.photoAlt || ""}
                    placeholder={fieldPlaceholders.photoAlt}
                    maxLength={255}
                    onChange={(event) => updateRole(index, { photoAlt: event.target.value })}
                  />
                  <small className="xp-field-help" id={`roles-${index}-photoAlt-help`}>Required when a photo is used. Describe what the photo shows.</small>
                </label>
                <label>
                  <span>Person's name</span>
                  <input
                    value={role.name || ""}
                    placeholder="e.g. Dr. Juan Dela Cruz"
                    maxLength={160}
                    onChange={(event) => updateRole(index, { name: event.target.value })}
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
                    onChange={(event) => updateRole(index, { title: event.target.value })}
                  />
                </label>
                <label>
                  <span>Short chart label (required)</span>
                  <input
                    value={role.label || ""}
                    placeholder="e.g. Director"
                    maxLength={120}
                    required
                    onChange={(event) => updateRole(index, { label: event.target.value })}
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
                    onChange={(event) => updateRole(index, { caption: event.target.value })}
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
  const images = currentImages.length >= defaultImages.length ? currentImages : defaultImages.map((image, index) => ({
    ...image,
    ...currentImages[index],
  }));
  const { index, select } = useContext(SlideshowSelection);
  const reportUpload = useContext(UploadActivity);
  const addInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const selected = images[index];
  const availableSlots = EXPERIENCE_HERO_IMAGE_LIMIT - images.length;

  const updateImage = (index: number, update: Partial<HeroImage>) => {
    props.onChange(images.map((image, imageIndex) =>
      imageIndex === index ? { ...image, ...update } : image
    ));
  };

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    if (files.length > availableSlots) {
      setUploadError(`Choose at most ${availableSlots} more photos.`);
      return;
    }

    reportUpload(1);
    setUploadError("");
    const added: HeroImage[] = [];
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          const url = await uploadSitePhoto(file, `hero-slot-${images.length + added.length + 1}`);
          added.push({ url, alt: "" });
        } catch (error) {
          failures.push(`${file.name}: ${errorMessage(error)}`);
        }
      }
      if (added.length) {
        props.onChange([...images, ...added]);
        select(images.length);
      }
      setUploadError(failures.join(" "));
    } finally {
      reportUpload(-1);
    }
  }

  return (
    <section className="xp-slideshow xp-array-field" aria-labelledby="slideshow-heading">
      <h3 id="slideshow-heading" tabIndex={-1}>Welcome slideshow <small>{index + 1} of {images.length}</small></h3>
      <div className="xp-photo-picker" role="group" aria-label="Choose a slideshow photo">
        {images.map((image, slot) => (
          <button key={slot} type="button" aria-label={`Show slideshow photo ${slot + 1}`} aria-pressed={slot === index} onClick={() => select(slot)}>
            <img src={image.url} alt="" />
            {slot === index && <span className="xp-photo-selected" aria-hidden="true"><Check size={14} /></span>}
            <span className="xp-photo-number" aria-hidden="true">{slot + 1}</span>
          </button>
        ))}
      </div>
      <ImageUrlField
        key={index}
        label={`Slideshow photo ${index + 1}`}
        value={selected.url || ""}
        uploadKind={`hero-slot-${index + 1}`}
        altText={selected.alt}
        allowManualPath={false}
        onChange={(value) => updateImage(index, { url: value, alt: "" })}
        clearLabel={images.length > defaultImages.length ? "Remove from slideshow" : undefined}
        onClear={() => {
          props.onChange(images.filter((_, imageIndex) => imageIndex !== index));
          select(Math.min(index, images.length - 2));
        }}
      />
      <label>
        <span>Photo description</span>
        <input
          id={`images-${index}-alt`}
          aria-describedby="slideshow-description-help"
          value={selected.alt || ""}
          maxLength={255}
          placeholder={`Describe slideshow photo ${index + 1}`}
          onChange={(event) => updateImage(index, { alt: event.target.value })}
        />
        <small className="xp-field-help" id="slideshow-description-help">Required before publishing. Describe what this photo shows.</small>
      </label>
      <button className="xp-studio-button" type="button" aria-describedby="slideshow-upload-help" disabled={availableSlots <= 0} onClick={() => addInput.current?.click()}>
        Add photos
      </button>
      <small className="xp-field-help" id="slideshow-upload-help">
        Select one or more JPG, PNG, or WebP files up to 8 MB each. The slideshow holds up to {EXPERIENCE_HERO_IMAGE_LIMIT} photos.
      </small>
      <input
        ref={addInput}
        type="file"
        aria-label="Select slideshow photos"
        accept={sitePhotoTypes}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void addPhotos(files);
        }}
      />
      {uploadError ? <small className="xp-field-error" role="alert">{uploadError}</small> : null}
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
  heroPanel: "photos" | "text";
}) {
  const { block, onChange, heroPanel } = props;
  const fields = componentMap[block.type]?.fields ?? {};
  const allowed = editableFields[block.type] ?? [];
  const visibleFields = block.type === "HeroBlock"
    ? allowed.filter((name) => (name === "images") === (heroPanel === "photos"))
    : allowed;
  const update = (name: string, value: unknown) => onChange({ ...block.props, [name]: value });

  return (
    <div className="xp-field-stack">
      {block.type === "ResearchAgendaBlock" && (
        <p className="xp-help-text">Update the introduction here. To change the official list, open Research Agenda from Edit Pages.</p>
      )}
      {visibleFields.map((name) => fields[name] && (
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
        <p className="xp-help-text">After you upload a reusable picture, press Copy next to it and paste it into a compatible picture box. Upload hero photos in the slideshow editor.</p>
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

function issueLabel(issue: ExperiencePublishIssue) {
  const [, index] = issue.field.split("-");
  if (issue.field.startsWith("images-")) return `Slideshow photo ${Number(index) + 1} needs a description.`;
  if (issue.field === "imageAlt") return "The archived image needs a description.";
  return issue.message.replace("requires alternative text", "needs a description");
}

function PublishBlockers({ issues, disabled, onFix }: {
  issues: ExperiencePublishIssue[];
  disabled: boolean;
  onFix: (issue: ExperiencePublishIssue) => void;
}) {
  const groups = new Map<string, ExperiencePublishIssue[]>();
  for (const issue of issues) {
    const key = `${issue.page}-${issue.block}`;
    const group = groups.get(key);
    if (group) group.push(issue);
    else groups.set(key, [issue]);
  }

  return (
    <section className="xp-workspace-error xp-publish-blockers" aria-labelledby="publish-blockers-heading">
      <div className="xp-publish-blockers-header">
        <CircleAlert size={22} aria-hidden="true" />
        <div>
          <h2 id="publish-blockers-heading" tabIndex={-1} aria-describedby="publish-blockers-help">Publishing blocked</h2>
          <p id="publish-blockers-help">Fix {issues.length} {issues.length === 1 ? "issue" : "issues"} to enable Publish changes. Select an issue to open its field.</p>
        </div>
      </div>
      {Array.from(groups, ([key, group]) => {
        const { page, block } = group[0];
        const headingId = `publish-blockers-${key}`;
        return (
          <div className="xp-publish-blocker-group" key={key}>
            <h3 id={headingId}>{pages[page].name} · {sectionName(block)}</h3>
            <ul role="list" aria-labelledby={headingId}>
              {group.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>
                  <button className="xp-studio-button" type="button" disabled={disabled} onClick={() => onFix(issue)}>
                    {issueLabel(issue)}<ArrowRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export default function App() {
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia(ADMIN_COMPACT_VIEWPORT).matches);
  const draftLoadStarted = useRef(false);
  const [config, setConfig] = useState<ExperienceConfig>(defaultExperienceConfig);
  const [savedConfig, setSavedConfig] = useState(config);
  const [published, setPublished] = useState<ExperienceConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [screen, setScreen] = useState<Screen>("pages");
  const [publishedPages, setPublishedPages] = useState<PageKey[]>([]);
  const [activePage, setActivePage] = useState<PageKey>("landing");
  const [section, setSection] = useState("HeroBlock");
  const [resume, setResume] = useState(readEditorLocation);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const [heroPhoto, setHeroPhoto] = useState(0);
  const [heroPanel, setHeroPanel] = useState<"photos" | "text">("photos");
  const [canvasScroll, setCanvasScroll] = useState({});
  const [canvasReady, setCanvasReady] = useState(false);
  const [device, setDevice] = useState<DeviceKey>("desktop");
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
  const leaveConfirmed = useRef(false);
  const history = useRef<{ past: ExperienceConfig[]; future: ExperienceConfig[]; lastEdit: number }>({ past: [], future: [], lastEdit: 0 });

  const dirty = config !== savedConfig;
  const working = busy !== null || uploads > 0;
  const selected = config.pages[activePage].data.content.find((block) => block.type === section);
  const landingHero = config.pages.landing.data.content.find((block) => block.type === "HeroBlock");
  const heroImages = landingHero?.props.images as HeroImage[] | undefined;
  const selectedHeroPhoto = Math.min(heroPhoto, Math.max(0, (heroImages?.length ?? 0) - 1));
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
    const media = window.matchMedia(ADMIN_COMPACT_VIEWPORT);
    const updateViewport = () => setCompactViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (compactViewport) {
      setCanvasReady(false);
      setConfirm(null);
      if (draftLoadStarted.current) document.getElementById("studio-desktop-required")?.focus();
      return;
    }
    if (draftLoadStarted.current) return;
    draftLoadStarted.current = true;
    if (window.innerWidth < 1100) setDevice("tablet");
    void loadOnMount();
  }, [compactViewport]);

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
  }, [focusRequest, loadState, compactViewport]);

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

  function navigate(next: Screen, id = next === "review" ? "publish-blockers-heading" : "studio-title") {
    if (next !== "edit") setCanvasReady(false);
    setScreen(next);
    setFocusRequest({ id });
  }

  function selectSection(location: EditorLocation) {
    setActivePage(location.page);
    setSection(location.section);
    setResume(location);
    try { sessionStorage.setItem(locationKey, JSON.stringify(location)); } catch { /* Storage is optional. */ }
  }

  function openSection(location: EditorLocation, field?: string) {
    if (location.page !== activePage || screen !== "edit") setCanvasReady(false);
    if (location.section === "HeroBlock" && field) {
      const photoField = field.startsWith("images-");
      setHeroPanel(photoField ? "photos" : "text");
      if (photoField) setHeroPhoto(Number(field.split("-")[1]));
    }
    history.current.lastEdit = 0;
    selectSection(location);
    setCanvasScroll({});
    navigate("edit", field || "studio-title");
  }

  function openPage(page: PageKey) {
    openSection({ page, section: page === "faq" ? "FaqBlock" : "HeroBlock" });
  }

  function exit() {
    const leave = () => {
      leaveConfirmed.current = true;
      window.location.assign("/admin/Components/edit-pages.html");
    };
    if (dirty) setConfirm({ title: "Leave without saving?", body: "Changes since the last successful save will be lost.", label: "Leave studio", action: leave });
    else leave();
  }

  function updateBlock(props: Record<string, unknown>, blockType = section) {
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
            content: config.pages[activePage].data.content.map((block) => block.type === blockType ? { ...block, props } : block),
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
    if (compactViewport || screen !== "edit" || confirm || working || !(event.metaKey || event.ctrlKey)) return;
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
    if (compactViewport || operation.current || loadState !== "ready" || conflict || uploads) return;
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
    if (compactViewport || !dirty || invalidDraft || working || conflict || loadState !== "ready" || error || confirm || screen === "review") return;
    const timer = setTimeout(() => autosave(), 25000);
    return () => clearTimeout(timer);
  }, [compactViewport, config, dirty, invalidDraft, working, conflict, loadState, error, confirm, screen]);

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
      setStatus("");
      setPublishedPages(pageKeys.filter((page) => changes.some((change) => change.page === page)));
      navigate("published");
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

  function sendCanvas(scroll = false) {
    const iframe = canvasRef.current;
    const targetWindow = iframe?.contentWindow;
    if (!iframe || !targetWindow) return;
    targetWindow.postMessage({ type: "experience-config", config }, window.location.origin);
    if (scroll) {
      const marker = iframe.contentDocument?.querySelector(sections[section]?.preview);
      const target = marker?.closest("section") ?? marker;
      if (target) targetWindow.scrollTo(0, targetWindow.scrollY + target.getBoundingClientRect().top - 96);
    }
  }

  function showCanvasPhoto() {
    canvasRef.current?.contentWindow?.postMessage({ type: "experience-show-photo", index: selectedHeroPhoto }, window.location.origin);
  }

  const receiveCanvasMessage = useEffectEvent((event: MessageEvent) => {
    if (compactViewport || event.origin !== window.location.origin || event.source !== canvasRef.current?.contentWindow || !event.data) return;
    const { type, block, field, value, index, open } = event.data;
    if (type === "experience-canvas-ready") {
      sendCanvas(true);
      setCanvasReady(true);
      return;
    }
    if (working) return;
    if (type === "experience-canvas-photo" && activePage === "landing" && Number.isInteger(index) && index >= 0 && index < (heroImages?.length ?? 0)) {
      selectSection({ page: activePage, section: "HeroBlock" });
      setHeroPhoto(index);
      setHeroPanel("photos");
      if (open) setFocusRequest({ id: "slideshow-heading" });
      return;
    }
    if (type === "experience-canvas-role" && activePage === "landing") {
      const chart = config.pages.landing.data.content.find((item) => item.type === "ImageFeatureBlock");
      const roles = chart?.props.roles as OrganizationRole[] | undefined;
      const roleIndex = roles?.findIndex((role) => role.id === event.data.roleId) ?? -1;
      if (roleIndex >= 0) {
        selectSection({ page: activePage, section: "ImageFeatureBlock" });
        setFocusRequest({ id: `roles-${roleIndex}-photoAlt` });
      }
      return;
    }
    if (typeof block !== "string" || !Object.prototype.hasOwnProperty.call(editableFields, block)) return;
    const target = config.pages[activePage].data.content.find((item) => item.type === block);
    if (!target) return;
    if (type === "experience-canvas-select") {
      if (block !== section) {
        history.current.lastEdit = 0;
        selectSection({ page: activePage, section: block });
      }
      if (block === "HeroBlock" && typeof field === "string") setHeroPanel("text");
    }
    if (type !== "experience-canvas-edit" || typeof field !== "string" || typeof value !== "string") return;
    const path = field.split(".");
    if (!editableFields[block].includes(path[0])) return;
    const props = structuredClone(target.props);
    let owner = props;
    for (const key of path.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(owner, key) || typeof owner[key] !== "object" || !owner[key]) return;
      owner = owner[key] as Record<string, unknown>;
    }
    const key = path[path.length - 1];
    if (!Object.prototype.hasOwnProperty.call(owner, key) || typeof owner[key] !== "string" || owner[key] === value) return;
    owner[key] = value;
    updateBlock(props, block);
  });
  const syncCanvas = useEffectEvent(sendCanvas);
  const syncPhoto = useEffectEvent(showCanvasPhoto);

  useEffect(() => {
    const listener = (event: MessageEvent) => receiveCanvasMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  useEffect(() => {
    if (!compactViewport && screen === "edit") syncCanvas();
  }, [config, screen, compactViewport]);

  useEffect(() => {
    if (screen === "edit" && canvasReady) syncCanvas(true);
  }, [canvasScroll, screen, canvasReady]);

  useEffect(() => {
    if (canvasReady && activePage === "landing") syncPhoto();
  }, [selectedHeroPhoto, canvasReady, activePage]);

  useLayoutEffect(() => {
    const frame = canvasRef.current?.parentElement;
    if (screen !== "edit" || !frame) return;
    const width = previewWidths[device];
    const fitPreview = () => {
      frame.style.setProperty("--preview-width", `${width}px`);
      frame.style.setProperty("--preview-scale", String(Math.min(1, frame.clientWidth / width)));
    };
    fitPreview();
    const observer = new ResizeObserver(fitPreview);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [screen, device, activePage, compactViewport]);

  const resumeLocation = resume ?? changes.find((change) => editableFields[change.section]);
  const pageName = pages[activePage].name;
  const title = screen === "pages" ? "Which page do you want to update?"
    : screen === "review" ? "Review changes"
    : screen === "tools" ? "Version history and images"
    : pageName;

  const editing = !compactViewport && screen === "edit" && loadState === "ready";
  const coverImage = heroImages?.[0]?.url;
  const faqContent = config.pages.faq.data.content.find((block) => block.type === "FaqBlock");
  const firstQuestion = (faqContent?.props.categories as FaqCategory[] | undefined)?.[0]?.items[0]?.question;

  return (
    <div className="xp-studio-shell">
      <header className="xp-workspace-header">
        <div className="xp-studio-identity">
          {!compactViewport && <button className="xp-studio-button xp-exit-button" type="button" onClick={exit} disabled={working}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Edit Pages</span>
          </button>}
          {editing ? (
            <h1 id="studio-title" tabIndex={-1}><LayoutTemplate size={18} aria-hidden="true" /> PeAS Studio</h1>
          ) : <strong><LayoutTemplate size={18} aria-hidden="true" /> PeAS Studio</strong>}
        </div>
        {editing && (
          <nav className="xp-page-switch" aria-label="Website editor navigation">
            <button type="button" aria-label="Website pages" title="Website pages" disabled={working} onClick={() => navigate("pages")}><LayoutTemplate size={16} aria-hidden="true" /></button>
            <button type="button" aria-pressed={activePage === "landing"} disabled={working} onClick={() => { if (activePage !== "landing") openPage("landing"); }}><House size={16} aria-hidden="true" />Home</button>
            <button type="button" aria-pressed={activePage === "faq"} disabled={working} onClick={() => { if (activePage !== "faq") openPage("faq"); }}><CircleHelp size={16} aria-hidden="true" />FAQ</button>
          </nav>
        )}
        {!compactViewport && loadState === "ready" && (
          <p className={`xp-draft-status${dirty ? " is-dirty" : ""}`} role="status" aria-label="Draft status">
            <span aria-hidden="true" />
            {statusText}
          </p>
        )}
        {editing && (
          <div className="xp-edit-actions" role="group" aria-label="Draft actions">
            <button className="xp-studio-button xp-icon-action" type="button" aria-label="Undo" title="Undo" onClick={() => undoOrRedo("past")} disabled={working || !history.current.past.length}><Undo2 size={18} aria-hidden="true" /></button>
            <button className="xp-studio-button xp-icon-action" type="button" aria-label="Redo" title="Redo" onClick={() => undoOrRedo("future")} disabled={working || !history.current.future.length}><Redo2 size={18} aria-hidden="true" /></button>
            <button className="xp-studio-button" type="button" onClick={saveDraft} disabled={working || conflict || !dirty}><ArrowDownToLine size={16} aria-hidden="true" />Save draft</button>
            <button className="xp-studio-button primary xp-review-action" type="button" aria-label="Review changes" disabled={working || (!dirty && !hasDraft && !issues.length)} onClick={() => navigate("review")}><span>Review changes</span><ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </header>
      {compactViewport && screen !== "published" ? (
        <main className="xp-workspace-main">
          <section className="xp-workspace-surface xp-desktop-notice" aria-labelledby="studio-desktop-required">
            <Monitor size={27} aria-hidden="true" />
            <h1 id="studio-desktop-required" tabIndex={-1}>Use a larger screen to edit website pages</h1>
            <p>Open Experience Studio on a computer or widen your browser window.</p>
            {dirty && <p>Your unsaved edits are still in this tab. Widen the window to continue editing.</p>}
            <button className="xp-studio-button primary" type="button" onClick={exit} disabled={working}>Back to Edit Pages</button>
          </section>
        </main>
      ) : <main className={`xp-workspace-main${editing ? " xp-visual-workspace" : screen === "pages" && loadState === "ready" ? " xp-page-picker" : ""}`}>
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
          {screen !== "pages" && screen !== "published" && !editing && (
            <nav aria-label="Website editor navigation" className="xp-workspace-nav">
              <button className="xp-text-button" type="button" disabled={working} onClick={() => navigate("pages")}>Website pages</button>
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
          {!editing && screen !== "published" && <div className="xp-workspace-title">
            <h1 id="studio-title" tabIndex={-1}>{title}</h1>
          </div>}

          {screen === "pages" && <>
            <ul className="xp-choice-list">
              {pageKeys.map((page) => (
                <li key={page}>
                  <button className="xp-choice" type="button" onClick={() => openPage(page)}>
                    <div className={`xp-choice-preview is-${page}`} aria-hidden="true">
                      {page === "landing" ? (
                        coverImage && <img src={coverImage} alt="" />
                      ) : (
                        <div className="xp-faq-choice-preview">
                          <CircleHelp size={29} />
                          <span>{firstQuestion}</span>
                          <ChevronDown size={18} />
                        </div>
                      )}
                    </div>
                    <div className="xp-choice-summary">
                      <strong>{pages[page].name}</strong>
                      <span>{pages[page].description}</span>
                      <ArrowUpRight size={23} aria-hidden="true" />
                    </div>
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

          {editing && selected && (
            <div className="xp-editor-layout">
              <section className="xp-workspace-preview" aria-labelledby="preview-heading">
                <div className="xp-preview-controls">
                  <div className="xp-canvas-heading">
                    <h2 tabIndex={-1} id="preview-heading"><Pencil size={15} aria-hidden="true" />Live canvas</h2>
                    <span>Select text to edit</span>
                  </div>
                  <div className="xp-device-switch" role="group" aria-label="Preview width">
                    {previewDevices.map(({ value, label, Icon }) => (
                      <button key={value} type="button" aria-pressed={device === value} aria-label={label} title={`${label} preview`} onClick={() => setDevice(value)}>
                        <Icon size={17} aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <button className="xp-inspector-jump" type="button" aria-label="Section settings" title="Section settings" onClick={() => setFocusRequest({ id: "section-settings" })}><PanelRight size={19} aria-hidden="true" /></button>
                </div>
                {!canvasReady && <p role="status" className="xp-canvas-help">Loading the page canvas…</p>}
                <div className={`xp-preview-frame ${device}`} inert={working}>
                  <iframe key={activePage} ref={canvasRef} title={`Live editor for ${pageName}`} src={`${pages[activePage].url}?experienceCanvas=1`} />
                </div>
              </section>
              <section className="xp-editor-fields" aria-labelledby="section-settings">
                <div className="xp-section-settings-heading">
                  <h2 id="section-settings" tabIndex={-1}>Section settings</h2>
                  <button className="xp-inspector-jump" type="button" aria-label="Back to canvas" title="Back to canvas" onClick={() => setFocusRequest({ id: "preview-heading" })}><PanelRight size={18} aria-hidden="true" /></button>
                </div>
                {activePage === "landing" ? (
                  <label className="xp-section-select">
                    <span className="xp-sr-only">Section</span>
                    <select value={section} disabled={working} onChange={(event) => {
                      history.current.lastEdit = 0;
                      selectSection({ page: activePage, section: event.target.value });
                      setCanvasScroll({});
                    }}>
                      {config.pages[activePage].data.content.filter((block) => editableFields[block.type]).map((block) => (
                        <option key={block.type} value={block.type}>{sectionName(block.type)}</option>
                      ))}
                    </select>
                    <ChevronDown size={17} aria-hidden="true" />
                  </label>
                ) : <p className="xp-section-name">{sectionName(section)}</p>}
                {section === "HeroBlock" && (
                  <div className="xp-inspector-switch" role="group" aria-label="Welcome content">
                    <button type="button" aria-pressed={heroPanel === "photos"} disabled={working} onClick={() => setHeroPanel("photos")}><Image size={16} aria-hidden="true" />Photos</button>
                    <button type="button" aria-pressed={heroPanel === "text"} disabled={working} onClick={() => setHeroPanel("text")}><Type size={16} aria-hidden="true" />Text</button>
                  </div>
                )}
                <fieldset disabled={working}>
                  <legend className="xp-sr-only">{sectionName(section)} fields</legend>
                  <UploadActivity.Provider value={(change) => setUploads((count) => count + change)}>
                    <SlideshowSelection.Provider value={{ index: selectedHeroPhoto, select: setHeroPhoto }}>
                      <BlockInspector key={section} block={selected} heroPanel={heroPanel} onChange={updateBlock} />
                    </SlideshowSelection.Provider>
                  </UploadActivity.Provider>
                </fieldset>
              </section>
            </div>
          )}

          {screen === "review" && <>
            {issues.length > 0 && <PublishBlockers issues={issues} disabled={working} onFix={(issue) => openSection({ page: issue.page, section: issue.block }, issue.field)} />}
            <section className="xp-workspace-surface">
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
              <div className="xp-workspace-actions">
                <button className="xp-studio-button" type="button" disabled={working} onClick={() => resumeLocation ? openSection(resumeLocation) : navigate("pages")}>{resumeLocation ? "Back to editing" : "Back to pages"}</button>
                <button className="xp-studio-button primary" type="button" disabled={working || conflict || !changes.length || issues.length > 0} aria-describedby={issues.length ? "publish-blockers-help" : undefined} onClick={publishChanges}>Publish changes</button>
              </div>
            </section>
          </>}

          {screen === "published" && (
            <section className="xp-workspace-surface xp-workspace-title xp-publish-success" aria-labelledby="studio-title">
              <h1 id="studio-title" tabIndex={-1} aria-describedby="publish-success-description">
                <CircleCheck size={28} aria-hidden="true" />Changes published
              </h1>
              <p id="publish-success-description">Your changes are live on the public website.</p>
              <div className="xp-workspace-actions">
                {publishedPages.map((page) => (
                  <a className="xp-studio-button primary" href={pages[page].url} key={page}>
                    {page === "landing" ? "View home page" : "View FAQ"}<ArrowRight size={16} aria-hidden="true" />
                  </a>
                ))}
                <button className="xp-studio-button" type="button" onClick={() => navigate("pages")}>Back to website pages</button>
              </div>
            </section>
          )}

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
      </main>}
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
