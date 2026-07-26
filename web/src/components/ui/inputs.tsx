"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils/cn";

const CONTROL =
  "w-full rounded border border-line bg-surface-inset px-2 py-1.5 text-[13px] text-fg placeholder:text-fg-subtle " +
  "transition-colors hover:border-line-strong focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | undefined;
  unit?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Renders label and control on one row for dense parameter grids. */
  inline?: boolean;
}

export function Field({ label, htmlFor, hint, error, unit, required, className, children, inline }: FieldProps) {
  return (
    <div className={cn("min-w-0", inline ? "grid grid-cols-[minmax(0,1fr)_140px] items-center gap-2" : "space-y-1", className)}>
      <label
        htmlFor={htmlFor}
        className={cn("flex items-baseline gap-1 text-[12px] font-medium text-fg-muted", inline && "leading-tight")}
      >
        <span>{label}</span>
        {required ? <span className="text-danger">*</span> : null}
        {unit ? <span className="text-[11px] font-normal text-fg-subtle">({unit})</span> : null}
      </label>
      <div className="min-w-0">
        {children}
        {error ? (
          <p role="alert" className="mt-1 text-[11.5px] font-medium text-danger">
            {error}
          </p>
        ) : hint && !inline ? (
          <p className="mt-1 text-[11.5px] text-fg-subtle">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function TextInput({ className, invalid, mono, ...props }: TextInputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, mono && "num", className)}
    />
  );
}

export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number | string;
  onValueChange: (raw: string) => void;
  invalid?: boolean;
}

export function NumberInput({ value, onValueChange, className, invalid, ...props }: NumberInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn(CONTROL, "num text-right", className)}
    />
  );
}

export interface SelectFieldProps<T extends string> extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  invalid?: boolean;
}

export function Select<T extends string>({ value, onValueChange, options, className, invalid, ...props }: SelectFieldProps<T>) {
  return (
    <div className="relative">
      <select
        {...props}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValueChange(event.target.value as T)}
        className={cn(CONTROL, "appearance-none pr-7", className)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ checked, onCheckedChange, label, description, disabled, id }: CheckboxProps) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className="flex items-start gap-2">
      <CheckboxPrimitive.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-surface-inset",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50",
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Check aria-hidden className="size-3 text-primary-fg" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="min-w-0">
        <label htmlFor={controlId} className="block cursor-pointer text-[12.5px] text-fg">
          {label}
        </label>
        {description ? <p className="text-[11.5px] text-fg-subtle">{description}</p> : null}
      </div>
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, label, id }: SwitchProps) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={controlId} className="text-[12.5px] text-fg-muted">
        {label}
      </label>
      <SwitchPrimitive.Root
        id={controlId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "relative h-4.5 w-8 shrink-0 rounded-full border border-line-strong bg-surface-3 transition-colors",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
        )}
      >
        <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-fg" />
      </SwitchPrimitive.Root>
    </div>
  );
}
