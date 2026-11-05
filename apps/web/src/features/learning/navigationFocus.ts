export function focusLearningHeading(container: Pick<HTMLElement, "querySelector"> | null) {
  const heading = container?.querySelector("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}
