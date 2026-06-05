import "../styles.css";

export const metadata = {
  title: "外贸应收款协同管理平台",
  description: "应收订单、收款登记、成本录入、利润分析和逾期提醒",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
