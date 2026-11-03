import { z } from "zod";
import { optionalEmail, optionalPhone, optionalText, requiredText } from "./common";

export const clientInput = z.object({
  name: requiredText("El nombre", 2, 120),
  /** Opcional al crear; se cambia después con `renameClientSlug`. */
  slug: optionalText(40),
  contactName: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  notes: optionalText(2000),
});

export const clientUpdateInput = clientInput.omit({ slug: true });

export type ClientInput = z.infer<typeof clientInput>;
export type ClientUpdateInput = z.infer<typeof clientUpdateInput>;
