import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Draft",
  description: "Draft board, grades and the consensus big board.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
