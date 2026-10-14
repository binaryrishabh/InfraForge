import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";
import { API_URL } from "../../client/httpClient";

export const authClient = createAuthClient({ baseURL: `${API_URL}/auth`, plugins: [usernameClient({ displayUsername: false })] });
