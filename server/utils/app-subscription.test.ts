import { describe, expect, it } from "vitest";
import {
  parseAppSubscriptionChargeId,
  shouldProcessAppSubscriptionTermination,
} from "./app-subscription";

describe("parseAppSubscriptionChargeId", () => {
  it("reads numeric id field when present", () => {
    expect(
      parseAppSubscriptionChargeId({
        id: 37757518115,
        admin_graphql_api_id: "gid://shopify/AppSubscription/999",
      })
    ).toBe("37757518115");
  });

  it("parses id from admin_graphql_api_id when id is missing", () => {
    expect(
      parseAppSubscriptionChargeId({
        admin_graphql_api_id: "gid://shopify/AppSubscription/37757518115",
      })
    ).toBe("37757518115");
  });

  it("returns null when no id is available", () => {
    expect(parseAppSubscriptionChargeId({ status: "EXPIRED" })).toBeNull();
  });
});

describe("shouldProcessAppSubscriptionTermination", () => {
  it("ignores stale EXPIRED webhook when another charge is active", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "37757485347",
        "37757518115",
        "active",
        "paid",
        "EXPIRED"
      )
    ).toBe(false);
  });

  it("ignores EXPIRED webhook for active paid shop without stored charge id", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "37757485347",
        null,
        "active",
        "paid",
        "EXPIRED"
      )
    ).toBe(false);
  });

  it("ignores EXPIRED webhook for complimentary shop without stored charge id", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "36600709436",
        null,
        "complimentary",
        "paid",
        "EXPIRED"
      )
    ).toBe(false);
  });

  it("processes CANCELLED webhook for the active charge", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "37757518115",
        "37757518115",
        "active",
        "paid",
        "CANCELLED"
      )
    ).toBe(true);
  });

  it("ignores CANCELLED webhook for a different charge", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "37757485347",
        "37757518115",
        "active",
        "paid",
        "CANCELLED"
      )
    ).toBe(false);
  });

  it("processes DECLINED webhook when shop is still on free tier", () => {
    expect(
      shouldProcessAppSubscriptionTermination(
        "37757485347",
        null,
        "active",
        "free",
        "DECLINED"
      )
    ).toBe(true);
  });
});
