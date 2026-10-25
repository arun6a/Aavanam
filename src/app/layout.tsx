import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/components/auth/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aavanam — AI Document Extraction Platform",
  description: "Upload documents (PDF, PNG, JPG, TIFF, DOCX, XLSX). Extract structured JSON via OCR + LLM. Export as JSON/CSV/XLSX. Multi-tenant SaaS with public API.",
  keywords: ["Aavanam", "document extraction", "OCR", "LLM", "invoice parsing", "AI", "Next.js"],
  authors: [{ name: "Aavanam" }],
  openGraph: {
    title: "Aavanam",
    description: "AI Document Extraction Platform",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
