import { useHits, useInstantSearch } from "react-instantsearch";
import { FileSearch } from "lucide-react";
import { LawHitCard } from "./LawHitCard";
import { PrecedentHitCard } from "./PrecedentHitCard";
import type { Mode } from "@/components/ModeTabs";

export function HitsList({ mode }: { mode: Mode }) {
  const { items } = useHits();
  const { indexUiState } = useInstantSearch();
  const query = indexUiState.query ?? "";

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-20 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
          <FileSearch className="size-7 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          검색 결과가 없습니다
        </h3>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          "{query}" 와 일치하는{" "}
          {mode === "prec" ? "판례" : "조문"}를 찾지 못했습니다. 다른
          키워드로 시도해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((hit) =>
        mode === "prec" ? (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <PrecedentHitCard key={hit.objectID} hit={hit as any} />
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <LawHitCard key={hit.objectID} hit={hit as any} />
        )
      )}
    </div>
  );
}
