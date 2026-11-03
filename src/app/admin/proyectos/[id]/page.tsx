import { notFound, redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { projectPath } from "@/lib/urls";
import { getProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

/** Enlaces antiguos (con UUID): se llevan a la dirección legible del proyecto. */
export default async function LegacyProjectLink({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;
  const project = await getProject(id).catch(() => null);
  if (!project) notFound();
  redirect(projectPath(project.clientSlug, project.slug));
}
