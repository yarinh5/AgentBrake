import type { Gateway } from "./gateway.js";
export type GatewayPort = Pick<
  Gateway,
  "submit" | "approve" | "review" | "actionForAgent"
>;
