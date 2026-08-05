import { FileText, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { PeasIconButton } from "../ui/peas-button";

interface PeasFileDropzoneProps {
  label: string;
  fieldKey?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  required?: boolean;
  error?: string;
  description?: string;
  disabled?: boolean;
  accept?: string;
}

export function PeasFileDropzone({
  label,
  fieldKey,
  file,
  onFileChange,
  required,
  error,
  description,
  disabled,
  accept = "application/pdf,.pdf",
}: PeasFileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="peas-field" data-upload-field={fieldKey}>
      <span className="peas-field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {!required ? <small>Optional</small> : null}
      </span>
      <div
        className={cn("peas-file-dropzone", dragging && "is-dragging", disabled && "is-disabled")}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          onFileChange(event.dataTransfer.files?.[0] ?? null);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onFileChange(event.currentTarget.files?.[0] ?? null)}
        />
        <button type="button" disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={`${fieldKey ? `${fieldKey}-description` : ""}${error ? ` ${fieldKey}-error` : ""}`.trim() || undefined} onClick={() => inputRef.current?.click()}>
          <span className="peas-file-dropzone__icon">
            {file ? <FileText aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
          </span>
          <span className="peas-file-dropzone__copy">
            <strong>{file ? file.name : "Choose PDF or drag it here"}</strong>
            <span id={fieldKey ? `${fieldKey}-description` : undefined}>{file ? formatFileSize(file.size) : description ?? "PDF files are supported."}</span>
          </span>
        </button>
        {file ? (
          <PeasIconButton
            label={`Remove ${label}`}
            tooltip="Remove file"
            variant="ghost"
            className="peas-file-dropzone__remove"
            disabled={disabled}
            onClick={() => onFileChange(null)}
          >
            <X aria-hidden="true" />
          </PeasIconButton>
        ) : null}
      </div>
      {error ? <p className="peas-field__error" id={fieldKey ? `${fieldKey}-error` : undefined} role="alert">{error}</p> : null}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
