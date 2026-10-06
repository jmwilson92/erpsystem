import { JOBBOSS_BODY, PROSHOP_BODY } from "./bodies";
import { materializeCompareCopy } from "./pricing-copy";
import {
  faqEntries,
  parseCompareDocument,
  type Block,
  type FaqEntry,
} from "./model";

export type ComparePage = {
  slug: string;
  title: string;
  description: string;
  navLabel: string;
  rawBody: string;
};

export const COMPARE_PAGES: readonly ComparePage[] = [
  {
    slug: "/compare/protessera-vs-proshop",
    title: "Protessera vs ProShop ERP: Job Shop ERP Comparison",
    description:
      "Protessera vs ProShop ERP for AS9100 and ISO job shops: travelers, NCR/MRB, traceability, setup, and pricing, plus when ProShop is the better pick.",
    navLabel: "Protessera vs ProShop",
    rawBody: PROSHOP_BODY,
  },
  {
    slug: "/compare/protessera-vs-jobboss",
    title: "Protessera vs JobBOSS²: Job Shop ERP Comparison",
    description:
      "Protessera vs JobBOSS² for AS9100 and ISO job shops: travelers, NCR/MRB, traceability, quoting, setup, and pricing, and when JobBOSS² is the better pick.",
    navLabel: "Protessera vs JobBOSS²",
    rawBody: JOBBOSS_BODY,
  },
];

export function getComparePage(slug: string): ComparePage | undefined {
  const path = slug.startsWith("/") ? slug : `/compare/${slug}`;
  return COMPARE_PAGES.find((page) => page.slug === path);
}

export function requireComparePage(slug: string): ComparePage {
  const page = getComparePage(slug);
  if (!page) throw new Error(`Missing comparison page ${slug}`);
  return page;
}

export type PreparedComparePage = ComparePage & {
  markdown: string;
  blocks: Block[];
  faqs: FaqEntry[];
};

export function prepareComparePage(page: ComparePage): PreparedComparePage {
  const markdown = materializeCompareCopy(page.rawBody);
  const blocks = parseCompareDocument(markdown);
  return { ...page, markdown, blocks, faqs: faqEntries(blocks) };
}
