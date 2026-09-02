/** JSON serialization used by diagnostics and bounded provider-input checks.
 *
 * Domain snapshots can contain PostgreSQL bigint values. Converting those
 * values to decimal strings keeps artifacts deterministic without exposing a
 * lossy Number conversion.
 */
export function safeDiagnosticJsonStringify(
  value: unknown,
  space?: string | number,
): string {
  const serialized = JSON.stringify(
    value,
    (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString(10) : nestedValue,
    space,
  );
  return serialized ?? "undefined";
}
