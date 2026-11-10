import type { Page } from "playwright-core";

/** Drawer visibility can lag its closing animation; its toggle owns the open state. */
async function showWorkspaceList(page: Page): Promise<void> {
  const drawer = page.getByRole("button", { name: /^(Open|Close) workspace list$/ });
  if (await drawer.isVisible()) {
    if (await drawer.getAttribute("aria-expanded") === "false") await drawer.click();
    return;
  }
  const sidebar = page.getByRole("button", { name: "Show workspace list", exact: true });
  if (await sidebar.isVisible()) await sidebar.click();
}

export async function openGraph(page: Page): Promise<void> {
  await showWorkspaceList(page);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
}

/** Exercise Ovis's own pane selection, including its folded phone Agents list. */
export async function openNativeAgent(page: Page, machine: string, pane: string): Promise<void> {
  const section = page.getByRole("region", { name: "Agents", exact: true });
  await showWorkspaceList(page);
  const toggle = section.locator(".agent-section-toggle");
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await section.locator(`.agent-item[data-machine="${machine}"][data-pane="${pane}"] .agent-select`).click();
}
