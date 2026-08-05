import { assert, assertEquals, assertThrows, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  NEWS_MEDIA_LIMITS,
  NEWS_MEDIA_PART_SIZE,
  normalizeWebVtt,
  validateNewsMediaInput,
  type NewsMediaInput,
} from "../services/newsMediaService.ts";

const input = (overrides: Partial<NewsMediaInput> = {}): NewsMediaInput => ({
  mediaType: "image",
  originalName: "photo.webp",
  sourceMime: "image/webp",
  sourceSize: 1024,
  ...overrides,
});

Deno.test("news media migration is additive and idempotent", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_news_media.sql", import.meta.url));
  for (const table of ["news_media_assets", "news_media_variants", "news_media_tracks", "news_media_upload_sessions", "news_media_jobs", "news_post_media"]) {
    assertStringIncludes(sql, `CREATE TABLE IF NOT EXISTS public.${table}`);
  }
  assertStringIncludes(sql, "ALTER TABLE public.news_posts");
  assertStringIncludes(sql, "ADD COLUMN IF NOT EXISTS cover_media_id");
  const worker = await Deno.readTextFile(new URL("../services/newsMediaService.ts", import.meta.url));
  assertStringIncludes(worker, "FOR UPDATE SKIP LOCKED");
});

Deno.test("news media input enforces type and size limits", () => {
  validateNewsMediaInput(input());
  validateNewsMediaInput(input({ mediaType: "audio", originalName: "recording.m4a", sourceMime: "audio/mp4", sourceSize: 1024 }));
  validateNewsMediaInput(input({ mediaType: "video", originalName: "clip.mp4", sourceMime: "video/mp4", sourceSize: 1024 }));
  assertThrows(() => validateNewsMediaInput(input({ sourceMime: "image/gif" })));
  assertThrows(() => validateNewsMediaInput(input({ sourceSize: NEWS_MEDIA_LIMITS.image.maxBytes + 1 })));
  assertThrows(() => validateNewsMediaInput(input({ originalName: "" })));
  assertEquals(NEWS_MEDIA_PART_SIZE, 16 * 1024 * 1024);
});

Deno.test("captions accept WebVTT and normalize SRT", () => {
  assertStringIncludes(normalizeWebVtt("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello"), "WEBVTT");
  assertStringIncludes(normalizeWebVtt("1\n00:00:00,000 --> 00:00:01,000\nHello"), "00:00:00.000 --> 00:00:01.000");
  assertThrows(() => normalizeWebVtt("not a caption file"));
});
