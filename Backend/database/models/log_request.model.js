export default (sequelize, DataTypes, schemas, choices, hooks) => {
    return sequelize.define(
        "LogRequests",
        {
            uuid: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
                comment: "Primary key of the table",
            },
            rolling_id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                allowNull: false,
                unique: true,
                comment: "Auto-incrementing unique identifier for each log request",
            },
            request_at: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: "Timestamp when the request was made",
            },
            request_ip: {
                type: DataTypes.STRING,
                allowNull: true,
                comment: "IP address from which the request originated",
            },
            request_to: {
                type: DataTypes.STRING,
                allowNull: false,
                comment: "Endpoint or URL to which the request was made",
            },
            request_protocol: {
                type: DataTypes.STRING,
                allowNull: true,
                comment: "Protocol used for the request (e.g., HTTP/1.1, HTTP/2)",
            },
            request_method: {
                type: DataTypes.STRING,
                allowNull: false,
                comment: "HTTP method used for the request (e.g., GET, POST, PUT, DELETE)",
            },
            request_header: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: "Headers sent with the request",
            },
            request_body: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: "Body of the request",
            },
            request_cookies: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: "Cookies sent with the request",
            },
        },
        {
            tableName: "log_requests",
            timestamps: false,
            schema: schemas.project,
            hooks: hooks?.logRequest || {}
        },
    );
};
