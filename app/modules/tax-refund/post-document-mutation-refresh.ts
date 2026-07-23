export type TaxRefundRefreshTarget = "detail" | "workbench";

export type TaxRefundRefreshFailure = {
  target: TaxRefundRefreshTarget;
  error: unknown;
};

type RefreshTask = {
  target: TaxRefundRefreshTarget;
  run?: () => void | Promise<void>;
};

export async function refreshTaxRefundAfterDocumentMutation({
  refreshDetail,
  refreshWorkbench,
  onFailure,
}: {
  refreshDetail?: () => void | Promise<void>;
  refreshWorkbench?: () => void | Promise<void>;
  onFailure?: (failure: TaxRefundRefreshFailure) => void;
}) {
  const availableTasks: RefreshTask[] = [
    { target: "detail", run: refreshDetail },
    { target: "workbench", run: refreshWorkbench },
  ];
  const tasks = availableTasks.filter((task) => typeof task.run === "function");

  const results = await Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(() => task.run?.())),
  );
  const failures = results.flatMap<TaxRefundRefreshFailure>((result, index) => {
    if (result.status === "fulfilled") return [];
    return [{ target: tasks[index].target, error: result.reason }];
  });
  failures.forEach((failure) => {
    try {
      onFailure?.(failure);
    } catch {
      // Refresh reporting must never turn a completed document mutation into a failure.
    }
  });
  return failures;
}
