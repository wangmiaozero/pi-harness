import type { InjectionKey } from 'vue'
import type { FileTreeEntry } from '@shared/types/workspace'

export interface FileTreeApi {
  isExpanded(path: string): boolean
  childrenOf(path: string): FileTreeEntry[]
  openEntry(entry: FileTreeEntry): void
}

export const FILE_TREE_API: InjectionKey<FileTreeApi> = Symbol('file-tree')
