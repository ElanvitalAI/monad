/** Write JSON output completely before the process can exit. */
export async function writeStdoutJson(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => process.stdout.write(text, error => error ? reject(error) : resolve()));
}
