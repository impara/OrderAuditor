export function shouldRemoveShopifyTag(flagSource: string | null): boolean {
  return flagSource !== "historical";
}
