"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, X } from "lucide-react";

type Option = { value: string; label: string };

/**
 * Reusable admin-gated inline setting editor. Drop it next to any company
 * setting on the page where that value is shown; admins get a pencil that
 * reveals an inline form posting to the same server action the central
 * admin Settings page uses. Non-admins see a read-only value.
 *
 * Pass `hiddenFields` to carry the setting's sibling values through to a
 * multi-field action so editing one field doesn't blank the others.
 */
export function InlineSetting({
  label,
  name,
  value,
  display,
  type = "text",
  options,
  action,
  hiddenFields,
  canEdit = false,
  textareaRows = 4,
  placeholder,
  suffix,
  className,
}: {
  label: string;
  name: string;
  value: string;
  /** Rendered value when not editing (defaults to `value`). */
  display?: React.ReactNode;
  type?: "text" | "number" | "select" | "textarea";
  options?: Option[];
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields?: Record<string, string>;
  canEdit?: boolean;
  textareaRows?: number;
  placeholder?: string;
  suffix?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);

  const shown = (
    <span className="text-sm text-slate-200">
      {display ?? value ?? "—"}
      {suffix ? <span className="ml-1 text-slate-500">{suffix}</span> : null}
    </span>
  );

  if (!canEdit) {
    return (
      <div className={className}>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          {label}
        </p>
        {shown}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className={className}>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <span className="inline-flex items-center gap-1.5">
          {shown}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-slate-500 transition-colors hover:text-teal-400"
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <form
        action={action}
        onSubmit={() => setEditing(false)}
        className="mt-1 flex flex-wrap items-center gap-1.5"
      >
        {hiddenFields &&
          Object.entries(hiddenFields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        {type === "select" ? (
          <select
            name={name}
            defaultValue={value}
            className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
          >
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : type === "textarea" ? (
          <textarea
            name={name}
            defaultValue={value}
            rows={textareaRows}
            placeholder={placeholder}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
          />
        ) : (
          <Input
            name={name}
            type={type}
            defaultValue={value}
            placeholder={placeholder}
            className="h-8 w-44 text-sm"
          />
        )}
        <Button type="submit" size="sm" className="h-8">
          Save
        </Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-slate-500 hover:text-slate-300"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
