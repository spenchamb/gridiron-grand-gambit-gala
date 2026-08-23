import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: { default: "GGGG", template: "%s · GGGG" },
  description: "The Gridiron Grand Gambit Gala — fantasy football league dashboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={axis.variable}>
      <body className="antialiased">
        {/* variant="inset": the page ground is the rail colour and the content
            is a rounded card floating on top of it, so the rail reads as
            underneath the content rather than beside it. */}
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
