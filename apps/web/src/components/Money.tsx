import { idr, usd } from "../lib/money.ts";

/** A cost in both currencies: dollars on top, rupiah beneath. */
export function Money({ micro, rupiah }: { micro: number; rupiah: number }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{usd(micro)}</span>
      <span className="text-xs text-muted-foreground">{idr(rupiah)}</span>
    </span>
  );
}
