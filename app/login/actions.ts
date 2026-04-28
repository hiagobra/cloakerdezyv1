"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidE164, normalizePhone } from "@/lib/auth/phone";
import type { AuthActionState } from "@/app/login/state";

export async function requestOtpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));

  if (!isValidE164(phone)) {
    return {
      status: "error",
      message: "Digite um telefone valido no formato internacional. Ex: +5511999999999",
      phone,
      otpRequested: false,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });

  if (error) {
    return {
      status: "error",
      message: error.message,
      phone,
      otpRequested: false,
    };
  }

  return {
    status: "success",
    message: "Codigo enviado por SMS. Digite abaixo para entrar.",
    phone,
    otpRequested: true,
  };
}

export async function verifyOtpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const token = String(formData.get("token") ?? "").replace(/\D/g, "");

  if (!isValidE164(phone)) {
    return {
      status: "error",
      message: "Telefone invalido. Solicite um novo codigo.",
      phone: "",
      otpRequested: false,
    };
  }

  if (token.length !== 6) {
    return {
      status: "error",
      message: "Codigo OTP deve ter 6 digitos.",
      phone,
      otpRequested: true,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });

  if (error) {
    return {
      status: "error",
      message: error.message,
      phone,
      otpRequested: true,
    };
  }

  if (user) {
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        phone,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
