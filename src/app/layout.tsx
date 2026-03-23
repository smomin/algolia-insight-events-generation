import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Algolia Insights Event Generator',
  description:
    'Generate realistic Algolia Insights events via 100 AI-driven personas.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-900 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
