import { useEffect, useState } from "react";
import { InstantSearch, Configure, useInstantSearch } from "react-instantsearch";
import { Scale, Command as CommandIcon, Zap } from "lucide-react";
import { searchClient, COLLECTION, fetchTotalArticles } from "@/lib/typesense";
import { SearchInput } from "@/components/SearchInput";
import { StatsBar } from "@/components/StatsBar";
import { RefinementFacet } from "@/components/RefinementFacet";
import { ActiveFilters } from "@/components/ActiveFilters";
import { HitsList } from "@/components/HitsList";
import { SearchPagination } from "@/components/SearchPagination";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

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
    <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground sm:inline-flex">
      {isMac ? <CommandIcon className="size-3" /> : "Ctrl"}K
    </kbd>
  );
}

/**
 * 검색어 유무로 랜딩(중앙)↔결과(상단바)를 전환하되, **SearchInput 은 단일
 * 인스턴스로 같은 트리 위치(key="search")에 유지**한다. 두 뷰에 각각 input 을
 * 두면 첫 글자 입력 시 화면 전환으로 input 이 remount 되어 iOS 한글 IME 조합이
 * 깨진다(예: "음" → "ㅇㅡㅁ"). 위치를 고정해 remount 를 막는다.
 */
function Shell() {
  const { indexUiState } = useInstantSearch();
  const hasQuery = Boolean(indexUiState.query?.trim());

  // 전체 조문 수를 라이브로 받아 랜딩 카피에 표기(매일 자동 갱신). 실패해도 무해.
  const [totalArticles, setTotalArticles] = useState<number | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchTotalArticles(ctrl.signal)
      .then(setTotalArticles)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 랜딩일 때만 토글을 우상단에 둔다(검색창과 안 겹침). 결과 화면에선
          헤더 안에 인라인으로 배치한다(아래). */}
      {!hasQuery && (
        <div className="flex justify-end px-3 py-3">
          <ThemeToggle />
        </div>
      )}

      {/* 검색 영역: 바깥/안쪽 래퍼는 className 만 바뀌고 요소 정체성은 유지된다.
          → key="search" 의 SearchInput 은 remount 되지 않는다. */}
      <div
        className={cn(
          "w-full",
          hasQuery
            ? "sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md"
            : "flex flex-1 flex-col items-center justify-center px-4 pb-24"
        )}
      >
        <div
          className={cn(
            hasQuery
              ? "mx-auto flex max-w-6xl items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6"
              : "-mt-16 flex w-full max-w-2xl flex-col items-center"
          )}
        >
          {hasQuery ? (
            <a
              key="brand"
              href="/"
              aria-label="처음으로"
              className="flex shrink-0 items-center gap-2 text-foreground"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                <Scale className="size-5 text-primary" />
              </div>
              <span className="hidden text-sm font-bold sm:inline">법령 검색</span>
            </a>
          ) : (
            <div key="brand" className="mb-8 flex flex-col items-center text-center">
              <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <Scale className="size-8 text-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                대한민국 법령 검색
              </h1>
              <p className="mt-3 inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground/80 sm:text-base">
                법령·행정규칙{" "}
                <span className="font-semibold text-muted-foreground">
                  {(totalArticles ?? 516704).toLocaleString("ko-KR")}
                </span>
                개 조문을 0.01초만에
                <Zap className="size-4 fill-primary/80 text-primary/80" aria-hidden />
              </p>
            </div>
          )}

          <div key="search" className={hasQuery ? "min-w-0 flex-1" : "w-full"}>
            <SearchInput compact={hasQuery} hint={<KbdHint />} />
          </div>

          {/* 결과 화면: 토글을 검색창 오른쪽 바깥에 인라인 배치(겹침 없음) */}
          {hasQuery && <ThemeToggle />}
        </div>
      </div>

      {/* 결과 본문 */}
      {hasQuery ? (
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <StatsBar />
            <ActiveFilters />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
            <aside className="space-y-2 lg:sticky lg:top-20 lg:self-start lg:space-y-4">
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
      ) : (
        <footer className="py-6 text-center text-xs text-muted-foreground">
          출처: 국가법령정보센터 (law.go.kr) · 조문 단위 색인 · Typesense
        </footer>
      )}
    </div>
  );
}
