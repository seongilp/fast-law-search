import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchBox } from "react-instantsearch";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  compact?: boolean;
  /** 우측에 표시할 단축키 힌트(⌘K). 입력값이 있으면 지우기 버튼으로 대체됨. */
  hint?: ReactNode;
}

/** 이미 입력 요소에 포커스가 있으면 "/" 단축키를 무시한다. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

/**
 * 검색 입력.
 *
 * input 을 **uncontrolled** 로 둔다(value prop 없음). controlled 로 두면
 * 조합 중 refine() → 리렌더 → React 가 value 를 재설정하면서 iOS Safari 의
 * 한글 IME 조합 버퍼가 깨진다(예: "음" → "ㅇㅡㅁ"). uncontrolled 라 React 가
 * value 를 건드리지 않으므로 모바일에서도 조합이 안 깨진다.
 *
 * 표시값은 브라우저/IME 가 직접 관리하고, refine() 만 onChange 에서 호출한다.
 * 외부에서 값을 바꿔야 할 때(Esc 초기화, 커맨드 팔레트 선택)는 DOM value 를
 * ref 로 직접 설정한다.
 */
export function SearchInput({ compact = false, hint }: SearchInputProps) {
  const { query, refine } = useSearchBox();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  // 지우기 버튼 표시 여부만 위한 최소 상태 (input value 는 바인딩하지 않음).
  const [hasValue, setHasValue] = useState(Boolean(query));

  // 외부 query 변화(초기화/팔레트 선택)를 DOM 에 반영. 조합 중엔 건드리지 않음.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || composing.current) return;
    if (el.value !== query) {
      el.value = query;
      setHasValue(Boolean(query));
    }
  }, [query]);

  // 네이티브 input 이벤트로 검색을 건다. iOS Safari 는 한글 조합 중 React 의
  // synthetic onChange 를 안 쏘는 경우가 있어, compositionend 전까지 검색이
  // 안 나간다. 네이티브 input 은 조합 중에도 매 입력마다 발화하므로 이걸로
  // 검색을 트리거하면 조합 중에도 즉시 결과가 갱신된다.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onInput = () => {
      setHasValue(Boolean(el.value));
      refine(el.value);
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
    // refine 은 InstantSearch 가 안정적으로 제공하므로 1회 등록으로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" 키로 검색창 포커스 (입력 중이거나 ⌘K 팔레트가 열려있으면 무시)
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
    const el = inputRef.current;
    if (el) el.value = "";
    setHasValue(false);
    refine("");
    el?.focus();
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
        defaultValue={query}
        // 검색 트리거는 네이티브 input 리스너(위 useEffect)가 담당한다.
        // onChange 는 React 가 controlled 로 오해하지 않게 no-op 으로 둔다.
        onChange={() => {}}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && inputRef.current?.value) {
            e.preventDefault();
            clear();
          }
        }}
        autoFocus
        placeholder="법령명·조문 내용·소관부처로 검색 …"
        className={cn(
          "rounded-full border-input pl-12 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40",
          hint || hasValue ? "pr-14" : "pr-4",
          compact ? "h-11 text-sm" : "h-14 text-base shadow-md"
        )}
      />
      {hasValue ? (
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
