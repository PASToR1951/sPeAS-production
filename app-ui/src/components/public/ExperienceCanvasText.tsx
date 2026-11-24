import { useState } from "react";

export function sendCanvasMessage(message: Record<string, unknown>) {
  window.parent.postMessage(message, window.location.origin);
}

export function ExperienceCanvasText({ enabled, block, field, label, value, multiline = false }: {
  enabled: boolean;
  block: string;
  field: string;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const [editingValue, setEditingValue] = useState<string | null>(null);
  if (!enabled) return value;

  return (
    <bdi
      className={`peas-canvas-text${multiline ? " peas-canvas-text--multiline" : ""}`}
      contentEditable="plaintext-only"
      role="textbox"
      aria-label={label}
      aria-multiline={multiline}
      spellCheck
      suppressContentEditableWarning
      onFocus={() => {
        // Keep the original React child while the browser owns the caret.
        setEditingValue(value);
        sendCanvasMessage({ type: "experience-canvas-select", block, field });
      }}
      onBlur={() => setEditingValue(null)}
      onInput={(event) => {
        sendCanvasMessage({
          type: "experience-canvas-edit",
          block,
          field,
          value: multiline ? event.currentTarget.innerText : (event.currentTarget.textContent ?? "").replace(/[\r\n]+/g, " "),
        });
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" || (event.key === "Enter" && !multiline)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >{editingValue ?? value}</bdi>
  );
}
