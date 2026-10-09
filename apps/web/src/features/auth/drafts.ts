export const draftKey = (userId: string) => `infraforge:draft:${userId}`;

export function clearOldBrowserAccounts() {
  for (const key of ["infraforge_auth_registry", "infraforge_auth_session", "Infraforge_Infrastucture_Draft"]) {
    localStorage.removeItem(key);
  }
}
