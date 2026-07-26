import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatIpGeolocation, resolveIpGeolocation } from "../lib/platform/ip-geolocation.ts";
import { readSharedAuthSource, readSharedUsersSource } from "./source-helpers.ts";

const schema = readPrismaSchemaSource();
const sharedAuth = readSharedAuthSource();
const clientIp = readFileSync("lib/client-ip.ts", "utf8");
const sharedUsers = readSharedUsersSource();
const migration = readFileSync("prisma/migrations/20260628193000_login_attempt_ip_geolocation/migration.sql", "utf8");
const localDb = readFileSync("data/ip-geolocation-ranges.json", "utf8");

test("local IP geolocation resolves local private and unknown addresses without network calls", () => {
  assert.equal(resolveIpGeolocation("127.0.0.1").region, "本地开发环境");
  assert.equal(resolveIpGeolocation("localhost").region, "本地开发环境");
  assert.equal(resolveIpGeolocation("192.168.1.10").region, "内网地址");
  assert.equal(resolveIpGeolocation("::1").region, "本地开发环境");
  assert.equal(resolveIpGeolocation("8.8.8.8").source, "geoip-lite");
  assert.equal(formatIpGeolocation({ country: "中国", region: "上海", city: "上海", isp: "中国电信", source: "local-ip-db" }), "中国 · 上海 / 中国电信");
});

test("login attempts persist local IP geolocation fields", () => {
  assert.match(schema, /failureReason\s+String\?\s+@map\("failure_reason"\)/);
  assert.match(schema, /geoCountry\s+String\?\s+@map\("geo_country"\)/);
  assert.match(schema, /geoRegion\s+String\?\s+@map\("geo_region"\)/);
  assert.match(schema, /geoCity\s+String\?\s+@map\("geo_city"\)/);
  assert.match(schema, /geoIsp\s+String\?\s+@map\("geo_isp"\)/);
  assert.match(schema, /geoSource\s+String\?\s+@map\("geo_source"\)/);
  assert.match(schema, /geoResolvedAt\s+DateTime\?\s+@map\("geo_resolved_at"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "geo_country"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "failure_reason"/);
  assert.match(localDb, /"cidr": "127\.0\.0\.0\/8"/);
  assert.match(sharedAuth, /resolveTrustedClientIp\(request\)/);
  assert.match(clientIp, /x-vercel-forwarded-for/);
  assert.match(clientIp, /x-forwarded-for/);
  assert.match(clientIp, /x-real-ip/);
  assert.match(clientIp, /cf-connecting-ip/);
  assert.match(clientIp, /TRUST_PROXY_HEADERS/);
  assert.match(sharedAuth, /const ipGeo = resolveIpGeolocation\(ipAddress\)/);
  assert.match(sharedAuth, /failureReason: success \? null : failureReason/);
  assert.match(sharedAuth, /console\.info\("login attempt captured"/);
  assert.match(sharedAuth, /geoResolvedAt: new Date\(\)/);
});

test("account login records display stored or locally resolved region", () => {
  assert.match(sharedUsers, /function osLabel/);
  assert.ok(sharedUsers.includes("return `${browserLabel(userAgent)} / ${osLabel(userAgent)}`;"));
  assert.match(sharedUsers, /prisma\.userSession\.findMany/);
  assert.match(sharedUsers, /function fallbackSessionUserAgent/);
  assert.match(sharedUsers, /failureReason: true/);
  assert.match(sharedUsers, /geoCountry: true/);
  assert.match(sharedUsers, /geoResolvedAt: true/);
  assert.match(sharedUsers, /resolveIpGeolocation\(row\.ipAddress\)/);
  assert.match(sharedUsers, /region: formatIpGeolocation\(geo\)/);
});
