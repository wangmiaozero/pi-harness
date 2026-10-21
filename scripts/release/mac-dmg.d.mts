export interface DmgOperations {
  run?: (
    file: string,
    args: string[],
    options: { cwd: string; timeout: number; maxBuffer: number }
  ) => Promise<{ stdout: string; stderr: string }>
  wait?: (milliseconds: number) => Promise<unknown>
  isMounted?: (mount: string) => Promise<boolean>
}
export function copyDmgApplication(
  image: string,
  mount: string,
  installed: string,
  diagnostics: string,
  options?: DmgOperations
): Promise<void>
