import type { Request, Response } from "express";
import { productEventPayloadSchema } from "@shared/product-events";
import type { IStorage } from "../storage";
import { logger } from "../utils/logger";

type ProductEventStorage = Pick<IStorage, "recordProductEvent">;

export function createProductEventHandler(storage: ProductEventStorage) {
  return async (req: Request, res: Response) => {
    const parsed = productEventPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid product event" });
    }

    try {
      const shop = res.locals.shopify?.shop;
      if (typeof shop !== "string" || shop.length === 0) {
        return res.status(401).json({ error: "Verified shop is required" });
      }

      const recorded = await storage.recordProductEvent(shop, parsed.data);
      return res
        .status(recorded ? 201 : 200)
        .json({ recorded: Boolean(recorded) });
    } catch (error) {
      logger.error("Error recording product event:", error);
      return res.status(500).json({ error: "Failed to record product event" });
    }
  };
}