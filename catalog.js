import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sqlWasmPath = path.join(__dirname, "node_modules", "sql.js", "dist");
export const databasePath = path.join(__dirname, "products.sqlite");

const sampleProducts = [
  {
    id: 1,
    name: "WidgetX 3000",
    price: "$199",
    description: "Flagship productivity widget with fast setup, USB connectivity, and automation-friendly controls for busy desk setups.",
  },
  {
    id: 2,
    name: "Premium 4K Video Projector",
    price: "$1299",
    description: "Native 4K projector with HDR10, 3,000 ANSI lumens, and flexible connectivity for home theater or presentation rooms.",
  },
  {
    id: 3,
    name: "Winter Coat",
    price: "$179",
    description: "Insulated winter coat with water resistance, durable construction, and room for layering in freezing conditions.",
  },
  {
    id: 4,
    name: "Summer Shorts",
    price: "$39",
    description: "Lightweight quick-dry shorts with UV protection, adjustable waist, and breathable fabric for warm weather use.",
  },
  {
    id: 5,
    name: "Widget Dock",
    price: "$49",
    description: "Compact charging and connectivity dock for Widget devices with USB-C power delivery and tidy cable management.",
  },
];

let sqlModulePromise = null;

function getSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(sqlWasmPath, file),
    });
  }

  return sqlModulePromise;
}

function saveDatabase(db) {
  const data = db.export();
  fs.writeFileSync(databasePath, Buffer.from(data));
}

function readRows(db, query) {
  const result = db.exec(query);
  if (!result.length) {
    return [];
  }

  const [{ columns, values }] = result;
  return values.map((row) => Object.fromEntries(row.map((value, index) => [columns[index], value])));
}

export async function ensureProductDatabase() {
  const SQL = await getSqlModule();
  const db = fs.existsSync(databasePath)
    ? new SQL.Database(fs.readFileSync(databasePath))
    : new SQL.Database();

  let shouldPersist = false;

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price TEXT NOT NULL,
        description TEXT NOT NULL
      )
    `);

    const count = readRows(db, "SELECT COUNT(*) AS count FROM products")[0]?.count ?? 0;
    if (count === 0) {
      const insert = db.prepare(`
        INSERT INTO products (id, name, price, description)
        VALUES (?, ?, ?, ?)
      `);

      for (const product of sampleProducts) {
        insert.run([product.id, product.name, product.price, product.description]);
      }

      insert.free();
      shouldPersist = true;
    } else if (!fs.existsSync(databasePath)) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      saveDatabase(db);
    }
  } finally {
    db.close();
  }

  return databasePath;
}

export async function getProducts() {
  await ensureProductDatabase();
  const SQL = await getSqlModule();
  const db = new SQL.Database(fs.readFileSync(databasePath));

  try {
    return readRows(
      db,
      "SELECT id, name, price, description FROM products ORDER BY id ASC",
    );
  } finally {
    db.close();
  }
}
