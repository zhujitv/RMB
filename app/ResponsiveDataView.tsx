"use client";

import { useEffect, useState, type ReactNode } from "react";

const DESKTOP_QUERY = "(min-width: 768px)";

type ResponsiveDataViewProps = {
  mobile?: ReactNode;
  desktop: ReactNode;
};

export function ResponsiveDataView({ mobile, desktop }: ResponsiveDataViewProps) {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const updateViewport = () => setIsDesktop(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  // 重要：桌面端只显示表格，移动端只显示卡片。
  // 禁止同一数据源在同一断点同时渲染 Card 和 Table，避免重复数据。
  if (!isDesktop && mobile) {
    return <>{mobile}</>;
  }

  return <>{desktop}</>;
}
