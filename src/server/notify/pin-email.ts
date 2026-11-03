const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Correo con el PIN nuevo del portal. Habla al cliente de "tú". */
export function buildPinEmail(input: { contactName: string | null; clientName: string; pin: string; portalUrl: string }): { subject: string; text: string; html: string } {
  const greeting = input.contactName?.trim() ? `Hola ${input.contactName.trim()},` : "Hola,";
  const subject = "Tu PIN para ver tu informe";
  const line = `Este es tu PIN nuevo para entrar al portal de ${input.clientName}. Los PIN anteriores dejan de funcionar.`;
  const text = [greeting, "", line, "", `PIN: ${input.pin}`, "", "Ábrelo aquí:", input.portalUrl, "", "Si no lo pediste tú, puedes ignorar este correo.", "", "AOC PageSpeed"].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1b33;max-width:560px">` +
    `<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#45587a;margin:0">AOC PageSpeed</p>` +
    `<p style="margin:16px 0 0">${esc(greeting)}</p>` +
    `<p>${esc(line)}</p>` +
    `<p style="font-size:32px;letter-spacing:.3em;font-weight:bold;font-family:'Courier New',monospace;margin:20px 0">${esc(input.pin)}</p>` +
    `<p style="margin:20px 0"><a href="${esc(input.portalUrl)}" style="display:inline-block;background:#0a5cff;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:bold">Abrir mi portal</a></p>` +
    `<p style="color:#45587a;font-size:14px">Si no lo pediste tú, puedes ignorar este correo.</p>` +
    `</div>`;
  return { subject, text, html };
}
