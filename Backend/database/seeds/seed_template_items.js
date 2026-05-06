import { Op } from "sequelize";
import { log } from "../../lib/utility.js";

const TEMPLATE_ITEMS = [
    {
        name: "Replace sample branding",
        summary: "Update app copy, colors, and metadata to match your new project.",
        status: "active",
        priority: "high",
    },
    {
        name: "Define your first model",
        summary: "Use this sample table as a reference when adding your real domain models.",
        status: "draft",
        priority: "medium",
    },
    {
        name: "Connect production auth",
        summary: "If the project needs auth, add it as a focused plugin and route module.",
        status: "archived",
        priority: "low",
    },
];

export default async function seedTemplateItems(db, options = {}) {
    if (!db?.TemplateItems) {
        return;
    }

    const forceSync = options.forceSync === true;

    if (forceSync) {
        const keepNames = TEMPLATE_ITEMS.map((item) => item.name);
        const removedRows = await db.TemplateItems.destroy({
            where: {
                name: {
                    [Op.notIn]: keepNames,
                },
            },
        });

        for (const item of TEMPLATE_ITEMS) {
            const existing = await db.TemplateItems.findOne({ where: { name: item.name } });
            if (existing) {
                await existing.update(item);
            } else {
                await db.TemplateItems.create(item);
            }
        }

        await log(`seed_template_items force-synced ${TEMPLATE_ITEMS.length} items and removed ${removedRows} out-of-seed row(s)`, import.meta.url);
        return;
    }

    for (const item of TEMPLATE_ITEMS) {
        const existing = await db.TemplateItems.findOne({ where: { name: item.name } });
        if (!existing) {
            await db.TemplateItems.create(item);
        }
    }

    await log(`seed_template_items ensured ${TEMPLATE_ITEMS.length} template items`, import.meta.url);
}