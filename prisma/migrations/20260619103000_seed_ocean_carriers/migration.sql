INSERT INTO "ocean_carriers" (
  "id",
  "carrier_name",
  "scac_code",
  "aliases",
  "website",
  "tracking_url",
  "status",
  "created_at",
  "updated_at"
)
VALUES
  ('ocean_carrier_maersk', 'Maersk', 'MAEU', '["MAERSK", "Maersk Line", "马士基"]'::jsonb, 'https://www.maersk.com', 'https://www.maersk.com/tracking/', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_msc', 'MSC', 'MSCU', '["Mediterranean Shipping Company", "地中海航运"]'::jsonb, 'https://www.msc.com', 'https://www.msc.com/en/track-a-shipment', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_cma_cgm', 'CMA CGM', 'CMDU', '["CMA", "达飞", "CMA-CGM"]'::jsonb, 'https://www.cma-cgm.com', 'https://www.cma-cgm.com/ebusiness/tracking', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_hapag_lloyd', 'Hapag-Lloyd', 'HLCU', '["Hapag Lloyd", "赫伯罗特", "HPL"]'::jsonb, 'https://www.hapag-lloyd.com', 'https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_one', 'Ocean Network Express', 'ONEY', '["ONE", "Ocean Network Express", "海洋网联"]'::jsonb, 'https://www.one-line.com', 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_cosco', 'COSCO Shipping Lines', 'COSU', '["COSCO", "COSCO SHIPPING", "中远海运"]'::jsonb, 'https://elines.coscoshipping.com', 'https://elines.coscoshipping.com/ebusiness/cargoTracking', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_oocl', 'OOCL', 'OOLU', '["Orient Overseas Container Line", "东方海外"]'::jsonb, 'https://www.oocl.com', 'https://www.oocl.com/eng/ourservices/eservices/cargotracking/Pages/cargotracking.aspx', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_evergreen', 'Evergreen Line', 'EGLV', '["Evergreen", "长荣海运", "EMC"]'::jsonb, 'https://www.evergreen-line.com', 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_yang_ming', 'Yang Ming Marine Transport', 'YMLU', '["Yang Ming", "阳明海运", "YML"]'::jsonb, 'https://www.yangming.com', 'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_hmm', 'HMM', 'HDMU', '["Hyundai Merchant Marine", "现代商船"]'::jsonb, 'https://www.hmm21.com', 'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_zim', 'ZIM', 'ZIMU', '["ZIM Integrated Shipping Services", "以星"]'::jsonb, 'https://www.zim.com', 'https://www.zim.com/tools/track-a-shipment', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_wan_hai', 'Wan Hai Lines', 'WHLC', '["Wan Hai", "万海航运"]'::jsonb, 'https://www.wanhai.com', 'https://www.wanhai.com/views/cargo_track_v2/cargo_track.xhtml', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_pil', 'Pacific International Lines', 'PCIU', '["PIL", "太平船务"]'::jsonb, 'https://www.pilship.com', 'https://www.pilship.com/en-our-track-and-trace-pil-pacific-international-lines/120.html', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ocean_carrier_sitc', 'SITC', 'SITC', '["SITC Container Lines", "海丰国际"]'::jsonb, 'https://www.sitc.com', 'https://www.sitc.com/trackTrace', '启用', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "carrier_name" = EXCLUDED."carrier_name",
  "scac_code" = EXCLUDED."scac_code",
  "aliases" = EXCLUDED."aliases",
  "website" = EXCLUDED."website",
  "tracking_url" = EXCLUDED."tracking_url",
  "status" = EXCLUDED."status",
  "updated_at" = CURRENT_TIMESTAMP;
