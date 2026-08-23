import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Ledger",
  description: "Every add, drop, waiver claim and trade across all seasons.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
