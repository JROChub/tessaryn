import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const distDirectory = resolve(appDirectory, process.env.TESSARYN_DIST_DIRECTORY || "dist");

async function createRoute(sourceFile, routeDirectory) {
  const sourcePath = join(distDirectory, sourceFile);
  const targetDirectory = join(distDirectory, routeDirectory);
  const targetPath = join(targetDirectory, "index.html");
  const source = await readFile(sourcePath, "utf8");
  const nested = source
    .replaceAll('href="./', 'href="../')
    .replaceAll('src="./', 'src="../');
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetPath, nested, "utf8");
  console.log(`created extensionless route /${routeDirectory} from ${sourceFile}`);
}

await createRoute("world-cell-theater.html", "world-cell-theater");
