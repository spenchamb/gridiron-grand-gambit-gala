import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import "./globals.css";

/* The GGGG brand face, used for stats/labels/numerals. next/font/local hashes
   and preloads it and resolves the URL through basePath, so it works unchanged
   in both the /sleeper and flattened builds. */
const axis = localFont({
  src: "./fonts/AxisExtrabold.otf",
  variable: "--font-axis",
  display: "swap",
});
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileTopbar } from "@/components/mobile-topbar";

export const metadata: Metadata = {
  title: { default: "GGGG", template: "%s · GGGG" },
  description: "The Gridiron Grand Gambit Gala — fantasy football league dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={axis.variable}>
      <body className="antialiased">
        {/* 15rem matches firstdown.studio's rail; shadcn's default is 16rem. */}
        <SidebarProvider style={{ "--sidebar-width": "15rem" } as React.CSSProperties}>
          {/* AppSidebar reads useSearchParams to mark the active team/season in
              its submenus. Under output:"export" that must sit inside a Suspense
              boundary or the build fails for every route. */}
          <Suspense fallback={null}>
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
