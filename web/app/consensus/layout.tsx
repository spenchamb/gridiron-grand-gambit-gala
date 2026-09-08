import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Consensus Rankings",
  description: "Weekly PPR expert-consensus rankings by position, tagged with who owns each player.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
