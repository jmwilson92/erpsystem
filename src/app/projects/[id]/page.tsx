import { redirect } from "next/navigation";

export default async function ProjectRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/pmo/projects/${id}`);
}
