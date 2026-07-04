export type User = {
  id: string;
  name: string;
  englishName?: string;
  department?: string;
  email: string;
  role: string;
  supplierId?: string;
  avatarInitials?: string;
  avatarUrl?: string;
  defaultLanguage?: string;
  defaultHome?: string;
  pageSize?: number;
  loginAlertEnabled?: boolean;
  mustChangePassword?: boolean;
  passwordPolicyPassed?: boolean;
  passwordChangedAt?: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  approvalStatus?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PermissionSnapshot = {
  menus?: string[];
  writeKeys?: string[];
  writes?: Record<string, boolean>;
  readKeys?: string[];
  reads?: Record<string, boolean>;
  scopeText?: string;
  mode?: string;
};

export type SessionInfo = {
  loginAt?: string;
  ipAddress?: string;
};

export type CompanyProfileSettings = {
  brandName?: string;
  systemName?: string;
  companyNameZh?: string;
  companyNameEn?: string;
  shortName?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  logoUrl?: string;
  footerText?: string;
};

export type AuthPayload = {
  user: User;
  permissions?: PermissionSnapshot;
  scopeText?: string;
  session?: SessionInfo;
  companyProfile?: CompanyProfileSettings;
};

export type AuthState =
  | { status: "loading"; message: string }
  | { status: "guest"; message?: string }
  | { status: "password-change"; user: User; message?: string }
  | { status: "ready"; payload: AuthPayload }
  | { status: "error"; message: string; detail?: string };

export type MenuItem = {
  key: string;
  label: string;
  description: string;
  parentKey?: string;
};

export type LoginResponse = {
  success: boolean;
  user: User;
  mustChangePassword?: boolean;
  message?: string;
};

export type WorkbenchTodoPriority = "urgent" | "important" | "normal";
export type WorkbenchTodoOwnerRole = "LOGISTICS_SUPPLIER" | "SALESPERSON" | "ADMIN" | "FINANCE" | "PURCHASE" | "PRODUCT_SUPPLIER";
export type WorkbenchTodoStatus = "DRAFT" | "BLOCKED" | "ACTIVE" | "DONE" | "CANCELLED" | "FINISHED" | "ARCHIVED" | "pending" | "completed";
export type WorkbenchFlowStage =
  | "SALES_ORDER_CREATED"
  | "PURCHASE_ORDER_CREATED"
  | "SUPPLIER_DOCUMENT_REQUESTED"
  | "SUPPLIER_DOCUMENT_COMPLETED"
  | "LOGISTICS_INFO_COMPLETED"
  | "CUSTOMS_DOCUMENT_UPLOADED"
  | "LOGISTICS_COST_RECORDED"
  | "LOGISTICS_INVOICE_UPLOADED"
  | "LOGISTICS_COST_AUDITED"
  | "SUPPLIER_PAYMENT_COMPLETED"
  | "TAX_REFUND_READY"
  | "TAX_ARCHIVE_SUBMITTED"
  | "PROFIT_REVIEWED"
  | "COMMISSION_SETTLED";

export type WorkbenchTodo = {
  id: string;
  type: string;
  title: string;
  module: string;
  flowStage?: WorkbenchFlowStage;
  prerequisiteStage?: WorkbenchFlowStage | null;
  activationCondition?: string;
  orderId?: string;
  orderNo?: string;
  customerShortName?: string;
  priority: WorkbenchTodoPriority;
  status: WorkbenchTodoStatus;
  dueAt?: string | null;
  ownerUserId?: string | null;
  ownerUserIds?: string[];
  ownerName?: string;
  ownerRole?: WorkbenchTodoOwnerRole;
  visibleToUserIds: string[];
  isMine: boolean;
  action: {
    label: string;
    href: string;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkbenchTodoSummary = {
  pending: number;
  todayDue: number;
  overdue: number;
  completed: number;
  total: number;
  urgent: number;
};

export type WorkbenchTodosState = {
  todos: WorkbenchTodo[];
  completedTodos?: WorkbenchTodo[];
  summary: WorkbenchTodoSummary;
  loading: boolean;
  error: string;
  generatedAt?: string;
};
