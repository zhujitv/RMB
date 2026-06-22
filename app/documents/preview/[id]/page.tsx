import { DocumentPreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

type PageContext = {
  params: Promise<{ id: string }>;
};

export default async function DocumentPreviewPage({ params }: PageContext) {
  const { id } = await params;
  return <DocumentPreviewClient documentId={id} />;
}
