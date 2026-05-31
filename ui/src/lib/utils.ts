import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 20260317 → "2026.03.17" 표시용 포맷. 0/누락이면 빈 문자열. */
export function formatLawDate(n?: number): string {
  if (!n || n < 10000101) return "";
  const s = String(n);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}
