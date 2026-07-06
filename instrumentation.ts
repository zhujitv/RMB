export async function register() {
  if (process.env.NEXT_RUNTIME === "edge" || process.env.DISABLE_ALIYUN_OCR_HEALTH_CHECK === "true") return;
  try {
    const { getOcrIntegrationSettings } = await import("./lib/platform/ocr-integration-shared");
    const { scheduleAliyunOcrStartupHealthCheck } = await import("./lib/platform/ocr-integration-clients");
    const settings = await getOcrIntegrationSettings();
    if (settings.enabled && settings.supplierDocumentReturnEnabled) {
      scheduleAliyunOcrStartupHealthCheck(settings);
    }
  } catch (error) {
    console.error("aliyun-ocr-startup-health-check-bootstrap-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
