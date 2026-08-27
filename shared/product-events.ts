import { z } from "zod";

const eventKeySchema = z.string().regex(/^[a-f0-9]{32}$/);

export const productEventPayloadSchema = z.discriminatedUnion("eventName", [
  z.object({
    eventName: z.literal("dashboard_opened"),
    eventKey: eventKeySchema,
    properties: z.object({}).strict(),
  }),
  z.object({
    eventName: z.literal("scan_summary_viewed"),
    eventKey: eventKeySchema,
    properties: z
      .object({
        statusBucket: z.enum(["no_orders", "no_matches", "matches_found"]),
      })
      .strict(),
  }),
  z.object({
    eventName: z.literal("match_review_opened"),
    eventKey: eventKeySchema,
    properties: z.object({}).strict(),
  }),
  z.object({
    eventName: z.literal("quota_banner_seen"),
    eventKey: eventKeySchema,
    properties: z
      .object({
        status: z.enum(["warning", "exceeded"]),
        percentageBucket: z.enum(["80-89", "90-99", "100+"]),
      })
      .strict(),
  }),
]);

export type ProductEventPayload = z.infer<typeof productEventPayloadSchema>;

export type ProductEventName = ProductEventPayload["eventName"];
export const PRODUCT_EVENT_NAMES: ProductEventName[] = [
  "dashboard_opened",
  "scan_summary_viewed",
  "match_review_opened",
  "quota_banner_seen",
];
