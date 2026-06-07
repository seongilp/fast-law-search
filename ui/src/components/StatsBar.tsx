import { useStats } from "react-instantsearch";
import { Zap } from "lucide-react";
import type { Mode } from "@/components/ModeTabs";

export function StatsBar({ mode = "laws" }: { mode?: Mode }) {
  const { nbHits, processingTimeMS, query } = useStats();
  const unit = mode === "prec" ? "개 판례" : "개 조문";

  if (!query) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        검색어를 입력하세요. 타이핑하는 즉시 결과가 나옵니다.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">
        {nbHits.toLocaleString("ko-KR")}
      </span>
      <span>{unit}</span>
      <span className="text-border">·</span>
      <Zap className="size-3.5 text-primary" />
      <span>{processingTimeMS}ms</span>
    </div>
  );
}
