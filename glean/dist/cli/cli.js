#!/usr/bin/env node
import * as exec from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { argv, platform } from "process";
import { promisify } from "util";
import log, { LoggingLevel } from "./core/log.js";
const LOG_TAG = "CLI";
const VIRTUAL_ENVIRONMENT_DIR = process.env.VIRTUAL_ENV || path.join(process.cwd(), ".venv");
const GLEAN_PARSER_VERSION = "8.1";
const PYTHON_SCRIPT = `
import importlib
import subprocess
import sys
offline = sys.argv[1] == 'offline'
module_name = sys.argv[2]
expected_version = sys.argv[3]
try:
    module = importlib.import_module(module_name)
except ImportError:
    found_version = None
else:
    found_version = getattr(module, '__version__')

if not offline:
    # When running in online mode, we always install.
    # If it is installed this is essentially a no-op,
    # otherwise it installs/upgrades.
    if 'git' in expected_version:
        target=expected_version
    else:
        target=f'{module_name}~={expected_version}'

    subprocess.check_call([
        sys.executable,
        '-m',
        'pip',
        'install',
        '--upgrade',
        target
    ])
else:
    error_text = f'''
    Using Python environment at {sys.executable},
    expected glean_parser version ~={expected_version}, found {found_version}.
    '''

    if found_version is None:
        print(error_text)
        sys.exit(1)
    else:
        # We check MAJOR.MINOR only
        expected_ver = expected_version.split('.')
        expected_maj, expected_min = int(expected_ver[0]), int(expected_ver[1])
        current_ver = found_version.split('.')
        current_maj, current_min = int(current_ver[0]), int(current_ver[1])

        if current_maj > expected_maj or current_maj < expected_maj or (current_maj == expected_maj and current_min < expected_min):
            print(error_text)
            sys.exit(1)
try:
    subprocess.check_call([
        sys.executable,
        '-m',
        module_name
    ] + sys.argv[4:])
except:
    # We don't need to show a traceback in this helper script.
    # Only the output of the subprocess is interesting.
    sys.exit(1)
`;
function getSystemPythonBinName() {
    return (platform === "win32") ? "python.exe" : "python3";
}
function getPipBinName() {
    return (platform === "win32") ? "pip3.exe" : "pip3";
}
function getPythonVenvBinariesPath(venvRoot) {
    if (platform === "win32") {
        return path.join(venvRoot, "Scripts");
    }
    return path.join(venvRoot, "bin");
}
async function checkPythonVenvExists(venvPath) {
    var _a;
    log(LOG_TAG, `Checking for a virtual environment at ${venvPath}`);
    const pythonBinary = (_a = process.env.GLEAN_PYTHON) !== null && _a !== void 0 ? _a : getSystemPythonBinName();
    const venvPython = path.join(getPythonVenvBinariesPath(venvPath), pythonBinary);
    const access = promisify(fs.access);
    try {
        await access(venvPath, fs.constants.F_OK);
        await access(venvPython, fs.constants.F_OK);
        return true;
    }
    catch (e) {
        return false;
    }
}
async function createPythonVenv(venvPath) {
    var _a, _b;
    log(LOG_TAG, `Creating a virtual environment at ${venvPath}`);
    const pipFilename = (_a = process.env.GLEAN_PIP) !== null && _a !== void 0 ? _a : getPipBinName();
    const venvPip = path.join(getPythonVenvBinariesPath(VIRTUAL_ENVIRONMENT_DIR), pipFilename);
    const pipCmd = `${venvPip} install wheel`;
    const pythonBinary = (_b = process.env.GLEAN_PYTHON) !== null && _b !== void 0 ? _b : getSystemPythonBinName();
    const venvCmd = `${pythonBinary} -m venv ${VIRTUAL_ENVIRONMENT_DIR}`;
    for (const cmd of [venvCmd, pipCmd]) {
        const spinner = getStartedSpinner();
        const { err, stdout, stderr } = await new Promise(resolve => {
            exec.exec(cmd, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
        });
        stopSpinner(spinner);
        log(LOG_TAG, `${stdout}`);
        if (err) {
            log(LOG_TAG, `${stderr}`);
            return false;
        }
    }
    return true;
}
async function setup() {
    const venvExists = await checkPythonVenvExists(VIRTUAL_ENVIRONMENT_DIR);
    if (venvExists) {
        log(LOG_TAG, `Using virtual environment at ${VIRTUAL_ENVIRONMENT_DIR}`);
    }
    else if (!await createPythonVenv(VIRTUAL_ENVIRONMENT_DIR)) {
        log(LOG_TAG, `Failed to create a virtual environment at ${VIRTUAL_ENVIRONMENT_DIR}`);
        process.exit(1);
    }
}
async function runGlean(parserArgs) {
    var _a;
    const spinner = getStartedSpinner();
    const pythonBinary = (_a = process.env.GLEAN_PYTHON) !== null && _a !== void 0 ? _a : getSystemPythonBinName();
    const pythonBin = path.join(getPythonVenvBinariesPath(VIRTUAL_ENVIRONMENT_DIR), pythonBinary);
    const isOnlineArg = process.env.OFFLINE ? "offline" : "online";
    let tmpDir = "";
    const appPrefix = "glean.js";
    const scriptName = "script.py";
    const tempDirectory = os.tmpdir();
    try {
        tmpDir = fs.mkdtempSync(path.join(tempDirectory, appPrefix));
        fs.writeFileSync(path.join(tmpDir, scriptName), PYTHON_SCRIPT);
    }
    catch (error) {
        log(LOG_TAG, ["Unable to write utility script to tmp directory.\n", error], LoggingLevel.Error);
        process.exit(1);
    }
    const cmd = `${pythonBin} ${tmpDir}/${scriptName} ${isOnlineArg} glean_parser ${GLEAN_PARSER_VERSION} ${parserArgs.join(" ")}`;
    const { err, stdout, stderr } = await new Promise(resolve => {
        exec.exec(cmd, (err, stdout, stderr) => {
            resolve({ err, stdout, stderr });
            fs.rmSync(tmpDir, { recursive: true });
        });
    });
    stopSpinner(spinner);
    log(LOG_TAG, `${stdout}`);
    if (err) {
        log(LOG_TAG, `${stderr}`);
        process.exit(1);
    }
}
function getStartedSpinner() {
    const ticks = ["\\", "|", "/", "-"];
    let i = 0;
    return setInterval(function () {
        process.stdout.write(" " + ticks[i++] + "\r\r");
        i %= 4;
    }, 250);
}
function stopSpinner(spinner) {
    process.stdout.write("  \r");
    clearInterval(spinner);
}
async function run(args) {
    if (args.includes("--glean-parser-version")) {
        console.log(GLEAN_PARSER_VERSION);
        process.exit(1);
    }
    try {
        await setup();
    }
    catch (err) {
        log(LOG_TAG, ["Failed to setup the Glean build environment.\n", err], LoggingLevel.Error);
        process.exit(1);
    }
    await runGlean(args.slice(2));
}
run(argv).catch(e => {
    log(LOG_TAG, ["There was an error running Glean.\n", e], LoggingLevel.Error);
    process.exit(1);
});
