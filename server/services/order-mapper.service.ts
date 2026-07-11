import type { InsertOrder } from "@shared/schema";

export interface ShopifyOrderPayload {
  id: string | number;
  order_number?: string | number | null;
  name?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  customer?: {
    id?: string | number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: Record<string, unknown> & { phone?: string | null };
  shipping_address?: Record<string, unknown> & {
    phone?: string | null;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
  };
  line_items?: Array<{
    id: string | number;
    sku?: string | null;
    title?: string | null;
    quantity?: number | null;
    price?: string | number | null;
  }>;
  total_price?: string | number | null;
  currency?: string | null;
  created_at?: string | Date | null;
}

function parseCreatedAt(value: ShopifyOrderPayload["created_at"]): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function mapShopifyOrder(
  shopDomain: string,
  shopifyOrder: ShopifyOrderPayload
): InsertOrder {
  const customerName = shopifyOrder.customer
    ? `${shopifyOrder.customer.first_name || ""} ${
        shopifyOrder.customer.last_name || ""
      }`.trim() || "Unknown"
    : "Unknown";

  return {
    shopDomain,
    shopifyOrderId: String(shopifyOrder.id),
    orderNumber:
      shopifyOrder.order_number?.toString() ||
      shopifyOrder.name ||
      String(shopifyOrder.id),
    customerEmail:
      shopifyOrder.email ||
      shopifyOrder.contact_email ||
      shopifyOrder.customer?.email ||
      null,
    customerName,
    customerPhone:
      shopifyOrder.phone ||
      shopifyOrder.customer?.phone ||
      shopifyOrder.billing_address?.phone ||
      shopifyOrder.shipping_address?.phone ||
      null,
    shippingAddress: shopifyOrder.shipping_address || null,
    lineItems: (shopifyOrder.line_items || []).map((item) => ({
      id: String(item.id),
      sku: item.sku ?? null,
      title: item.title ?? "",
      quantity: item.quantity ?? 0,
      price: String(item.price ?? "0.00"),
    })),
    totalPrice: String(shopifyOrder.total_price ?? "0.00"),
    currency: shopifyOrder.currency || "USD",
    createdAt: parseCreatedAt(shopifyOrder.created_at),
    isFlagged: false,
  };
}
