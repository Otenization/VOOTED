import { initDB } from '../index.js'
import seedTemplateItems from '../seeds/seed_template_items.js'

const main = async () => {
  const db = await initDB()

  try {
    await db.TemplateItems.destroy({
      where: {},
      truncate: true,
      cascade: true,
      restartIdentity: true,
    })

    await seedTemplateItems(db, { forceSync: true })

    console.log('DB reset + reseed completed with template example items.')
  } finally {
    await db.sequelize.close()
  }
}

main().catch((err) => {
  console.error('Failed to reset/reseed DB:', err)
  process.exit(1)
})
