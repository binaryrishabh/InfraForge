export type TurnstileAction = "signup" | "password_reset";
export type TokenProvider = (action: TurnstileAction) => Promise<string>;
let provider: TokenProvider | undefined;

// The owner-selected UI mounts Cloudflare's widget and registers its callback
// bridge here. No script is loaded, widget rendered or token cached by this API.
export function setTurnstileTokenProvider(next: TokenProvider): () => void {
  provider = next;
  return () => { if (provider === next) provider = undefined; };
}
export async function obtainTurnstileToken(action: TurnstileAction): Promise<string> {
  if (!provider) throw Error("Security check is not ready");
  const token = await provider(action);
  if (!token || token.length > 2048) throw Error("Complete the security check");
  return token;
}
