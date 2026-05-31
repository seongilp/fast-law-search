import { useEffect, useRef, type ReactNode } from "react";
import { useSearchBox } from "react-instantsearch";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  compact?: boolean;
  /** 우측에 표시할 단축키 힌트(⌘K). query 가 있으면 지우기 버튼으로 대체됨. */
  hint?: ReactNode;
}

/** 이미 입력 요소에 포커스가 있으면 "/" 단축키를 무시한다. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

export function SearchInput({ compact = false, hint }: SearchInputProps) {
  const { query, refine } = useSearchBox();
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" 키로 검색창에 즉시 포커스 (입력 중이거나 ⌘K 팔레트가 열려있으면 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      // 모달(커맨드 팔레트) 떠 있으면 무시
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <Search
        className={cn(
          "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground",
          compact ? "size-4" : "size-5"
        )}
      />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => refine(e.target.value)}
        onKeyDown={(e) => {
          // Esc: 검색어 지우기 → 깨끗한 화면으로
          if (e.key === "Escape" && query) {
            e.preventDefault();
            refine("");
          }
        }}
        autoFocus
        placeholder="법령명·조문 내용·소관부처로 검색 …"
        className={cn(
          "rounded-full border-input pl-12 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40",
          hint || query ? "pr-14" : "pr-4",
          compact ? "h-11 text-sm" : "h-14 text-base shadow-md"
        )}
      />
      {query ? (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={() => {
            refine("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : (
        hint && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">{hint}</span>
        )
      )}
    </div>
  );
}
