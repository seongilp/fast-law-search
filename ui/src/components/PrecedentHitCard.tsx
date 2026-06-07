import { Highlight } from "react-instantsearch";
import type { Hit } from "instantsearch.js";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PrecHit } from "@/lib/typesense";

function fmtDate(n?: number): string {
  if (!n) return "";
  const s = String(n);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

export function PrecedentHitCard({ hit }: { hit: Hit<PrecHit> }) {
  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-md">
      <div className="p-5">
        {/* 헤더 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[15px] font-bold text-foreground">
              <Highlight attribute="case_name" hit={hit} />
            </span>
            {hit.case_no && (
              <span className="text-sm text-foreground/70">{hit.case_no}</span>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            {hit.court && <Badge variant="default">{hit.court}</Badge>}
            {hit.case_type && <Badge variant="muted">{hit.case_type}</Badge>}
          </div>
        </div>

        {/* 판시사항 또는 판결요지 */}
        {hit.holding ? (
          <div className="line-clamp-3 text-sm leading-relaxed text-foreground/90">
            <Highlight attribute="holding" hit={hit} />
          </div>
        ) : hit.summary ? (
          <div className="line-clamp-3 text-sm leading-relaxed text-foreground/90">
            <Highlight attribute="summary" hit={hit} />
          </div>
        ) : null}

        {/* 메타 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {hit.judgment_type && <span>{hit.judgment_type}</span>}
          {hit.decided_date ? (
            <span>{fmtDate(hit.decided_date)} 선고</span>
          ) : null}
          {hit.source_url && (
            <a
              href={hit.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              원문 <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}
