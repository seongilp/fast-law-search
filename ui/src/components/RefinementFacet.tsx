import { useState } from "react";
import { useRefinementList } from "react-instantsearch";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  attribute: string;
  title: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  limit?: number;
}

export function RefinementFacet({
  attribute,
  title,
  searchable = false,
  searchPlaceholder = "검색",
  limit = 8,
}: Props) {
  const { items, refine, searchForItems, canToggleShowMore, isShowingMore, toggleShowMore } =
    useRefinementList({ attribute, limit, showMore: true, showMoreLimit: 30 });
  const [q, setQ] = useState("");

  if (items.length === 0 && !q) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>

      {searchable && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              searchForItems(e.target.value);
            }}
            placeholder={searchPlaceholder}
            className="h-8 pl-8 text-sm"
          />
        </div>
      )}

      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                item.isRefined && "bg-accent/60"
              )}
            >
              <Checkbox
                checked={item.isRefined}
                onCheckedChange={() => refine(item.value)}
              />
              <span
                className={cn(
                  "flex-1 truncate",
                  item.isRefined ? "font-medium text-foreground" : "text-foreground/80"
                )}
                title={item.label}
              >
                {item.label}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {item.count.toLocaleString("ko-KR")}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {canToggleShowMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleShowMore}
          className="mt-2 h-7 w-full text-xs text-muted-foreground"
        >
          {isShowingMore ? "접기" : "더 보기"}
        </Button>
      )}
    </section>
  );
}
