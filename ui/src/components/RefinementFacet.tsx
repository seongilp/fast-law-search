import { useState } from "react";
import { useRefinementList } from "react-instantsearch";
import { Search, ChevronDown } from "lucide-react";
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
  const {
    items,
    refine,
    searchForItems,
    canToggleShowMore,
    isShowingMore,
    toggleShowMore,
  } = useRefinementList({ attribute, limit, showMore: true, showMoreLimit: 30 });
  const [q, setQ] = useState("");
  // 모바일 펼침 상태. 데스크톱(lg)은 CSS 로 항상 펼침이라 이 값과 무관.
  const [open, setOpen] = useState(false);

  if (items.length === 0 && !q) return null;

  const refinedCount = items.filter((i) => i.isRefined).length;

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* 헤더: 모바일에선 탭하면 토글, 데스크톱에선 정적 라벨 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left lg:cursor-default"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {refinedCount > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {refinedCount}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform lg:hidden",
            open && "rotate-180"
          )}
        />
      </button>

      {/* 본문: 모바일은 open 일 때만, 데스크톱은 항상 표시 */}
      <div className={cn("px-4 pb-4", open ? "block" : "hidden", "lg:block")}>
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
                    item.isRefined
                      ? "font-medium text-foreground"
                      : "text-foreground/80"
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
      </div>
    </section>
  );
}
