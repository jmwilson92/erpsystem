import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — item cards live under /items */
export default async function PartDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/items/${id}`);
}
