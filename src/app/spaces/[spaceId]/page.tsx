import { notFound } from "next/navigation";
import { spaceIdSchema } from "@/features/spaces/contracts";
import { SpacePage } from "@/features/spaces/spaces-ui";
export default async function Page({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  if (!spaceIdSchema.safeParse(spaceId).success) notFound();
  return <SpacePage spaceId={spaceId} />;
}
