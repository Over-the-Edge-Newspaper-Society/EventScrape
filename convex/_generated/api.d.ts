/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cronMatch from "../cronMatch.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as events from "../events.js";
import type * as exports from "../exports.js";
import type * as instagramAccounts from "../instagramAccounts.js";
import type * as instagramReview from "../instagramReview.js";
import type * as instagramSettings from "../instagramSettings.js";
import type * as jobs from "../jobs.js";
import type * as matches from "../matches.js";
import type * as migration from "../migration.js";
import type * as openrouter from "../openrouter.js";
import type * as runLogs from "../runLogs.js";
import type * as runs from "../runs.js";
import type * as schedules from "../schedules.js";
import type * as sources from "../sources.js";
import type * as storage from "../storage.js";
import type * as systemSettings from "../systemSettings.js";
import type * as wordpress from "../wordpress.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cronMatch: typeof cronMatch;
  crons: typeof crons;
  dashboard: typeof dashboard;
  events: typeof events;
  exports: typeof exports;
  instagramAccounts: typeof instagramAccounts;
  instagramReview: typeof instagramReview;
  instagramSettings: typeof instagramSettings;
  jobs: typeof jobs;
  matches: typeof matches;
  migration: typeof migration;
  openrouter: typeof openrouter;
  runLogs: typeof runLogs;
  runs: typeof runs;
  schedules: typeof schedules;
  sources: typeof sources;
  storage: typeof storage;
  systemSettings: typeof systemSettings;
  wordpress: typeof wordpress;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
