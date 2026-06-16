import type { NextRequest } from "next/server";
import { reportGetHandler } from "../../../../lib/report-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return reportGetHandler(request, "payments");
}
