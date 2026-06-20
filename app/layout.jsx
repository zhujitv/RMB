import "./globals.css";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "NEXTWOOD 供应链协同平台",
  description: "供应链业务、单证、物流与退税资料协同管理",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": -1,
      "max-image-preview": "none",
      "max-video-preview": -1,
    },
  },
};

export default async function RootLayout({ children }) {
  await headers();
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
