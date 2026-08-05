import { assertEquals, assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  defaultExperienceConfig,
  EXPERIENCE_DEFAULT_ORGANIZATION_ROLES,
  EXPERIENCE_ORGANIZATION_ROLE_IDS,
  ExperienceOrganizationRolesSchema,
  getExperiencePublishErrors,
  migrateExperienceConfigToV3,
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

  const migrated = migrateExperienceConfigToV3(input);
  assertEquals(migrated.schemaVersion, 3);
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

  const migrated = migrateExperienceConfigToV3(input);
  assertEquals(migrated.schemaVersion, 3);
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

  const migrated = migrateExperienceConfigToV3(input);
  const migratedOverview = migrated.pages.landing.data.content.find((block) => block.type === "OverviewBlock")!;
  assertEquals(migratedOverview.props.eyebrow, "A tailored overview");
  assertEquals(migratedOverview.props.title, "A shorter title");
  assertEquals(migratedOverview.props.summary, "A concise explanation of the repository.");
  assertEquals(migratedOverview.props.pillars, [
    { id: "preserve", label: "Preserve", description: "Approved preserve copy." },
    { id: "discover", label: "Discover", description: "Connects readers with research through structured metadata, authors, topics, keywords, and collection filters." },
    { id: "access", label: "Access", description: "Approved access copy." },
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

  const migrated = migrateExperienceConfigToV3(input);
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
  const migrated = migrateExperienceConfigToV3(input);
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

  const migrated = migrateExperienceConfigToV3(input);
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
  const migratedLegacy = migrateExperienceConfigToV3(legacy);
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
  const migrated = migrateExperienceConfigToV3(input);
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
