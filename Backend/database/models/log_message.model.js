export default (sequelize, DataTypes, schemas, choices, hooks) => {
  return sequelize.define('LogMessages', {
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
        comment: "Primary key of the table"
    },
    rolling_id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      unique: true,
        comment: "Auto-incrementing unique identifier for each log message"
    },
    server_start_on: {
      type: DataTypes.DATE,
      allowNull: false,
        comment: "Timestamp when the server started"
    },
    report_on: {
      type: DataTypes.DATE,
      allowNull: false,
        comment: "Timestamp when the log message was generated"
    },
    report_by: {
      type: DataTypes.STRING,
      allowNull: false,
        comment: "Identifier of the source that generated the log message (module path)"
    },
    level: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "info",
      validate: {
        isIn: [choices.log_messages_level]
      },
      comment: "Log level (info, warning, error)"
    },
    messages: {
      type: DataTypes.TEXT,
      allowNull: false,
        comment: "The log message content"
    }
  }, {
    tableName: 'log_messages',
    timestamps: false,
    schema: schemas.project,
    hooks: hooks?.logMessage || {}
  })
}