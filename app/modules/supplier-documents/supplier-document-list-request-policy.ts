export type SupplierDocumentListView = {
  page: number;
  pageSize: number;
  keyword: string;
};

export function supplierDocumentListView(page: number, pageSize: number, keyword: string): SupplierDocumentListView {
  return { page, pageSize, keyword: keyword.trim() };
}

export function supplierDocumentListViewsMatch(left: SupplierDocumentListView, right: SupplierDocumentListView) {
  return left.page === right.page && left.pageSize === right.pageSize && left.keyword === right.keyword;
}

export function canStartSupplierDocumentListRequest(input: {
  silent: boolean;
  currentView: SupplierDocumentListView;
  requestedView: SupplierDocumentListView;
  expectedView?: SupplierDocumentListView | null;
}) {
  if (input.expectedView) return supplierDocumentListViewsMatch(input.currentView, input.expectedView);
  return !input.silent || supplierDocumentListViewsMatch(input.currentView, input.requestedView);
}

export function canApplySupplierDocumentListResponse(input: {
  silent: boolean;
  requestId: number;
  latestVisibleRequestId: number;
  latestSilentRequestId: number;
  visibleRequestIdAtStart: number;
  currentView: SupplierDocumentListView;
  requestedView: SupplierDocumentListView;
  expectedView?: SupplierDocumentListView | null;
}) {
  if (!input.silent) {
    return input.requestId === input.latestVisibleRequestId
      && supplierDocumentListViewsMatch(input.currentView, input.requestedView);
  }
  return input.requestId === input.latestSilentRequestId
    && input.visibleRequestIdAtStart === input.latestVisibleRequestId
    && supplierDocumentListViewsMatch(input.currentView, input.expectedView || input.requestedView);
}
