export type AuthActionState = {
  status: "idle" | "success" | "error";
  message: string;
  phone: string;
  otpRequested: boolean;
};

export const INITIAL_AUTH_STATE: AuthActionState = {
  status: "idle",
  message: "",
  phone: "",
  otpRequested: false,
};
