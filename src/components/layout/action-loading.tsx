"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type FormProps = ComponentProps<"form">;
type FormSubmitEvent = Parameters<NonNullable<FormProps["onSubmit"]>>[0];

export type ActionTheme =
  | "shipping"
  | "packing"
  | "manufacturing"
  | "planning"
  | "receiving"
  | "creating"
  | "kitting"
  | "purchasing"
  | "quality"
  | "navigation"
  | "inventory"
  | "engineering"
  | "hr"
  | "accounting"
  | "default";

type ThemeMeta = {
  title: string;
  accent: string;
  messages: string[];
};

export const ACTION_THEMES: Record<ActionTheme, ThemeMeta> = {
  shipping: {
    title: "Shipping",
    accent: "from-sky-500 via-teal-400 to-emerald-400",
    messages: [
      "Verifying parts…",
      "Putting the packing peanuts in…",
      "Taping the box shut…",
      "Printing the shipping label…",
      "Waving goodbye to the crate…",
      "Calling the carrier pigeon…",
      "Double-checking the ship-to address…",
      "Buckling the pallet straps…",
      "Scanning the tracking barcode…",
    ],
  },
  packing: {
    title: "Packing",
    accent: "from-amber-500 via-orange-400 to-yellow-400",
    messages: [
      "Lining the box with bubble wrap…",
      "Nesting the foam inserts…",
      "Snapping pack photos…",
      "Counting every screw twice…",
      "Sealing with industrial tape…",
      "Writing “fragile” in big letters…",
      "Matching the packing list…",
    ],
  },
  manufacturing: {
    title: "Manufacturing",
    accent: "from-teal-500 via-cyan-400 to-sky-400",
    messages: [
      "Measuring the parts…",
      "Soldering wires…",
      "Torquing the bolts…",
      "Wiping coolant off the mill…",
      "Calibrating the torque wrench…",
      "Checking the traveler steps…",
      "Warming up the soldering iron…",
      "Deburring the edges…",
      "Tightening to spec…",
      "Running the go/no-go gauge…",
      "Clocking in at the station…",
    ],
  },
  planning: {
    title: "Planning",
    accent: "from-violet-500 via-purple-400 to-fuchsia-400",
    messages: [
      "Checking the stockroom crystal ball…",
      "Balancing demand against shelves…",
      "Spinning up work orders…",
      "Drafting purchase requisitions…",
      "Aligning the value stream…",
      "Negotiating with the BOM…",
      "Scheduling the shop floor…",
      "Hunting for free capacity…",
      "Spreading the work across stations…",
      "Pulling out the disco ball…",
      "Checking stock room…",
      "Balancing the load…",
    ],
  },
  receiving: {
    title: "Receiving",
    accent: "from-emerald-500 via-green-400 to-lime-400",
    messages: [
      "Unwrapping the pallet…",
      "Counting the widgets…",
      "Scanning barcodes into the void…",
      "Checking for packing slips…",
      "Staging at the dock…",
      "Writing the traveler ticket…",
      "Arguing with the scale…",
      "Parking parts at RCV-01…",
      "Photo-documenting the crate…",
      "Putting it away (politely)…",
    ],
  },
  creating: {
    title: "Creating",
    accent: "from-indigo-500 via-blue-400 to-cyan-400",
    messages: [
      "Forging a new record…",
      "Stamping a fresh number…",
      "Opening a blank traveler…",
      "Warming up the database…",
      "Filing the paperwork…",
      "Making it official…",
      "Assigning serials…",
      "Pulling out the disco ball…",
    ],
  },
  kitting: {
    title: "Kitting",
    accent: "from-rose-500 via-pink-400 to-orange-400",
    messages: [
      "Pulling bins from the shelf…",
      "Bagging the fasteners…",
      "Matching kits to travelers…",
      "Checking the pick list twice…",
      "Rolling the cart to the line…",
      "Labeling tote #1…",
      "Weighing the kit bag…",
    ],
  },
  purchasing: {
    title: "Purchasing",
    accent: "from-amber-500 via-yellow-400 to-lime-400",
    messages: [
      "Calling the suppliers…",
      "Comparing quotes…",
      "Drafting the PO…",
      "Checking the budget twice…",
      "Expediting long-lead parts…",
      "Chasing the approval stamp…",
    ],
  },
  quality: {
    title: "Quality",
    accent: "from-cyan-500 via-sky-400 to-blue-400",
    messages: [
      "Zeroing the calipers…",
      "Checking the print…",
      "Recording the measurements…",
      "Looking for burrs…",
      "Stamping the traveler…",
      "Signing the CoC…",
      "Filling the inspection form…",
    ],
  },
  inventory: {
    title: "Inventory",
    accent: "from-lime-500 via-emerald-400 to-teal-400",
    messages: [
      "Counting the shelves…",
      "Moving bins to the right address…",
      "Putting stuff away…",
      "Whispering to the kanban cards…",
      "Finding the lost tote…",
      "Checking the stock room…",
    ],
  },
  engineering: {
    title: "Engineering",
    accent: "from-blue-500 via-indigo-400 to-violet-400",
    messages: [
      "Opening the drawing…",
      "Redlining with style…",
      "Revising the BOM…",
      "Syncing with CM…",
      "Convincing the CAD server…",
    ],
  },
  hr: {
    title: "People",
    accent: "from-pink-500 via-rose-400 to-orange-400",
    messages: [
      "Checking the timecard…",
      "Rounding to the nearest coffee…",
      "Balancing the hours…",
      "Looking for the stamp…",
    ],
  },
  accounting: {
    title: "Accounting",
    accent: "from-yellow-500 via-amber-400 to-orange-400",
    messages: [
      "Balancing the books…",
      "Counting the beans…",
      "Debiting with confidence…",
      "Crediting with flair…",
      "Reconciling the universe…",
    ],
  },
  navigation: {
    title: "Loading module",
    accent: "from-teal-500 via-cyan-400 to-sky-400",
    messages: [
      "Opening the module…",
      "Checking the stock room…",
      "Balancing the load…",
      "Pulling out the disco ball…",
      "Warming up the screens…",
      "Finding your place in the plant…",
      "Syncing the value stream…",
      "Almost there…",
      "Dusting off the dashboards…",
      "Making it look intentional…",
    ],
  },
  default: {
    title: "Working",
    accent: "from-teal-500 via-cyan-400 to-sky-400",
    messages: [
      "Doing the thing…",
      "Almost there…",
      "Crunching the numbers…",
      "Talking to the server…",
      "Making magic happen…",
      "One moment…",
      "Holding the fort…",
      "Pulling out the disco ball…",
      "Checking the stock room…",
      "Balancing the load…",
    ],
  },
};

/** Infer fun theme from a route / form context. */
export function themeForPath(href: string): ActionTheme {
  const path = href.split("?")[0].toLowerCase();
  if (path.startsWith("/shipping")) return "shipping";
  if (path.startsWith("/receiving")) return "receiving";
  if (path.startsWith("/kitting")) return "kitting";
  if (path.startsWith("/work-orders") || path.startsWith("/floor") || path.startsWith("/workcenters"))
    return "manufacturing";
  if (path.startsWith("/planning") || path.startsWith("/budgets") || path.startsWith("/value-stream"))
    return "planning";
  if (path.startsWith("/purchasing") || path.startsWith("/suppliers")) return "purchasing";
  if (path.startsWith("/qa") || path.startsWith("/quality") || path.startsWith("/mrb") || path.startsWith("/test-"))
    return "quality";
  if (path.startsWith("/inventory") || path.startsWith("/items") || path.startsWith("/government-property"))
    return "inventory";
  if (
    path.startsWith("/engineering") ||
    path.startsWith("/bom") ||
    path.startsWith("/products") ||
    path.startsWith("/cm") ||
    path.startsWith("/requirements")
  )
    return "engineering";
  if (path.startsWith("/hr") || path.startsWith("/approvals")) return "hr";
  if (path.startsWith("/accounting") || path.startsWith("/reports")) return "accounting";
  if (path.startsWith("/sales") || path.startsWith("/customers")) return "creating";
  if (path.startsWith("/pmo")) return "planning";
  return "navigation";
}

function themeFromForm(form: HTMLFormElement): ActionTheme {
  const explicit = form.dataset.loadingTheme as ActionTheme | undefined;
  if (explicit && ACTION_THEMES[explicit]) return explicit;
  const action = (form.getAttribute("action") || "").toLowerCase();
  const text = (form.innerText || form.textContent || "").toLowerCase();
  const blob = `${action} ${text} ${form.className}`;
  if (/ship|pack|track/.test(blob)) return "shipping";
  if (/receiv|put.?away|dock|gfp/.test(blob)) return "receiving";
  if (/kit|pick/.test(blob)) return "kitting";
  if (/inspect|pass|fail|ncr|mrb|qa/.test(blob)) return "quality";
  if (/plan|forecast|mrs|budget|schedule|capacity/.test(blob)) return "planning";
  if (/po|pr |purchas|supplier|convert/.test(blob)) return "purchasing";
  if (/sign.?off|start production|release|work order|torque|solder/.test(blob))
    return "manufacturing";
  if (/create|new |add |save/.test(blob)) return "creating";
  if (/move|finish|complete|put.?away/.test(blob)) return "manufacturing";
  return "default";
}

type ActionLoadingApi = {
  start: (theme?: ActionTheme, title?: string) => void;
  stop: () => void;
  /** Force-close regardless of depth (navigation finished). */
  stopAll: () => void;
  run: <T>(
    theme: ActionTheme,
    fn: () => Promise<T>,
    title?: string
  ) => Promise<T>;
  active: boolean;
};

const ActionLoadingContext = createContext<ActionLoadingApi | null>(null);

const noopApi: ActionLoadingApi = {
  start: () => {},
  stop: () => {},
  stopAll: () => {},
  run: async (_t, fn) => fn(),
  active: false,
};

export function useActionLoading(): ActionLoadingApi {
  return useContext(ActionLoadingContext) ?? noopApi;
}

export function ActionLoadingProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [theme, setTheme] = useState<ActionTheme>("default");
  const [customTitle, setCustomTitle] = useState<string | undefined>();
  const [msgIndex, setMsgIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fadeKey, setFadeKey] = useState(0);
  const depthRef = useRef(0);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStartedRef = useRef(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const start = useCallback((t: ActionTheme = "default", title?: string) => {
    if (finishTimer.current) {
      clearTimeout(finishTimer.current);
      finishTimer.current = null;
    }
    depthRef.current += 1;
    const safeTheme = ACTION_THEMES[t] ? t : "default";
    flushSync(() => {
      setTheme(safeTheme);
      setCustomTitle(title);
      setMsgIndex(
        Math.floor(Math.random() * ACTION_THEMES[safeTheme].messages.length)
      );
      setFadeKey((k) => k + 1);
      setProgress(6 + Math.random() * 6);
      setActive(true);
    });
  }, []);

  const stop = useCallback(() => {
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current > 0) return;
    setProgress(100);
    finishTimer.current = setTimeout(() => {
      setActive(false);
      setProgress(0);
      finishTimer.current = null;
    }, 320);
  }, []);

  const stopAll = useCallback(() => {
    depthRef.current = 0;
    navStartedRef.current = false;
    setProgress(100);
    if (finishTimer.current) clearTimeout(finishTimer.current);
    finishTimer.current = setTimeout(() => {
      setActive(false);
      setProgress(0);
      finishTimer.current = null;
    }, 280);
  }, []);

  const run = useCallback(
    async <T,>(t: ActionTheme, fn: () => Promise<T>, title?: string) => {
      start(t, title);
      try {
        return await fn();
      } finally {
        stop();
      }
    },
    [start, stop]
  );

  // Global: internal link clicks (sidebar + in-app) show the bar
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target as Element | null;
      if (!el?.closest) return;
      const a = el.closest("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      if (a.dataset.noLoading === "true") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (/^https?:\/\//i.test(href) && !href.includes(window.location.host))
        return;
      // Same-page hash only
      try {
        const url = new URL(href, window.location.origin);
        // Same page, only query/hash change (e.g. project ?tab=budgets) — never
        // blanket the screen; that was resetting soft tab navigation.
        if (url.pathname === window.location.pathname) {
          return;
        }
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
        navStartedRef.current = true;
        const label =
          a.getAttribute("title") ||
          a.textContent?.trim().slice(0, 40) ||
          "Loading";
        start(themeForPath(url.pathname + url.search), label);
        // Safety: never leave overlay forever if navigation is soft-cancelled
        window.setTimeout(() => {
          if (navStartedRef.current) stopAll();
        }, 12_000);
      } catch {
        /* ignore bad urls */
      }
    }

    function onSubmit(e: Event) {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      if (form.dataset.actionLoading === "true") return; // ActionLoadingForm owns it
      if (form.dataset.noLoading === "true") return;
      const theme = themeFromForm(form);
      start(theme, form.dataset.loadingTitle || undefined);
      // Forms without our wrapper: stop after a generous timeout if no nav
      window.setTimeout(() => stop(), 45_000);
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [start, stop, stopAll]);

  // Server actions that only revalidatePath never navigate, so the submit
  // overlay used to sit at 92% until the 45s failsafe. Track the action's
  // own fetch (Next sends a "next-action" header) and clear on response.
  useEffect(() => {
    const orig = window.fetch;
    let inFlight = 0;
    const patched: typeof window.fetch = async (input, init) => {
      let isAction = false;
      try {
        const h = new Headers(
          init?.headers ||
            (input instanceof Request ? input.headers : undefined)
        );
        isAction = h.has("next-action");
      } catch {
        /* ignore header parse issues */
      }
      if (isAction) inFlight += 1;
      try {
        return await orig(input as RequestInfo | URL, init);
      } finally {
        if (isAction) {
          inFlight = Math.max(0, inFlight - 1);
          if (inFlight === 0) {
            // Give the RSC refresh a beat to paint, then clear overlays
            window.setTimeout(() => stopAll(), 350);
          }
        }
      }
    };
    window.fetch = patched;
    return () => {
      window.fetch = orig;
    };
  }, [stopAll]);

  // Route changed → clear navigation overlay
  useEffect(() => {
    if (navStartedRef.current || active) {
      // Slight delay so the bar is visible even on fast transitions
      const t = window.setTimeout(() => stopAll(), 180);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    if (!active) return;
    const messages = ACTION_THEMES[theme].messages;
    const id = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
      setFadeKey((k) => k + 1);
    }, 1550);
    return () => clearInterval(id);
  }, [active, theme]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        const step = Math.max(0.35, (92 - p) * 0.055);
        return Math.min(92, p + step);
      });
    }, 110);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    return () => {
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, []);

  const value = useMemo(
    () => ({ start, stop, stopAll, run, active }),
    [start, stop, stopAll, run, active]
  );

  const meta = ACTION_THEMES[theme] || ACTION_THEMES.default;
  const message = meta.messages[msgIndex % meta.messages.length];

  return (
    <ActionLoadingContext.Provider value={value}>
      {children}
      {active && (
        <div
          className="action-loading-overlay fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[3px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="action-loading-card w-full max-w-md overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 p-6 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-teal-400/90">
                {customTitle || meta.title}
              </p>
            </div>
            <div className="mt-3 min-h-[2.25rem]">
              <p
                key={fadeKey}
                className="action-loading-msg text-lg font-medium leading-snug text-slate-100"
              >
                {message}
              </p>
            </div>
            <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/50">
              <div
                className={cn(
                  "action-loading-bar relative h-full rounded-full bg-gradient-to-r",
                  meta.accent
                )}
                style={{ width: `${progress}%` }}
              >
                <span className="action-loading-shine" />
              </div>
            </div>
            <p className="mt-3 text-center font-mono text-[11px] tabular-nums text-slate-500">
              {Math.round(progress)}%
            </p>
          </div>
        </div>
      )}
    </ActionLoadingContext.Provider>
  );
}

type ServerAction = (formData: FormData) => void | Promise<void>;

/**
 * Drop-in `<form>` that shows the themed loading overlay while a server
 * action runs. Prefer this over a bare `<form action={…}>` for create /
 * plan / ship / kit / start-production style buttons.
 */
export function ActionLoadingForm({
  theme = "default",
  title,
  action,
  className,
  onSubmit,
  children,
  ...props
}: Omit<FormProps, "action"> & {
  theme?: ActionTheme;
  title?: string;
  action?: ServerAction | string;
}) {
  const { start, stop } = useActionLoading();
  const startedRef = useRef(false);

  function handleSubmit(e: FormSubmitEvent) {
    onSubmit?.(e);
    if (e.defaultPrevented) return;
    startedRef.current = true;
    start(theme, title);
  }

  const wrappedAction: ServerAction | string | undefined =
    typeof action === "function"
      ? async (fd: FormData) => {
          if (!startedRef.current) {
            startedRef.current = true;
            start(theme, title);
          }
          try {
            await action(fd);
          } finally {
            // redirect() throws NEXT_REDIRECT after this — rethrow is automatic
            startedRef.current = false;
            stop();
          }
        }
      : action;

  return (
    <form
      {...props}
      action={wrappedAction}
      className={className}
      data-action-loading="true"
      data-loading-theme={theme}
      onSubmit={handleSubmit}
    >
      {children}
    </form>
  );
}
