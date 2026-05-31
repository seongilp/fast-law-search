import { usePagination } from "react-instantsearch";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SearchPagination() {
  const {
    pages,
    currentRefinement,
    nbPages,
    isFirstPage,
    isLastPage,
    refine,
  } = usePagination({ padding: 2 });

  if (nbPages <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-center gap-1">
      <Button
        variant="outline"
        size="icon"
        disabled={isFirstPage}
        onClick={() => refine(currentRefinement - 1)}
        aria-label="이전 페이지"
        className="size-9"
      >
        <ChevronLeft className="size-4" />
      </Button>

      {pages.map((page) => (
        <Button
          key={page}
          variant={page === currentRefinement ? "default" : "outline"}
          size="icon"
          onClick={() => refine(page)}
          className="size-9 tabular-nums"
        >
          {page + 1}
        </Button>
      ))}

      <Button
        variant="outline"
        size="icon"
        disabled={isLastPage}
        onClick={() => refine(currentRefinement + 1)}
        aria-label="다음 페이지"
        className="size-9"
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
