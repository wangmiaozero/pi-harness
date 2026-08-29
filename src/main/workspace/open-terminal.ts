import { spawn } from 'node:child_process'
import { PathDeniedError } from '../services/errors'

export async function openDirectoryInTerminal(directory: string): Promise<void> {
  if (!directory) throw new PathDeniedError('Terminal directory is required')
  const child =
    process.platform === 'darwin'
      ? spawn('open', ['-a', 'Terminal', directory], { detached: true, stdio: 'ignore' })
      : process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', 'cd', '/d', directory], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
        : spawn(linuxTerminal(), linuxTerminalArgs(directory), {
            detached: true,
            stdio: 'ignore'
          })
  child.unref()
}

function linuxTerminal(): string {
  return process.env.TERMINAL?.trim() || process.env.COLORTERM?.trim() || 'x-terminal-emulator'
}

function linuxTerminalArgs(directory: string): string[] {
  const command = linuxTerminal()
  if (command.includes('gnome-terminal')) return ['--working-directory', directory]
  if (command.includes('konsole')) return ['--workdir', directory]
  if (command.includes('xfce4-terminal')) return [`--working-directory=${directory}`]
  return ['--working-directory', directory]
}
