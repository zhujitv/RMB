export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  supplierId?: string;
  phone?: string;
  avatarInitials?: string;
  defaultLanguage?: string;
  mustChangePassword?: boolean;
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

export type AuthPayload = {
  user: User;
  permissions?: PermissionSnapshot;
  scopeText?: string;
  session?: SessionInfo;
};

export type AuthState =
  | { status: "loading"; message: string }
  | { status: "guest"; message?: string }
  | { status: "password-change"; user: User; message?: string }
  | { status: "ready"; payload: AuthPayload }
  | { status: "error"; message: string };

export type MenuItem = {
  key: string;
  label: string;
  description: string;
};

export type LoginResponse = {
  success: boolean;
  user: User;
  mustChangePassword?: boolean;
  message?: string;
};
