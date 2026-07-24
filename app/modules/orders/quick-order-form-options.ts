import { apiJson } from "../../api";
import type {
  BusinessEntityOption,
  SalespersonOption,
  SettingsResponse,
  SuppliersResponse,
} from "./model";

type BusinessEntitiesResponse = { entities?: BusinessEntityOption[] };
type SalespeopleResponse = { salespeople?: SalespersonOption[] };

export async function loadQuickOrderFormOptions(canManageOrderAssignments: boolean) {
  const [settingsResult, suppliersResult, businessEntitiesResult, salespeopleResult] = await Promise.all([
    apiJson<SettingsResponse>("/api/exchange-rates/settings").catch(() => null),
    apiJson<SuppliersResponse>("/api/suppliers/available").catch(() => null),
    apiJson<BusinessEntitiesResponse>("/api/business-entities").catch(() => null),
    canManageOrderAssignments
      ? apiJson<SalespeopleResponse>("/api/settings/customers?page=1&pageSize=1").catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    allowMultipleLogisticsSuppliers: Boolean(
      settingsResult?.settings?.allowMultipleOrderLogisticsSuppliers,
    ),
    suppliers: Array.isArray(suppliersResult?.suppliers) ? suppliersResult.suppliers : [],
    businessEntities: Array.isArray(businessEntitiesResult?.entities) ? businessEntitiesResult.entities : [],
    salespeople: Array.isArray(salespeopleResult?.salespeople) ? salespeopleResult.salespeople : [],
  };
}
