import type { ReactNode } from "react";

interface PeasFieldProps {
  label: string;
  htmlFor?: string;
  fieldKey?: string;
  required?: boolean;
  optional?: boolean;
  description?: string;
  error?: string;
  children: ReactNode;
}

export function PeasField({ label, htmlFor, fieldKey, required, optional, description, error, children }: PeasFieldProps) {
  const descriptionId = fieldKey ? `${fieldKey}-description` : undefined;
  const errorId = fieldKey ? `${fieldKey}-error` : undefined;
  return (
    <div className="peas-field" data-upload-field={fieldKey}>
      <label className="peas-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {optional ? <small>Optional</small> : null}
      </label>
      {children}
      {description ? <p className="peas-field__description" id={descriptionId}>{description}</p> : null}
      {error ? <p className="peas-field__error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}
