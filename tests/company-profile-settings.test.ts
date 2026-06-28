import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const service = readFileSync("lib/platform/company-profile.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const route = readFileSync("app/api/settings/company-profile/route.ts", "utf8");
const publicRoute = readFileSync("app/api/company-profile/route.ts", "utf8");
const authMeRoute = readFileSync("app/api/auth/me/route.ts", "utf8");
const loginPanel = readFileSync("app/LoginPanel.tsx", "utf8");
const settingsModule = readSettingsModuleSource();
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");
const welcomePanel = readFileSync("app/WelcomePanel.tsx", "utf8");
const workspaceStyles = readWorkspaceStylesSource();
const types = readFileSync("app/types.ts", "utf8");

test("company profile settings are stored in shared system settings", () => {
  assert.match(constants, /COMPANY_PROFILE_SETTING_KEY = "company_profile"/);
  assert.match(constants, /DEFAULT_COMPANY_PROFILE_SETTINGS/);
  assert.match(service, /prisma\.systemSetting\.findUnique\(\{ where: \{ key: COMPANY_PROFILE_SETTING_KEY \} \}\)/);
  assert.match(service, /prisma\.systemSetting\.upsert/);
  assert.match(service, /assertWrite\(actor, "settings"\)/);
  assert.match(service, /assertRead\(actor, "settings"\)/);
  assert.match(service, /writeAudit\(request, actor, "更新公司资料"/);
  assert.match(shared, /export \* from "\.\/company-profile"/);
});

test("company profile api supports authenticated read and admin write", () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /readCompanyProfileSettings\(actor\)/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /saveCompanyProfileSettings\(request, actor, body\)/);
  assert.match(route, /公司资料已保存/);
  assert.match(publicRoute, /export async function GET/);
  assert.match(publicRoute, /getCompanyProfileSettings/);
  assert.match(publicRoute, /brandName: settings\.brandName/);
  assert.doesNotMatch(publicRoute, /contactEmail|contactPhone|address/);
});

test("workspace auth payload exposes company profile for brand display", () => {
  assert.match(types, /export type CompanyProfileSettings/);
  assert.match(types, /companyProfile\?: CompanyProfileSettings/);
  assert.match(authMeRoute, /getCompanyProfileSettings/);
  assert.match(authMeRoute, /const \[session, companyProfile\]/);
  assert.match(authMeRoute, /companyProfile,/);
  assert.match(workspaceShell, /loadPublicCompanyProfile/);
  assert.match(workspaceShell, /updateCompanyProfile\(settings: CompanyProfileSettings\)/);
  assert.match(workspaceShell, /onCompanyProfileSaved=\{updateCompanyProfile\}/);
  assert.match(workspaceShell, /document\.title = activeCompanyProfile\?\.systemName/);
  assert.match(workspaceLayout, /payload\.companyProfile/);
  assert.match(workspaceLayout, /brandName/);
  assert.match(workspaceLayout, /systemName/);
  assert.match(workspaceLayout, /companyNameZh/);
  assert.match(workspaceLayout, /logoUrl/);
  assert.match(workspaceLayout, /footerText/);
  assert.match(welcomePanel, /payload\.companyProfile\?\.systemName/);
  assert.match(workspaceLayout, /typeof companyProfile\.footerText === "string"/);
  assert.doesNotMatch(workspaceLayout, /companyProfile\.footerText\?\.trim\(\) \|\|/);
});

test("settings module includes company profile tab and form", () => {
  assert.match(settingsModule, /type SettingsTabKey = "companyProfile"/);
  assert.match(settingsModule, /label: "公司资料"/);
  assert.match(settingsModule, /\/api\/settings\/company-profile/);
  assert.match(settingsModule, /CompanyProfileSettingsCard/);
  assert.match(settingsModule, /公司资料 \/ 系统品牌配置/);
  assert.match(settingsModule, /保存公司资料/);
  assert.match(settingsModule, /onCompanyProfileSaved\?\.\(nextSettings\)/);
  assert.match(settingsModule, /companyNameEn: optionalStringSetting\(settings, "companyNameEn"\)/);
  assert.match(settingsModule, /footerText: optionalStringSetting\(settings, "footerText"\)/);
  assert.doesNotMatch(settingsModule, /generatedCompanyFooterText|isAutoCompanyFooterText/);
  assert.match(settingsModule, /activeTab !== "companyProfile"/);
});

test("login and sidebar consume configured logo and footer text", () => {
  assert.match(loginPanel, /companyProfile\?: CompanyProfileSettings/);
  assert.match(loginPanel, /const brandName = companyProfile\?\.brandName/);
  assert.match(loginPanel, /const logoUrl = companyProfile\?\.logoUrl/);
  assert.match(loginPanel, /typeof companyProfile\?\.footerText === "string"/);
  assert.doesNotMatch(loginPanel, /companyProfile\?\.footerText\?\.trim\(\) \|\|/);
  assert.match(loginPanel, /loginBrandLogo/);
  assert.match(loginPanel, /loginFooter/);
  assert.match(workspaceLayout, /brandLogo/);
  assert.match(workspaceLayout, /sidebarFooter/);
  assert.match(workspaceStyles, /\.loginBrandLogo/);
  assert.match(workspaceStyles, /\.brandLogo/);
  assert.match(workspaceStyles, /\.sidebarFooter/);
});

test("company english name and footer copyright preserve intentionally blank values", () => {
  assert.match(service, /companyNameEn: cleanOptionalText\(input\.companyNameEn/);
  assert.match(service, /footerText: cleanOptionalText\(input\.footerText/);
  assert.doesNotMatch(service, /generatedFooterText|companyNameEn = cleanText\(input\.companyNameEn, DEFAULT_COMPANY_PROFILE_SETTINGS\.companyNameEn|footerText = !rawFooterText/);
});
