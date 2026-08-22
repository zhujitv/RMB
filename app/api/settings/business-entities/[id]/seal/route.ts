import type { NextRequest } from "next/server";
import {
  apiError,
  deleteBusinessEntityElectronicSeal,
  managedFileStreamHeaders,
  ok,
  readBusinessEntityElectronicSealImage,
  uploadBusinessEntityElectronicSeal,
} from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const seal = await readBusinessEntityElectronicSealImage(actor, id);
    return new Response(new Uint8Array(seal.body), {
      headers: managedFileStreamHeaders({
        bodyLength: seal.body.length,
        mimeType: seal.mimeType,
        fileName: seal.fileName,
        disposition: "inline",
      }),
    });
  } catch (error: unknown) {
    return apiError(error, "读取业务主体电子章失败");
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    assertMultipartRequestWithinLimit(request);
    const formData = await request.formData();
    const result = await uploadBusinessEntityElectronicSeal(request, actor, id, formData.get("file"));
    return ok({ success: true, ...result, message: "业务主体电子章已上传" });
  } catch (error: unknown) {
    return apiError(error, "上传业务主体电子章失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const result = await deleteBusinessEntityElectronicSeal(request, actor, id);
    return ok({ success: true, ...result, message: "业务主体电子章已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除业务主体电子章失败");
  }
}
