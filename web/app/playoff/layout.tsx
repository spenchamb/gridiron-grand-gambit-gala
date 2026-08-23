import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Playoff Watch",
  description: "Simulated odds of making the playoff field.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
