/**
 * Checkpoint 管理器：工作区快照的创建、列出、回滚。
 * 存储结构：
 *   <cwd>/.aicowork/checkpoints/<cpId>/
 *     meta.json    {id, createdAt, label, fileCount}
 *     data/        cwd 的完整快照（排除 .aicowork/ 自身）
 */
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CheckpointInfo } from "@ai-cowork/shared";

const CP_DIR = ".aicowork/checkpoints";
/**
 * 回滚时排除的目录/文件：
 * - `.aicowork`：快照存储自身，必须保留
 * - `node_modules`：依赖目录，删除后要重装几分钟，不该被回滚清掉
 * - `.git`：版本历史，删了等于丢历史，绝不能动
 * - `dist`/`build`/`.next`/`.cache`：构建产物，删了要重新构建
 *
 * 注意：创建快照时仍然完整拷贝这些目录（保证回滚后状态一致），
 * 仅在「回滚清空 cwd」这一步跳过它们，避免误删重资源。
 */
const EXCLUDE_ON_ROLLBACK = new Set([".aicowork", "node_modules", ".git", "dist", "build", ".next", ".cache"]);
/** 创建快照时排除的目录：避免把 node_modules 等重目录也拷进快照（体积大、且与回滚无关） */
const EXCLUDE_ON_SNAPSHOT = new Set([".aicowork", "node_modules", ".git", "dist", "build", ".next", ".cache"]);

function cpRoot(cwd: string) { return join(cwd, CP_DIR); }
function cpDir(cwd: string, id: string) { return join(cpRoot(cwd), id); }
function dataDir(cwd: string, id: string) { return join(cpDir(cwd, id), "data"); }
function metaPath(cwd: string, id: string) { return join(cpDir(cwd, id), "meta.json"); }

/** 创建 checkpoint。返回 CheckpointInfo（已落盘） */
export async function createCheckpoint(cwd: string, label?: string): Promise<CheckpointInfo> {
  const id = randomUUID();
  const target = dataDir(cwd, id);
  const meta = { id, createdAt: Date.now(), label } satisfies Omit<CheckpointInfo, "fileCount">;
  await mkdir(target, { recursive: true });
  let fileCount = 0;
  const entries = await readdir(cwd, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_ON_SNAPSHOT.has(e.name.toString())) continue;
    fileCount += await copyRecursive(join(cwd, e.name.toString()), join(target, e.name.toString()));
  }
  const info: CheckpointInfo = { ...meta, fileCount };
  await writeFile(metaPath(cwd, id), JSON.stringify(info, null, 2), "utf-8");
  return info;
}

/** 列出所有 checkpoint（按时间倒序） */
export async function listCheckpoints(cwd: string): Promise<CheckpointInfo[]> {
  const root = cpRoot(cwd);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const infos: CheckpointInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const id = e.name.toString();
    try {
      const raw = await readFile(metaPath(cwd, id), "utf-8");
      const info = JSON.parse(raw) as CheckpointInfo;
      infos.push(info);
    } catch {
      // 损坏的跳过
    }
  }
  return infos.sort((a, b) => b.createdAt - a.createdAt);
}

/** 回滚：清空 cwd 用户内容（保留 .aicowork / node_modules / .git 等关键目录），从 checkpoint 还原 */
export async function rollbackCheckpoint(cwd: string, checkpointId: string): Promise<void> {
  const src = dataDir(cwd, checkpointId);
  // 确认存在
  await stat(src); // 不存在抛错
  // 清 cwd 用户内容，但跳过 node_modules / .git / dist 等关键目录（见 EXCLUDE_ON_ROLLBACK 说明）
  const entries = await readdir(cwd, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_ON_ROLLBACK.has(e.name.toString())) continue;
    await rm(join(cwd, e.name.toString()), { recursive: true, force: true });
  }
  // 还原快照内容（快照本身已不含 node_modules 等，所以只还原用户文件）
  const files = await readdir(src, { withFileTypes: true });
  for (const e of files) {
    await copyRecursive(join(src, e.name.toString()), join(cwd, e.name.toString()));
  }
}

/** 递归拷贝目录。返回拷贝的文件数量（仅文件，不含目录） */
async function copyRecursive(src: string, dest: string): Promise<number> {
  let count = 0;
  const info = await stat(src);
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const name = e.name.toString();
      count += await copyRecursive(join(src, name), join(dest, name));
    }
  } else {
    await mkdir(resolve(dest, ".."), { recursive: true });
    await copyFile(src, dest);
    count = 1;
  }
  return count;
}
