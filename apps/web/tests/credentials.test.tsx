import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SignInPage } from "../src/features/auth/pages/SignInPage";
import { credentialBody, signupErrors, signupFailure } from "../src/features/auth/credentials";
import { WorkspaceRequired } from "../src/features/canvas/components/WorkspaceRequired";
import { DESIGNER_MIN_WIDTH } from "../src/features/canvas/designerViewport";
import { normalizeUsername, validUsername } from "@infraforge/contracts/auth";
import { SocialSignIn } from "../src/features/auth/components/SocialSignIn";

test("one identifier reaches the auth server without a browser account lookup", () => {
  expect(credentialBody(" User@Example.test ", "opaque")).toMatchObject({ identifier: "User@Example.test" });
  expect(credentialBody(" Rishabh ", "opaque")).toMatchObject({ identifier: "Rishabh" });
  expect(normalizeUsername("Rishabh")).toBe("rishabh");
  for (const username of ["ab", "1name", "name space", "mail@email.test", "a".repeat(31)]) expect(validUsername(username)).toBe(false);
  expect(validUsername("Learner_123")).toBe(true);
});
test("signup mirrors bounds and returns accessible field errors without composition rules", () => {
  expect(signupErrors({ username: "Rishabh", email: "user@example.test", password: "a".repeat(15) })).toEqual({});
  expect(Object.keys(signupErrors({ username: "1bad", email: "invalid", password: "short" }))).toEqual(["username", "email", "password"]);
  expect(signupErrors({ username: "Rishabh", email: "user@example.test", password: "a".repeat(129) }).password).toBeDefined();
  expect(signupFailure("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL").message).toContain("original method");
  expect(signupFailure("USERNAME_IS_ALREADY_TAKEN").username).toContain("unavailable");
});
test("sign-in and sign-up have labelled password-manager forms and distinct routes", () => {
  for (const mode of ["signin", "signup"] as const) {
    const html = renderToStaticMarkup(<MemoryRouter><SignInPage mode={mode} /></MemoryRouter>);
    expect(html).toContain('name="password"'); expect(html).toContain('type="password"');
    expect(html).toContain(`autoComplete="${mode === "signup" ? "new-password" : "current-password"}"`);
    expect(html).toContain('autoComplete="username"'); expect(html).toContain('for="auth-password"');
    expect(html).toContain('aria-invalid="false"');
    expect(html).not.toContain("Sign-in is not configured"); expect(html).not.toContain("Forgot password");
    if (mode === "signup") { expect(html).toContain('name="email"'); expect(html).toContain('href="/signin"'); }
    else { expect(html).toContain("Username or email"); expect(html).toContain('href="/signup"'); }
  }
});
test("small Designer state is a useful accessible page with no canvas", () => {
  const html = renderToStaticMarkup(<MemoryRouter><WorkspaceRequired /></MemoryRouter>);
  expect(html).toContain(`${DESIGNER_MIN_WIDTH}px`); expect(html).toContain('id="main"');
  expect(html).toContain('href="/designs"'); expect(html).toContain('href="/runs"');
  expect(html).toContain("Give your design more room"); expect(html).not.toContain("Design canvas");
});
test("social options are optional and only configured providers appear", () => {
  expect(renderToStaticMarkup(<SocialSignIn providers={[]} pending={null} onSignIn={() => {}} />)).toBe("");
  const html = renderToStaticMarkup(<SocialSignIn providers={["github", "google"]} pending={null} onSignIn={() => {}} />);
  expect(html).toContain("Continue with GitHub"); expect(html).toContain("Continue with Google");
  expect(renderToStaticMarkup(<SocialSignIn providers={["github"]} pending="credentials" onSignIn={() => {}} />)).toContain("disabled");
});
