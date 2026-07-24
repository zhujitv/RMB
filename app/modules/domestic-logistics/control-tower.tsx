import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabActive } from "../../workspace/workspace-tab-context";
import {
  controlTowerSearchParams
} from "./control-tower-components";
import { ControlTowerPresentation } from "./control-tower-presentation";
import {
  EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS,
  EMPTY_SHIPSGO_CONTROL_TOWER_STATS,
  type ShipsgoControlTowerFilters,
  type ShipsgoControlTowerResponse,
  type ShipsgoControlTowerRow,
  type ShipsgoFeatureFlags,
} from "./model";

export { ShipsgoMapAction } from "./control-tower-components";

export function ShipsgoControlTowerView({
  features,
  canManage,
  initialKeyword = "",
  initialOpenToken = 0,
  initialFullScreen = false,
  syncingId,
  onSyncingChange,
  onOpenOrder,
}: {
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  initialKeyword?: string;
  initialOpenToken?: number;
  initialFullScreen?: boolean;
  syncingId: string;
  onSyncingChange: (id: string) => void;
  onOpenOrder: (row: ShipsgoControlTowerRow) => void;
}) {
  const [rows, setRows] = useState<ShipsgoControlTowerRow[]>([]);
  const [stats, setStats] = useState(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
  const [filters, setFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [fullScreen, setFullScreen] = useState(initialFullScreen);
  const loadRequestRef = useRef(0);
  const submittedFiltersRef = useRef(submittedFilters);
  const workspaceTabActive = useWorkspaceTabActive();
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);

  function setFilterValue<K extends keyof ShipsgoControlTowerFilters>(key: K, value: ShipsgoControlTowerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  }

  async function loadControlTower(nextFilters = submittedFilters, quiet = false) {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = controlTowerSearchParams(nextFilters);
      const result = await apiJson<ShipsgoControlTowerResponse>(`/api/shipsgo/ocean-trackings/control-tower?${params}`);
      if (result.success === false) throw new Error(result.message || "读取运输监控失败");
      if (requestId !== loadRequestRef.current) return;
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setStats(result.stats || EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      setUpdatedAt(result.updatedAt || new Date().toISOString());
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      const message = loadError instanceof Error ? loadError.message : "读取运输监控失败";
      console.error("读取运输监控失败", loadError);
      setError(message);
      if (!quiet) {
        setRows([]);
        setStats(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (initialOpenToken && initialKeyword.trim()) return;
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const nextFilters = { ...EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS, orderNo: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    submittedFiltersRef.current = nextFilters;
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(nextFilters);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    if (!workspaceTabActive || !fullScreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullScreen, workspaceTabActive]);

  useEffect(() => {
    if (!workspaceTabActive || !fullScreen) return undefined;
    const timer = window.setInterval(() => {
      void loadControlTower(submittedFilters, true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [fullScreen, submittedFilters, workspaceTabActive]);

  function submitFilters() {
    setSubmittedFilters(filters);
    submittedFiltersRef.current = filters;
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(filters);
  }

  function resetFilters() {
    setFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    setSubmittedFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    submittedFiltersRef.current = EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS;
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }

  async function syncTracking(row: ShipsgoControlTowerRow) {
    if (!features.manualSyncEnabled || !canManage) return;
    onSyncingChange(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(row.id)}/sync`, {
        method: "POST",
      });
      if (result.success === false) throw new Error(result.message || "同步海运跟踪失败");
      await loadControlTower(submittedFiltersRef.current, true);
      setNotice(result.message || "海运状态已同步");
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步海运跟踪失败";
      console.error("同步海运跟踪失败", syncError);
      setError(message);
    } finally {
      onSyncingChange("");
    }
  }

  function toggleTimeline(row: ShipsgoControlTowerRow) {
    setExpandedId((current) => current === row.id ? "" : row.id);
  }

  return (
    <ControlTowerPresentation
      fullScreen={fullScreen}
      updatedAt={updatedAt}
      submittedFilters={submittedFilters}
      loading={loading}
      stats={stats}
      filters={filters}
      error={error}
      notice={notice}
      rows={rows}
      selectedRow={selectedRow}
      canManage={canManage}
      features={features}
      syncingId={syncingId}
      expandedId={expandedId}
      loadControlTower={loadControlTower}
      setFullScreen={setFullScreen}
      setFilterValue={setFilterValue}
      submitFilters={submitFilters}
      resetFilters={resetFilters}
      setSelectedId={setSelectedId}
      syncTracking={syncTracking}
      onOpenOrder={onOpenOrder}
      toggleTimeline={toggleTimeline}
    />
  );
}
