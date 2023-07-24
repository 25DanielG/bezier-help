import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    console.log("bezier-help is active.");
    context.subscriptions.push(
        vscode.commands.registerCommand("bezier-help.editBezier", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const selection = editor.selection;
                const word = document.getText(selection);

                if (/cubic-bezier\([^)]+\)/.test(word)) {
                    BezierEditorPanel.createOrShow(context.extensionUri, word, editor);
                } else {
                    vscode.window.showErrorMessage("Not a valid cubic-bezier value.");
                }
            }
        })
    );

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (BezierEditorPanel.currentPanel && BezierEditorPanel.currentPanel.hasPendingEdit()) {
            BezierEditorPanel.currentPanel.tryApplyPendingEdit(editor);
        }
    });
}

class BezierEditorPanel {
    private static readonly viewType = "bezierEditor";
    public static currentPanel?: BezierEditorPanel;
    private _textEditor: vscode.TextEditor;
    private readonly _panel: vscode.WebviewPanel;
    public bezierValue: string;
    private pendingEdit?: {data: any, range: vscode.Range};

    private constructor(panel: vscode.WebviewPanel, bezierValue: string, editor: vscode.TextEditor) {
        this._panel = panel;
        this.bezierValue = bezierValue;
        this._textEditor = editor;
        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case "updateBezier":
                        this.updateTextInEditor(message.data);
                        return;
                }
            },
            undefined
        );
		this._panel.onDidChangeViewState(e => {
			if (e.webviewPanel.visible) {
				console.log("Webview is now active.");
				console.log(this.bezierValue);
				this.updateWebview();
			}
		}, null);
		this._panel.onDidDispose(() => {
			BezierEditorPanel.currentPanel = undefined;
		}, null);		
    }

    private updateTextInEditor(data: any) {
		if (!this._textEditor) {
			console.log("No text editor available!");
			return;
		}
	
		const currentActiveEditor = vscode.window.activeTextEditor;
		const thisEditorUri = this._textEditor.document.uri.toString();
	
		if (!currentActiveEditor || currentActiveEditor.document.uri.toString() !== thisEditorUri) {
			this.pendingEdit = {
				data: data,
				range: this._textEditor.selection
			};
			return;
		}
	
		if (this._textEditor.document.isClosed) {
			this.pendingEdit = {
				data: data,
				range: this._textEditor.selection
			};
			return;
		}
	
		const updatedBezier = `cubic-bezier(${data.cp1x.toFixed(2)}, ${data.cp1y.toFixed(2)}, ${data.cp2x.toFixed(2)}, ${data.cp2y.toFixed(2)})`;
		this.bezierValue = updatedBezier;
		this._textEditor.edit(editBuilder => {
			editBuilder.replace(this._textEditor.selection, updatedBezier);
		});
	}

    public static createOrShow(extensionUri: vscode.Uri, bezierValue: string, editor: vscode.TextEditor) {
		if (BezierEditorPanel.currentPanel) {
			BezierEditorPanel.currentPanel.bezierValue = bezierValue;
			BezierEditorPanel.currentPanel._panel.reveal();
			BezierEditorPanel.currentPanel.updateWebview();
			return;
		}
	
		const panel = vscode.window.createWebviewPanel(
			BezierEditorPanel.viewType,
			"Bezier Editor",
			vscode.ViewColumn.One,
			{
				enableScripts: true
			}
		);
	
		BezierEditorPanel.currentPanel = new BezierEditorPanel(panel, bezierValue, editor);
	}

	public updateWebview() {
		this._panel.webview.html = this._getHtmlForWebview();
	}

    hasPendingEdit(): boolean {
        return !!this.pendingEdit;
    }

    tryApplyPendingEdit(editor: vscode.TextEditor | undefined) {
		if (this.pendingEdit && editor?.document.uri.toString() === this._textEditor?.document.uri.toString()) {
			const updatedBezier = `cubic-bezier(${this.pendingEdit.data.cp1x.toFixed(2)}, ${this.pendingEdit.data.cp1y.toFixed(2)}, ${this.pendingEdit.data.cp2x.toFixed(2)}, ${this.pendingEdit.data.cp2y.toFixed(2)})`;
			this.bezierValue = updatedBezier;
			editor.edit(editBuilder => {
				editBuilder.replace(this.pendingEdit!.range, updatedBezier);
			});
			this.pendingEdit = undefined;
		}
	}

    private _getHtmlForWebview() {
		const matched = this.bezierValue.match(/cubic-bezier\(([^)]+)\)/);
		if (matched === null) {
			console.log("An error occurred while obtaining webview HTML.");
			return "An error occurred.";
		}
		const [x1, y1, x2, y2] = matched[1].split(",").map(num => parseFloat(num.trim()));

		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Bezier Curve</title>
			</head>
			<body>
				<div id="bezierValuesDisplay">
					cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})
				</div>
				<canvas id="bezierCanvas" width="650px" height="650px" style="background-color: #f5f5f5;"></canvas>
				<script>
					const vscode = acquireVsCodeApi();
					
					const canvas = document.getElementById("bezierCanvas");
					const ctx = canvas.getContext("2d");
					const width = canvas.width;
					const height = canvas.height;
					const padding = 200;
			
					let dragPoint = null;
			
					let cp1 = {x: padding + ${x1} * (width - 2 * padding), y: height - padding - ${y1} * (height - 2 * padding)};
					let cp2 = {x: padding + ${x2} * (width - 2 * padding), y: height - padding - ${y2} * (height - 2 * padding)};
			
					let cubePos = 0;
					let startTime;
					
					function getY(x, p0, p1, p2, p3) {
						function B(t, p) {
							return (1 - t) * (1 - t) * (1 - t) * p0[p] +
								3 * (1 - t) * (1 - t) * t * p1[p] +
								3 * (1 - t) * t * t * p2[p] +
								t * t * t * p3[p];
						}
					
						let low = 0, high = 1, epsilon = 0.001;
					
						while (low < high) {
							const mid = (low + high) / 2;
							const estimatedX = B(mid, "x");
							if (Math.abs(x - estimatedX) < epsilon) {
								return B(mid, "y");
							} else if (estimatedX < x) {
								low = mid;
							} else {
								high = mid;
							}
						}
					
						return B(high, "y");
					}

					function animate() {
						if (!startTime) {
							startTime = Date.now();
						}
					
						const elapsed = (Date.now() - startTime) / 2000;
						const linearProgress = elapsed % 2;
					
						let cubePos;
						if(linearProgress <= 1) {
							cubePos = linearProgress * (width - 2 * padding) + padding;
						} else {
							cubePos = (2 - linearProgress) * (width - 2 * padding) + padding;
						}
					
						draw();
					
						const boundedProgress = (cubePos - padding) / (width - 2 * padding);
						const bezierX = getX(boundedProgress, { x: padding, y: 0 }, cp1, cp2, { x: width - padding, y: 1 });
						
						ctx.fillStyle = "#00ff007f";
						ctx.fillRect(bezierX - 5, height/2 + 145, 30, 30);
					
						ctx.fillStyle = "#8000807f";
						ctx.fillRect(cubePos - 5, height/2 + 180, 30, 30);
					
						requestAnimationFrame(animate);
					}
					
					function getX(t, start, cp1, cp2, end) {
						const invT = 1 - t;
						return invT * invT * invT * start.x +
							   3 * invT * invT * t * cp1.x +
							   3 * invT * t * t * cp2.x +
							   t * t * t * end.x;
					}

					animate();
					
					function draw() {
						ctx.clearRect(0, 0, width, height);
						
						ctx.strokeStyle = "#CCC";
						ctx.lineWidth = 1;
						for (let i = 0; i <= 10; i++) {
							ctx.beginPath();
							ctx.moveTo(padding + i * (width - 2 * padding) / 10, padding);
							ctx.lineTo(padding + i * (width - 2 * padding) / 10, height - padding);
							ctx.stroke();
					
							ctx.beginPath();
							ctx.moveTo(padding, padding + i * (height - 2 * padding) / 10);
							ctx.lineTo(width - padding, padding + i * (height - 2 * padding) / 10);
							ctx.stroke();
						}
					
						ctx.strokeStyle = "black";
						ctx.lineWidth = 3;
						ctx.beginPath();
						ctx.moveTo(padding, height - padding);
						ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, width - padding, padding);
						ctx.stroke();
					
						ctx.fillStyle = "red";
						ctx.fillRect(cp1.x - 5, cp1.y - 5, 10, 10); 
						ctx.fillStyle = "blue";
						ctx.fillRect(cp2.x - 5, cp2.y - 5, 10, 10);
					}									
			
					function mouseDownHandler(e) {
						const rect = canvas.getBoundingClientRect();
						const x = e.clientX - rect.left;
						const y = e.clientY - rect.top;
			
						if (Math.abs(x - cp1.x) < 5 && Math.abs(y - cp1.y) < 5) {
							dragPoint = "cp1";
						} else if (Math.abs(x - cp2.x) < 5 && Math.abs(y - cp2.y) < 5) {
							dragPoint = "cp2";
						}
					}
			
					function mouseUpHandler() {
						dragPoint = null;
					}
			
					function mouseMoveHandler(e) {
						if (!dragPoint) return;
					
						const rect = canvas.getBoundingClientRect();
						const x = e.clientX - rect.left;
						const y = e.clientY - rect.top;
					
						const leftBound = padding;
						const rightBound = width - padding;
					
						const boundedX = Math.min(Math.max(x, leftBound), rightBound);
						const boundedY = Math.min(Math.max(y, 0), height);
					
						if (dragPoint === "cp1") {
							cp1.x = boundedX;
							cp1.y = boundedY;
						} else if (dragPoint === "cp2") {
							cp2.x = boundedX;
							cp2.y = boundedY;
						}
					
						draw();
	
						const bezierValues = {
							cp1x: (cp1.x - padding) / (width - 2 * padding),
							cp1y: 1 - (cp1.y - padding) / (height - 2 * padding),
							cp2x: (cp2.x - padding) / (width - 2 * padding),
							cp2y: 1 - (cp2.y - padding) / (height - 2 * padding)
						};
						
						document.getElementById("bezierValuesDisplay").innerText = 
							"cubic-bezier(" + bezierValues.cp1x.toFixed(4) + ", " +
							bezierValues.cp1y.toFixed(4) + ", " +
							bezierValues.cp2x.toFixed(4) + ", " +
							bezierValues.cp2y.toFixed(4) + ")";

						vscode.postMessage({
							command: "updateBezier",
							data: bezierValues
						});
					}
			
					canvas.addEventListener("mousedown", mouseDownHandler);
					canvas.addEventListener("mouseup", mouseUpHandler);
					canvas.addEventListener("mousemove", mouseMoveHandler);
			
					draw();
				</script>
				<style>
					#bezierValuesDisplay {
						font-size: 1.5em;
						user-select: none;
					}
				</style>
			</body>
			</html>
		`;
	}
}

export function deactivate() {}