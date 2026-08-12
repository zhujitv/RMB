import type {
  SupplierPurchaseOrderDto,
  SupplierPurchaseOrderResponseAction,
  SupplierPurchaseOrderStatus,
} from "../../../lib/platform/supplier-purchase-orders-values";

export type {
  SupplierPurchaseOrderDto,
  SupplierPurchaseOrderResponseAction,
  SupplierPurchaseOrderStatus,
};

export type SupplierPurchaseOrderListResponse = {
  success?: boolean;
  purchaseOrders?: SupplierPurchaseOrderDto[];
  data?: SupplierPurchaseOrderDto[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
  message?: string;
};

export type SupplierPurchaseOrderDetailResponse = {
  success?: boolean;
  purchaseOrder?: SupplierPurchaseOrderDto;
  data?: SupplierPurchaseOrderDto;
  message?: string;
};
