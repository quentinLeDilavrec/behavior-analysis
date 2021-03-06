import * as vscode from 'vscode';
import { join } from "path";
import { BehaviorStatsProvider } from 'src/ngramsFetcher/behaviorStats';
import { writeFileSync } from 'fs';
import { parseLoc } from "behavior-code-processing";
export type resources_t = { path: string, sl: number, sc: number, pocc: number, tocc: number }[];
export class TreeView {

  constructor(context: vscode.ExtensionContext, private stats: BehaviorStatsProvider) {
    let currentPanel: vscode.WebviewPanel | undefined = undefined;
    let currentResources: resources_t | undefined = undefined;

    function sendResources(resources: resources_t | undefined) {
      // if (resources) { merge_resources(resources); } //merge
      currentResources = resources; // replace
      if (!currentPanel) {
        return;
      }
      // Send a message to our webview.
      // You can send any JSON serializable data.
      if (currentResources) {
        console.log('14523', currentResources);
        const o: { [path: string]: { path: string, sl: number, sc: number, pocc: number, tocc: number }[] } = {};
        currentResources.forEach(x => {
          const curr = o[x.path] || [];
          curr.push(x);
          o[x.path] = curr;
        });
        writeFileSync(join(context.extensionPath, 'Viewers', 'global-behavior-visualization', 'data_params.json'), JSON.stringify(o));
        currentPanel.webview.postMessage(o)
          .then(x => console.log('voyons...', x));
      }
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('BehaviorProvider.showHierarchicalViewer', async (resources: resources_t | undefined | null | Promise<resources_t>) => {
        // TODO get workspace with https://github.com/Microsoft/vscode/wiki/Adopting-Multi-Root-Workspace-APIs#new-helpful-api
        const workspaces = vscode.workspace.workspaceFolders;
        if (!workspaces) {
          throw new Error('no workspaces');
        }
        const root = workspaces.length === 1 ? workspaces[0] : (await vscode.window.showWorkspaceFolderPick()) || workspaces[0];

        if (currentPanel) { // already created
          currentPanel.reveal(vscode.ViewColumn.Two);
          if (resources !== undefined && resources !== null) {
            if ('then' in resources) {
              resources.then(x => sendResources(x));
            } else {
              sendResources(resources);
            }
          }
        } else {
          currentPanel = vscode.window.createWebviewPanel(
            'treeView',
            'tree View',
            vscode.ViewColumn.Two,
            {
              enableScripts: true,
              retainContextWhenHidden: true,
              localResourceRoots: [vscode.Uri.file(join(context.extensionPath, 'Viewers/global-behavior-visualization'))]
            }
          );
          currentPanel.onDidDispose(
            () => {
              currentPanel = undefined;
            },
            undefined,
            context.subscriptions
          );

          const code_resources = {
            tree: {
              script: vscode.Uri.file(join(context.extensionPath, 'Viewers', 'global-behavior-visualization', 'script.js')),
              style: vscode.Uri.file(join(context.extensionPath, 'Viewers', 'global-behavior-visualization', 'style.css')),
              data: vscode.Uri.file(join(context.extensionPath, 'Viewers', 'global-behavior-visualization', 'data.json')),
              d3: vscode.Uri.file(join(context.extensionPath, 'Viewers', 'global-behavior-visualization', 'd3/d3.js'))
              
            }
          };
          currentPanel.webview.html = getWebviewContent(code_resources.tree);
        }
        currentPanel.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'ready': {
                if (resources === undefined) { // default fallback
                  const res = await this.stats.searchingSymbols(root.name);
                  sendResources(res);
                } else if (resources !== null) {
                  const res = await resources;
                  sendResources(res);
                }
                return;
              }
              case 'jump to decl': {
                console.log('jump to ' + message.position);
                if (vscode.workspace.workspaceFolders === undefined) {
                  throw new Error('no workspace');
                }
                if (vscode.workspace.workspaceFolders.length !== 1) {
                  throw new Error("don't handle multi workspace");
                }
                const [p, sl, sc, el, ec] = message.position.split(/:/g);
                const loc = new vscode.Location(vscode.Uri.file(join(root.uri.path, p)),
                  new vscode.Range(
                    new vscode.Position(parseInt(sl), parseInt(sc)),
                    new vscode.Position(parseInt(el), parseInt(ec))
                  )
                );
                const doc = await vscode.workspace.openTextDocument(loc.uri);
                const edi = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                edi.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
                return;
              }
              case 'show context': {
                //TODO rm duplicated code
                async function f(pos: string, stats: BehaviorStatsProvider) {
                  if (vscode.workspace.workspaceFolders === undefined) {
                    throw new Error('no workspace');
                  }
                  if (vscode.workspace.workspaceFolders.length !== 1) {
                    throw new Error("don't handle multi workspace");
                  } const [p, ...r] = message.position.split(/:/g);
                  const o = await stats.searching(root.name, p, [parseInt(r[0]), parseInt(r[1]), parseInt(r[2]), parseInt(r[3])]);//, vscode.workspace.workspaceFolders[0].uri, -1));
                  const symbols = new Set<string>();
                  o.forEach(x => x.ngram.forEach(x => symbols.add(x)));
                  const symbols_stats = {} as any;
                  (await stats.searchingSymbols(root.name, [...symbols]))
                    .forEach(x => {
                      if (x.ngram.length !== 1) {
                        throw new Error(x + ' is not a symbol');
                      }
                      symbols_stats[x.ngram[0]] = {
                        pocc: x.pocc,
                        tocc: x.tocc
                      };
                    });
                  return {
                    symb_stats: symbols_stats,
                    ngrams: o
                  };
                }
                console.log('show ' + message.position);
                vscode.commands.executeCommand(
                  'BehaviorProvider.showContextViewer',
                  f(message.position, this.stats)
                );

                return;
              }
            }
          },
          this,
          context.subscriptions
        );
      })
    );
    // context.subscriptions.push(
    //   vscode.commands.registerCommand('BehaviorProvider.ngramAddToView', (resources: resources_t | undefined) => {
    //     sendResources(resources);
    //   })
    // );
  }
}



function getWebviewContent(resources: {
  script: vscode.Uri;
  style: vscode.Uri;
  data: vscode.Uri;
  d3: vscode.Uri;
}) {
  return `
<!DOCTYPE html>
<meta charset="utf-8">
<link rel="stylesheet" href="${'vscode-resource://' + resources.style.path}" type="text/css"/>
<body>
<script src="${'vscode-resource://' + resources.d3.path}" type="text/javascript" ></script>
<script>window.mypath='${'vscode-resource://' + resources.data.path}'</script>
<div id="settings"></div>
<div id="chart"></div>
<script src="${'vscode-resource://' + resources.script.path}" type="text/javascript"></script>
</body>`;
  // <button type="button" onclick="collapseAll()">Collapse All</button>
  // <button type="button" onclick="expandAll()">Expand All</button>
}