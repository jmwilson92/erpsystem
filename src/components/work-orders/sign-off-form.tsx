"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionSignOffStep } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignOffStepForm({
  workOrderId,
  stepId,
  isTestStep,
  passFailRequired,
  measureUom,
  expectedValue,
  /** DOM id of this step card — keep scroll anchored after soft refresh */
  stepAnchorId,
}: {
  workOrderId: string;
  stepId: string;
  isTestStep?: boolean;
  passFailRequired?: boolean;
  measureUom?: string | null;
  expectedValue?: string | null;
  stepAnchorId?: string;
}) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [measured, setMeasured] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsResult = isTestStep || passFailRequired;

  function submit(result: "PASS" | "FAIL") {
    setError(null);
    if (!pin.trim()) {
      setError("Enter your PIN to sign");
      return;
    }
    if (measureUom && !measured.trim()) {
      setError(`Enter measured value (${measureUom})`);
      return;
    }
    const fd = new FormData();
    fd.set("workOrderId", workOrderId);
    fd.set("stepId", stepId);
    fd.set("result", result);
    fd.set("pinCode", pin.trim());
    if (measured) fd.set("measuredValue", measured);
    if (measureUom) fd.set("measureUom", measureUom);
    const scrollY = window.scrollY;
    startTransition(async () => {
      try {
        const outcome = await actionSignOffStep(fd);
        // Soft refresh — stay put unless next open step is a different station
        // or traveler is ready for Receiving putaway (then jump to guide at top).
        if (outcome?.readyForPutaway || outcome?.stationChanged) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          router.refresh();
          return;
        }
        router.refresh();
        // Restore scroll after RSC refresh paints
        requestAnimationFrame(() => {
          window.scrollTo(0, scrollY);
          if (stepAnchorId) {
            document
              .getElementById(stepAnchorId)
              ?.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-off failed");
      }
    });
  }

  return (
    <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950/50 p-2">
      {(measureUom || needsResult) && (
        <Input
          className="h-8 text-xs"
          placeholder={
            measureUom
              ? `Measured (${measureUom})${expectedValue ? ` · exp ${expectedValue}` : ""}`
              : "Measured value"
          }
          value={measured}
          onChange={(e) => setMeasured(e.target.value)}
        />
      )}
      <Input
        className="h-8 text-xs font-mono"
        type="password"
        inputMode="numeric"
        placeholder="Your PIN *"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        autoComplete="off"
      />
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      <div className="flex gap-1">
        {needsResult ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => submit("PASS")}
            >
              Pass
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => submit("FAIL")}
            >
              Fail
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => submit("PASS")}
          >
            Sign off
          </Button>
        )}
      </div>
    </div>
  );
}
