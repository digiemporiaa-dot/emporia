/** IANA zones the runtime knows, with UTC first — `supportedValuesOf` leaves it out on some runtimes. */
export function timeZoneOptions(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
}
