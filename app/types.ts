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

export type WorkbenchTodo = {
  id: string;
  type: string;
  title: string;
  module: string;
  orderId?: string;
  orderNo?: string;
  customerShortName?: string;
  priority: WorkbenchTodoPriority;
  status: "pending" | "completed";
  dueAt?: string | null;
  ownerName?: string;
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
  summary: WorkbenchTodoSummary;
  loading: boolean;
  error: string;
  generatedAt?: string;
};
