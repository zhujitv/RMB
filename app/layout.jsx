import "../styles.css";

export const metadata = {
  title: "NEXTWOOD 供应链协同平台",
  description: "供应链业务、单证、物流与退税资料协同管理",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
