"use client";

import { useState } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

/**
 * Uncontrolled premium toggle for plain server-action forms — drop-in
 * replacement for a named checkbox. Submits "on" when checked (same as a
 * checkbox) via a hidden input.
 */
export function ToggleField({
  name,
  label,
  defaultChecked = false,
  disabled,
}: {
  name: string;
  label?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <>
      {checked && <input type="hidden" name={name} value="on" />}
      <ToggleSwitch
        checked={checked}
        onChange={setChecked}
        label={label}
        disabled={disabled}
      />
    </>
  );
}
