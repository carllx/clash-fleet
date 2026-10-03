import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 计算给定文件路径的 SHA-256 十六进制哈希
 *
 * @param {string} filePath 文件绝对路径
 * @returns {string} 64 位十六进制哈希
 */
export function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * 创建与目标文件 byte-identical 的基线备份文件 (Script.js.bak)
 *
 * 遵循严格 Fail-Closed 原则：
 * 1. 目标文件必须预先存在 (normal update path)；若不存在抛出异常阻断。
 * 2. 备份写入后重新计算其 SHA-256，必须与目标文件 pre-deploy 哈希完全一致。
 * 3. 校验失败或发生写入异常时立即清理残余备份并抛错阻断，绝不进入替换流程。
 *
 * @param {string} targetPath 目标脚本路径 (如 profiles/Script.js)
 * @returns {{ backupPath: string, sha256: string }} 验证成功的备份文件路径与哈希
 */
export function createByteIdenticalBackup(targetPath) {
  const resolvedTarget = path.resolve(targetPath);

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target script not found for backup: ${resolvedTarget}`);
  }

  const stat = fs.statSync(resolvedTarget);
  if (!stat.isFile()) {
    throw new Error(`Target path is not a regular file: ${resolvedTarget}`);
  }

  const originalHash = computeFileSha256(resolvedTarget);
  const backupPath = `${resolvedTarget}.bak`;

  try {
    // 拷贝并强制落盘
    fs.copyFileSync(resolvedTarget, backupPath);

    // 重新读取并验证哈希严格相等
    const backupHash = computeFileSha256(backupPath);
    if (backupHash !== originalHash) {
      throw new Error(
        `Backup verification mismatch: original=${originalHash}, backup=${backupHash}`
      );
    }

    return {
      backupPath,
      sha256: backupHash,
    };
  } catch (err) {
    // 发生失败时清理可能残留的损坏备份，并 Fail-Closed
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch {
      // 忽略清理异常
    }
    throw new Error(`Failed to create byte-identical backup: ${err.message}`);
  }
}

/**
 * 跨平台同目录原子替换文件 (Atomic Replace Primitive)
 *
 * 原理与保证：
 * 1. 临时文件必须在与目标文件相同的目录 (同一文件系统) 下创建，避免跨分区 EXDEV 限制。
 * 2. 写入 candidate 字节到临时文件后，使用跨平台 fs.renameSync 执行原子覆盖。
 * 3. 若发生异常（权限、锁冲突等），清理临时文件并 Fail-Closed，确保原目标未被损坏。
 *
 * @param {string} targetPath 目标文件路径
 * @param {string} candidateFilePath 已经完全通过全部门禁验证的候选文件路径
 * @returns {{ replaced: boolean, targetPath: string, sha256: string }}
 */
export function atomicReplaceFile(targetPath, candidateFilePath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedCandidate = path.resolve(candidateFilePath);

  if (!fs.existsSync(resolvedCandidate)) {
    throw new Error(`Candidate file not found for replacement: ${resolvedCandidate}`);
  }

  const targetDir = path.dirname(resolvedTarget);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }

  const candidateHash = computeFileSha256(resolvedCandidate);
  const tempStagingName = `.${path.basename(resolvedTarget)}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  const tempStagingPath = path.join(targetDir, tempStagingName);

  try {
    // 在同目录下拷贝生成候选暂存文件
    fs.copyFileSync(resolvedCandidate, tempStagingPath);

    // 执行跨平台原子重命名覆盖
    fs.renameSync(tempStagingPath, resolvedTarget);

    return {
      replaced: true,
      targetPath: resolvedTarget,
      sha256: candidateHash,
    };
  } catch (err) {
    try {
      if (fs.existsSync(tempStagingPath)) {
        fs.unlinkSync(tempStagingPath);
      }
    } catch {
      // 忽略清理异常
    }
    throw new Error(`Atomic replacement failed for "${resolvedTarget}": ${err.message}`);
  }
}
