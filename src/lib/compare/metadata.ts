import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import type { ComparePage } from "./pages";

export function comparePageMetadata(page: ComparePage): Metadata {
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: page.slug },
    openGraph: {
      title: page.title,
      description: page.description,
      url: page.slug,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
    robots: { index: true, follow: true },
  };
}
