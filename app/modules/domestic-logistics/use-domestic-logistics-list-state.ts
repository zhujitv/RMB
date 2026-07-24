import { useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import {
  PAGE_SIZE,
  domesticLogisticsCanArchive,
  sanitizeDomesticLogisticsRowsForRender,
  type DomesticLogisticsResponse,
  type DomesticLogisticsRow,
  type ShipsgoFeatureFlags,
} from "./model";

export function useDomesticLogisticsListState(
  submittedKeyword: string,
  businessScope: string,
) {
  const [rows, setRows] = useState<DomesticLogisticsRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shipsgoFeatures, setShipsgoFeatures] = useState<ShipsgoFeatureFlags>({ enabled: false });
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const listRequestRef = useRef(0);

  async function loadRows(
    nextKeyword = submittedKeyword,
    nextBusinessScope = businessScope,
    nextPage = page,
  ) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        businessScope: nextBusinessScope,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<DomesticLogisticsResponse>(`/api/domestic-logistics?${params}`);
      if (requestId !== listRequestRef.current) return [];
      const nextRows = sanitizeDomesticLogisticsRowsForRender(
        Array.isArray(result.rows) ? result.rows : [],
      );
      setRows(nextRows);
      setTotal(Number(result.total || 0));
      setPage(Number(result.page || nextPage));
      setTotalPages(Math.max(1, Number(result.totalPages || 1)));
      setShipsgoFeatures(result.shipsgo || { enabled: false });
      setSelectedOrderIds((current) => current.filter(
        (orderId) => nextRows.some((row) => row.id === orderId),
      ));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取物流信息失败");
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedOrderIds.includes(row.id)),
    [rows, selectedOrderIds],
  );
  const selectedArchivableRows = useMemo(
    () => selectedRows.filter(domesticLogisticsCanArchive),
    [selectedRows],
  );
  const pageArchivableRows = useMemo(
    () => rows.filter(domesticLogisticsCanArchive),
    [rows],
  );
  const allPageArchivableSelected = pageArchivableRows.length > 0
    && pageArchivableRows.every((row) => selectedOrderIds.includes(row.id));

  function toggleOrderSelection(row: DomesticLogisticsRow, checked: boolean) {
    if (!domesticLogisticsCanArchive(row)) return;
    setSelectedOrderIds((current) => checked
      ? Array.from(new Set([...current, row.id]))
      : current.filter((orderId) => orderId !== row.id));
  }

  function togglePageArchivableOrders(checked: boolean) {
    const pageArchivableIds = pageArchivableRows.map((row) => row.id);
    setSelectedOrderIds((current) => checked
      ? Array.from(new Set([...current, ...pageArchivableIds]))
      : current.filter((orderId) => !pageArchivableIds.includes(orderId)));
  }

  return {
    rows, setRows, page, setPage, total, totalPages, loading, error, setError,
    shipsgoFeatures, selectedOrderIds, setSelectedOrderIds, selectedRows,
    selectedArchivableRows, pageArchivableRows, allPageArchivableSelected,
    loadRows, toggleOrderSelection, togglePageArchivableOrders,
  };
}
