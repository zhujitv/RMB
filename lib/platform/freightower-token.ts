import { isPlainRecord, nonEmpty } from "./shared-base-utils";
import { recordAt } from "./shipsgo-tracking-mapping-helpers";

const FREIGHTOWER_TOKEN_FALLBACK_TTL_SECONDS = 10 * 60;

export function freightowerAccessTokenFromPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const accessToken = nonEmpty(data.access_token || root.access_token);
  const expiresInValue = Number(data.expires_in ?? root.expires_in);
  const expiresIn = Number.isFinite(expiresInValue) && expiresInValue > 0
    ? Math.min(expiresInValue, 7 * 24 * 60 * 60)
    : FREIGHTOWER_TOKEN_FALLBACK_TTL_SECONDS;
  return { accessToken, expiresIn };
}
