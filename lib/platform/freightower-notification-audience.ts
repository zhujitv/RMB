import { NOTIFICATION_TYPES } from "./notification-definition-types";

export function freightowerTrackingEmailAudiencePolicy(input: {
  portRolloverChanged: boolean;
  customsChanged: boolean;
  portOperationChanged: boolean;
}) {
  return {
    internalType: input.portRolloverChanged
      ? NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT
      : input.customsChanged
        ? NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT
        : input.portOperationChanged
          ? NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT
          : NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
    customerAllowed: !input.portRolloverChanged && !input.customsChanged && !input.portOperationChanged,
  };
}
