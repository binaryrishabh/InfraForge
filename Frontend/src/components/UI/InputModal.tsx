import { useState } from "react";
import { Modal } from "./Modal";
import { INFRASTRUCTURE_NAME_MAX_LENGTH, validateInfrastructureName } from "@infraforge/domain/validation";
import {
  INPUT_CLASS,
  LABEL_CLASS,
  CANCEL_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/theme/controlClasses";

interface InputModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (value: string) => void;
}

export function InputModal(props: InputModalProps) {
  if (!props.open) return null;
  return <OpenInputModal key={props.initialValue ?? ""} {...props} />;
}

function OpenInputModal({
  open,
  onOpenChange,
  title,
  description,
  label = "Infrastructure name",
  placeholder = "production-web-cluster",
  initialValue = "",
  submitLabel,
  loading = false,
  onSubmit,
}: InputModalProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const validate = (val: string) => {
    return validateInfrastructureName(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    const validationError = validate(trimmed);
    if (validationError) {
      setError(validationError);
      setTouched(true);
      return;
    }
    onSubmit(trimmed);
  };

  const showError = touched && error;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      loading={loading}
    >
      <form onSubmit={handleSubmit}>
        <div>
          <label className={LABEL_CLASS}>
            {label}
          </label>
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (touched) {
                const validationError = validate(e.target.value);
                setError(validationError);
              }
            }}
            onBlur={() => {
              setTouched(true);
              setError(validate(value));
            }}
            onFocus={(e) => e.target.select()}
            placeholder={placeholder}
            maxLength={INFRASTRUCTURE_NAME_MAX_LENGTH}
            disabled={loading}
            className={`${INPUT_CLASS} ${
              showError
                ? "!border-[#C4574A] !shadow-[0_0_0_3px_rgba(196,87,74,0.16)]"
                : ""
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          {showError && (
            <p className="text-xs text-[#C4574A] mt-1.5 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" />
                <line x1="6" y1="3.5" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1" />
                <circle cx="6" cy="8.5" r="0.5" fill="currentColor" />
              </svg>
              {error}
            </p>
          )}
          {value.length >= INFRASTRUCTURE_NAME_MAX_LENGTH - 6 && !showError && (
            <p className="text-[11px] text-[#5A5F6B] text-right mt-1.5">
              {value.length}/{INFRASTRUCTURE_NAME_MAX_LENGTH}
            </p>
          )}
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={CANCEL_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim() || loading}
            className={PRIMARY_BUTTON_CLASS}
          >
            {loading && (
              <span className="w-3.5 h-3.5 border-2 border-[#14161A]/30 border-t-[#14161A] rounded-full animate-spin" />
            )}
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
