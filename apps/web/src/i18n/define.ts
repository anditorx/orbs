/**
 * Declares one feature's messages in both languages side by side. The Indonesian table must have
 * exactly the same keys as the English one, so a missing translation fails the type check.
 */
export function defineMessages<const E extends Record<string, string>>(
  en: E,
  id: { [K in keyof E]: string },
) {
  return { en, id };
}
