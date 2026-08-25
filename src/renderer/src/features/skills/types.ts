export interface SkillEditorFormState {
  name: string
  description: string
  content: string
  targetRoot: string
  expectedMtime: number | null
}

export interface SkillImportFormState {
  source: string
  name: string
  targetRoot: string
}
