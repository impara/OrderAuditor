import { apiRequest } from "@/lib/queryClient";
import type { ProductEventPayload } from "@shared/product-events";

type ProductEventInput = Omit<ProductEventPayload, "eventKey">;

function createOpaqueEventKey(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure browser crypto is unavailable");
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function trackProductEvent(
  event: ProductEventInput,
  sessionDedupeKey: string
): Promise<void> {
  const storageKey = `duplicate-guard:event:${event.eventName}:${sessionDedupeKey}`;

  try {
    let previous: { state: "pending" | "sent"; eventKey: string } | null = null;
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try {
        const candidate = JSON.parse(stored) as Partial<{
          state: "pending" | "sent";
          eventKey: string;
        }>;
        if (
          (candidate.state === "pending" || candidate.state === "sent") &&
          typeof candidate.eventKey === "string"
        ) {
          previous = candidate as { state: "pending" | "sent"; eventKey: string };
        } else {
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
    if (previous?.state === "sent") {
      return;
    }
    const eventKey = previous?.eventKey ?? createOpaqueEventKey();
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ state: "pending", eventKey })
    );

    await apiRequest("POST", "/api/product-events", {
      ...event,
      eventKey,
    });

    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ state: "sent", eventKey })
    );
  } catch (error) {
    console.warn(`[Telemetry] Failed to record ${event.eventName}`, error);
  }
}
