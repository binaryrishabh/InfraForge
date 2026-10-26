import { expect, mock, test } from "bun:test";
import { Children, isValidElement, type ComponentProps, type FormEvent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateInfrastructureName } from "@infraforge/domain/validation";
import { Dialog } from "../src/ui/Dialog";
import { NameDialog } from "../src/ui/ConfirmDialogs";
import { DeployDialog } from "../src/features/deployment/components/DeployDialog";

test("unnamed designs submit a real default in both dialogs while saved names and validation remain", () => {
  const original = Dialog;
  let form: ReactElement<ComponentProps<"form">>;
  // Render portal contents on the server and capture the actual submit handler.
  mock.module("../src/ui/Dialog", () => ({ Dialog: ({ children, footer }: ComponentProps<typeof Dialog>) => {
    form = Children.toArray(children).find((child) => isValidElement(child) && child.type === "form") as typeof form;
    return <>{children}{footer}</>;
  } }));
  try {
    for (const kind of ["run", "save"] as const) for (const initial of ["", "   ", "saved-api", "ab"]) {
      const submitted: string[] = [];
      const props = { open: true, onOpenChange: () => {}, loading: false };
      const html = renderToStaticMarkup(kind === "run"
        ? <DeployDialog {...props} initialName={initial} resourceCount={2} connectionCount={1} onRun={(_, name) => submitted.push(name)} />
        : <NameDialog {...props} title="Save design" initialValue={initial} submitLabel="Save" onSubmit={(name) => submitted.push(name)} />);
      const value = html.match(/<input[^>]*value="([^"]*)"/)?.[1];
      if (!initial.trim()) { expect(value).toMatch(/^design-\d{8}$/); expect(validateInfrastructureName(value!)).toBeNull(); }
      else expect(value).toBe(initial);
      form!.props.onSubmit!({ preventDefault() {} } as FormEvent<HTMLFormElement>);
      expect(submitted).toEqual(initial === "ab" ? [] : [value!]);
    }
  } finally { mock.module("../src/ui/Dialog", () => ({ Dialog: original })); }
});
