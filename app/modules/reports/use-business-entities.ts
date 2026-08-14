import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import type { BusinessEntitiesResponse, BusinessEntityOption } from "./model";

export function useBusinessEntities() {
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);

  useEffect(() => {
    void apiJson<BusinessEntitiesResponse>("/api/business-entities")
      .then((result) => setBusinessEntities(Array.isArray(result.entities) ? result.entities : []))
      .catch(() => setBusinessEntities([]));
  }, []);

  return businessEntities;
}
