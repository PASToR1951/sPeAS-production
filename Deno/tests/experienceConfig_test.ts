import { assertEquals, assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  defaultExperienceConfig,
  EXPERIENCE_DEFAULT_ORGANIZATION_ROLES,
  EXPERIENCE_ORGANIZATION_ROLE_IDS,
  ExperienceOrganizationRolesSchema,
  FaqBlockPropsSchema,
  getExperiencePublishErrors,
  migrateExperienceConfigToV5,
} from "../shared/experienceConfig.ts";

Deno.test("v1 experience content migrates while layout and theme stay locked", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  input.schemaVersion = 1;
  input.theme = { primaryColor: "#FF0000" };
  input.pages.landing.data.content.reverse();
  const hero = input.pages.landing.data.content.find((block: any) => block.type === "HeroBlock");
  hero.props.title = "Approved new title";
  hero.props.primaryHref = "https://attacker.example";
  input.pages.landing.data.content.push({ type: "AnnouncementBanner", props: { text: "Injected" } });

  const migrated = migrateExperienceConfigToV5(input);
  assertEquals(migrated.schemaVersion, 5);
  assertEquals("theme" in migrated, false);
  assertEquals(migrated.pages.landing.data.content.map((block) => block.type), defaultExperienceConfig.pages.landing.data.content.map((block) => block.type));
  const migratedHero = migrated.pages.landing.data.content.find((block) => block.type === "HeroBlock")!;
  assertEquals(migratedHero.props.title, "Approved new title");
  assertEquals("primaryHref" in migratedHero.props, false);
  assertEquals(migratedHero.props.variant, "background-slideshow");
});

Deno.test("v2 content receives exactly one overview immediately after the hero", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  input.schemaVersion = 2;
  input.pages.landing.data.content = input.pages.landing.data.content.filter((block: any) => block.type !== "OverviewBlock");

  const migrated = migrateExperienceConfigToV5(input);
  assertEquals(migrated.schemaVersion, 5);
  const landingTypes = migrated.pages.landing.data.content.map((block) => block.type);
  assertEquals(landingTypes.filter((type) => type === "OverviewBlock").length, 1);
  assertEquals(landingTypes.slice(0, 2), ["HeroBlock", "OverviewBlock"]);

  const overview = migrated.pages.landing.data.content.find((block) => block.type === "OverviewBlock")!;
  assertEquals(overview.props.id, "peas-overview");
  assertEquals(overview.props.ctaHref, "/pages/searchResultsPage.html");
});

Deno.test("overview migration preserves approved copy and locks structure", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  input.schemaVersion = 3;
  const overview = input.pages.landing.data.content.find((block: any) => block.type === "OverviewBlock");
  overview.props.eyebrow = "A tailored overview";
  overview.props.title = "A shorter title";
  overview.props.summary = "A concise explanation of the repository.";
  overview.props.pillars = [
    { id: "access", label: "Changed access label", description: "Approved access copy." },
    { id: "preserve", label: "Changed preserve label", description: "Approved preserve copy." },
    { id: "injected", label: "Injected", description: "Must be discarded." },
  ];
  overview.props.ctaLabel = "Injected CTA";
  overview.props.ctaHref = "javascript:alert(1)";
  overview.props.visualStyle = "custom-shader";

  const migrated = migrateExperienceConfigToV5(input);
  const migratedOverview = migrated.pages.landing.data.content.find((block) => block.type === "OverviewBlock")!;
  assertEquals(migratedOverview.props.eyebrow, "A tailored overview");
  assertEquals(migratedOverview.props.title, "A shorter title");
  assertEquals(migratedOverview.props.summary, "A concise explanation of the repository.");
  assertEquals(migratedOverview.props.pillars, [
    { id: "preserve", label: "Preserve", description: "Approved preserve copy." },
    { id: "discover", label: "Discover", description: "Connects readers with research through structured metadata, authors, topics, keywords, and collection filters." },
    { id: "access", label: "Access", description: "Lets visitors open public research records and download available PDFs immediately, without an account." },
  ]);
  assertEquals(migratedOverview.props.ctaLabel, "Explore the repository");
  assertEquals(migratedOverview.props.ctaHref, "/pages/searchResultsPage.html");
  assertEquals(migratedOverview.props.visualStyle, "archive-rings");
});

Deno.test("hero keeps four stable slideshow slots while accepting replacements", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  const hero = input.pages.landing.data.content.find((block: any) => block.type === "HeroBlock");
  hero.props.images = [{
    url: "/storage/site-branding/hero/slot-1/replacement.webp",
    alt: "Replacement for the first hero photo",
  }];

  const migrated = migrateExperienceConfigToV5(input);
  const migratedHero = migrated.pages.landing.data.content.find((block) => block.type === "HeroBlock")!;
  const images = migratedHero.props.images as Array<{ url: string; alt: string }>;

  assertEquals(images.length, 4);
  assertEquals(images[0], {
    url: "/storage/site-branding/hero/slot-1/replacement.webp",
    alt: "Replacement for the first hero photo",
  });
  assertEquals(images.slice(1), (defaultExperienceConfig.pages.landing.data.content.find((block) =>
    block.type === "HeroBlock"
  )!.props.images as Array<{ url: string; alt: string }>).slice(1));
});

Deno.test("fixed quick-link destinations and agenda vocabulary cannot be changed", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  const quickLinks = input.pages.landing.data.content.find((block: any) => block.type === "QuickLinksBlock");
  quickLinks.props.links = [{ label: "Changed", description: "Changed", href: "javascript:alert(1)" }];
  const agenda = input.pages.landing.data.content.find((block: any) => block.type === "ResearchAgendaBlock");
  agenda.props.items = [{ text: "Legacy item must not be retained" }];
  const migrated = migrateExperienceConfigToV5(input);
  const nextQuickLinks = migrated.pages.landing.data.content.find((block) => block.type === "QuickLinksBlock")!;
  const nextAgenda = migrated.pages.landing.data.content.find((block) => block.type === "ResearchAgendaBlock")!;
  assertEquals((nextQuickLinks.props.links as any[])[0].href, "#mission");
  assertEquals(nextAgenda.props.items, undefined);
});

Deno.test("publishing requires alt text for meaningful images", () => {
  const config = structuredClone(defaultExperienceConfig);
  const hero = config.pages.landing.data.content.find((block) => block.type === "HeroBlock")!;
  (hero.props.images as any[])[0].alt = "";
  assert(getExperiencePublishErrors(config).some((error) => error.includes("requires alternative text")));
});

Deno.test("organization roles keep fixed identity, order, and group classification", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  const chart = input.pages.landing.data.content.find((block: any) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  );
  const roles = chart.props.roles as any[];
  const director = roles.find((role) => role.id === "director-orp");
  Object.assign(director, {
    title: "  Director of Research  ",
    label: "  Research Director  ",
    caption: "  Research Office  ",
    name: "  Dr. Ada Paul  ",
    photo: "  /storage/site-branding/team/director.webp  ",
    photoAlt: "  Dr. Ada Paul in university attire  ",
    group: true,
    summary: "  Coordinates the university research and publication program.  ",
  });
  Object.assign(roles.find((role) => role.id === "president"), {
    title: "   ",
    label: "   ",
    caption: "   ",
    name: "   ",
    summary: "   ",
  });
  roles.find((role) => role.id === "editorial-board").group = false;
  chart.props.roles = roles.reverse();
  chart.props.roles.push({
    id: "injected-role",
    title: "Injected",
    group: false,
  });

  const migrated = migrateExperienceConfigToV5(input);
  const migratedChart = migrated.pages.landing.data.content.find((block) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  )!;
  const migratedRoles = migratedChart.props.roles as any[];
  const migratedDirector = migratedRoles.find((role) =>
    role.id === "director-orp"
  );
  const migratedPresident = migratedRoles.find((role) =>
    role.id === "president"
  );

  assertEquals(migratedRoles.map((role) => role.id), [
    ...EXPERIENCE_ORGANIZATION_ROLE_IDS,
  ]);
  assertEquals(
    migratedRoles.map((role) => role.group),
    EXPERIENCE_DEFAULT_ORGANIZATION_ROLES.map((role) => role.group),
  );
  assertEquals(migratedDirector, {
    id: "director-orp",
    title: "Director of Research",
    label: "Research Director",
    caption: "Research Office",
    name: "Dr. Ada Paul",
    photo: "/storage/site-branding/team/director.webp",
    photoAlt: "Dr. Ada Paul in university attire",
    group: false,
  });
  assertEquals("summary" in migratedDirector, false);
  assertEquals(migratedPresident, EXPERIENCE_DEFAULT_ORGANIZATION_ROLES[0]);
  ExperienceOrganizationRolesSchema.parse(migratedRoles);
});

Deno.test("organization role migration supplies defaults and rejects unapproved photo URLs", () => {
  const legacy = structuredClone(defaultExperienceConfig) as any;
  legacy.schemaVersion = 1;
  const legacyChart = legacy.pages.landing.data.content.find((block: any) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  );
  delete legacyChart.props.roles;
  const migratedLegacy = migrateExperienceConfigToV5(legacy);
  const migratedLegacyChart = migratedLegacy.pages.landing.data.content.find((
    block,
  ) => block.type === "ImageFeatureBlock" && block.props.id === "org-chart")!;
  assertEquals(
    migratedLegacyChart.props.roles,
    EXPERIENCE_DEFAULT_ORGANIZATION_ROLES,
  );

  const input = structuredClone(defaultExperienceConfig) as any;
  const chart = input.pages.landing.data.content.find((block: any) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  );
  chart.props.roles.find((role: any) => role.id === "president").photo =
    "https://attacker.example/president.png";
  const migrated = migrateExperienceConfigToV5(input);
  const migratedChart = migrated.pages.landing.data.content.find((block) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  )!;
  const president = (migratedChart.props.roles as any[]).find((role) =>
    role.id === "president"
  );
  assertEquals(president.photo, "");
});

Deno.test("publishing requires alt text for organization role photos", () => {
  const config = structuredClone(defaultExperienceConfig);
  const chart = config.pages.landing.data.content.find((block) =>
    block.type === "ImageFeatureBlock" && block.props.id === "org-chart"
  )!;
  const president = (chart.props.roles as any[]).find((role) =>
    role.id === "president"
  );
  president.photo = "/storage/site-branding/team/president.png";
  president.photoAlt = "";

  assert(
    getExperiencePublishErrors(config).includes(
      "University President photo requires alternative text.",
    ),
  );
});

Deno.test("legacy experience versions receive the seeded FAQ page", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  input.schemaVersion = 3;
  delete input.pages.faq;

  const migrated = migrateExperienceConfigToV5(input);
  assertEquals(migrated.schemaVersion, 5);
  const faq = migrated.pages.faq.data.content.find((block) => block.type === "FaqBlock")!;
  const props = FaqBlockPropsSchema.parse(faq.props);
  assertEquals(props.categories.length, 4);
  assertEquals(props.categories.reduce((sum, category) => sum + category.items.length, 0), 11);
  assertEquals(props.contactHref, "/contact.html");
});

Deno.test("v4 request-specific FAQ IDs migrate to direct downloads without discarding custom content", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  input.schemaVersion = 4;
  const overview = input.pages.landing.data.content.find((block: any) => block.type === "OverviewBlock");
  overview.props.summary = "The Paulinian electronic Archiving System preserves the university's academic works, makes scholarship easier to discover, and provides role-appropriate access to repository materials.";
  const faq = input.pages.faq.data.content.find((block: any) => block.type === "FaqBlock");
  const accounts = faq.props.categories.find((category: any) => category.id === "accounts-and-access");
  accounts.items.find((item: any) => item.id === "full-paper-access").answer = "Administrator approval is required.";
  accounts.items.push({
    id: "outsider-access-request",
    question: "How do I request access?",
    answer: "Submit identity information for approval.",
  });
  faq.props.categories.splice(3, 0, {
    id: "verified-request-access",
    label: "Approved request access",
    items: [
      { id: "verify-request-email", question: "Why verify?", answer: "To verify the requester." },
      { id: "custom-reading-help", question: "Where can I get reading help?", answer: "Contact the library desk." },
    ],
  });

  const migrated = migrateExperienceConfigToV5(input);
  const migratedOverview = migrated.pages.landing.data.content.find((block) => block.type === "OverviewBlock")!;
  const migratedFaq = FaqBlockPropsSchema.parse(
    migrated.pages.faq.data.content.find((block) => block.type === "FaqBlock")!.props,
  );
  assertEquals(migrated.schemaVersion, 5);
  assertEquals(migratedOverview.props.summary, "The Paulinian electronic Archiving System preserves the university's academic works, makes approved scholarship easier to discover, and provides immediate downloads for available public PDFs.");
  assertEquals(migratedFaq.categories.some((category) => category.id === "verified-request-access"), false);
  assertEquals(migratedFaq.categories.some((category) => category.items.some((item) => item.id === "outsider-access-request")), false);
  const migratedAccounts = migratedFaq.categories.find((category) => category.id === "accounts-and-access")!;
  assertEquals(migratedAccounts.items.find((item) => item.id === "full-paper-access")?.question, "How do I download a full paper?");
  assertEquals(migratedAccounts.items.find((item) => item.id === "custom-reading-help")?.answer, "Contact the library desk.");
});

Deno.test("v5 preserves current administrator-authored direct-download copy", () => {
  const input = structuredClone(defaultExperienceConfig) as any;
  const overview = input.pages.landing.data.content.find((block: any) => block.type === "OverviewBlock");
  overview.props.pillars.find((pillar: any) => pillar.id === "access").description = "Public PDFs are available from each eligible record.";
  const faq = input.pages.faq.data.content.find((block: any) => block.type === "FaqBlock");
  faq.props.categories.find((category: any) => category.id === "accounts-and-access")
    .items.find((item: any) => item.id === "full-paper-access").answer = "Choose the download action on the public record.";

  const migrated = migrateExperienceConfigToV5(input);
  const migratedOverview = migrated.pages.landing.data.content.find((block) => block.type === "OverviewBlock")!;
  const migratedFaq = FaqBlockPropsSchema.parse(migrated.pages.faq.data.content.find((block) => block.type === "FaqBlock")!.props);
  assertEquals((migratedOverview.props.pillars as any[]).find((pillar) => pillar.id === "access").description, "Public PDFs are available from each eligible record.");
  assertEquals(migratedFaq.categories.find((category) => category.id === "accounts-and-access")!.items.find((item) => item.id === "full-paper-access")!.answer, "Choose the download action on the public record.");
});

Deno.test("FAQ schema rejects duplicate questions and HTML answers", () => {
  const faq = structuredClone(defaultExperienceConfig.pages.faq.data.content[0].props) as any;
  faq.categories[1].items[0].question = faq.categories[0].items[0].question;
  faq.categories[1].items[0].answer = "<strong>Unsafe markup</strong>";
  assert(!FaqBlockPropsSchema.safeParse(faq).success);
});

Deno.test("FAQ schema enforces limits, IDs, duplicate categories, and plain-text headings", () => {
  const base = structuredClone(defaultExperienceConfig.pages.faq.data.content[0].props) as any;
  const tooManyCategories = structuredClone(base);
  tooManyCategories.categories = Array.from({ length: 9 }, (_, index) => ({
    id: `category-${index}`,
    label: `Category ${index}`,
    items: [{ id: `item-${index}`, question: `Question ${index}`, answer: "Answer" }],
  }));
  assert(!FaqBlockPropsSchema.safeParse(tooManyCategories).success);

  const duplicateCategory = structuredClone(base);
  duplicateCategory.categories[1].label = `  ${duplicateCategory.categories[0].label.toUpperCase()}  `;
  assert(!FaqBlockPropsSchema.safeParse(duplicateCategory).success);

  const unsupportedId = structuredClone(base);
  unsupportedId.categories[0].items[0].id = "not valid";
  assert(!FaqBlockPropsSchema.safeParse(unsupportedId).success);

  const markupTitle = structuredClone(base);
  markupTitle.title = "<em>Unsafe</em>";
  assert(!FaqBlockPropsSchema.safeParse(markupTitle).success);
});
