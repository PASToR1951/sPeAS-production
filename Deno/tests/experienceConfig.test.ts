import {
  defaultExperienceConfig,
  parseExperienceConfig,
  parseUserExperiencePreferences,
} from "../shared/experienceConfig.ts";

Deno.test("default experience config is valid", () => {
  const parsed = parseExperienceConfig(defaultExperienceConfig);
  if (parsed.schemaVersion !== 6) {
    throw new Error("Expected schema version 6");
  }
  if (!parsed.pages.landing.data.content.length || !parsed.pages.login.data.content.length || !parsed.pages.faq.data.content.length) {
    throw new Error("Expected landing, login, and FAQ defaults");
  }
});

Deno.test("experience config rejects unknown schema versions", () => {
  let didThrow = false;
  try {
    parseExperienceConfig({
      ...defaultExperienceConfig,
      schemaVersion: 999,
    });
  } catch {
    didThrow = true;
  }

  if (!didThrow) {
    throw new Error("Expected schema validation to reject unknown schema version");
  }
});

Deno.test("user experience preferences default safely", () => {
  const preferences = parseUserExperiencePreferences({});
  if (preferences.landingDensity !== "comfortable") {
    throw new Error("Expected comfortable density default");
  }
  if (preferences.preferredModules.length || preferences.hiddenModules.length) {
    throw new Error("Expected empty module defaults");
  }
});
