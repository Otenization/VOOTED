export default (sequelize, DataTypes, schemas, choices, hooks) => {
    return sequelize.define(
        "TemplateItems",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            summary: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "",
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: "draft",
                validate: {
                    isIn: [choices.template_item_status],
                },
            },
            priority: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: "medium",
                validate: {
                    isIn: [choices.template_item_priority],
                },
            },
        },
        {
            tableName: "template_items",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            schema: schemas.project,
            hooks: hooks?.templateItem || {},
        },
    );
};
