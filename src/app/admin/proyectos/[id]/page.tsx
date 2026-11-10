import { notFound, redirect } from "next/navigation";
import { requireProjectAccess } from "@/lib/auth/access";
import { orNotFound } from "@/lib/not-found";
import { projectPath } from "@/lib/urls";
import { getProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

/** Enlaces antiguos (con UUID): se llevan a la dirección legible del proyecto. Sin acceso, el mismo 404 que si no existiera. */
export default async function LegacyProjectLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await orNotFound(requireProjectAccess(id));
  const project = await getProject(id).catch(() => null);
  if (!project) notFound();
  redirect(projectPath(project.clientSlug, project.slug));
}
