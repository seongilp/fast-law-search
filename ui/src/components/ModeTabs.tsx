import { cn } from "@/lib/utils";

export type Mode = "laws" | "prec";

export function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { key: Mode; label: string }[] = [
    { key: "laws", label: "법령" },
    { key: "prec", label: "판례" },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-muted p-0.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            mode === t.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
