"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const INDUSTRIES = [
  {
    id: "aerospace",
    label: "Aerospace & defense",
    title: "Configuration, travelers, and an audit-shaped quality loop",
    body: "Aerospace and defense work needs the bill, the traveler, and the nonconformance in one chain. Protessera keeps revision-controlled BOMs and work instructions, serial trace from receipt to ship, and an AS9100-shaped quality record: NCR, MRB, and corrective action.",
    image: "/marketing/product-test-center.png",
    alt: "Protessera test center with traveler steps queued at a test station",
  },
  {
    id: "medical",
    label: "Medical devices",
    title: "Lot, serial, and the inspection that belongs to them",
    body: "Device work depends on knowing which lot did what. Track lot and serial through inventory, keep bills and work instructions under revision control, and record inspection and test results on the traveler. An NCR and its MRB stay attached to the lot that failed.",
    image: "/marketing/product-inventory.png",
    alt: "Protessera inventory screen showing on-hand quantity, lot and serial, and government-furnished property",
  },
  {
    id: "precision",
    label: "Precision machining / job shops",
    title: "The job, the traveler, and the cost on one record",
    body: "High-mix shops need work orders, travelers, inventory, purchasing, and job cost without a six-month implementation. Quote through ship stays in one system, and receiving and shipping post the books as the material moves.",
    image: "/marketing/product-work-orders.png",
    alt: "Protessera work orders screen with a production order form and the order list",
  },
  {
    id: "electronics",
    label: "Electronics & assembly",
    title: "Multi-level builds, from receiving through test",
    body: "Assemblies run on multi-level BOMs, work instructions, and test procedures. The value stream shows suppliers, purchase orders, receiving, incoming inspection, inventory, production, and shipping as one flow — including the MRB hold when a unit cannot move.",
    image: "/marketing/product-value-stream.png",
    alt: "Protessera value stream map from suppliers through receiving, inspection, inventory, production, and shipping",
  },
  {
    id: "government",
    label: "Government contractors",
    title: "Furnished property and the job in the same books",
    body: "Government-furnished property, UID, and DD-1149 custody are tracked with purchasing and the job — not in a side spreadsheet. The standard hosted service is not a CUI or ITAR enclave. Read the FAQ before you put controlled technical data in it.",
    image: "/marketing/product-inventory.png",
    alt: "Protessera inventory screen with a government-furnished property line beside company stock",
  },
] as const;

export function HomeIndustries() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const current = INDUSTRIES[active];

  function selectTab(index: number, focus = false) {
    const next = (index + INDUSTRIES.length) % INDUSTRIES.length;
    setActive(next);
    tabsRef.current[next]?.scrollIntoView({ inline: "nearest", block: "nearest" });
    if (focus) tabsRef.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Industries"
        className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {INDUSTRIES.map((industry, index) => {
          const selected = index === active;
          return (
            <button
              key={industry.id}
              ref={(node) => {
                tabsRef.current[index] = node;
              }}
              id={`${baseId}-tab-${industry.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${industry.id}`}
              tabIndex={selected ? 0 : -1}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f] ${
                selected
                  ? "bg-[#10203f] text-white"
                  : "bg-white text-[#24344d] ring-1 ring-[#d5deea] hover:bg-[#f7f9fc]"
              }`}
              onClick={() => selectTab(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectTab(index + 1, true);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectTab(index - 1, true);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  selectTab(0, true);
                } else if (event.key === "End") {
                  event.preventDefault();
                  selectTab(INDUSTRIES.length - 1, true);
                }
              }}
            >
              {industry.label}
            </button>
          );
        })}
      </div>

      {INDUSTRIES.map((industry, index) => {
        const selected = index === active;
        return (
          <div
            key={industry.id}
            id={`${baseId}-panel-${industry.id}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${industry.id}`}
            hidden={!selected}
            tabIndex={selected ? 0 : -1}
            className={
              selected
                ? "mt-6 rounded-[28px] bg-white p-3 shadow-[0_16px_50px_rgba(16,32,63,0.08)] ring-1 ring-[#10203f]/5 sm:p-4"
                : "hidden"
            }
          >
            <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] bg-[#e7eef6]">
                <Image
                  src={industry.image}
                  alt={industry.alt}
                  fill
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="object-cover object-left-top"
                  priority={industry.id === "aerospace"}
                />
              </div>
              <div className="px-2 py-2 sm:px-4 sm:py-4 lg:pr-6">
                <h3 className="text-2xl font-semibold tracking-tight text-[#10203f] sm:text-3xl">
                  {industry.title}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-[#3d4d66]">
                  {industry.body}
                </p>
                <Link
                  href="/demo"
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-[#10203f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
                >
                  See it in action
                </Link>
              </div>
            </div>
          </div>
        );
      })}
      <p className="sr-only">Showing {current.label}</p>
    </div>
  );
}
