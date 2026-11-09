import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, assertAvatar, detectImage, displayName, initials } from "@/server/domain/profile";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe("perfil: nombre e iniciales", () => {
  it("el nombre visible es «Nombre Apellido» y, sin ninguno, el correo", () => {
    expect(displayName({ email: "a@x.test", firstName: " Gustavo ", lastName: "Amarista" })).toBe("Gustavo Amarista");
    expect(displayName({ email: "a@x.test", firstName: "Luis", lastName: null })).toBe("Luis");
    expect(displayName({ email: "a@x.test", firstName: " ", lastName: "" })).toBe("a@x.test");
  });
  it("las iniciales son hasta dos letras en mayúscula y, sin nombre, la del correo", () => {
    expect(initials({ email: "a@x.test", firstName: "gustavo", lastName: "amarista" })).toBe("GA");
    expect(initials({ email: "a@x.test", firstName: "Luis", lastName: null })).toBe("L");
    expect(initials({ email: "zipnegocios@gmail.com" })).toBe("Z");
    expect(initials({ email: "x@y.z", firstName: "Ñandú", lastName: "Álvarez" })).toBe("ÑÁ");
  });
});

describe("perfil: foto", () => {
  it("reconoce PNG, JPEG y WebP por su firma, no por lo que diga el nombre", () => {
    expect(detectImage(png)).toEqual({ mime: "image/png", ext: "png" });
    expect(detectImage(jpg)).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectImage(webp)).toEqual({ mime: "image/webp", ext: "webp" });
    expect(detectImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF no se admite
    expect(detectImage(new Uint8Array())).toBeNull();
  });
  it("rechaza lo vacío, lo que no es imagen y lo que pesa de más", () => {
    expect(() => assertAvatar(new Uint8Array())).toThrow(/Elige una foto/);
    expect(() => assertAvatar(new TextEncoder().encode("hola"))).toThrow(/PNG, JPEG o WebP/);
    expect(() => assertAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1).fill(0xff))).toThrow(/pesa demasiado/);
    expect(assertAvatar(png)).toMatchObject({ mime: "image/png" });
  });
});
