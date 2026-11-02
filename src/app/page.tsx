import { redirect } from "next/navigation";

// No hay portada pública: la raíz lleva al panel, que pide iniciar sesión si hace falta.
export default function Home() {
  redirect("/admin");
}
