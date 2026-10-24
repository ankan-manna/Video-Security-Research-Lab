export interface KeyValueRow {
  name: string;
  value: string;
}

/** Renders redacted values with a visible warning indicator, never silently. */
export function KeyValueTable({ rows }: { rows: KeyValueRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-neutral-600">none</p>;
  }
  return (
    <table className="w-full text-left text-[11px]">
      <tbody>
        {rows.map((row, index) => {
          const redacted = row.value === "[REDACTED]";
          return (
            <tr key={`${row.name}-${index}`} className="border-t border-lab-border/60">
              <td className="whitespace-nowrap py-1 pr-2 align-top text-lab-accent2">{row.name}</td>
              <td className={`break-all py-1 ${redacted ? "text-lab-warn" : "text-neutral-300"}`}>
                {row.value}
                {redacted && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-lab-warn">● redacted</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
