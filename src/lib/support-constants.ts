/** Client-safe support desk constants (no server/DB imports). */

export const SUPPORT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
] as const;

export const SUPPORT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const SUPPORT_CATEGORIES = [
  "GENERAL",
  "BILLING",
  "BUG",
  "HOWTO",
  "ACCOUNT",
  "OTHER",
] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
