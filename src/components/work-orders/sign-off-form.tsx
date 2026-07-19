"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionSignOffStep } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionLoading } from "@/components/layout/action-loading";

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
  const { start: startLoading, stop: stopLoading } = useActionLoading();
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
    startLoading("manufacturing");
    startTransition(async () => {
      try {
        const outcome = await actionSignOffStep(fd);
        if (outcome && "error" in outcome) {
          setError(outcome.error ?? "Sign-off failed");
          return;
        }
        const jumpTop = !!(
          outcome &&
          (outcome.readyForPutaway || outcome.stationChanged)
        );
        if (jumpTop) {
          // Station handoff or ready for Receiving — show guide at top
          sessionStorage.setItem(
            `wo-handoff-${workOrderId}`,
            JSON.stringify({
              at: Date.now(),
              area: outcome.nextArea,
              areaLabel: outcome.nextAreaLabel,
              workCenter: outcome.nextWorkCenter,
              stepTitle: outcome.nextStepTitle,
              stepNumber: outcome.nextStepNumber,
              readyForPutaway: outcome.readyForPutaway,
            })
          );
          router.refresh();
          stopLoading();
          // After paint, force top (refresh can fight rAF once)
          setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
          setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 200);
          return;
        }
        router.refresh();
        stopLoading();
        // Same station — restore scroll after RSC refresh
        setTimeout(() => {
          window.scrollTo(0, scrollY);
          if (stepAnchorId) {
            document
              .getElementById(stepAnchorId)
              ?.scrollIntoView({ block: "nearest" });
          }
        }, 80);
      } catch (e) {
        stopLoading();
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
