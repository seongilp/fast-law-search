import { useState } from "react";
import { Highlight } from "react-instantsearch";
import type { Hit } from "instantsearch.js";
import { ExternalLink, ChevronDown, Building2, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LawHit } from "@/lib/typesense";
import { formatLawDate, cn } from "@/lib/utils";

export function LawHitCard({ hit }: { hit: Hit<LawHit> }) {
  const [expanded, setExpanded] = useState(false);
  const enforce = formatLawDate(hit.enforcement_date);
  const ministries = hit.ministry?.filter(Boolean) ?? [];

  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-md">
      <div className="p-5">
        {/* 헤더 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[15px] font-bold text-foreground">
              <Highlight attribute="law_name" hit={hit} />
            </span>
            {hit.article_label && (
              <span className="text-sm font-semibold text-primary">
                {hit.article_label}
              </span>
            )}
            {hit.article_title && (
              <span className="text-sm text-foreground/70">
                <Highlight attribute="article_title" hit={hit} />
              </span>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Badge variant="default">{hit.law_type}</Badge>
            {hit.status && <Badge variant="muted">{hit.status}</Badge>}
          </div>
        </div>

        {/* 본문 */}
        <div
          className={cn(
            "law-body text-sm leading-relaxed text-foreground/90",
            !expanded && "line-clamp-4"
          )}
        >
          <Highlight attribute="content" hit={hit} />
        </div>

        {hit.content.length > 180 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 h-7 px-2 text-xs text-primary hover:text-primary"
          >
            {expanded ? "접기" : "더보기"}
            <ChevronDown
              className={cn("transition-transform", expanded && "rotate-180")}
            />
          </Button>
        )}

        {/* 메타 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {hit.chapter && <span className="font-medium">{hit.chapter}</span>}
          {ministries.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" />
              {ministries.join(", ")}
            </span>
          )}
          {enforce && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" />
              시행 {enforce}
            </span>
          )}
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
