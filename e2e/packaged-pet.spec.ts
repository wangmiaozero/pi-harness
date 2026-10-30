import { test } from './fixtures'
import { verifyPetResources } from './pet-resources'

test('preserves bundled actions and renders frames, or excludes pets in nomascot', async ({
  page,
  electronApp
}) => {
  await verifyPetResources(page, electronApp)
})
