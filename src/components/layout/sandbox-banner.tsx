import { actionEndTestDrive } from "@/app/actions";
import { FlaskConical } from "lucide-react";

/** Shown at the top of every page while a visitor is in a test-drive sandbox. */
export function SandboxBanner() {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-500/10 to-teal-500/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm text-cyan-200">
        <FlaskConical className="h-4 w-4 shrink-0 text-cyan-400" />
        <span>
          <span className="font-semibold">Test drive</span> — this is your
          private sandbox. Change anything; it disappears when you leave.
        </span>
      </p>
      <form action={actionEndTestDrive}>
        <button
          type="submit"
          className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/15"
        >
          End test drive
        </button>
      </form>
    </div>
  );
}
