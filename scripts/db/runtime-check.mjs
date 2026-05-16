import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const envPath = path.join(rootDir, ".env");
const requireFromApi = createRequire(path.join(rootDir, "apps", "api", "package.json"));
const { PrismaClient } = requireFromApi("@prisma/client");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Файл .env не найден: ${filePath}`);
  }

  const fileContents = readFileSync(filePath, "utf8");
  const lines = fileContents.split(/\r?\n/u);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/u, "$1");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function checkCommandAvailability(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 5_000,
  });

  return {
    available: result.status === 0,
    details:
      result.status === 0
        ? (result.stdout || result.stderr).trim()
        : (result.error?.message || result.stderr || "Команда недоступна").trim(),
  };
}

function maskDatabaseUrl(databaseUrl) {
  return databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/u, "://$1:***@");
}

async function main() {
  loadEnvFile(envPath);

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("В .env отсутствует обязательная переменная DATABASE_URL");
  }

  const parsedUrl = new URL(databaseUrl);
  const dockerStatus = checkCommandAvailability("docker", ["--version"]);
  const psqlStatus = checkCommandAvailability("psql", ["--version"]);

  console.log("Проверка локальной базы данных");
  console.log(`- .env: OK (${envPath})`);
  console.log(`- DATABASE_URL: ${maskDatabaseUrl(databaseUrl)}`);
  console.log(
    `- Цель подключения: ${parsedUrl.hostname}:${parsedUrl.port || "5432"} / ${parsedUrl.pathname.replace(/^\//u, "")}`,
  );
  console.log(`- docker: ${dockerStatus.available ? "доступен" : "не найден"}`);
  console.log(`- psql: ${psqlStatus.available ? "доступен" : "не найден"}`);

  const prisma = new PrismaClient();

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("- Prisma runtime-check: OK");
  } catch (error) {
    const normalizedError = error;
    const message = normalizedError instanceof Error ? normalizedError.message : String(normalizedError);

    console.log("- Prisma runtime-check: FAIL");
    console.log(`- Причина: ${message}`);

    if (!dockerStatus.available && !psqlStatus.available) {
      console.log(
        "- Подсказка: в текущем окружении не найден ни docker, ни psql. Сначала нужно установить и запустить PostgreSQL локально.",
      );
    } else {
      console.log(
        "- Подсказка: проверь, что PostgreSQL действительно запущен и принимает подключения по DATABASE_URL.",
      );
    }

    process.exitCode = 1;
    return;
  } finally {
    await prisma.$disconnect();
  }

  console.log("- Итог: локальная БД доступна, Prisma подключается успешно.");
}

await main();
