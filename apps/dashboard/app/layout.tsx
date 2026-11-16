import type { ReactNode } from "react";
import "../../../src/styles.css";
export const metadata = { title: "AgentBrake · Local control", description: "Isolated local agent control and evidence workspace" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
