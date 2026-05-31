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
 * input 을 **uncontrolled**(value 바인딩 없음, defaultValue 만)로 둔다.
 * controlled 로 두면 조합 중 refine→리렌더→React 가 value 를 재설정하며 iOS
 * 한글 IME 조합이 깨진다("음"→"ㅇㅡㅁ"). uncontrolled 라 React 가 value 를
 * 건드리지 않으므로 모바일에서도 안 깨지고, onChange 로 매 입력마다 검색해도
 * 안전하다.
 */
export function SearchInput({ compact = false, hint }: SearchInputProps) {
  const { query, refine } = useSearchBox();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [hasValue, setHasValue] = useState(Boolean(query));

  // 최신 refine 을 ref 로 보관(전역 keydown 리스너의 stale closure 방지).
  const refineRef = useRef(refine);
  refineRef.current = refine;

  // 외부 query 변화(Esc 초기화, 커맨드 팔레트 선택)를 DOM 에 반영.
  // 조합 중엔 건드리지 않는다.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || composing.current) return;
    if (el.value !== query) {
      el.value = query;
      setHasValue(Boolean(query));
    }
  }, [query]);

  // 전역 단축키:
  //  "/"   → 검색창 포커스 (입력 중이거나 ⌘K 팔레트가 열려있으면 무시)
  //  "Esc" → 검색어/결과 초기화 (검색창 포커스 여부와 무관하게 어디서나)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K 팔레트(모달) 떠 있으면 전역 단축키 무시
      if (document.querySelector('[role="dialog"]')) return;

      if (e.key === "Escape") {
        const el = inputRef.current;
        if (el?.value) {
          e.preventDefault();
          el.value = "";
          setHasValue(false);
          refineRef.current(""); // 최신 refine 사용
          el.focus();
        }
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // clear 는 매 렌더 새로 생성되지만 ref 만 참조하므로 안정적 — 1회 등록으로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(v: string) {
    setHasValue(Boolean(v));
    refine(v);
  }

  function clear() {
    const el = inputRef.current;
    if (el) el.value = "";
    apply("");
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
        onChange={(e) => apply(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          // iOS 등에서 조합 종료 시 onChange 가 누락될 수 있어 한 번 더 동기화
          apply(e.currentTarget.value);
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
