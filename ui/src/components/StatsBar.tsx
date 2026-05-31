import { useStats } from "react-instantsearch";
import { Zap } from "lucide-react";

export function StatsBar() {
  const { nbHits, processingTimeMS, query } = useStats();

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
      <span>개 조문</span>
      <span className="text-border">·</span>
      <Zap className="size-3.5 text-primary" />
      <span>{processingTimeMS}ms</span>
    </div>
  );
}
