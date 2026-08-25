import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import { Archivo } from "next/font/google";
import "./globals.css";

/* The GGGG brand face. It used to be wired as --font-mono, which put it on
   every stat, label, badge and numeral on the site — 312 elements against 12
   headings. A display face doing tabular work reads as a wordmark stretched
   over a spreadsheet, and it spent its impact on points-for columns. It is now
   the heading face only, which is what --font-brand below expresses.

   next/font/local hashes and preloads it and resolves the URL through
   basePath, so it works unchanged in both the /sleeper and flattened builds. */
const axis = localFont({
  src: "./fonts/AxisExtrabold.otf",
  variable: "--font-axis",
  display: "swap",
});

/* One grotesque for everything else, numerals included. Archivo carries true
   tabular figures, so the columns that relied on the old mono face still line
   up. next/font/google downloads it at BUILD time and self-hosts the result —
   the deployed site makes no request to Google, and the CSP never sees one. */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopbar } from "@/components/mobile-topbar";
import { TeamTheme } from "@/components/team-theme";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "GGGG", template: "%s · GGGG" },
  description: "The Gridiron Grand Gambit Gala — fantasy football league dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${axis.variable} ${archivo.variable}`} suppressHydrationWarning>
      <head>
        {/* Re-applies a stored light-mode choice before first paint. Inline and
            synchronous by necessity — anything deferred lets a dark frame
            through on every navigation. suppressHydrationWarning above is for
            the class this adds to <html>, which the prerender cannot know. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        {/* 15rem matches firstdown.studio's rail; shadcn's default is 16rem. */}
        <SidebarProvider style={{ "--sidebar-width": "15rem" } as React.CSSProperties}>
          {/* AppSidebar reads useSearchParams to mark the active team/season in
              its submenus. Under output:"export" that must sit inside a Suspense
              boundary or the build fails for every route. */}
          <Suspense fallback={null}>
            <TeamTheme />
            <AppSidebar />
          </Suspense>
          {/* Below md the rail becomes an off-canvas Sheet, which needs a
              trigger — without this bar the nav is unreachable on a phone.
              pt-12 clears its fixed height. */}
          <SidebarInset className="pt-12 md:pt-0">
            <MobileTopbar />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
