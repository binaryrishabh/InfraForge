import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { controlClass } from "./controlClass";

interface FieldProps { label: ReactNode; hint?: ReactNode; error?: string | null; children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; className?: string; optional?: boolean }

export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined, errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}{optional && <span className="ml-1.5 font-normal text-ink-3">optional</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && <p id={hintId} className="text-xs text-ink-3">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-fail">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, "h-9", className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(controlClass, "h-9 pr-8", className)} {...rest}>{children}</select>;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlClass, "py-2 min-h-20 leading-relaxed", className)} {...rest} />;
}
