export interface BillingAuditOptions {
  shop?: string;
  applyActive: boolean;
  help: boolean;
}

export function parseBillingAuditArgs(args: string[]): BillingAuditOptions {
  const options: BillingAuditOptions = { applyActive: false, help: false };
  for (const arg of args) {
    if (arg === "--apply-active") options.applyActive = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--shop=")) options.shop = arg.slice(7).toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (
    options.shop &&
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(options.shop)
  ) {
    throw new Error("--shop must be a valid *.myshopify.com domain");
  }
  if (options.applyActive && !options.shop) {
    throw new Error("--apply-active requires an explicit --shop");
  }
  return options;
}
