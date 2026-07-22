"use client";

import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { startTourEvent } from "./guided-tour";

export function GuideLauncher({ tourId }: { tourId: string }) {
  return (
    <Button
      size="sm"
      onClick={() => window.dispatchEvent(startTourEvent(tourId))}
      className="h-8"
    >
      <Play className="mr-1 h-3.5 w-3.5" />
      Start
    </Button>
  );
}
