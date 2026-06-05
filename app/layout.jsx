import "../styles.css";

export const metadata = {
  title: "外贸收款与成本支出登记系统",
  description: "外贸应收、收款和成本登记系统",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
