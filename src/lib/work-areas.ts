/** Plant modules — stations are created under these areas. */
export const WORK_AREAS = ["MANUFACTURING", "QA", "TEST"] as const;
export type WorkArea = (typeof WORK_AREAS)[number];

export function isWorkArea(v: string | null | undefined): v is WorkArea {
  return !!v && (WORK_AREAS as readonly string[]).includes(v);
}

export const WORK_AREA_LABELS: Record<WorkArea, string> = {
  MANUFACTURING: "Manufacturing (build / assembly)",
  QA: "QA (inspections / DMM / GD&T / continuity)",
  TEST: "Test (powered functional)",
};
