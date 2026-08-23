import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Matchups",
  description: "Box scores for any week of any season.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
