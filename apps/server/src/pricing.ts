import { checkPriceFloor } from "@orbs/protocol";
import { ORPCError } from "@orpc/server";
import { t } from "./i18n.ts";

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * Refuses a price below the provider's own published price, so a model can't be set up to cost more than it
 * brings in. Checked on the server as well as in the form, because the form alone can be bypassed.
 */
export function assertPriceNotBelowProvider(
  provider: string,
  modelId: string,
  input: number | null,
  output: number | null,
): void {
  const result = checkPriceFloor(provider, modelId, input, output);
  if (result.ok) return;
  throw new ORPCError("BAD_REQUEST", {
    message: t(result.field === "input" ? "model.priceBelowInput" : "model.priceBelowOutput", {
      min: dollars(result.min),
    }),
  });
}
