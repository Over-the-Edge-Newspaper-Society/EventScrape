"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Node-runtime port of apps/api/src/services/wordpress-client.ts (uploadEvents)
// and apps/api/src/routes/wordpress.ts (POST /upload). Runs in Convex's Node
// runtime so it can use Buffer for Basic-auth + binary media upload.
//
// Differences from the original, called out for review:
//  - The original loaded events from `eventsRaw` only. Here events come from the
//    `getEventsForUpload` internalQuery, which accepts both eventsRaw and
//    eventsCanonical ids (the admin selects canonical events). For canonical
//    events, `raw` / `sourceId` / `localImageStorageId` are resolved from the
//    first merged raw event.
//  - Timestamps are now epoch-ms numbers (not strings/Dates); the date/time
//    extraction logic is reproduced 1:1 otherwise.
//  - Media: if includeMedia and the event has a `localImageStorageId`, the image
//    is resolved through Convex storage (ctx.storage.getUrl) and that URL is used
//    as the media source. Otherwise the event's imageUrl is used (original
//    behaviour).

interface WordPressEvent {
  title: string;
  content: string;
  status?: "publish" | "draft" | "pending";
  excerpt?: string;
  external_id?: string;
  meta?: Record<string, any>;
  event_meta?: Record<string, any>;
  featured_media?: number;
  categories?: number[];
  tags?: number[];
  series_data?: {
    occurrence_type?: "single" | "multi_day" | "all_day" | "recurring" | "virtual";
    recurrence_type?: "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
    recurrence_pattern?: string;
    is_all_day?: boolean;
    is_virtual?: boolean;
    event_status?: "scheduled" | "canceled" | "postponed";
    status_reason?: string;
  };
  occurrences?: Array<{
    sequence: number;
    start_datetime: string;
    end_datetime?: string;
    is_provisional?: boolean;
  }>;
}

interface WordPressUploadResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
  action?: "created" | "updated" | "skipped";
  occurrencesCreated?: number;
}

interface ClubData {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
  profileUrl?: string | null;
  platform?: string | null;
}

class WordPressClient {
  private siteUrl: string;
  private username: string;
  private applicationPassword: string;

  constructor(settings: { siteUrl: string; username: string; applicationPassword: string }) {
    this.siteUrl = settings.siteUrl.replace(/\/$/, "");
    this.username = settings.username;
    this.applicationPassword = settings.applicationPassword;
  }

  private getAuthHeaders(): Record<string, string> {
    const credentials = Buffer.from(
      `${this.username}:${this.applicationPassword}`,
    ).toString("base64");

    return {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    };
  }

  async uploadMedia(
    imageUrl: string,
    filename?: string,
  ): Promise<{ mediaId?: number; error?: string }> {
    try {
      if (filename) {
        const searchResponse = await fetch(
          `${this.siteUrl}/wp-json/wp/v2/media?search=${encodeURIComponent(filename)}&per_page=1`,
          { method: "GET", headers: this.getAuthHeaders() },
        );

        if (searchResponse.ok) {
          const existingMedia = (await searchResponse.json()) as Array<{ id: number }>;
          if (existingMedia.length > 0) {
            console.log(
              `[WordPress Client] Reusing existing media ID ${existingMedia[0].id} for ${filename}`,
            );
            return { mediaId: existingMedia[0].id };
          }
        }
      }

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        return { error: `Failed to download image from ${imageUrl}` };
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

      const uploadResponse = await fetch(`${this.siteUrl}/wp-json/wp/v2/media`, {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeaders().Authorization as string,
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename || "event-image.jpg"}"`,
        },
        body: Buffer.from(imageBuffer),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text();
        return { error: `Media upload failed: ${error}` };
      }

      const media = (await uploadResponse.json()) as { id: number };
      return { mediaId: media.id };
    } catch (error: any) {
      return { error: `Media upload error: ${error.message}` };
    }
  }

  private async matchOrganization(clubData?: ClubData): Promise<string | null> {
    if (!clubData) return null;

    try {
      const response = await fetch(
        `${this.siteUrl}/wp-json/wp/v2/organization?per_page=100&_fields=id,org_instagram`,
        { method: "GET", headers: this.getAuthHeaders() },
      );

      if (!response.ok) {
        console.warn("Failed to fetch organizations from WordPress:", response.status);
        return null;
      }

      const organizations = (await response.json()) as Array<{
        id: number;
        org_instagram?: string;
      }>;

      const normalizedClubUrl = clubData.profileUrl
        ? this.normalizeInstagramUrl(clubData.profileUrl)
        : null;

      for (const org of organizations) {
        const orgInstagram = org.org_instagram ? String(org.org_instagram).trim() : null;
        if (!orgInstagram) continue;

        const normalizedOrgUrl = this.normalizeInstagramUrl(orgInstagram);

        if (normalizedClubUrl && normalizedOrgUrl === normalizedClubUrl) {
          return org.id.toString();
        }

        if (clubData.username) {
          const normalizedUsername = clubData.username
            .replace(/^@/, "")
            .toLowerCase()
            .trim();

          let orgUsername = orgInstagram.toLowerCase();
          if (orgInstagram.includes("instagram.com")) {
            const match = orgInstagram.match(/instagram\.com\/([^\/\?]+)/);
            if (match) orgUsername = match[1].toLowerCase().trim();
          } else {
            orgUsername = orgInstagram.replace(/^@/, "").toLowerCase().trim();
          }

          if (orgUsername === normalizedUsername) {
            return org.id.toString();
          }
        }
      }

      return null;
    } catch (error: any) {
      console.error("Error matching organization:", error.message);
      return null;
    }
  }

  private normalizeInstagramUrl(url: string): string {
    return url
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
      .replace(/\/$/, "")
      .toLowerCase()
      .trim();
  }

  private convertToLocalDateTime(
    utcDatetime: Date,
    timezone: string = "UTC",
  ): { date: string; time: string } {
    try {
      const localDatetime = new Date(
        utcDatetime.toLocaleString("en-US", { timeZone: timezone }),
      );

      const year = localDatetime.getFullYear();
      const month = String(localDatetime.getMonth() + 1).padStart(2, "0");
      const day = String(localDatetime.getDate()).padStart(2, "0");
      const hours = String(localDatetime.getHours()).padStart(2, "0");
      const minutes = String(localDatetime.getMinutes()).padStart(2, "0");
      const seconds = String(localDatetime.getSeconds()).padStart(2, "0");

      return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}:${seconds}` };
    } catch {
      const year = utcDatetime.getUTCFullYear();
      const month = String(utcDatetime.getUTCMonth() + 1).padStart(2, "0");
      const day = String(utcDatetime.getUTCDate()).padStart(2, "0");
      const hours = String(utcDatetime.getUTCHours()).padStart(2, "0");
      const minutes = String(utcDatetime.getUTCMinutes()).padStart(2, "0");
      const seconds = String(utcDatetime.getUTCSeconds()).padStart(2, "0");

      return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}:${seconds}` };
    }
  }

  async createEvent(event: WordPressEvent): Promise<WordPressUploadResult> {
    try {
      const endpoint = `${this.siteUrl}/wp-json/wp/v2/events`;
      const method = "POST";

      const requestBody = {
        title: event.title,
        content: event.content,
        status: event.status || "draft",
        excerpt: event.excerpt,
        external_id: event.external_id,
        meta: event.meta,
        event_meta: event.event_meta,
        featured_media: event.featured_media,
        event_category: event.categories,
        tags: event.tags,
      };

      const response = await fetch(endpoint, {
        method,
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Post creation/update failed: ${response.status} - ${error}`,
        };
      }

      const post = (await response.json()) as { id: number; link: string };
      return { success: true, postId: post.id, postUrl: post.link, action: "created" };
    } catch (error: any) {
      return { success: false, error: `Post operation error: ${error.message}` };
    }
  }

  async importEventWithOccurrences(
    event: WordPressEvent,
    imageUrl?: string,
    updateIfExists: boolean = false,
    clubData?: ClubData,
  ): Promise<WordPressUploadResult> {
    try {
      const endpoint = `${this.siteUrl}/wp-json/unbc-events/v1/import-event`;

      let organizationId: string | null = null;
      if (clubData) {
        organizationId = await this.matchOrganization(clubData);
      }

      const meta = event.event_meta || event.meta || {};
      if (organizationId) {
        (meta as any).organization_id = organizationId;
      }

      const requestBody = {
        event: {
          title: event.title,
          description: event.content,
          status: event.status || "publish",
          external_id: event.external_id,
          meta,
          series_data: event.series_data,
          occurrences: event.occurrences,
          featured_media_url: imageUrl,
          categories: event.categories,
        },
        update_if_exists: updateIfExists,
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Event import failed: ${response.status} - ${error}` };
      }

      const result = (await response.json()) as {
        success: boolean;
        action: "created" | "updated";
        post_id: number;
        post_url: string;
        series_created: boolean;
        occurrences_created: number;
      };

      return {
        success: true,
        postId: result.post_id,
        postUrl: result.post_url,
        action: result.action,
        occurrencesCreated: result.occurrences_created,
      };
    } catch (error: any) {
      return { success: false, error: `Event import error: ${error.message}` };
    }
  }

  async uploadEvents(
    events: Array<{
      id: string;
      rawEventId?: string;
      title: string;
      descriptionHtml?: string;
      startDatetime: number | string | Date;
      endDatetime?: number | string | Date;
      timezone?: string;
      venueName?: string;
      venueAddress?: string;
      city?: string;
      organizer?: string;
      category?: string;
      url?: string;
      imageUrl?: string;
      raw?: any;
      sourceId?: string;
      sourceLegacyId?: string;
    }>,
    options: {
      status?: "publish" | "draft" | "pending";
      updateIfExists?: boolean;
      sourceCategoryMappings?: Record<string, number> | string;
      includeMedia?: boolean;
    } = {},
  ): Promise<Array<{ event: any; result: WordPressUploadResult }>> {
    const results: Array<{ event: any; result: WordPressUploadResult }> = [];

    for (const event of events) {
      let clubData: ClubData | undefined;
      if (event.raw?.massPosterMeta?.club) {
        clubData = event.raw.massPosterMeta.club;
      }

      let localStart: { date: string; time: string };
      let localEnd: { date: string; time: string } | null = null;

      if (event.raw?.events?.[0]) {
        const rawEvent = event.raw.events[0];
        localStart = {
          date: rawEvent.startDate || new Date(event.startDatetime).toISOString().split("T")[0],
          time: rawEvent.startTime || "00:00:00",
        };
        if (rawEvent.endDate && rawEvent.endTime) {
          localEnd = { date: rawEvent.endDate, time: rawEvent.endTime };
        }
      } else {
        const startDate = new Date(event.startDatetime);
        const endDate = event.endDatetime ? new Date(event.endDatetime) : null;

        localStart = this.convertToLocalDateTime(startDate, event.timezone || "UTC");
        localEnd = endDate
          ? this.convertToLocalDateTime(endDate, event.timezone || "UTC")
          : null;
      }

      const mappings =
        typeof options.sourceCategoryMappings === "string"
          ? JSON.parse(options.sourceCategoryMappings)
          : options.sourceCategoryMappings;

      // Mappings may be keyed by the source's Convex _id OR its legacy UUID —
      // try both so categories resolve regardless of which key was configured.
      let categoryId: number | undefined;
      if (mappings) {
        categoryId =
          (event.sourceId ? mappings[event.sourceId] : undefined) ??
          (event.sourceLegacyId ? mappings[event.sourceLegacyId] : undefined);
      }

      const hasSeriesData =
        event.raw?.seriesDates &&
        Array.isArray(event.raw.seriesDates) &&
        event.raw.seriesDates.length > 1;

      if (hasSeriesData) {
        const seriesDates = event.raw.seriesDates;

        const wpEvent: WordPressEvent = {
          title: event.title,
          content: event.descriptionHtml || "",
          status: options.status || "draft",
          external_id: event.id,
          event_meta: {
            date: localStart.date,
            start_time: localStart.time,
            end_time: localEnd?.time || "",
            location: event.venueName || "",
            cost: "",
            organization: "",
            featured: false,
            website: event.url || "",
          },
          categories: categoryId ? [categoryId] : undefined,
          series_data: { occurrence_type: "recurring", recurrence_type: "custom" },
          occurrences: seriesDates.map((dateInfo: any, index: number) => {
            const occStart = new Date(dateInfo.start);
            const occEnd = dateInfo.end ? new Date(dateInfo.end) : null;
            const localOccStart = this.convertToLocalDateTime(
              occStart,
              event.timezone || "UTC",
            );
            const localOccEnd = occEnd
              ? this.convertToLocalDateTime(occEnd, event.timezone || "UTC")
              : null;

            return {
              sequence: index + 1,
              start_datetime: `${localOccStart.date} ${localOccStart.time}`,
              end_datetime: localOccEnd
                ? `${localOccEnd.date} ${localOccEnd.time}`
                : undefined,
              is_provisional: false,
            };
          }),
        };

        const result = await this.importEventWithOccurrences(
          wpEvent,
          event.imageUrl,
          options.updateIfExists || false,
          clubData,
        );
        results.push({ event, result });
      } else {
        const wpEvent: WordPressEvent = {
          title: event.title,
          content: event.descriptionHtml || "",
          status: options.status || "draft",
          external_id: event.id,
          event_meta: {
            date: localStart.date,
            start_time: localStart.time,
            end_time: localEnd?.time || "",
            location: event.venueName || "",
            cost: "",
            organization: "",
            featured: false,
            website: event.url || "",
          },
          categories: categoryId ? [categoryId] : undefined,
          series_data: { occurrence_type: "single", recurrence_type: "none" },
          occurrences: [
            {
              sequence: 1,
              start_datetime: `${localStart.date} ${localStart.time}`,
              end_datetime: localEnd ? `${localEnd.date} ${localEnd.time}` : undefined,
              is_provisional: false,
            },
          ],
        };

        const result = await this.importEventWithOccurrences(
          wpEvent,
          event.imageUrl,
          options.updateIfExists || false,
          clubData,
        );
        results.push({ event, result });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}

// action: ports POST /wordpress/upload. Publishes the given events to WordPress
// synchronously and returns the per-event success/failure results array.
export const uploadEvents = action({
  args: {
    settingsId: v.id("wordpressSettings"),
    eventIds: v.array(v.string()),
    status: v.optional(
      v.union(v.literal("publish"), v.literal("draft"), v.literal("pending")),
    ),
    updateIfExists: v.optional(v.boolean()),
  },
  returns: v.object({ message: v.string(), results: v.array(v.any()) }),
  handler: async (ctx, args): Promise<{ message: string; results: any[] }> => {
    const settings: any = await ctx.runQuery(internal.wordpress.getSettingWithSecret, {
      id: args.settingsId,
    });

    if (!settings) {
      throw new Error("WordPress setting not found");
    }
    if (!settings.active) {
      throw new Error("WordPress setting is not active");
    }

    const events: any[] = await ctx.runQuery(internal.wordpress.getEventsForUpload, {
      ids: args.eventIds,
    });

    if (events.length === 0) {
      throw new Error("No events found");
    }

    const includeMedia = settings.includeMedia !== false;

    // Resolve Convex-stored images to a public URL so the WP client can fetch
    // the bytes. Falls back to the event's own imageUrl when there's no stored
    // image (original behaviour).
    const preparedEvents = await Promise.all(
      events.map(async (e) => {
        let imageUrl = e.imageUrl;
        if (includeMedia && e.localImageStorageId) {
          const storageUrl = await ctx.storage.getUrl(e.localImageStorageId);
          if (storageUrl) imageUrl = storageUrl;
        }
        return {
          id: e.id,
          rawEventId: e.rawEventId,
          title: e.title,
          descriptionHtml: e.descriptionHtml,
          startDatetime: e.startDatetime,
          endDatetime: e.endDatetime,
          timezone: e.timezone,
          venueName: e.venueName,
          venueAddress: e.venueAddress,
          city: e.city,
          organizer: e.organizer,
          category: e.category,
          url: e.url,
          imageUrl,
          raw: e.raw,
          sourceId: e.sourceId,
          sourceLegacyId: e.sourceLegacyId,
        };
      }),
    );

    const client = new WordPressClient({
      siteUrl: settings.siteUrl,
      username: settings.username,
      applicationPassword: settings.applicationPassword,
    });

    const results = await client.uploadEvents(preparedEvents, {
      status: args.status || "draft",
      updateIfExists: args.updateIfExists ?? false,
      sourceCategoryMappings:
        (settings.sourceCategoryMappings as Record<string, number>) || {},
      includeMedia,
    });

    const successCount = results.filter((r) => r.result.success).length;
    const failureCount = results.length - successCount;

    return {
      message: `Uploaded ${successCount} events, ${failureCount} failed`,
      results,
    };
  },
});
