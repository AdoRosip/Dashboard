import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Analytics Dashboard",
  description: "Match analytics for Europe's top leagues",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-50 border-b border-border bg-bg-secondary/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
            <a href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white text-sm font-bold">
                FA
              </div>
              <span className="text-lg font-semibold text-text-primary">
                Football Analytics
              </span>
            </a>
            <nav className="ml-8 flex flex-wrap gap-4 sm:gap-6">
              <a
                href="/"
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Fixtures
              </a>
              <a
                href="/value-picks"
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Value picks
              </a>
              <a
                href="/results"
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Results
              </a>
              <a
                href="/model-performance"
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Research
              </a>
              <a
                href="/admin/flags"
                className="text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Admin
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
