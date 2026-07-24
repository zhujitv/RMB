import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ExchangeRateResponse, OrderRow, QuickOrderForm } from "./model";

type ExchangeRateControllerParams = {
  form: QuickOrderForm;
  setForm: Dispatch<SetStateAction<QuickOrderForm>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

export function useQuickOrderExchangeRate({ form, setForm, setMessage }: ExchangeRateControllerParams) {
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [exchangeCacheMissing, setExchangeCacheMissing] = useState(false);
  const [refreshingExchangeRate, setRefreshingExchangeRate] = useState(false);
  const requestRef = useRef(0);

  const syncExchangeMetadata = useCallback((order?: OrderRow | null) => {
    requestRef.current += 1;
    setRefreshingExchangeRate(false);
    setExchangeCacheMissing(false);
    if (!order?.currency) {
      setExchangeMeta("");
      return;
    }
    const hasExchangeMeta = Boolean(
      order.exchangeRate && order.exchangeRateDate && order.exchangeRateSource && order.exchangeRateType,
    );
    setExchangeMeta(order.currency === "CNY"
      ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000"
      : hasExchangeMeta
        ? `来源：${order.exchangeRateSource} ｜ 类型：${order.exchangeRateType} ｜ 更新时间：${order.exchangeRateDate}`
        : "当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。");
  }, []);

  const refreshOfficialExchangeRate = useCallback(async (
    currencyInput = form.currency,
    options: { quiet?: boolean } = {},
  ) => {
    const requestId = ++requestRef.current;
    const normalized = currencyInput.trim().toUpperCase();
    if (!normalized) {
      setRefreshingExchangeRate(false);
      setMessage("请先选择币种");
      return false;
    }
    if (normalized === "CNY") {
      setRefreshingExchangeRate(false);
      setForm((current) => ({
        ...current, currency: "CNY", exchangeRate: "1", exchangeRateDate: "",
        exchangeRateSource: "系统", exchangeRateType: "人民币",
      }));
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setExchangeCacheMissing(false);
      if (!options.quiet) setMessage("");
      return true;
    }
    setRefreshingExchangeRate(true);
    setExchangeCacheMissing(false);
    setExchangeMeta("正在读取官方汇率缓存...");
    try {
      const result = await apiJson<ExchangeRateResponse>(
        `/api/exchange-rates?currency=${encodeURIComponent(normalized)}&cacheOnly=1`,
      );
      if (requestId !== requestRef.current) return false;
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (!(rate > 0)) throw new Error("当前币种暂无官方汇率缓存，请到系统设置刷新汇率。");
      setForm((current) => ({
        ...current,
        currency: normalized,
        exchangeRate: String(rate),
        exchangeRateDate: result.rate?.rateDate || "",
        exchangeRateSource: result.rate?.source || "",
        exchangeRateType: result.rate?.rateType || "",
      }));
      setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      setMessage("");
      setExchangeCacheMissing(false);
      return true;
    } catch (rateError) {
      if (requestId !== requestRef.current) return false;
      const typedError = rateError as { status?: number; code?: string; message?: string };
      const missingCache = typedError.status === 404 || typedError.code === "EXCHANGE_RATE_NOT_FOUND";
      const nextMessage = missingCache
        ? "当前币种暂无官方汇率缓存，请到系统设置刷新汇率。"
        : (typedError.message || "读取官方汇率失败，请稍后重试。");
      setExchangeMeta(nextMessage);
      setMessage(nextMessage);
      setExchangeCacheMissing(missingCache);
      return false;
    } finally {
      if (requestId === requestRef.current) setRefreshingExchangeRate(false);
    }
  }, [form.currency, setForm, setMessage]);

  const resolveExchangeRate = useCallback(async (currency: string) => {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      requestRef.current += 1;
      setRefreshingExchangeRate(false);
      setExchangeMeta("");
      setExchangeCacheMissing(false);
      setForm((current) => ({
        ...current, exchangeRate: "", exchangeRateDate: "",
        exchangeRateSource: "", exchangeRateType: "",
      }));
      return;
    }
    await refreshOfficialExchangeRate(normalized, { quiet: true });
  }, [refreshOfficialExchangeRate, setForm]);

  const clearExchangeMetadata = useCallback(() => {
    requestRef.current += 1;
    setRefreshingExchangeRate(false);
    setExchangeMeta("");
  }, []);

  return {
    exchangeMeta,
    exchangeCacheMissing,
    refreshingExchangeRate,
    setExchangeCacheMissing,
    syncExchangeMetadata,
    clearExchangeMetadata,
    resolveExchangeRate,
    refreshOfficialExchangeRate,
  };
}
