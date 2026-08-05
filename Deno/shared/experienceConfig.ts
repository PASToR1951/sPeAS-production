import { z } from "zod";

export const EXPERIENCE_SCHEMA_VERSION = 3;

export const EXPERIENCE_COMPONENT_TYPES = [
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
  "LoginShellBlock",
  "BrandPanelBlock",
  "HelpPanelBlock",
] as const;

export const ExperienceComponentTypeSchema = z.enum(EXPERIENCE_COMPONENT_TYPES);

export const EXPERIENCE_OVERVIEW_PILLAR_IDS = [
  "preserve",
  "discover",
  "access",
] as const;

export type ExperienceOverviewPillarId = typeof EXPERIENCE_OVERVIEW_PILLAR_IDS[number];

export interface OverviewBlockProps {
  id: "peas-overview";
  eyebrow: string;
  title: string;
  summary: string;
  pillars: [
    { id: "preserve"; label: "Preserve"; description: string },
    { id: "discover"; label: "Discover"; description: string },
    { id: "access"; label: "Access"; description: string },
  ];
  ctaLabel: "Explore the repository";
  ctaHref: "/pages/searchResultsPage.html";
  visualStyle: "archive-rings";
}

export const ExperienceOverviewPillarIdSchema = z.enum(EXPERIENCE_OVERVIEW_PILLAR_IDS);

export const ExperienceOverviewPillarSchema = z.object({
  id: ExperienceOverviewPillarIdSchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(320),
}).strict();

export const ExperienceOverviewPillarsSchema = z.tuple([
  ExperienceOverviewPillarSchema,
  ExperienceOverviewPillarSchema,
  ExperienceOverviewPillarSchema,
]);

export const EXPERIENCE_ORGANIZATION_ROLE_IDS = [
  "president",
  "vp-student-affairs",
  "director-orp",
  "associate-assistant",
  "editorial-board",
  "technical-board",
  "research-ethics-board",
] as const;

export const ExperienceOrganizationRoleIdSchema = z.enum(
  EXPERIENCE_ORGANIZATION_ROLE_IDS,
);

export const ExperienceOrganizationRoleSchema = z.object({
  id: ExperienceOrganizationRoleIdSchema,
  title: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(120),
  caption: z.string().trim().min(1).max(120),
  name: z.string().trim().max(160),
  photo: z.string().trim().max(2048).refine((value) => !value || isApprovedImageUrl(value), {
    message: "Organization role photos must use an approved local raster image path",
  }),
  photoAlt: z.string().trim().max(255),
  group: z.boolean(),
}).strict();

const EXPERIENCE_ORGANIZATION_ROLE_GROUPS: Readonly<
  Record<
    z.infer<typeof ExperienceOrganizationRoleIdSchema>,
    boolean
  >
> = {
  president: false,
  "vp-student-affairs": false,
  "director-orp": false,
  "associate-assistant": false,
  "editorial-board": true,
  "technical-board": true,
  "research-ethics-board": true,
};

/**
 * Validates the complete, code-owned chart shape. Role IDs, order, and group
 * classification are structural and cannot be changed by Experience Studio.
 */
export const ExperienceOrganizationRolesSchema = z.array(
  ExperienceOrganizationRoleSchema,
)
  .length(EXPERIENCE_ORGANIZATION_ROLE_IDS.length)
  .superRefine((roles, context) => {
    roles.forEach((role, index) => {
      const expectedId = EXPERIENCE_ORGANIZATION_ROLE_IDS[index];
      if (role.id !== expectedId) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Expected organization role ${expectedId} at position ${
            index + 1
          }`,
        });
      }
      if (role.group !== EXPERIENCE_ORGANIZATION_ROLE_GROUPS[expectedId]) {
        context.addIssue({
          code: "custom",
          path: [index, "group"],
          message:
            `Organization role ${expectedId} has a fixed group classification`,
        });
      }
    });
  });

export type ExperienceOrganizationRole = z.infer<
  typeof ExperienceOrganizationRoleSchema
>;

export const EXPERIENCE_DEFAULT_ORGANIZATION_ROLES:
  ExperienceOrganizationRole[] = ExperienceOrganizationRolesSchema.parse([
    {
      id: "president",
      title: "University President",
      label: "University President",
      caption: "Administration",
      name: "",
      photo: "",
      photoAlt: "",
      group: false,
    },
    {
      id: "vp-student-affairs",
      title: "Vice President, Student Affairs",
      label: "Vice President",
      caption: "Student Affairs",
      name: "",
      photo: "",
      photoAlt: "",
      group: false,
    },
    {
      id: "director-orp",
      title: "Director, Office of Research and Publications",
      label: "Director",
      caption: "Research & Publications",
      name: "",
      photo: "",
      photoAlt: "",
      group: false,
    },
    {
      id: "associate-assistant",
      title: "Associate Assistant",
      label: "Associate Assistant",
      caption: "Office Support",
      name: "",
      photo: "",
      photoAlt: "",
      group: false,
    },
    {
      id: "editorial-board",
      title: "Editorial Board",
      label: "Editorial Board",
      caption: "Publications",
      name: "",
      photo: "",
      photoAlt: "",
      group: true,
    },
    {
      id: "technical-board",
      title: "Technical Board",
      label: "Technical Board",
      caption: "Research Review",
      name: "",
      photo: "",
      photoAlt: "",
      group: true,
    },
    {
      id: "research-ethics-board",
      title: "Research Ethics Board",
      label: "Research Ethics Board",
      caption: "Ethics Review",
      name: "",
      photo: "",
      photoAlt: "",
      group: true,
    },
  ]);

export const PuckComponentDataSchema = z.object({
  type: ExperienceComponentTypeSchema,
  props: z.record(z.string(), z.unknown()).default({}),
  readOnly: z.record(z.string(), z.boolean()).optional(),
});

export const PuckPageDataSchema = z.object({
  root: z.record(z.string(), z.unknown()).default({}),
  content: z.array(PuckComponentDataSchema).default([]),
  zones: z.record(z.string(), z.array(PuckComponentDataSchema)).optional(),
});

export const ExperienceThemeSchema = z.object({
  brandName: z.string().min(1).max(120),
  logoUrl: z.string().min(1),
  faviconUrl: z.string().min(1).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  primaryDarkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pageBackground: z.string().min(1),
  surfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mutedTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.string().min(1),
  radius: z.enum(["compact", "soft", "rounded"]),
  motion: z.enum(["none", "reduced", "standard"]),
});

export const EXPERIENCE_FIXED_THEME = ExperienceThemeSchema.parse({
  brandName: "Paulinian electronic Archiving System",
  logoUrl: "/Components/images/peas.png",
  faviconUrl: "/Components/images/peas-ico.png",
  primaryColor: "#006A4E",
  primaryDarkColor: "#00523D",
  accentColor: "#FDB813",
  pageBackground: "linear-gradient(to bottom right, #fdfae8, #e6f4ea)",
  surfaceColor: "#FFFFFF",
  textColor: "#1F2937",
  mutedTextColor: "#6B7280",
  fontFamily: "Inter",
  radius: "soft",
  motion: "standard",
});

export const ExperiencePageSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(300).optional(),
  data: PuckPageDataSchema,
});

export const ExperiencePersonalizationSchema = z.object({
  enabled: z.boolean().default(true),
  greetingTemplate: z.string().max(140).default("Welcome back, {{first_name}}"),
  guestGreeting: z.string().max(140).default("Welcome to PeAS"),
  modules: z.array(z.enum([
    "roleQuickLinks",
    "savedDocuments",
    "recentActivity",
    "adminShortcuts",
  ])).default(["roleQuickLinks", "savedDocuments", "recentActivity"]),
});

export const ExperienceConfigSchema = z.object({
  schemaVersion: z.literal(EXPERIENCE_SCHEMA_VERSION),
  title: z.string().min(1).max(160),
  updatedAt: z.string().optional(),
  pages: z.object({
    landing: ExperiencePageSchema,
    login: ExperiencePageSchema,
  }),
});

export const UserExperiencePreferencesSchema = z.object({
  landingDensity: z.enum(["comfortable", "compact"]).default("comfortable"),
  preferredModules: z.array(z.string().max(80)).default([]),
  hiddenModules: z.array(z.string().max(80)).default([]),
});

export type ExperienceConfig = z.infer<typeof ExperienceConfigSchema>;
export type UserExperiencePreferences = z.infer<typeof UserExperiencePreferencesSchema>;

export function parseExperienceConfig(input: unknown): ExperienceConfig {
  return ExperienceConfigSchema.parse(migrateExperienceConfigToV3(input));
}

export function parseUserExperiencePreferences(input: unknown): UserExperiencePreferences {
  return UserExperiencePreferencesSchema.parse(input ?? {});
}

export const defaultExperienceConfig: ExperienceConfig = {
  schemaVersion: EXPERIENCE_SCHEMA_VERSION,
  title: "PeAS Experience",
  pages: {
    landing: {
      title: "Office of Research & Publications",
      description: "The public PeAS landing page.",
      data: {
        root: { props: { title: "Office of Research & Publications" } },
        content: [
          {
            type: "HeroBlock",
            props: {
              id: "hero-current-peas",
              eyebrow: "St. Paul University Dumaguete",
              title: "Welcome to the Office of Research & Publications",
              body: "Sharing the institution's research activities, initiatives, and publications - innovations and scientific discoveries that expand human knowledge and serve the broader community.",
              logoUrl: "/Components/images/peas.png",
              images: [
                { url: "/Components/images/1.jpg", alt: "Research Initiative Photo 1" },
                { url: "/Components/images/2.jpg", alt: "Research Initiative Photo 2" },
                { url: "/Components/images/3.jpg", alt: "Research Initiative Photo 3" },
                { url: "/Components/images/4.jpg", alt: "Research Initiative Photo 4" },
              ],
              variant: "background-slideshow",
            },
          },
          {
            type: "OverviewBlock",
            props: {
              id: "peas-overview",
              eyebrow: "What is PeAS?",
              title: "A digital home for Paulinian research",
              summary: "The Paulinian electronic Archiving System preserves the university's academic works, makes scholarship easier to discover, and provides role-appropriate access to repository materials.",
              pillars: [
                {
                  id: "preserve",
                  label: "Preserve",
                  description: "Safeguards theses, dissertations, Confluence, Synergy, and other scholarly outputs in one organized repository.",
                },
                {
                  id: "discover",
                  label: "Discover",
                  description: "Connects readers with research through structured metadata, authors, topics, keywords, and collection filters.",
                },
                {
                  id: "access",
                  label: "Access",
                  description: "Gives guests, registered readers, publishers, and administrators the right experience while protected files remain controlled.",
                },
              ],
              ctaLabel: "Explore the repository",
              ctaHref: "/pages/searchResultsPage.html",
              visualStyle: "archive-rings",
            },
          },
          {
            type: "QuickLinksBlock",
            props: {
              id: "quick-links-current",
              title: "Explore PeAS",
              links: [
                {
                  label: "Our Mission",
                  href: "#mission",
                  description: "Excellence, integrity, and ethics in the pursuit of truth, knowledge, and holistic formation.",
                },
                {
                  label: "Organizational Chart",
                  href: "#org-chart",
                  description: "Meet the team driving research, publications, and innovation at the university.",
                },
                {
                  label: "Research Agenda",
                  href: "#research-agenda",
                  description: "Twenty focus areas aligned with national priorities and global development goals.",
                },
              ],
            },
          },
          {
            type: "RichTextBlock",
            props: {
              id: "mission",
              eyebrow: "Our Mission",
              title: "Advancing knowledge in service of the community",
              body: "The Office of Research & Publications of St. Paul University Dumaguete supports faculty and students in meaningful research that improves the institution and the populations we serve.\n\nOur innovations and scientific discoveries are expanding human knowledge and extending help to improve the institution and the public community.\n\nThe office provides standards aligned with its newly crafted research agenda and in parallel with the priorities mandated by several agencies towards sustainability and development goals of our country.",
            },
          },
          {
            type: "ImageFeatureBlock",
            props: {
              id: "org-chart",
              eyebrow: "Team",
              title: "Organizational Chart",
              body: "The structure behind the Office of Research & Publications.",
              imageUrl: "/Components/images/org-chart.png",
              imageAlt: "Organizational chart for the Office of Research and Publications",
              caption: "Click to view the full organizational chart.",
              roles: clone(EXPERIENCE_DEFAULT_ORGANIZATION_ROLES),
            },
          },
          {
            type: "ResearchAgendaBlock",
            props: {
              id: "research-agenda",
              eyebrow: "Focus Areas",
              title: "Research Agenda",
              body: "Twenty priority areas guiding faculty and student research - from Paulinian identity and formation to technology, sustainability, and global partnerships.",
              imageUrl: "/Components/images/prism.png",
              imageAlt: "Research prism diagram",
            },
          },
          {
            type: "CtaBlock",
            props: {
              id: "bottom-cta",
              title: "Collaborate with the Office of Research & Publications",
              body: "Have a research inquiry, an idea for a publication, or a question about our work? We'd love to hear from you.",
              label: "Get in touch",
              href: "/contact.html",
            },
          },
          {
            type: "FooterLinksBlock",
            props: {
              id: "footer-links",
              copyrightLabel: "PeAS. All Rights Reserved.",
              logoUrl: "/Components/images/spud-logo.png",
              links: [
                { label: "Home", href: "/index.html" },
                { label: "Contact", href: "/contact.html" },
                { label: "Terms & Conditions", href: "/pages/miscellaneous/T&A-Public.html" },
                { label: "Privacy Policy", href: "/pages/miscellaneous/Privacy.html" },
              ],
            },
          },
        ],
      },
    },
    login: {
      title: "PeAS Login",
      description: "The configurable login experience.",
      data: {
        root: { props: { title: "PeAS Login" } },
        content: [
          {
            type: "LoginShellBlock",
            props: {
              id: "login-shell-current",
              brandText: "Paulinian electronic\nArchiving System (PeAS)",
              logoUrl: "/Components/images/peas_logo.png",
              title: "Welcome back",
              subtitle: "Please enter your details to access the PeAS.",
              schoolIdLabel: "School ID",
              schoolIdPlaceholder: "Enter your School ID",
              passwordLabel: "Password",
              passwordPlaceholder: "Enter your password",
              submitLabel: "Sign in",
              forgotPasswordLabel: "Forgot Password?",
              forgotPasswordTitle: "Forgot Password?",
              forgotPasswordSubtitle: "No worries, we'll send you reset instructions.",
              backgroundImageUrl: "/Components/images/spud_facade.jpg",
              graphicLogoUrl: "/Components/images/spud_logo_s.png",
              footerText: "PeAS. All Rights Reserved. L. Rovira Rd, Bantayan, Dumaguete, Negros Oriental.",
              layout: "split",
            },
          },
        ],
      },
    },
  },
};

const EDITABLE_STRING_FIELDS: Record<string, readonly string[]> = {
  HeroBlock: ["eyebrow", "title", "body"],
  OverviewBlock: ["eyebrow", "title", "summary"],
  QuickLinksBlock: ["title"],
  RichTextBlock: ["eyebrow", "title", "body"],
  ImageFeatureBlock: ["eyebrow", "title", "body", "imageUrl", "imageAlt", "caption"],
  ResearchAgendaBlock: ["eyebrow", "title", "body", "imageUrl", "imageAlt"],
  CtaBlock: ["title", "body", "label"],
  LoginShellBlock: [
    "brandText", "title", "subtitle", "forgotPasswordTitle", "forgotPasswordSubtitle",
    "footerText", "backgroundImageUrl", "graphicLogoUrl", "logoUrl",
  ],
};

/**
 * Canonicalizes legacy v1/v2 documents and v3 drafts into the locked v3 layout. Only approved copy and image fields survive. Component
 * order, component types, link destinations, form semantics, theme, and
 * personalization are not stored in the v3 content document.
 */
export function migrateExperienceConfigToV3(input: unknown): ExperienceConfig {
  const source = asRecord(input);
  if (typeof source.schemaVersion === "number" && ![1, 2, 3].includes(source.schemaVersion)) {
    throw new Error(`Unsupported Experience schema version: ${source.schemaVersion}`);
  }
  const output = clone(defaultExperienceConfig);
  output.schemaVersion = EXPERIENCE_SCHEMA_VERSION;
  output.title = typeof source.title === "string" && source.title.trim()
    ? source.title.trim().slice(0, 160)
    : defaultExperienceConfig.title;
  if (typeof source.updatedAt === "string") output.updatedAt = source.updatedAt;

  for (const pageKey of ["landing", "login"] as const) {
    const sourcePage = asRecord(asRecord(asRecord(source.pages)[pageKey]));
    const sourceData = asRecord(sourcePage.data);
    const sourceBlocks = Array.isArray(sourceData.content) ? sourceData.content.map(asRecord) : [];
    output.pages[pageKey].data.content = output.pages[pageKey].data.content.map((defaultBlock) => {
      const defaultProps = asRecord(defaultBlock.props);
      const matching = sourceBlocks.find((block) => {
        const props = asRecord(block.props);
        return block.type === defaultBlock.type && props.id === defaultProps.id;
      }) ?? sourceBlocks.find((block) => block.type === defaultBlock.type);
      if (!matching) return defaultBlock;
      return {
        ...defaultBlock,
        props: migrateBlockProps(defaultBlock.type, defaultProps, asRecord(matching.props)),
      };
    });
  }
  return output;
}

/** @deprecated Use migrateExperienceConfigToV3. Kept for compatibility with recovery scripts. */
export function migrateExperienceConfigV1ToV2(input: unknown): ExperienceConfig {
  return migrateExperienceConfigToV3(input);
}

export function getExperiencePublishErrors(config: ExperienceConfig): string[] {
  const errors: string[] = [];
  for (const page of [config.pages.landing, config.pages.login]) {
    for (const block of page.data.content) {
      const props = asRecord(block.props);
      if (typeof props.imageUrl === "string" && props.imageUrl.trim() && !String(props.imageAlt ?? "").trim()) {
        errors.push(`${block.type} image requires alternative text.`);
      }
      if (Array.isArray(props.images)) {
        props.images.forEach((item, index) => {
          const image = asRecord(item);
          if (String(image.url ?? "").trim() && !String(image.alt ?? "").trim()) {
            errors.push(`${block.type} image ${index + 1} requires alternative text.`);
          }
        });
      }
      if (Array.isArray(props.roles)) {
        props.roles.forEach((item, index) => {
          const role = asRecord(item);
          if (String(role.photo ?? "").trim() && !String(role.photoAlt ?? "").trim()) {
            const roleLabel = String(role.title ?? role.label ?? "").trim() || `role ${index + 1}`;
            errors.push(`${roleLabel} photo requires alternative text.`);
          }
        });
      }
    }
  }
  return errors;
}

function migrateBlockProps(type: string, defaults: Record<string, unknown>, source: Record<string, unknown>) {
  const result = clone(defaults);
  for (const field of EDITABLE_STRING_FIELDS[type] ?? []) {
    if (typeof source[field] === "string") result[field] = source[field];
  }

  if (type === "HeroBlock" && Array.isArray(source.images)) {
    const fallback = Array.isArray(defaults.images) ? defaults.images.map(asRecord) : [];
    const sourceImages = source.images;
    result.images = fallback.slice(0, 4).map((defaultItem, index) => {
      const image = asRecord(sourceImages[index]);
      const defaultImage = asRecord(defaultItem);
      return {
        url: approvedImageUrl(image.url, String(defaultImage.url ?? "")),
        alt: typeof image.alt === "string" ? image.alt.slice(0, 255) : String(defaultImage.alt ?? ""),
      };
    });
  }

  if (type === "QuickLinksBlock" && Array.isArray(source.links) && Array.isArray(defaults.links)) {
    const sourceLinks = source.links;
    result.links = defaults.links.map((defaultItem, index) => {
      const locked = asRecord(defaultItem);
      const incoming = asRecord(sourceLinks[index]);
      return {
        ...locked,
        label: typeof incoming.label === "string" ? incoming.label.slice(0, 120) : locked.label,
        description: typeof incoming.description === "string" ? incoming.description.slice(0, 300) : locked.description,
      };
    });
  }

  if (type === "OverviewBlock" && Array.isArray(defaults.pillars)) {
    const sourcePillars = Array.isArray(source.pillars) ? source.pillars.map(asRecord) : [];
    const defaultPillars = defaults.pillars.map(asRecord);
    result.pillars = defaultPillars.map((locked) => {
      const incoming = sourcePillars.find((pillar) => pillar.id === locked.id) ?? {};
      return {
        id: locked.id,
        label: locked.label,
        description: boundedRequiredString(incoming.description, String(locked.description ?? ""), 320),
      };
    });
    result.ctaLabel = defaults.ctaLabel;
    result.ctaHref = defaults.ctaHref;
    result.visualStyle = defaults.visualStyle;
  }

  if (type === "ImageFeatureBlock" && defaults.id === "org-chart" && Array.isArray(defaults.roles)) {
    const sourceRoles = Array.isArray(source.roles) ? source.roles.map(asRecord) : [];
    result.roles = ExperienceOrganizationRolesSchema.parse(defaults.roles.map((defaultItem) => {
      const locked = asRecord(defaultItem);
      const incoming = sourceRoles.find((role) => role.id === locked.id) ?? {};
      return {
        id: locked.id,
        title: boundedRequiredString(incoming.title, String(locked.title ?? ""), 160),
        label: boundedRequiredString(incoming.label, String(locked.label ?? ""), 120),
        caption: boundedRequiredString(incoming.caption, String(locked.caption ?? ""), 120),
        name: boundedOptionalString(incoming.name, String(locked.name ?? ""), 160),
        photo: approvedOptionalImageUrl(incoming.photo, String(locked.photo ?? "")),
        photoAlt: boundedOptionalString(incoming.photoAlt, String(locked.photoAlt ?? ""), 255),
        group: locked.group,
      };
    }));
  }

  for (const field of ["imageUrl", "backgroundImageUrl", "graphicLogoUrl", "logoUrl"]) {
    if (field in result && typeof source[field] === "string") {
      result[field] = approvedImageUrl(source[field], String(defaults[field] ?? ""));
    }
  }
  return result;
}

function boundedRequiredString(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

function boundedOptionalString(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function approvedOptionalImageUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  if (!value.trim()) return "";
  return approvedImageUrl(value, fallback);
}

function approvedImageUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const url = value.trim();
  return isApprovedImageUrl(url) ? url : fallback;
}

function isApprovedImageUrl(url: string) {
  const supportedRaster = /\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(url);
  return supportedRaster && (url.startsWith("/Components/images/") || url.startsWith("/storage/site-branding/"));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
