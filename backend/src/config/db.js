const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 100,   // raised from 10 → 100 for load-test concurrency
    queueLimit: 0,
    connectTimeout: 30000,  // 30s connection acquisition timeout
    acquireTimeout: 30000,  // 30s max wait for a connection from pool
    idleTimeout: 60000,     // release idle connections after 60s
});

module.exports = pool;