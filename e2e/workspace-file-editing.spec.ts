import { test } from './fixtures'
import { verifyFileEditing } from './workspace-fixtures'

test(
  'preserves in-flight edits, saves and external conflict protection in the installed editor',
  verifyFileEditing
)
