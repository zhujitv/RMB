import TrackingMapClient from "./tracking-map-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "大掌櫃运输地图",
};

type TrackingMapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function TrackingMapPage({ searchParams }: TrackingMapPageProps) {
  const params = await searchParams;
  return (
    <TrackingMapClient
      initialTrackingId={firstSearchParam(params?.trackingId)}
      initialBillOfLading={firstSearchParam(params?.billOfLading)}
    />
  );
}
