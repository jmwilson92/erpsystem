import { CompareArticle } from "@/components/marketing/compare-article";
import { comparePageMetadata } from "@/lib/compare/metadata";
import { requireComparePage } from "@/lib/compare/pages";

const page = requireComparePage("/compare/protessera-vs-proshop");

export const dynamic = "force-dynamic";

export const metadata = comparePageMetadata(page);

export default function ProtesseraVsProShopPage() {
  return <CompareArticle page={page} />;
}
