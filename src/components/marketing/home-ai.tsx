"use client";

import { useId, useRef, useState } from "react";
import {
  BadgeCheck,
  ClipboardList,
  Languages,
  ListChecks,
  Mic,
  PackagePlus,
  Route,
  ScanSearch,
} from "lucide-react";
import { CircleLink } from "./circle-link";

type Card = {
  icon: typeof Mic;
  label: string;
  title: string;
  body: string;
  link: "Watch the demo" | "Learn more";
};

const MODES: { id: "agents" | "assistant"; label: string; cards: Card[] }[] = [
  {
    id: "agents",
    label: "Workflow help",
    cards: [
      {
        icon: BadgeCheck,
        label: "Work orders",
        title: "Understand work order release and completion",
        body: "Carina explains the work order workflow and its prerequisites. You perform changes in the normal screen with the required permissions and sign-offs.",
        link: "Watch the demo",
      },
      {
        icon: ClipboardList,
        label: "Purchasing",
        title: "Get guidance on purchase requests",
        body: "Ask how purchasing, charge codes and approvals fit together. The AI help assistant does not file or approve purchase requests.",
        link: "Learn more",
      },
      {
        icon: PackagePlus,
        label: "Records",
        title: "Find the right record workflow",
        body: "Get source-linked help for parts, customers and orders. Carina explains the process without creating or changing your records.",
        link: "Watch the demo",
      },
      {
        icon: ListChecks,
        label: "Time off",
        title: "Find workforce and approval guidance",
        body: "Ask where time-off requests and approvals live, then use the authorized HR screen. Private workforce records are not loaded into AI help.",
        link: "Learn more",
      },
    ],
  },
  {
    id: "assistant",
    label: "Assistant",
    cards: [
      {
        icon: ScanSearch,
        label: "Grounded help",
        title: "Ask how Protessera works",
        body: "Carina uses reviewed product guides and page context, with source links. It does not access live plant data and offers human support when it cannot verify an answer.",
        link: "Watch the demo",
      },
      {
        icon: Route,
        label: "Tours",
        title: "Walk a real screen, not a made-up one",
        body: "Guided tours and on-screen highlights come from a fixed catalog of pages and anchors in the product. Tours use reviewed product steps; your permissions still apply.",
        link: "Learn more",
      },
      {
        icon: Mic,
        label: "Voice",
        title: "Talk to the help bubble on the floor",
        body: "Text and voice sit in the product help bubble, with a wake name and voice you set on My AI assistant. Marketing chat on this site stays a support thread.",
        link: "Watch the demo",
      },
      {
        icon: Languages,
        label: "Language",
        title: "She answers in the language you pick",
        body: "The assistant follows the language selected for the session and can switch when you ask. Replies stay on production, quality, supply, engineering, programs, accounting, and HR.",
        link: "Learn more",
      },
    ],
  },
];

export function HomeAi() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function focusTab(index: number) {
    const next = (index + MODES.length) % MODES.length;
    setActive(next);
    tabsRef.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Carina modes"
        className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-[#d5deea]"
      >
        {MODES.map((mode, index) => {
          const selected = index === active;
          return (
            <button
              key={mode.id}
              ref={(node) => {
                tabsRef.current[index] = node;
              }}
              id={`${baseId}-tab-${mode.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${mode.id}`}
              tabIndex={selected ? 0 : -1}
              className={`rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f] ${
                selected ? "bg-[#10203f] text-white" : "text-[#24344d] hover:bg-[#f4f7fb]"
              }`}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusTab(index + 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusTab(index - 1);
                }
              }}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      {MODES.map((mode, index) => (
        <div
          key={mode.id}
          id={`${baseId}-panel-${mode.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${mode.id}`}
          hidden={index !== active}
          className={
            index === active
              ? "mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              : "hidden"
          }
        >
          {mode.cards.map((card) => (
            <article
              key={card.title}
              className="flex flex-col rounded-[24px] bg-white p-5 shadow-[0_12px_40px_rgba(16,32,63,0.07)] ring-1 ring-[#10203f]/5"
            >
              <card.icon className="h-6 w-6 text-[#0f766e]" aria-hidden />
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#0f766e]">
                {card.label}
              </p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#10203f]">
                {card.title}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[#3d4d66]">{card.body}</p>
              <div className="mt-5">
                <CircleLink href="/demo">{card.link}</CircleLink>
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
