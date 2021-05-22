import * as vscode from 'vscode';
import * as path from 'path';
import { mizar_verify, mizfiles } from './mizarFunctions';
import { makeQueryFunction } from './mizarMessages';
import { displayErrorLinks } from './displayErrors';
import { DefinitionProvider} from './goToDefinition';
import { HoverProvider } from './hover';
import * as cp from 'child_process';

export const queryMizarMsg = makeQueryFunction();
let timer: NodeJS.Timer;

/**
 * @fn
 * コマンドを実行する関数を返す関数
 * @param (channel) 結果を出力するチャンネル
 * @param (diagnostics) 診断情報を詰め込むためのリスト
 * @param (diagnosticCollection) 
 * diagnosticsをセットするための引数、セットにより問題パネルへ表示される
 * @param (command) 実行するコマンドの名前
 * @param (isVerify2) 
 * verify2が実行されたかどうかを受け取る
 * この引数でerrflagを実行するかどうかを決定する
 * @return コマンドを実行する処理の関数
 */
function returnExecutingFunction(
    channel:vscode.OutputChannel, 
    runningCmd: {process: cp.ChildProcess | null},
    diagnosticCollection:vscode.DiagnosticCollection, 
    command:string,
    isVerify2:boolean=false
)
{
    return async () => {
        // アクティブなエディタがなければエラーを示して終了
        if (vscode.window.activeTextEditor === undefined){
            vscode.window.showErrorMessage('Not currently in .miz file!!');
            return;
        }
        // アクティブなファイルのパスを取得
        let uri = vscode.window.activeTextEditor.document.uri;
        let fileName =vscode.window.activeTextEditor.document.fileName;
        // 拡張子を確認し、mizarファイルでなければエラーを示して終了
        if (path.extname(fileName) !== '.miz'){
            vscode.window.showErrorMessage('Not currently in .miz file!!');
            return;
        }
        // 環境変数MIZFILESが未定義ならエラーメッセージを表示
        if (mizfiles === undefined){
            vscode.window.showErrorMessage('You have to set environment variable "MIZFILES"');
            return;
        }
        // 既に実行中のコマンドがある場合
        if (runningCmd['process']){
            return;
        }
        channel.clear();
        channel.show(true);
        diagnosticCollection.clear();
        // makeenvとverifierの実行
        let result = null;
        let prevCwd = process.cwd();
        try {
            // dict,prelを読み込むため、カレントディレクトリを対象ファイルの1つ上へ変更
            process.chdir(path.join( path.dirname(fileName), '..') );
            result = await mizar_verify(channel, fileName, command, runningCmd);
        } finally {
            process.chdir(prevCwd);
        }
        // mizar-verify2の場合はerrflagを実行する
        if(isVerify2){
            // errflagの実行
            let errFlag = path.join(String(mizfiles), "errflag");
            cp.spawn(errFlag, [fileName]);
            return;
        }
        // makeenv,verifierの結果でエラーがあれば、エラー表示関数を呼び出す処理
        switch(result){
            case "success": break;
            case "makeenv error":
            case "command error":
                displayErrorLinks(
                    channel,fileName,uri,diagnosticCollection
                );
        }
    };
}

interface StrStrDictionary {
    [key: string]: string;
}

const MIZAR_COMMANDS:StrStrDictionary = {
    "mizar-verify":"verifier",
    "mizar-verify2":"verifier",
    "mizar-irrths":"irrths",
    "mizar-relinfer":"relinfer",
    "mizar-trivdemo":"trivdemo",
    "mizar-reliters":"reliters",
    "mizar-relprem":"relprem",
    "mizar-irrvoc":"irrvoc",
    "mizar-inacc":"inacc",
    "mizar-chklab":"chklab"
};

// FIXME:グローバルで良いのか？
let diagnosticCollection = 
        vscode.languages.createDiagnosticCollection('mizar');

export function activate(context: vscode.ExtensionContext) {
    // verifierの実行結果を出力するチャンネル
    let channel = vscode.window.createOutputChannel('output');
    let runningCmd: {process: cp.ChildProcess | null} = {process: null};
    // let diagnosticCollection = 
    //     vscode.languages.createDiagnosticCollection('mizar');
    channel.show(true);

    loadConfigure();

    // Mizarコマンドの登録
    for (let cmd in MIZAR_COMMANDS){
        context.subscriptions.push(
            vscode.commands.registerCommand(
                cmd,
                returnExecutingFunction(
                    channel, runningCmd, diagnosticCollection, MIZAR_COMMANDS[cmd],
                )
            )
        );
    }

    let hover = new HoverProvider();
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            {scheme: 'file', language: 'Mizar'}, hover
        )
    );

    let definition = new DefinitionProvider();
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            {scheme:'file', language:'Mizar'}, definition
        )
    );

    // Mizarコマンドを停止する処理
    let stopCommand = vscode.commands.registerCommand(
        'stop-command',
        () => {
            if (runningCmd['process'] === null){
                return;
            }
            runningCmd['process'].kill('SIGINT');
            vscode.window.showInformationMessage('Command stopped!');
        }
    );
    context.subscriptions.push(stopCommand);
}

// this method is called when your extension is deactivated
export function deactivate() {}


function loadConfigure(){
    // NOTE:vscodeが連続保存の処理を中断しているから上手くいっている？
    vscode.workspace.onDidSaveTextDocument((() => startLint()));
}

function startLint(){
    timer = global.setTimeout(Lint, 1000); 
}

// cpplint-extensionを真似たが，不要かも
function doLint(){
    if (vscode.window.activeTextEditor) {
        Lint();
    }
}

function Lint(){
    if (vscode.window.activeTextEditor === undefined) {
        return;
    }
    let activedoc = vscode.window.activeTextEditor.document;
    let mizarLintOutput;
    mizarLintOutput = runOnFile();
    // vscode.window.showInformationMessage('called!');
    analysisResult(mizarLintOutput, activedoc);
}

function analysisResult(output: string, doc: vscode.TextDocument){
    let prevDiagnostics = vscode.languages.getDiagnostics(doc.uri);
    let diagnostics: vscode.Diagnostic[] = [];
    // verifierが検出したエラーは保持しておく
    for (let diagnostic of prevDiagnostics){
        if (diagnostic.severity === 0){
            diagnostics.push(diagnostic);
        }
    }
    diagnosticCollection.clear();
    // 1 = path, 2 = line, 3 = severity, 4 = message
    let regex = /^(.*):([0-9]+):\s*(\w+):(.*\s+\[.*\])\s+\[([0-9]+)\]/gm;
    let regexArray: RegExpExecArray | null;
    
    // Mizar lintが検出したエラーをProblemsへ反映
    while (regexArray = regex.exec(output)){
        if (regexArray[1] === undefined || regexArray[2] === undefined
            || regexArray[3] === undefined || regexArray[4] === undefined
            || regexArray[5] === undefined) {
            continue;
        }
        let errorLineNum = Number(regexArray[2])-1;
        let errorLine = doc.lineAt(errorLineNum);
        let errorMsg = regexArray[4];
        let pos1 = new vscode.Position(Number(errorLineNum), 0);
        let pos2 = new vscode.Position(Number(errorLineNum), errorLine.text.length);
        let range = new vscode.Range(pos1, pos2);
        let d = new vscode.Diagnostic(range, errorMsg, 1);
        diagnostics.push(d);
    }
    diagnosticCollection.set(doc.uri, diagnostics);

}

function runOnFile(){
    if (vscode.window.activeTextEditor === undefined) {
        return "";
    }

    let activeDoc = vscode.window.activeTextEditor.document;
    let filename = activeDoc.fileName;
    let workspacefolder = vscode.workspace.getWorkspaceFolder(activeDoc.uri);

    let workspaces = null;
    if (workspacefolder !== undefined) {
        workspaces = [workspacefolder.uri.fsPath];
    }

    let result = runMizarLint(filename, false);
    return result;

}

function runMizarLint(fileName: string, enableworkspace: boolean){
    let exec = 'python';
    // FIXME:仮の記述
    let lintPath = path.join(__dirname, '..\\lint\\test.py');
    let params = [lintPath, fileName];
    let result = lint(exec, params);
    let msgLength = result[0].length + result[1].length;
    return result.join('\n').slice(1, msgLength);
}

function lint(exec: string, params: string[]){
    let result = cp.spawnSync(exec, params);
    let stdout = result.stdout;
    let stderr = result.stderr;
    let out = [stdout, stderr];
    return out;
}
