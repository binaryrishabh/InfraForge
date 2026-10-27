import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { passwordAcceptable } from "@infraforge/contracts/auth";
import { PasswordChecklist } from "../src/features/auth/components/PasswordChecklist";
import { SignupPage } from "../src/features/auth/pages/SignupPage";

test("the password checklist shows each rule and which ones are met", () => {
  const weak = renderToStaticMarkup(<PasswordChecklist password="weakpass" id="rules" />);
  expect(weak.match(/— done/g)).toHaveLength(2);
  expect(weak).toContain("An uppercase letter"); expect(weak).toContain("A symbol");
  const strong = renderToStaticMarkup(<PasswordChecklist password="Strong#Pass9" id="rules" />);
  expect(strong.match(/— done/g)).toHaveLength(5);
});
test("password rule: 8+ characters with lowercase, uppercase, number and symbol", () => {
  for (const ok of ["Strong#Pass9", "aB3!aaaa", "Ünïcødé9?Z"]) expect(passwordAcceptable(ok)).toBe(true);
  for (const bad of ["Short1!", "alllowercase1!", "ALLUPPERCASE1!", "NoNumbers!!", "NoSymbol123", "a".repeat(129) + "A1!"]) expect(passwordAcceptable(bad)).toBe(false);
});
test("signup starts with the email only and links to sign-in", () => {
  const html = renderToStaticMarkup(<MemoryRouter><SignupPage /></MemoryRouter>);
  expect(html).toContain('id="signup-email"'); expect(html).not.toContain('id="signup-password"');
  expect(html).toContain("Send confirmation link"); expect(html).toContain('href="/signin"');
});
