import { requireScope } from "@/lib/auth/access";
import { projectPath } from "@/lib/urls";
import { ProjectSwitcher } from "@/lib/ui/components/project-switcher";
import { listAllProjects } from "@/server/services/projects";

/** Carga los proyectos para el conmutador de la barra superior (una consulta). Si falla, el conmutador queda vacío. */
export async function ProjectSwitcherLoader() {
  const projects = await requireScope().then(({ scope }) => listAllProjects(undefined, scope)).catch(() => []);
  return (
    <ProjectSwitcher
      items={projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, href: projectPath(p.clientSlug, p.slug), phase: p.phase }))}
    />
  );
}
