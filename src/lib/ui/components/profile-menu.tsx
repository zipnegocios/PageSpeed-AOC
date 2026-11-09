"use client";

import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/admin/actions";
import { Avatar } from "./avatar";
import { Badge } from "./badge";
import { Menu, MenuButton, MenuDivider, MenuLink } from "./menu";

const OWN_PAGES = ["/admin/perfil", "/admin/equipo", "/admin/archivados"];

/** El menú de la persona: foto o iniciales, y dentro Mi perfil, Equipo (solo el propietario), Archivados y Salir. */
export function ProfileMenu({
  name,
  email,
  role,
  initials,
  avatarSrc,
}: {
  name: string;
  email: string;
  role: "owner" | "admin";
  initials: string;
  avatarSrc: string | null;
}) {
  const pathname = usePathname();
  const active = OWN_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <Menu label={`Menú de ${name}`} active={active} triggerClassName="rounded-full p-0" panelClassName="w-72" trigger={<Avatar initials={initials} src={avatarSrc} />}>
      <div className="flex items-center gap-3 px-4 pt-2 pb-3">
        <Avatar initials={initials} src={avatarSrc} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[17px] font-bold text-ink">{name}</span>
          {name !== email ? <span className="truncate text-[14px] text-ink-muted">{email}</span> : null}
          <span>
            <Badge tone={role === "owner" ? "primary" : "neutral"}>{role === "owner" ? "Propietario" : "Administrador"}</Badge>
          </span>
        </div>
      </div>
      <MenuDivider />
      <MenuLink href="/admin/perfil" current={pathname === "/admin/perfil"}>
        Mi perfil
      </MenuLink>
      {role === "owner" ? (
        <MenuLink href="/admin/equipo" current={pathname.startsWith("/admin/equipo")}>
          Equipo
        </MenuLink>
      ) : null}
      <MenuLink href="/admin/archivados" current={pathname.startsWith("/admin/archivados")}>
        Archivados
      </MenuLink>
      <MenuDivider />
      <form action={logoutAction}>
        <MenuButton className="text-danger">Salir</MenuButton>
      </form>
    </Menu>
  );
}
