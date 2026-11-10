import { Card } from "@/lib/ui/components/card";

/**
 * Aviso para un proyecto en mejora inicial: los valores de las primeras semanas son el punto de partida y se van a corregir, así
 * que el cliente no tiene por qué alarmarse. Se enciende y se apaga a mano en la ficha del proyecto.
 */
export function InitialImprovementNotice() {
  return (
    <Card>
      <p className="text-[19px] font-semibold text-ink">Estamos en la fase de mejora inicial</p>
      <p className="text-[17px] leading-6 text-ink">
        Los valores de este proyecto son el <strong>punto de partida</strong>, no un problema de tu negocio. Estoy corrigiendo de forma progresiva, con los ajustes, los parches y las actualizaciones que hagan falta, y cada mes verás aquí cómo evolucionan.
      </p>
    </Card>
  );
}
