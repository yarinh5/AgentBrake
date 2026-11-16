import { HttpError } from "../contracts.js";
export function assertPayloadLimits(input: unknown) {
  const pending = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 12 || ++nodes > 2000)
      throw new HttpError(
        400,
        "Payload nesting or complexity exceeds the supported limit",
      );
    if (value && typeof value === "object")
      for (const child of Object.values(value))
        pending.push({ value: child, depth: depth + 1 });
  }
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 32768)
    throw new HttpError(413, "Request is too large");
}
export class RequestLimits {
  private active = 0;
  private rates = new Map<string, { since: number; count: number }>();
  constructor(
    private maxConcurrent = 8,
    private perMinute = 120,
  ) {}
  enter(identity: string) {
    const now = Date.now();
    const entry = this.rates.get(identity);
    const rate =
      entry && now - entry.since < 60000 ? entry : { since: now, count: 0 };
    this.rates.set(identity, rate);
    if (++rate.count > this.perMinute)
      throw new HttpError(429, "Agent request rate exceeded");
    if (this.active >= this.maxConcurrent)
      throw new HttpError(429, "Gateway concurrency limit reached");
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
