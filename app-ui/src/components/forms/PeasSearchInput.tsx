import { Search, X } from "lucide-react";
import { Input, type InputProps } from "../ui/input";
import { PeasIconButton } from "../ui/peas-button";

interface PeasSearchInputProps extends Omit<InputProps, "type"> {
  onClear?: () => void;
}

export function PeasSearchInput({ value, onClear, className, ...props }: PeasSearchInputProps) {
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <div className={className ? `peas-search-input ${className}` : "peas-search-input"}>
      <Search aria-hidden="true" className="peas-search-input__icon" />
      <Input type="search" value={value} {...props} />
      {hasValue && onClear ? (
        <PeasIconButton
          label="Clear search"
          tooltip="Clear search"
          variant="ghost"
          className="peas-search-input__clear"
          onClick={onClear}
        >
          <X aria-hidden="true" />
        </PeasIconButton>
      ) : null}
    </div>
  );
}
