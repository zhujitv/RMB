import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { getActor, getOrderDocumentMetadata } from "../../../../lib/platform-db";
import { DocumentPreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

type PageContext = {
  params: Promise<{ id: string }>;
};

function displayNameFromMetadata(document: {
  displayFileName?: string;
  downloadFileName?: string;
  originalFileName?: string;
  originalFilename?: string;
  originalName?: string;
  fileName?: string;
} | null) {
  return (
    document?.displayFileName
    || document?.downloadFileName
    || document?.originalFileName
    || document?.originalFilename
    || document?.originalName
    || document?.fileName
    || ""
  );
}

async function metadataRequest() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const host = headerStore.get("host") || "localhost";
  const protocol = headerStore.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return {
    method: "GET",
    url: `${protocol}://${host}/documents/preview`,
    headers: {
      get(name: string) {
        return headerStore.get(name);
      },
    },
    cookies: {
      get(name: string) {
        const cookie = cookieStore.get(name);
        return cookie ? { value: cookie.value } : undefined;
      },
    },
  };
}

async function previewFileName(documentId: string) {
  try {
    const request = await metadataRequest();
    const actor = await getActor(request);
    const document = await getOrderDocumentMetadata(request, actor, documentId);
    return displayNameFromMetadata(document) || "PDF 预览";
  } catch {
    return "PDF 预览";
  }
}

export async function generateMetadata({ params }: PageContext): Promise<Metadata> {
  const { id } = await params;
  const title = await previewFileName(id);
  return { title };
}

export default async function DocumentPreviewPage({ params }: PageContext) {
  const { id } = await params;
  const initialFileName = await previewFileName(id);
  return <DocumentPreviewClient documentId={id} initialFileName={initialFileName} />;
}
