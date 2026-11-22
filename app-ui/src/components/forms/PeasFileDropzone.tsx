import { ArrowDown, ArrowUp, FileText, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { PeasIconButton } from "../ui/peas-button";

interface PeasFileDropzoneProps {
  label: string;
  fieldKey?: string;
  file: File | null;
  onFileChange?: (file: File | null) => void;
  additionalFiles?: File[];
  onFilesChange?: (files: File[]) => void;
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
  additionalFiles = [],
  onFilesChange,
  required,
  error,
  description,
  disabled,
  accept = "application/pdf,.pdf",
}: PeasFileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const files = file ? [file, ...additionalFiles] : [];
  const selectFiles = (selected: File[]) => {
    if (onFilesChange) onFilesChange([...files, ...selected]);
    else onFileChange?.(selected[0] ?? null);
  };
  const moveFile = (index: number, offset: number) => {
    const reordered = [...files];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    onFilesChange?.(reordered);
  };

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
          selectFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={Boolean(onFilesChange)}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldKey ? `${fieldKey}-description${error ? ` ${fieldKey}-error` : ""}` : undefined}
          disabled={disabled}
          onChange={(event) => { selectFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}
        />
        <button type="button" disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={`${fieldKey ? `${fieldKey}-description` : ""}${error ? ` ${fieldKey}-error` : ""}`.trim() || undefined} onClick={() => inputRef.current?.click()}>
          <span className="peas-file-dropzone__icon">
            {file ? <FileText aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
          </span>
          <span className="peas-file-dropzone__copy">
            <strong>{file ? `${error ? "Rejected: " : ""}${file.name}` : "Choose file or drag it here"}</strong>
            <span id={fieldKey ? `${fieldKey}-description` : undefined}>{file ? `${formatFileSize(file.size)}${onFilesChange ? " · Choose more files to stitch" : ""}` : description ?? "PDF files are supported."}</span>
          </span>
        </button>
        {file ? (
          <PeasIconButton
            label={`Remove ${label}`}
            tooltip="Remove file"
            variant="ghost"
            className="peas-file-dropzone__remove"
            disabled={disabled}
            onClick={() => onFilesChange ? onFilesChange([]) : onFileChange?.(null)}
          >
            <X aria-hidden="true" />
          </PeasIconButton>
        ) : null}
      </div>
      {onFilesChange ? <>
        <p className="peas-upload-inline-hint">Choose or add files in reading order. Non-PDF documents are converted first, then all pages are stitched into one PDF. Up to 20 files and 100 MB combined.</p>
        {files.length ? <ol className="peas-document-files" aria-label={`${label} reading order`}>
          {files.map((source, index) => <li key={index}>
            <span className="peas-document-files__name">{index + 1}. {source.name} <small>{formatFileSize(source.size)}</small></span>
            <div className="peas-document-files__actions">
              <PeasIconButton label={`Move ${source.name} up`} tooltip="Move up" variant="ghost" disabled={disabled || index === 0} onClick={() => moveFile(index, -1)}><ArrowUp aria-hidden="true" /></PeasIconButton>
              <PeasIconButton label={`Move ${source.name} down`} tooltip="Move down" variant="ghost" disabled={disabled || index === files.length - 1} onClick={() => moveFile(index, 1)}><ArrowDown aria-hidden="true" /></PeasIconButton>
              <PeasIconButton label={`Remove ${source.name}`} tooltip="Remove file" variant="ghost" disabled={disabled} onClick={() => onFilesChange(files.filter((_, item) => item !== index))}><X aria-hidden="true" /></PeasIconButton>
            </div>
          </li>)}
        </ol> : null}
      </> : null}
      {error ? <p className="peas-field__error" id={fieldKey ? `${fieldKey}-error` : undefined} role="alert">{error}</p> : null}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
