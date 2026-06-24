/**
 * Normalize phone number for comparison and indexed lookups.
 * Removes non-digit characters except leading +, then normalizes to E.164-like format.
 */
export function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "";

  let normalized = phone.trim();

  if (normalized.startsWith("+")) {
    normalized = "+" + normalized.slice(1).replace(/\D/g, "");
  } else {
    normalized = normalized.replace(/\D/g, "");
    if (normalized.length === 10) {
      normalized = "+1" + normalized;
    } else if (normalized.length === 11 && normalized.startsWith("1")) {
      normalized = "+" + normalized;
    }
  }

  return normalized;
}
