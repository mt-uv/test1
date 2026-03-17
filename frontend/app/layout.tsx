import "./globals.css";

export const metadata = {
  title: "Na-ion Materials ML Platform",
  description: "Structure relaxation interface",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}