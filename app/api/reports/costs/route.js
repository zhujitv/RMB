import { reportGetHandler } from "../../../../lib/report-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return reportGetHandler(request, "costs");
}
