export function getAdminCredentials() {
  const email = process.env.ADMIN_LOGIN_EMAIL ?? "hiagobrambatti@gmail.com";
  const password = process.env.ADMIN_LOGIN_PASSWORD ?? "br101218";

  return { email, password };
}

export function isValidAdminLogin(inputEmail: string, inputPassword: string): boolean {
  const { email, password } = getAdminCredentials();
  return inputEmail.trim().toLowerCase() === email.trim().toLowerCase() && inputPassword === password;
}

