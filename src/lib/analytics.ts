/**
 * analytics.ts — sole PostHog integration point.
 *
 * No other file may import posthog-js directly. All calls are no-ops until
 * initialized, wrapped in try/catch so analytics can never break app behavior.
 *
 * PRIVACY: event properties may only contain module names, numeric counts,
 * file sizes, file extensions, and booleans — never user-uploaded data.
 */

import posthog from "posthog-js";

const POSTHOG_API_KEY = "phc_xoKqgnfgY8NhDqQRpGNPQonPDV3ZVgTcuucyeaPbPYL7";

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (!import.meta.env.PROD) return; // production only
  if (!POSTHOG_API_KEY) return; // no key → silently no-op
  try {
    posthog.init(POSTHOG_API_KEY, {
      api_host: "https://us.i.posthog.com",
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      capture_pageleave: true,
      persistence: "localStorage",
    });
    initialized = true;
  } catch {
    // analytics must never throw into the app
  }
}

export function trackPageview(path: string): void {
  if (!initialized) return;
  try {
    posthog.capture("$pageview", { $current_url: window.location.origin + path });
  } catch {
    // no-op
  }
}

export function track(
  event: string,
  props?: Record<string, string | number | boolean>
): void {
  if (!initialized) return;
  try {
    posthog.capture(event, props);
  } catch {
    // no-op
  }
}
