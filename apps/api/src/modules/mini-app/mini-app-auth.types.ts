export type MiniAppRole = "client" | "trainer";

export interface MiniAppSessionPayload {
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  role: MiniAppRole;
  iat: number;
  exp: number;
}

export interface MiniAppSessionResponse {
  status: "ok";
  token: string;
  session: MiniAppSessionPayload;
}

export interface MiniAppSupportContact {
  telegramId: string;
  telegramUrl: string;
  label: string;
}
