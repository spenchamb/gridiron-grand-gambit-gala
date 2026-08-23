import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Keepers",
  description: "Every team's kept player, season by season.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
