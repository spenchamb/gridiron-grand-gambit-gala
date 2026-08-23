import type { Metadata } from "next";

/* Page-level metadata has to live in a server component; the page itself is a
   client component because it fetches at runtime. */
export const metadata: Metadata = {
  title: "Changelog",
  description: "Every change to the site, explained — newest first.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
