import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SignInPage } from "../src/features/auth/pages/SignInPage";
import { credentialBody, signinFailure, signupFailure } from "../src/features/auth/credentials";
import { normalizeUsername, validUsername } from "@infraforge/contracts/auth";
import { SocialSignIn } from "../src/features/auth/components/SocialSignIn";

test("one identifier reaches the auth server without a browser account lookup", () => {
  expect(credentialBody(" User@Example.test ", "opaque")).toMatchObject({ identifier: "User@Example.test" });
  expect(credentialBody(" Rishabh ", "opaque")).toMatchObject({ identifier: "Rishabh" });
  expect(normalizeUsername("Rishabh")).toBe("rishabh");
  for (const username of ["ab", "1name", "name space", "mail@email.test", "a".repeat(31)]) expect(validUsername(username)).toBe(false);
  expect(validUsername("Learner_123")).toBe(true);
});
test("signup failures map to the field that needs fixing", () => {
  expect(signupFailure("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL").message).toContain("original method");
  expect(signupFailure("USERNAME_IS_ALREADY_TAKEN").username).toContain("unavailable");
  expect(signupFailure("PASSWORD_COMPROMISED").password).toContain("data breach");
  expect(signupFailure("PASSWORD_TOO_WEAK").password).toContain("password rule");
});
test("sign-in has a labelled password-manager form and links to sign-up", () => {
  const html = renderToStaticMarkup(<MemoryRouter><SignInPage /></MemoryRouter>);
  expect(html).toContain('name="password"'); expect(html).toContain('type="password"');
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('autoComplete="username"'); expect(html).toContain('for="auth-password"');
  expect(html).toContain('aria-invalid="false"'); expect(html).not.toContain("Forgot password");
  expect(html).toContain("Username or email"); expect(html).toContain('href="/signup"');
});
test("social options are optional and only configured providers appear", () => {
  expect(renderToStaticMarkup(<SocialSignIn providers={[]} pending={null} onSignIn={() => {}} />)).toBe("");
  const html = renderToStaticMarkup(<SocialSignIn providers={["github", "google"]} pending={null} onSignIn={() => {}} />);
  expect(html).toContain("Continue with GitHub"); expect(html).toContain("Continue with Google");
  expect(renderToStaticMarkup(<SocialSignIn providers={["github"]} pending="credentials" onSignIn={() => {}} />)).toContain("disabled");
});
test("an unconfirmed email asks for confirmation instead of a security check", () => {
  expect(signinFailure("EMAIL_NOT_VERIFIED", 403)).toBe("unverified");
  expect(signinFailure(undefined, 403)).toBe("login");
  expect(signinFailure("INVALID_EMAIL_OR_PASSWORD", 401)).toBe("login");
  expect(signinFailure(undefined, 429)).toBe("rate");
});
