import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "What-If",
  description: "Re-run each season under different rules.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
