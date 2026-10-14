import { useState, type FormEvent } from "react";
import { INFRASTRUCTURE_NAME_MAX_LENGTH, validateInfrastructureName } from "@infraforge/domain/validation";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Field, Input } from "./Field";

export function ConfirmDialog({ open, onOpenChange, title, description, consequences = [], confirmLabel, danger = false, loading = false, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; consequences?: string[];
  confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm" busy={loading} guarded={danger}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading} autoFocus={!danger}>{confirmLabel}</Button>
      </>}>
      {consequences.length > 0 ? (
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">{consequences.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : <p className="text-sm text-ink-2">Confirm to continue.</p>}
    </Dialog>
  );
}

export function NameDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; initialValue?: string; submitLabel: string; loading?: boolean; onSubmit: (name: string) => void }) {
  if (!props.open) return null;
  return <OpenNameDialog key={props.initialValue ?? ""} {...props} />;
}

function OpenNameDialog({ open, onOpenChange, title, description, initialValue = "", submitLabel, loading = false, onSubmit }: Parameters<typeof NameDialog>[0]) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const error = touched ? validateInfrastructureName(value) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!validateInfrastructureName(value)) onSubmit(value.trim());
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm" busy={loading}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Design name" error={error} hint={`3–${INFRASTRUCTURE_NAME_MAX_LENGTH} characters.`}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoFocus value={value} maxLength={INFRASTRUCTURE_NAME_MAX_LENGTH}
              onChange={(event) => setValue(event.target.value)} onBlur={() => setTouched(true)} onFocus={(event) => event.target.select()}
              placeholder="checkout-api" disabled={loading} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="primary" loading={loading} disabled={!value.trim()}>{submitLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TypeToConfirmDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; name: string; loading?: boolean; onConfirm: () => void }) {
  if (!props.open) return null;
  return <OpenTypeToConfirm key={props.name} {...props} />;
}

function OpenTypeToConfirm({ open, onOpenChange, name, loading = false, onConfirm }: Parameters<typeof TypeToConfirmDialog>[0]) {
  const [value, setValue] = useState("");
  const matches = value.trim() === name.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Delete design" size="sm" busy={loading} guarded
      description="The saved layout is removed. Runs started from it keep their own recorded inputs and reports.">
      <form onSubmit={(event) => { event.preventDefault(); if (matches) onConfirm(); }} className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">Deleting <span className="if-num rounded-sm border border-line bg-surface px-1.5 py-0.5 text-ink">{name}</span>. This cannot be undone.</p>
        <Field label="Type the design name to confirm">
          {({ id }) => <Input id={id} autoFocus value={value} onChange={(event) => setValue(event.target.value)} disabled={loading} autoComplete="off" />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!matches}>Delete design</Button>
        </div>
      </form>
    </Dialog>
  );
}
