import { CalendarDays, X } from "lucide-react";

interface PeasDateRangeProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function PeasDateRange({ from, to, onFromChange, onToChange }: PeasDateRangeProps) {
  return (
    <div className="peas-date-range" aria-label="Date range">
      <DateTrigger label="From" value={from} onChange={onFromChange} />
      <DateTrigger label="To" value={to} onChange={onToChange} />
      {from || to ? <button className="peas-date-range__clear" type="button" onClick={() => { onFromChange(""); onToChange(""); }}><X aria-hidden="true" /> Clear dates</button> : null}
    </div>
  );
}

function DateTrigger({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="peas-date-trigger">
      <span>{label}</span>
      <span className="peas-date-trigger__surface">
        <CalendarDays aria-hidden="true" />
        <strong>{value ? formatDate(value) : "Any date"}</strong>
        <input aria-label={`${label} date`} type="date" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </span>
    </label>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(date);
}
