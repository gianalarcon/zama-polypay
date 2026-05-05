import type { Metadata } from "next";
import "~~/styles/globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Polypay-Zama",
  description: "Confidential multisig payroll on Sepolia, powered by Zama FHE.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
