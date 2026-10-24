export type BadgeKind = "success" | "warning" | "failure" | "loading" | "info";

const STYLES: Record<BadgeKind, string> = {
  success: "border-lab-accent text-lab-accent",
  warning: "border-lab-warn text-lab-warn",
  failure: "border-lab-danger text-lab-danger",
  loading: "border-lab-accent2 text-lab-accent2 animate-pulse",
  info: "border-lab-border text-neutral-400",
};

export function StatusBadge({ kind, children }: { kind: BadgeKind; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${STYLES[kind]}`}
    >
      {children}
    </span>
  );
}
