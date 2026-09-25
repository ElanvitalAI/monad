export function shouldPassthroughDashboardHostOwnedInputCoreAction(actionId: string): boolean {
  return actionId === 'app.quit';
}
