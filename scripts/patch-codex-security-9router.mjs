// Vá cấu hình @openai/codex-security (công cụ quét bảo mật, CHỈ dùng khi lập trình) cho 9router.
// Chạy tự động qua `postinstall`.
//
// ⚠️ Gói này nằm ở devDependencies → BẢN CÀI PRODUCTION (`npm ci --omit=dev` trong Dockerfile)
// KHÔNG có nó, nhưng npm VẪN chạy postinstall. Vì vậy thiếu gói thì phải im lặng thoát 0,
// nếu ném lỗi là gãy nguyên lượt build Docker (app không deploy được).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ⚠️ TUYỆT ĐỐI KHÔNG ĐƯỢC LÀM GÃY `npm ci`.
//
// Đây là script TIỆN ÍCH cho môi trường lập trình, chạy qua `postinstall` nên nó nằm chắn ngang MỌI
// lượt cài đặt: Docker build, CI, và container test trên VM dev. Ngày 2026-08-11 nó ném lỗi ở dòng
// "Could not configure UTF-8 and the Codex CLI path…" trên node:22-alpine → `npm ci` exit 1 →
// `test-on-dev.sh` chết câm (script đó nuốt output bằng `>/dev/null 2>&1`) và CI Linux cũng sẽ chết
// y hệt. Một công cụ quét bảo mật CHỈ dùng lúc code không đáng để chặn đường triển khai.
//
// Hai lớp bảo vệ:
//   1. Bỏ qua trên hệ điều hành không phải Windows — toàn bộ bản vá là để xử lý chuyện của Windows
//      (spawn `codex.cmd`, đường dẫn runtime Windows, chính sách chặn shell sandbox).
//   2. Mọi lỗi ngoài dự kiến → CẢNH BÁO rồi thoát 0, không bao giờ exit khác 0.
const softExit = (why) => {
  console.warn(`⚠️  Bỏ qua vá codex-security (không ảnh hưởng ứng dụng): ${why}`);
  process.exit(0);
};
process.on("uncaughtException", (e) => softExit(e?.message || String(e)));
process.on("unhandledRejection", (e) => softExit(e?.message || String(e)));

if (process.platform !== "win32") {
  console.log("Bỏ qua vá codex-security: bản vá chỉ dành cho Windows.");
  process.exit(0);
}

const packageRoot = new URL("../node_modules/@openai/codex-security/", import.meta.url);
if (!existsSync(fileURLToPath(new URL("dist/config.js", packageRoot)))) {
  console.log("Bỏ qua vá codex-security: không có gói (bản cài production / --omit=dev).");
  process.exit(0);
}
const configPath = fileURLToPath(
  new URL("dist/config.js", packageRoot),
);
const runtimePath = fileURLToPath(new URL("dist/runtime.js", packageRoot));
const apiPath = fileURLToPath(new URL("dist/api.js", packageRoot));
const codexSdkPath = fileURLToPath(
  new URL("../codex-sdk/dist/index.js", packageRoot),
);
const workbenchTargetPath = fileURLToPath(
  new URL("_bundled_plugin/scripts/workbench_target.py", packageRoot),
);
const rankInputPath = fileURLToPath(
  new URL("_bundled_plugin/scripts/generate_rank_input.py", packageRoot),
);
const targetModel = "cx/gpt-5.6-sol";
const targetReasoningEffort = "xhigh";
const targetContextWindow = 272000;
const targetAutoCompactLimit = 240000;
const routerName = "9router";
const routerBaseUrl = "http://127.0.0.1:20128/v1";

const source = await readFile(configPath, "utf8");
const defaultConfigPattern = /export const DEFAULT_CODEX_CONFIG = \{[\s\S]*?\n\};/;
const match = source.match(defaultConfigPattern);

if (!match) {
  throw new Error(`Could not locate DEFAULT_CODEX_CONFIG in ${configPath}`);
}

let patchedDefault = match[0]
  .replace(/model:\s*"[^"]+"/, `model: "${targetModel}"`)
  .replace(
    /model_reasoning_effort:\s*"[^"]+"/,
    `model_reasoning_effort: "${targetReasoningEffort}"`,
  );

if (!patchedDefault.includes(`model_context_window: ${targetContextWindow}`)) {
  patchedDefault = patchedDefault.replace(
    `model_reasoning_effort: "${targetReasoningEffort}",`,
    [
      `model_reasoning_effort: "${targetReasoningEffort}",`,
      `    model_context_window: ${targetContextWindow},`,
      `    model_auto_compact_token_limit: ${targetAutoCompactLimit},`,
      '    model_auto_compact_token_limit_scope: "total",',
    ].join("\n"),
  );
}

if (!patchedDefault.includes(`model_provider: "${routerName}"`)) {
  patchedDefault = patchedDefault.replace(
    `model_reasoning_effort: "${targetReasoningEffort}",`,
    [
      `model_reasoning_effort: "${targetReasoningEffort}",`,
      `    model_provider: "${routerName}",`,
      "    model_providers: {",
      `        "${routerName}": {`,
      '            name: "9Router",',
      `            base_url: "${routerBaseUrl}",`,
      '            wire_api: "responses",',
      "        },",
      "    },",
    ].join("\n"),
  );
}

if (!patchedDefault.includes(`model: "${targetModel}"`)) {
  throw new Error("Could not set the Codex Security model for 9router.");
}
if (
  !patchedDefault.includes(
    `model_reasoning_effort: "${targetReasoningEffort}"`,
  )
) {
  throw new Error("Could not set the Codex Security reasoning effort.");
}
if (
  !patchedDefault.includes(`model_context_window: ${targetContextWindow}`) ||
  !patchedDefault.includes(
    `model_auto_compact_token_limit: ${targetAutoCompactLimit}`,
  )
) {
  throw new Error("Could not set Codex Security model context limits.");
}
if (
  !patchedDefault.includes(`model_provider: "${routerName}"`) ||
  !patchedDefault.includes(`base_url: "${routerBaseUrl}"`) ||
  !patchedDefault.includes('wire_api: "responses"')
) {
  throw new Error("Could not configure the Codex Security 9router provider.");
}

const patched = source.replace(defaultConfigPattern, patchedDefault);
if (patched !== source) {
  await writeFile(configPath, patched, "utf8");
}

const runtimeSource = await readFile(runtimePath, "utf8");
// The deep-scan MCP server resolves the CLI with `env.CODEX_CLI_PATH || "codex"`.
// On Windows the bare name is codex.cmd, which child_process.spawn cannot execute,
// so deep discovery dies with `spawn codex ENOENT`. Hand it the vendored codex.exe.
const pythonEnvironmentLegacy =
  "return { ...environment, PYTHON: python };";
const pythonEnvironmentUtf8 =
  'return { ...environment, PYTHON: python, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };';
const pythonEnvironment =
  'return { ...environment, PYTHON: python, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", CODEX_CLI_PATH: environment.CODEX_CLI_PATH ?? resolveCodexCommand().command };';
let patchedRuntime = runtimeSource;
if (!patchedRuntime.includes(pythonEnvironment)) {
  patchedRuntime = patchedRuntime
    .replace(pythonEnvironmentUtf8, pythonEnvironment)
    .replace(pythonEnvironmentLegacy, pythonEnvironment);
}

if (!patchedRuntime.includes(pythonEnvironment)) {
  throw new Error("Could not configure UTF-8 and the Codex CLI path for the Codex Security runtime.");
}
if (patchedRuntime !== runtimeSource) {
  await writeFile(runtimePath, patchedRuntime, "utf8");
}

const sdkSource = await readFile(codexSdkPath, "utf8");
const sdkSpawnWithWorkingDirectory = [
  "const child = spawn(this.executablePath, commandArgs, {",
  "      cwd: args.workingDirectory,",
  "      env,",
].join("\n");
const patchedSdk = sdkSource.includes(sdkSpawnWithWorkingDirectory)
  ? sdkSource
  : sdkSource.replace(
      [
        "const child = spawn(this.executablePath, commandArgs, {",
        "      env,",
      ].join("\n"),
      sdkSpawnWithWorkingDirectory,
    );

if (!patchedSdk.includes(sdkSpawnWithWorkingDirectory)) {
  throw new Error("Could not align the Codex SDK process cwd with the scan directory.");
}
if (patchedSdk !== sdkSource) {
  await writeFile(codexSdkPath, patchedSdk, "utf8");
}

const apiSource = await readFile(apiPath, "utf8");
let patchedApi = apiSource.replace(
  "            const prompt = await scanPrompt(shellPluginRoot, normalized, mode, runtime.configPath !== undefined, knowledgeBase !== null);\n",
  "",
);

const legacyPythonLauncherState = [
  '        let targetPathsFile = null;',
  '        let pythonLauncher = null;',
].join("\n");
patchedApi = patchedApi.replace(
  legacyPythonLauncherState,
  '        let targetPathsFile = null;',
);

const legacyEarlyPythonLauncher = [
  '            notifyObserver("onOutputDirReady", options.onOutputDirReady, options.onObserverError, scanDir);',
  '            checkOpen();',
  '            pythonLauncher = await createLocalPythonLauncher(scanDir, python, signal);',
  '            checkOpen();',
  '            const shellPluginRoot = runtime.plugin.pluginRoot;',
].join("\n");
const shellPluginRootAfterOutput = [
  '            notifyObserver("onOutputDirReady", options.onOutputDirReady, options.onObserverError, scanDir);',
  '            checkOpen();',
  '            const shellPluginRoot = runtime.plugin.pluginRoot;',
].join("\n");
patchedApi = patchedApi.replace(
  legacyEarlyPythonLauncher,
  shellPluginRootAfterOutput,
);

const legacyPythonLauncherAfterRegistration = [
  '            activeScan = { id: scanId, options: workbenchOptions };',
  '            checkOpen();',
  '            pythonLauncher = await createLocalPythonLauncher(scanDir, python, signal);',
  '            checkOpen();',
  '            targetPathsFile =',
].join("\n");
const targetPathsAfterRegistration = [
  '            activeScan = { id: scanId, options: workbenchOptions };',
  '            checkOpen();',
  '            targetPathsFile =',
].join("\n");
patchedApi = patchedApi.replace(
  legacyPythonLauncherAfterRegistration,
  targetPathsAfterRegistration,
);

patchedApi = patchedApi.replace(
  '                PYTHON: pythonLauncher,',
  '                PYTHON: python,',
);

const legacyRemovePythonLauncherBeforeFinalize = [
  '                onFinalize: async (usage) => {',
  '                    await removeLocalPythonLauncher(pythonLauncher);',
  '                    pythonLauncher = null;',
  '                    const snapshot = await tracker.stop(usage);',
].join("\n");
const finalizeWithoutPythonLauncher = [
  '                onFinalize: async (usage) => {',
  '                    const snapshot = await tracker.stop(usage);',
].join("\n");
patchedApi = patchedApi.replace(
  legacyRemovePythonLauncherBeforeFinalize,
  finalizeWithoutPythonLauncher,
);

const legacyRemovePythonLauncherOnExit = [
  '                knowledgeBase?.cleanup(),',
  '                removeTargetPathsFile(targetPathsFile),',
  '                removeLocalPythonLauncher(pythonLauncher),',
].join("\n");
const cleanupWithoutPythonLauncher = [
  '                knowledgeBase?.cleanup(),',
  '                removeTargetPathsFile(targetPathsFile),',
].join("\n");
patchedApi = patchedApi.replace(
  legacyRemovePythonLauncherOnExit,
  cleanupWithoutPythonLauncher,
);

const legacyPythonLauncherHelpers = [
  'async function createLocalPythonLauncher(scanDir, python, signal) {',
  '    const launcherPath = join(scanDir, ".codex-security-python.cmd");',
  '    const launcher = `@echo off\\r\\n"${python}" %*\\r\\nexit /b %errorlevel%\\r\\n`;',
  '    await writeFile(launcherPath, launcher, {',
  '        encoding: "utf8",',
  '        flag: "wx",',
  '        signal,',
  '    });',
  '    return launcherPath;',
  '}',
  'async function removeLocalPythonLauncher(path) {',
  '    if (path !== null)',
  '        await rm(path, { force: true });',
  '}',
  'async function removeTargetPathsFile(path) {',
].join("\n");
patchedApi = patchedApi.replace(
  legacyPythonLauncherHelpers,
  'async function removeTargetPathsFile(path) {',
);

// Windows: the SDK runs each scan in a throwaway CODEX_HOME that has no Windows
// sandbox setup state, so a sandboxed thread cannot spawn a shell at all — Codex
// answers every command with `rejected: blocked by policy` before process creation
// and the scan dies in preflight. Run the scan unsandboxed instead.
const scanSecurityConstants = [
  'const SCAN_PERMISSION_PROFILE = "codex_security_scan";',
  'const SCAN_SANDBOX_MODE = "danger-full-access";',
].join("\n");
patchedApi = patchedApi
  .replace(
    [
      'const SCAN_PERMISSION_PROFILE = "codex_security_scan";',
      'const SCAN_SANDBOX_MODE = "workspace-write";',
    ].join("\n"),
    scanSecurityConstants,
  )
  .replace(
    'const SCAN_SANDBOX_MODE = "workspace-write";',
    scanSecurityConstants,
  )
  .replace(
    '                    default_permissions: SCAN_PERMISSION_PROFILE,\n',
    '',
  );
if (!patchedApi.includes(scanSecurityConstants)) {
  patchedApi = patchedApi.replace(
    'const SCAN_PERMISSION_PROFILE = "codex_security_scan";',
    scanSecurityConstants,
  );
}

// The isolated config.toml must agree with the thread-level sandbox mode; otherwise
// scanRuntimeCodexConfig strips sandbox_mode and any codex path that reads the file
// falls back to a sandboxed default.
patchedApi = patchedApi.replace(
  '    delete hardened["sandbox_mode"];',
  '    hardened["sandbox_mode"] = SCAN_SANDBOX_MODE;',
);

const scanThreadWithSandboxMode = [
  '            const thread = codex.startThread({',
  '                workingDirectory: scanDir,',
  '                skipGitRepoCheck: true,',
  '                sandboxMode: SCAN_SANDBOX_MODE,',
  '                approvalPolicy: "never",',
].join("\n");
if (!patchedApi.includes(scanThreadWithSandboxMode)) {
  patchedApi = patchedApi.replace(
    [
      '            const thread = codex.startThread({',
      '                workingDirectory: scanDir,',
      '                skipGitRepoCheck: true,',
      '                approvalPolicy: "never",',
    ].join("\n"),
    scanThreadWithSandboxMode,
  );
}

const promptBeforeEnvironment = [
  "            const prompt = await scanPrompt(shellPluginRoot, normalized, mode, runtimePaths);",
  "            const environment = {",
].join("\n");
if (!patchedApi.includes(promptBeforeEnvironment)) {
  patchedApi = patchedApi.replace(
    "            const environment = {",
    promptBeforeEnvironment,
  );
}

patchedApi = patchedApi
  .replace(
    "async function scanPrompt(pluginRoot, target, mode, hasConfigPath = false, hasKnowledgeBase = false) {",
    [
      "async function scanPrompt(pluginRoot, target, mode, runtimePaths) {",
      '    const hasConfigPath = typeof runtimePaths.CODEX_SECURITY_CONFIG_PATH === "string";',
      '    const hasKnowledgeBase = typeof runtimePaths.CODEX_SECURITY_KNOWLEDGE_BASE === "string";',
    ].join("\n"),
  )
  .replace(
    '        `Use the installed $codex-security:${skillName} skill at "$CODEX_SECURITY_PLUGIN_ROOT/skills/${skillName}/SKILL.md".`,',
    '        `Use the installed $codex-security:${skillName} skill at "${join(pluginRoot, "skills", skillName, "SKILL.md")}".`,',
  )
  .replace(
    '        \'Use "$PYTHON" as <python_command> for every plugin helper; replace any literal python or python3 helper invocation with this exact interpreter.\',',
    '        `Use this exact resolved Python executable as <python_command> for every plugin helper: "${runtimePaths.PYTHON}".`,',
  )
  .replace(
    '        \'Repository root: "$CODEX_SECURITY_REPOSITORY"\',',
    '        `Repository root: "${runtimePaths.CODEX_SECURITY_REPOSITORY}"`,',
  )
  .replace(
    '        \'Use this exact scan directory for all scan output: "$CODEX_SECURITY_SCAN_DIR"\',',
    '        `Use this exact scan directory for all scan output: "${runtimePaths.CODEX_SECURITY_SCAN_DIR}"`,',
  )
  .replace(
    '        \'Use exactly "$CODEX_SECURITY_SCAN_ID" as the scan ID in the manifest, findings, and coverage.\',',
    '        `Use exactly "${runtimePaths.CODEX_SECURITY_SCAN_ID}" as the scan ID in the manifest, findings, and coverage.`,',
  )
  .replace(
    '        \'Use exactly "$CODEX_SECURITY_TARGET_ID" as scan.target.targetId; do not derive a different target ID.\',',
    '        `Use exactly "${runtimePaths.CODEX_SECURITY_TARGET_ID}" as scan.target.targetId; do not derive a different target ID.`,',
  )
  .replace(
    '        \'Use exactly "$CODEX_SECURITY_TARGET_DISPLAY_NAME" as scan.target.displayName; do not infer a display name from the Git remote.\',',
    '        `Use exactly "${runtimePaths.CODEX_SECURITY_TARGET_DISPLAY_NAME}" as scan.target.displayName; do not infer a display name from the Git remote.`,',
  )
  .replace(
    '                \'For normal config-preflight helper calls, append --config "$CODEX_SECURITY_CONFIG_PATH" so preflight reads the sanitized active runtime config. Preserve the documented runtime and --effective-config arguments for session-only values.\',',
    '                `For normal config-preflight helper calls, append --config "${runtimePaths.CODEX_SECURITY_CONFIG_PATH}" so preflight reads the sanitized active runtime config. Preserve the documented runtime and --effective-config arguments for session-only values.`,',
  )
  .replace(
    '                \'The "$CODEX_SECURITY_KNOWLEDGE_BASE" environment variable contains primary documents about the project and its organization, including their architecture, threat model, and policies. These documents are a source of truth and override conflicting SECURITY.md guidance, generated threat models, and other sources, except explicit user instructions.\',',
    '                `The resolved knowledge-base path "${runtimePaths.CODEX_SECURITY_KNOWLEDGE_BASE}" contains primary documents about the project and its organization, including their architecture, threat model, and policies. These documents are a source of truth and override conflicting SECURITY.md guidance, generated threat models, and other sources, except explicit user instructions.`,',
  )
  .replace(
    '                        \'Include "$CODEX_SECURITY_KNOWLEDGE_BASE" in deep-discovery userContext.\',',
    '                        `Include "${runtimePaths.CODEX_SECURITY_KNOWLEDGE_BASE}" in deep-discovery userContext.`,',
  )
  .replace(
    '        "Runtime paths are environment-backed; keep them quoted in POSIX shells and use the corresponding $env: names in PowerShell. Do not copy or reparse their values.",',
    '        "The Windows command policy blocks environment-variable expressions in shell commands. Do not use $env:CODEX_SECURITY_* or $env:PYTHON; use the resolved absolute values above verbatim.",\n        "The process working directory is the exact scan directory. Create generated scan artifacts with apply_patch paths relative to that directory.",',
  )
  .replace("        targetInstruction(target),", "        targetInstruction(target, runtimePaths),")
  .replace("function targetInstruction(target) {", "function targetInstruction(target, runtimePaths) {")
  .replace(
    '        return \'Scan target paths: generate the combined inventory once with "$PYTHON" "$CODEX_SECURITY_PLUGIN_ROOT/scripts/generate_rank_input.py" make-repo-rank-input --repo "$CODEX_SECURITY_REPOSITORY" --scopes-file "$CODEX_SECURITY_TARGET_PATHS_FILE" --out "$CODEX_SECURITY_SCAN_DIR/artifacts/02_discovery/rank_input.jsonl". Before finalization, preserve every requested scope with "$PYTHON" "$CODEX_SECURITY_PLUGIN_ROOT/scripts/generate_rank_input.py" bind-repo-scopes --scopes-file "$CODEX_SECURITY_TARGET_PATHS_FILE" --manifest "$CODEX_SECURITY_SCAN_DIR/scan-manifest.json" --coverage "$CODEX_SECURITY_SCAN_DIR/coverage.json". Do not print, evaluate, or modify the target-paths file.\';',
    '        return `Scan target paths: generate the combined inventory once with "${runtimePaths.PYTHON}" "${join(runtimePaths.CODEX_SECURITY_PLUGIN_ROOT, "scripts", "generate_rank_input.py")}" make-repo-rank-input --repo "${runtimePaths.CODEX_SECURITY_REPOSITORY}" --scopes-file "${runtimePaths.CODEX_SECURITY_TARGET_PATHS_FILE}" --out "${join(runtimePaths.CODEX_SECURITY_SCAN_DIR, "artifacts", "02_discovery", "rank_input.jsonl")}". Before finalization, preserve every requested scope with "${runtimePaths.PYTHON}" "${join(runtimePaths.CODEX_SECURITY_PLUGIN_ROOT, "scripts", "generate_rank_input.py")}" bind-repo-scopes --scopes-file "${runtimePaths.CODEX_SECURITY_TARGET_PATHS_FILE}" --manifest "${join(runtimePaths.CODEX_SECURITY_SCAN_DIR, "scan-manifest.json")}" --coverage "${join(runtimePaths.CODEX_SECURITY_SCAN_DIR, "coverage.json")}". Do not print, evaluate, or modify the target-paths file.`;',
  );

const canonicalArtifactGuard = [
  "        const missingCanonicalArtifacts = [];",
  '        for (const name of ["scan-manifest.json", "findings.json", "coverage.json"]) {',
  "            try {",
  "                await requireScanFile(options.scanDir, name, name, options.signal);",
  "            }",
  "            catch (error) {",
  "                if (options.signal.aborted)",
  "                    throw options.signal.reason ?? error;",
  "                missingCanonicalArtifacts.push(name);",
  "            }",
  "        }",
  "        if (missingCanonicalArtifacts.length > 0) {",
  "            const diagnosticPath = join(dirname(options.scanDir), `${basename(options.scanDir)}.agent-response.txt`);",
  '            await writeFile(diagnosticPath, finalResponse || "(empty agent response)\\n", "utf8").catch(() => undefined);',
  "            const response = finalResponse.trim().slice(0, 2400);",
  "            throw new IncompleteScanError(`Codex Security agent ended without required artifacts: ${missingCanonicalArtifacts.join(\", \")}. Agent response saved at ${diagnosticPath}.${response ? ` Agent response: ${response}` : \"\"}`);",
  "        }",
  "        if (options.onFinalize !== undefined) {",
].join("\n");
if (!patchedApi.includes(canonicalArtifactGuard)) {
  patchedApi = patchedApi.replace(
    "        if (options.onFinalize !== undefined) {",
    canonicalArtifactGuard,
  );
}

for (const required of [
  shellPluginRootAfterOutput,
  targetPathsAfterRegistration,
  scanSecurityConstants,
  '    hardened["sandbox_mode"] = SCAN_SANDBOX_MODE;',
  scanThreadWithSandboxMode,
  'PYTHON: python,',
  promptBeforeEnvironment,
  "async function scanPrompt(pluginRoot, target, mode, runtimePaths)",
  "The Windows command policy blocks environment-variable expressions",
  "function targetInstruction(target, runtimePaths)",
  "const missingCanonicalArtifacts = [];",
]) {
  if (!patchedApi.includes(required)) {
    throw new Error(`Could not patch Codex Security runtime prompt: ${required}`);
  }
}
if (patchedApi !== apiSource) {
  await writeFile(apiPath, patchedApi, "utf8");
}

const workbenchTargetSource = await readFile(workbenchTargetPath, "utf8");
const workbenchTargetEncoding = [
  "            text=text,",
  '            encoding="utf-8" if text else None,',
  '            errors="replace" if text else None,',
].join("\n");
const patchedWorkbenchTarget = workbenchTargetSource.includes(
  workbenchTargetEncoding,
)
  ? workbenchTargetSource
  : workbenchTargetSource.replace("            text=text,", workbenchTargetEncoding);

if (!patchedWorkbenchTarget.includes(workbenchTargetEncoding)) {
  throw new Error("Could not configure UTF-8 Git output decoding.");
}
if (patchedWorkbenchTarget !== workbenchTargetSource) {
  await writeFile(workbenchTargetPath, patchedWorkbenchTarget, "utf8");
}

const rankInputSource = await readFile(rankInputPath, "utf8");
const rankInputEncoding = [
  "        text=True,",
  '        encoding="utf-8",',
  '        errors="replace",',
].join("\n");
const patchedRankInput = rankInputSource.includes(rankInputEncoding)
  ? rankInputSource
  : rankInputSource.replace("        text=True,", rankInputEncoding);

if (!patchedRankInput.includes(rankInputEncoding)) {
  throw new Error("Could not configure UTF-8 diff output decoding.");
}
if (patchedRankInput !== rankInputSource) {
  await writeFile(rankInputPath, patchedRankInput, "utf8");
}

console.log(
  `Configured Codex Security for 9router: ${targetModel}, ${targetReasoningEffort}, ${targetContextWindow}-token context, unsandboxed scan (Windows policy blocks sandboxed shells), Windows cwd/runtime paths, UTF-8 Git and Python runtime.`,
);
