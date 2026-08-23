import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readCostRecordsMutationsSource, readCostsModuleSource, readDomesticLogisticsModuleSource, readLogisticsExpenseInvoiceSource, readLogisticsFeesModuleSource, readOrderDocumentsSource, readOrdersServiceSource, readPaymentsServiceSource, readSharedBaseUtilsSource, readSharedUsersSource, readTaxRefundModuleSource } from "./source-helpers.ts";

export const nextConfig = readFileSync("next.config.mjs", "utf8");
export const proxy = ["proxy.ts", "proxy-rate-limit.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
export const securityHeaders = readFileSync("lib/security-headers.mjs", "utf8");
export const apiRouteGuard = readFileSync("lib/api-route-guard.ts", "utf8");
export const sharedBaseUtils = readSharedBaseUtilsSource();
export const sharedUtils = readFileSync("lib/platform/shared-utils.ts", "utf8");
export const sharedAudit = readFileSync("lib/platform/shared-audit.ts", "utf8");
export const sharedUsers = readSharedUsersSource();
export const inputSchemas = readFileSync("lib/platform/input-schemas.ts", "utf8");
export const uploadValidation = readFileSync(
  "lib/platform/upload-validation.ts",
  "utf8",
);
export const fileCenter = readFileSync(
  "lib/platform/file-center.ts",
  "utf8",
);
export const appUtils = readFileSync("app/utils.ts", "utf8");
export const taxRefundModule = readTaxRefundModuleSource();
export const domesticLogisticsModule = readDomesticLogisticsModuleSource();
export const costsUiModule = readCostsModuleSource();
export const logisticsFeesModule = readLogisticsFeesModuleSource();
export const orderDocumentsRoute = readFileSync(
  "app/api/order-documents/route.ts",
  "utf8",
);
export const orderDocumentsService = readOrderDocumentsSource();
export const logisticsInvoiceService = readLogisticsExpenseInvoiceSource();
export const ordersModule = readOrdersServiceSource();
export const paymentsModule = readPaymentsServiceSource();
export const costsModule = readCostRecordsMutationsSource();
export const loginRoute = readFileSync("app/api/auth/login/route.ts", "utf8");
export const registerRoute = readFileSync("app/api/auth/register/route.ts", "utf8");
export const reportsRoute = readFileSync("app/api/reports/route.ts", "utf8");
export const reportExportRoute = readFileSync(
  "app/api/reports/export/route.ts",
  "utf8",
);
export const settingsUsersRoute = readFileSync(
  "app/api/settings/users/route.ts",
  "utf8",
);
export const schema = readPrismaSchemaSource();
export const packageJson = readFileSync("package.json", "utf8");
export const runWithEnvScript = readFileSync("scripts/run-with-env.mjs", "utf8");
export const securityAuditScript = readFileSync("scripts/security-audit.mjs", "utf8");
export const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

export function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export const apiRouteSources = filesUnder("app/api")
  .filter((file) => file.endsWith("/route.ts"))
  .map((file) => [file, readFileSync(file, "utf8")] as const);

export function cspFor(isDevelopment: boolean) {
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import('./lib/security-headers.mjs').then(({ buildContentSecurityPolicy }) => process.stdout.write(buildContentSecurityPolicy({ isDevelopment: ${isDevelopment}, nonce: 'testnonce', env: {} })))`,
    ],
    { encoding: "utf8" },
  );
}

export function configuredCsp() {
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import('./lib/security-headers.mjs').then(({ buildContentSecurityPolicy }) => process.stdout.write(buildContentSecurityPolicy({ isDevelopment: false, nonce: 'testnonce', env: { COS_REGION: 'ap-nanjing', CSP_CONNECT_SRC: 'https://api.nextwood.net', CSP_IMG_SRC: 'https://assets.nextwood.net', CSP_FRAME_SRC: 'https://viewer.nextwood.net' } })))`,
    ],
    { encoding: "utf8" },
  );
}
