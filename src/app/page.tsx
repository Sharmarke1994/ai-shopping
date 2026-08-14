import {
  isFixtureViewKey,
  type FixtureViewKey,
} from "@/features/shopping-preview/fixtures";
import { ShoppingPreview } from "@/features/shopping-preview/shopping-preview";

type HomeProps = Readonly<{
  searchParams: Promise<{
    fixture?: string | string[];
  }>;
}>;

export default async function Home({ searchParams }: HomeProps) {
  const parameters = await searchParams;
  const requestedFixture = Array.isArray(parameters.fixture)
    ? parameters.fixture[0]
    : parameters.fixture;
  const initialView: FixtureViewKey =
    requestedFixture && isFixtureViewKey(requestedFixture)
      ? requestedFixture
      : "landing";

  return <ShoppingPreview initialView={initialView} />;
}
