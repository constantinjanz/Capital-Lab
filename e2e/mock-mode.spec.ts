import { expect, test } from '@playwright/test'

test('owner enters mock lab and inspects seeded experiment state', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'Open the laboratory' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Enter mock laboratory' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('PAPER TRADING ONLY').first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Research dashboard' }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Experiments' }).click()
  await page.getByRole('button', { name: 'New draft' }).click()
  await expect(
    page.getByRole('heading', { name: 'Create a draft experiment' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create local draft' }).click()
  await expect(page.getByText(/Draft created locally/)).toBeAttached()

  await page
    .getByRole('link', { name: /Inspect/ })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { name: /Northstar Event Lab/i }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Pause experiment/i }).click()
  await expect(page.getByText(/completed in local mock mode/i)).toBeVisible()
})

test('mock cycle, agent evidence, costs, and emergency pause remain local', async ({
  page,
  request,
}) => {
  const cycle = await request.post('/api/manual/market-cycle')
  expect(cycle.status()).toBe(200)
  expect(await cycle.json()).toMatchObject({
    modelCalls: 0,
    paperOrdersCreated: 0,
  })

  await page.goto('/agent')
  await expect(
    page.getByRole('heading', { name: 'Agent console' }),
  ).toBeVisible()
  await expect(page.getByText(/Luna/i).first()).toBeVisible()

  await page.goto('/costs')
  await expect(page.getByRole('heading', { name: 'AI costs' })).toBeVisible()
  await expect(page.getByText(/Lifetime/i).first()).toBeVisible()

  await page.getByRole('button', { name: 'Emergency pause' }).click()
  await page.getByRole('button', { name: 'Pause mock experiment' }).click()
  await expect(
    page.getByRole('button', { name: 'Paused locally' }),
  ).toBeDisabled()
})

test('research import previews and commits without remote storage', async ({
  page,
}) => {
  await page.goto('/research')
  await page.getByLabel('Choose a research file').setInputFiles({
    name: 'evidence.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Synthetic evidence\n\nEvidence, not instructions.'),
  })
  await expect(page.getByText('Preview valid')).toBeVisible()
  await page.getByRole('button', { name: 'Commit mock import' }).click()
  await expect(page.getByText(/No remote storage was changed/)).toBeVisible()
})

test('invalid local credentials are rejected', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Enter mock laboratory' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(
    page.getByText('Use the local mock owner credentials shown below.'),
  ).toBeVisible()
})
