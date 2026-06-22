import { apiError, getCompanyProfileSettings, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getCompanyProfileSettings();
    return ok({
      settings: {
        brandName: settings.brandName,
        systemName: settings.systemName,
        companyNameZh: settings.companyNameZh,
        companyNameEn: settings.companyNameEn,
        shortName: settings.shortName,
        logoUrl: settings.logoUrl,
        footerText: settings.footerText,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取系统品牌失败");
  }
}
