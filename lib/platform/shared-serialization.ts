export { USER_PUBLIC_SELECT, publicUser, serializeUser } from "./shared-users";
export * from "./shared-serialization-parties";
export * from "./shared-serialization-costs";
export * from "./shared-serialization-documents";

import { serializeCustomer, serializeSupplier } from "./shared-serialization-parties";
import { serializePayment, safeSerializeCost } from "./shared-serialization-costs";
import {
  serializeOrderDocument,
  serializeShippingDocumentNotification,
  serializeCustomsRecognition,
  serializeDomesticLogisticsTransportItem,
  serializeDomesticLogisticsInfo,
} from "./shared-serialization-documents";

export type CustomerDto = ReturnType<typeof serializeCustomer>;
export type SupplierDto = ReturnType<typeof serializeSupplier>;
export type PaymentDto = ReturnType<typeof serializePayment>;
export type CostDto = ReturnType<typeof safeSerializeCost>;
export type OrderDocumentDto = ReturnType<typeof serializeOrderDocument>;
export type ShippingDocumentNotificationDto = ReturnType<typeof serializeShippingDocumentNotification>;
export type CustomsRecognitionDto = ReturnType<typeof serializeCustomsRecognition>;
export type DomesticLogisticsTransportItemDto = ReturnType<typeof serializeDomesticLogisticsTransportItem>;
export type DomesticLogisticsInfoDto = ReturnType<typeof serializeDomesticLogisticsInfo>;
