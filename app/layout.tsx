import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: "🛡️ Guarded AI Agent Dashboard",
  description: "Real-time Policy Guardrails & Dynamic MCP Discovery Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Space+Grotesk:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
