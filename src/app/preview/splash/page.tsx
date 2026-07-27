import { PreviewHeader, PreviewFooter } from "@/components/marketing/preview-chrome";
import { PreviewSplashClient } from "@/components/marketing/preview-splash-client";

export default function PreviewSplashPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PreviewHeader />
      <PreviewSplashClient />
      <PreviewFooter />
    </div>
  );
}
