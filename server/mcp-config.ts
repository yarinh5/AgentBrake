export function gatewayBase(raw: string, isolated = false): URL {
  const base = new URL(raw);
  const local =
    base.protocol === "http:" &&
    (["127.0.0.1", "localhost"].includes(base.hostname) ||
      (isolated && base.hostname === "gateway" && base.port === "4313"));
  if (base.username || base.password || (!local && base.protocol !== "https:"))
    throw Error(
      "Use HTTPS, loopback or the explicitly selected isolated fixture gateway",
    );
  return base;
}
