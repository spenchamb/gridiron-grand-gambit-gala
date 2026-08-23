import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Player",
  description: "League game log and career summary for a player.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
