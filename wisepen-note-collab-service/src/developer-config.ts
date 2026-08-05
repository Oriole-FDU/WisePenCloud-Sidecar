import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

function parseProperties(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.search(/[=:]/);
    if (separator < 0) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function readDeveloperFromEnvironment(): string | undefined | null {
  const enableValue = process.env.DEVELOPER_ENABLE;
  const nameValue = process.env.DEVELOPER_NAME;
  if (enableValue === undefined && nameValue === undefined) return null;
  const enabled = enableValue?.trim().toLowerCase() === 'true';
  const developer = nameValue?.trim();
  return enabled && developer ? developer : undefined;
}

function readDeveloperFromFile(): string | undefined {
  const filePath = path.join(process.cwd(), 'dev.properties');
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const properties = parseProperties(fs.readFileSync(filePath, 'utf8'));
    const enabled = properties['wisepen.developer.enable']?.toLowerCase() === 'true';
    const developer = properties['wisepen.developer.name']?.trim();
    return enabled && developer ? developer : undefined;
  } catch (error) {
    console.error(`[DevelopmentTraffic] 读取开发者配置失败: ${filePath}`, error);
    return undefined;
  }
}

const environmentDeveloper = readDeveloperFromEnvironment();
export const processDeveloper =
  environmentDeveloper === null ? readDeveloperFromFile() : environmentDeveloper;
