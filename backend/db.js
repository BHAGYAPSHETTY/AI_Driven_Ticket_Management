require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: false, // For local dev, if you don't have SSL set up
        trustServerCertificate: true // Change to false for production
    }
};

async function connectDB() {
    try {
        await sql.connect(config);
        console.log('Connected to MSSQL database.');
        return sql;
    } catch (err) {
        console.error('Database connection failed:', err);
        process.exit(1); // Exit if connection fails
    }
}

module.exports = { connectDB, sql };