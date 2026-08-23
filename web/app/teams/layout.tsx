import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teams",
  description: "Every manager in the league, all-time.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
