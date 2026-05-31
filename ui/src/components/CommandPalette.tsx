import { useEffect, useMemo, useRef, useState } from "react";
import { useInstantSearch } from "react-instantsearch";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { quickSearch, type LawHit } from "@/lib/typesense";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";

const RECENT_KEY = "legalize:recent";
const EXAMPLES = ["개인정보 동의", "손해배상", "음주운전", "유류분", "근로시간"];

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 불가 환경 무시 */
  }
  return next;
}

/** 평탄화된 선택 가능 항목. 키보드 네비게이션이 이 배열 인덱스로 동작. */
interface Row {
  key: string;
  group: string;
  run: () => void;
  render: (active: boolean) => React.ReactNode;
}

/** ⌘K / Ctrl+K 로 여는 라이브 검색 팔레트(키보드 네비게이션 직접 구현). */
export function CommandPalette() {
  const { setIndexUiState } = useInstantSearch();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [hits, setHits] = useState<LawHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const debounced = useDebounce(input, 180);
  const listRef = useRef<HTMLDivElement>(null);

  // 단축키 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 열 때 초기화
  useEffect(() => {
    if (open) {
      setRecent(loadRecent());
      setActive(0);
    } else {
      setInput("");
      setHits([]);
    }
  }, [open]);

  // 라이브 검색 (디바운스 + 취소)
  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    quickSearch(q, 7, ctrl.signal)
      .then((r) => setHits(r))
      .catch((err) => {
        if (err?.name !== "AbortError") setHits([]);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced]);

  function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecent(pushRecent(trimmed));
    setIndexUiState((s) => ({ ...s, query: trimmed, page: 1 }));
    setOpen(false);
  }

  // 현재 상태에 따른 선택 가능 행 목록 구성
  const rows = useMemo<Row[]>(() => {
    const showSuggestions = input.trim().length === 0;
    const out: Row[] = [];

    if (showSuggestions) {
      recent.forEach((q) =>
        out.push({
          key: `recent-${q}`,
          group: "최근 검색",
          run: () => runSearch(q),
          render: (a) => (
            <Item active={a}>
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{q}</span>
            </Item>
          ),
        })
      );
      EXAMPLES.forEach((q) =>
        out.push({
          key: `ex-${q}`,
          group: "추천 검색어",
          run: () => runSearch(q),
          render: (a) => (
            <Item active={a}>
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{q}</span>
            </Item>
          ),
        })
      );
    } else {
      hits.forEach((hit) =>
        out.push({
          key: hit.id,
          group: "조문",
          run: () => runSearch(input),
          render: (a) => (
            <Item active={a}>
              <FileText className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">
                  <span className="font-semibold">{hit.law_name}</span>{" "}
                  <span className="text-primary">{hit.article_label}</span>{" "}
                  {hit.article_title && (
                    <span className="text-foreground/70">{hit.article_title}</span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {hit.content.replace(/\s+/g, " ").slice(0, 72)}
                </span>
              </div>
            </Item>
          ),
        })
      );
      out.push({
        key: "__run__",
        group: "동작",
        run: () => runSearch(input),
        render: (a) => (
          <Item active={a}>
            <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">
              "<span className="font-medium">{input.trim()}</span>" 전체 결과 보기
            </span>
          </Item>
        ),
      });
    }
    return out;
    // runSearch 는 매 렌더 새로 생성되지만 의존성에 넣으면 무한루프 — 의도적으로 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, hits, recent]);

  // 행 목록이 바뀌면 활성 인덱스 보정
  useEffect(() => {
    setActive((i) => (i >= rows.length ? 0 : i));
  }, [rows.length]);

  // 활성 항목이 보이도록 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active]) rows[active].run();
      else runSearch(input);
    }
  }

  // 그룹 헤더 표시용: 직전 행과 그룹이 다르면 헤더 출력
  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0" showClose={false}>
        <DialogTitle className="sr-only">법령 검색</DialogTitle>
        <DialogDescription className="sr-only">
          법령명·조문 내용을 검색하세요.
        </DialogDescription>

        <div className="flex items-center border-b px-3">
          <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            placeholder="법령·조문 검색…  (↑↓ 이동, Enter 로 전체 결과)"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-[400px] overflow-y-auto p-2">
          {input.trim() && loading && hits.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              검색 중…
            </div>
          )}
          {input.trim() && !loading && hits.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              결과가 없습니다.
            </div>
          )}

          {rows.map((row, idx) => {
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <div key={row.key}>
                {header && (
                  <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {header}
                  </div>
                )}
                <div
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => row.run()}
                  className="cursor-pointer"
                >
                  {row.render(idx === active)}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Item({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-2.5 text-foreground transition-colors",
        active && "bg-accent text-accent-foreground"
      )}
    >
      {children}
    </div>
  );
}
