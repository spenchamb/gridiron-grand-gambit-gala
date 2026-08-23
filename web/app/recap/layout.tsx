import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Last Week",
  description: "The week’s biggest scores, closest games, and top performers.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
