import mysql from "mysql2/promise";
import { config } from "./config.js";

async function ensureDatabaseExists(dbConfig) {
  const bootstrap = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();
}

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              INT            PRIMARY KEY AUTO_INCREMENT,
      name            VARCHAR(120)   NOT NULL,
      email           VARCHAR(190)   NOT NULL UNIQUE,
      password_hash   VARCHAR(255)   NOT NULL,
      role            ENUM('student','staff','security') NOT NULL,
      is_verified     TINYINT(1)     NOT NULL DEFAULT 1,
      status          VARCHAR(20)    NOT NULL DEFAULT 'active',
      created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS parking_spots (
      id              INT            PRIMARY KEY AUTO_INCREMENT,
      code            VARCHAR(20)    NOT NULL UNIQUE,
      side            VARCHAR(20)    NOT NULL,
      type            VARCHAR(30)    NOT NULL DEFAULT 'standard',
      lot_type        VARCHAR(20)    NOT NULL DEFAULT 'general',
      is_available    TINYINT(1)     NOT NULL DEFAULT 1,
      notes           TEXT,
      created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id              INT            PRIMARY KEY AUTO_INCREMENT,
      user_id         INT            NOT NULL,
      spot_id         INT            NOT NULL,
      start_time      VARCHAR(30)    NOT NULL,
      end_time        VARCHAR(30)    NOT NULL,
      status          ENUM('pending','approved','rejected','cancelled','completed') NOT NULL,
      approved_by     INT            NULL,
      approval_note   TEXT,
      created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_res_user  FOREIGN KEY (user_id)     REFERENCES users(id)         ON DELETE CASCADE,
      CONSTRAINT fk_res_spot  FOREIGN KEY (spot_id)     REFERENCES parking_spots(id) ON DELETE CASCADE,
      CONSTRAINT fk_res_admin FOREIGN KEY (approved_by) REFERENCES users(id)         ON DELETE SET NULL,
      INDEX idx_res_spot_status (spot_id, status),
      INDEX idx_res_user_status (user_id, status)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id                              INT         PRIMARY KEY,
      student_max_active_reservations INT         NOT NULL DEFAULT 5,
      student_max_hours               INT         NOT NULL DEFAULT 6,
      staff_max_hours                 INT         NOT NULL DEFAULT 12,
      default_reservation_mode        VARCHAR(20) NOT NULL DEFAULT 'approved',
      updated_at                      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT chk_settings_singleton CHECK (id = 1)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    INSERT IGNORE INTO app_settings
      (id, student_max_active_reservations, student_max_hours, staff_max_hours, default_reservation_mode)
    VALUES (1, 5, 6, 12, 'approved')
  `);
}

export async function createDatabase(dbConfig = config.db) {
  await ensureDatabaseExists(dbConfig);

  const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    dateStrings: true
  });

  await createTables(pool);
  return pool;
}
