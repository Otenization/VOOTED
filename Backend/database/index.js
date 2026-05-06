import { Sequelize } from "sequelize";
import { loadConfig, log, logQuery } from "../lib/utility.js";
import initModels from "./models/index.js";
import seedTemplateItems from "./seeds/seed_template_items.js";

// Config is loaded lazily inside initDB() — pulling it at module top-level
// would eagerly load runtime config on the user's filesystem just from importing this
// module (which the db plugin does even when database.enabled=false), before
// the GUI setup card has had a chance to confirm the folder.
export async function initDB() {
    const config = loadConfig();
    const dbConfig = config.database.connection;
    const sequelizeLoggingConfig = config.logging?.sequelize || {};
    
    // Create logging function for Sequelize
    const loggingFunction = (sequelizeLoggingConfig.log_to_file || 
                            sequelizeLoggingConfig.log_to_console) 
        ? (query, duration) => {
            logQuery(query, duration);
        }
        : false;

    const sequelize = new Sequelize(
        dbConfig.database,
        dbConfig.username,
        dbConfig.password,
        {
            host: dbConfig.host,
            port: dbConfig.port || 5432,
            dialect: dbConfig.dialect,
            benchmark: sequelizeLoggingConfig.benchmark !== false,
            logging: loggingFunction
        },
    );

    await sequelize.authenticate();
    try {
        await sequelize.createSchema(dbConfig.schemas.project);
    } catch (err) {
        if (err.name !== "SequelizeDatabaseError") {
            throw err;
        }
    }
    const models = initModels(sequelize, dbConfig.schemas);

    await sequelize.sync(config.database.sync);

    const db = {
        sequelize,
        ...models.models,
        choices: models.choices
    };

    await seedTemplateItems(db, {
        forceSync: config.database?.seed?.force_template_items_sync === true,
    });

    return db;
}
