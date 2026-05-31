import { InstantSearch, Configure, useInstantSearch } from "react-instantsearch";
import { Scale, Command as CommandIcon } from "lucide-react";
import { searchClient, COLLECTION } from "@/lib/typesense";
import { SearchInput } from "@/components/SearchInput";
import { StatsBar } from "@/components/StatsBar";
import { RefinementFacet } from "@/components/RefinementFacet";
import { ActiveFilters } from "@/components/ActiveFilters";
import { HitsList } from "@/components/HitsList";
import { SearchPagination } from "@/components/SearchPagination";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function App() {
  return (
    <InstantSearch
      searchClient={searchClient}
      indexName={COLLECTION}
      future={{ preserveSharedStateOnUnmount: true }}
      routing
    >
      <Configure hitsPerPage={12} />
      <CommandPalette />
      <Shell />
    </InstantSearch>
  );
}

/** ⌘K 단축키 힌트 배지. */
function KbdHint() {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <kbd className="pointer-events-none inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
      {isMac ? <CommandIcon className="size-3" /> : "Ctrl"}K
    </kbd>
  );
}

/** 검색어 유무에 따라 랜딩(구글식) ↔ 결과 화면을 전환한다. */
function Shell() {
  const { indexUiState } = useInstantSearch();
  const hasQuery = Boolean(indexUiState.query?.trim());

  return hasQuery ? <ResultsView /> : <LandingView />;
}

/** 첫 화면: 화면 중앙에 검색창만(구글식). */
function LandingView() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="relative z-10 flex justify-end px-4 py-3 sm:px-6">
        <ThemeToggle />
      </div>
      <main className="-mt-12 flex flex-1 flex-col items-center justify-center px-4 pb-32">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Scale className="size-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            대한민국 법령 검색
          </h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            약 20만 개 조문을 즉시 검색합니다.
          </p>
        </div>

        <div className="w-full max-w-2xl">
          <SearchInput hint={<KbdHint />} />
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-muted-foreground">
        출처: 국가법령정보센터 (law.go.kr) · 조문 단위 색인 · Typesense
      </footer>
    </div>
  );
}

/** 검색 후: 상단 검색바 + 좌측 패싯 + 결과. */
function ResultsView() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <a
            href="/"
            className="flex shrink-0 items-center gap-2 text-foreground"
            aria-label="처음으로"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Scale className="size-4.5 text-primary" />
            </div>
            <span className="hidden text-sm font-bold sm:inline">법령 검색</span>
          </a>
          <div className="flex-1">
            <SearchInput compact hint={<KbdHint />} />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <StatsBar />
          <ActiveFilters />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <RefinementFacet
              attribute="law_type"
              title="법령구분"
              searchable
              searchPlaceholder="구분 검색"
            />
            <RefinementFacet
              attribute="ministry"
              title="소관부처"
              searchable
              searchPlaceholder="부처 검색"
            />
            <RefinementFacet attribute="status" title="상태" limit={6} />
          </aside>

          <main>
            <HitsList />
            <SearchPagination />
          </main>
        </div>
      </div>
    </div>
  );
}
