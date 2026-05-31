import { useEffect, useRef, useState, type ReactNode } from "react";
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

  // 표시값은 로컬 state 로 관리한다. react-instantsearch 의 query 를 input value
  // 에 직접 바인딩하면 매 키마다 controlled value 가 되돌아와 한글 IME 조합이
  // 깨진다(예: "ㄱd"). 표시값을 분리했으므로 조합 중에도 refine 을 호출해도
  // 안전하다 → "음주운전"을 띄어쓰기 없이 쳐도 글자마다 즉시 검색된다.
  const [value, setValue] = useState(query);
  const composing = useRef(false);

  // 외부에서 query 가 바뀔 때만(Esc 초기화, 커맨드 팔레트 선택 등) 표시값 동기화.
  // 조합 중에는 건드리지 않아 IME 가 깨지지 않게 한다.
  useEffect(() => {
    if (!composing.current) setValue(query);
  }, [query]);

  // "/" 키로 검색창에 즉시 포커스 (입력 중이거나 ⌘K 팔레트가 열려있으면 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function clear() {
    setValue("");
    refine("");
    inputRef.current?.focus();
  }

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
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          // 조합 중이든 아니든 즉시 검색 (표시값을 분리해 IME 가 안 깨짐).
          refine(v);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          // Esc: 검색어 지우기 → 깨끗한 화면으로
          if (e.key === "Escape" && value) {
            e.preventDefault();
            clear();
          }
        }}
        autoFocus
        placeholder="법령명·조문 내용·소관부처로 검색 …"
        className={cn(
          "rounded-full border-input pl-12 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40",
          hint || value ? "pr-14" : "pr-4",
          compact ? "h-11 text-sm" : "h-14 text-base shadow-md"
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={clear}
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
