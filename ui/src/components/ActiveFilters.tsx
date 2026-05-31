import { useCurrentRefinements } from "react-instantsearch";
import { X } from "lucide-react";

export function ActiveFilters() {
  const { items, refine } = useCurrentRefinements();
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">필터</span>
      {items.map((item) =>
        item.refinements.map((refinement) => (
          <button
            key={`${item.attribute}-${refinement.label}`}
            onClick={() => refine(refinement)}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {refinement.label}
            <X className="size-3" />
          </button>
        ))
      )}
    </div>
  );
}
