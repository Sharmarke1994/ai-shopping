import type { Metadata } from "next";
import { LiveShopping } from "@/features/live-shopping/live-shopping";

export const metadata: Metadata = {
  title: "Consider — shop with a brief, not a keyword",
  description:
    "A private founder preview for turning a real shopping need into a clear brief and live UK product search.",
};

export default function LiveShoppingPage() {
  return <LiveShopping />;
}
