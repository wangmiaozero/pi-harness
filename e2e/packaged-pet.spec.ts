import { test } from './fixtures'
import { verifyPetResources } from './pet-resources'

test('does not ship optional pet artwork inside the application', async ({
  page,
  electronApp
}) => {
  await verifyPetResources(page, electronApp)
})
