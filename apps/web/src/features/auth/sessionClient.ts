import { createAuthClient } from "better-auth/client";
import { API_URL } from "../../client/httpClient";

export const authClient = createAuthClient({ baseURL: `${API_URL}/auth` });
