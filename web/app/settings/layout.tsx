import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "League Settings",
  description: "Scoring, roster, playoff format and starting lineup for the GGGG.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
