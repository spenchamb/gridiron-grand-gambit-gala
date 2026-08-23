import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Trade Lab",
  description: "Draft a hypothetical trade and see how both rosters change.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
