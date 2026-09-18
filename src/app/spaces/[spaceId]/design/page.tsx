import { VisualStudio } from "@/features/spaces/visual-studio";
export default async function Page({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  return <VisualStudio spaceId={(await params).spaceId} />;
}
