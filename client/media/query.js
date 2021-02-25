// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
function showResult(result) {

    let cols = result.columns.map(obj => {
        return { title: obj.description, field: obj.name };
    });

    var table = new Tabulator("#result-table", {
        data: result.values, //assign data to table
        columns: cols,
        // pagination: "local",
        // paginationSize: 10,
        // paginationSizeSelector: [10, 20, 50, 100]
    });

}

function showError(msg) {
    document.getElementById('result-table').innerHTML = `<p class="error">${msg}</p>`;
}

(function () {
    const vscode = acquireVsCodeApi();

    const oldState = vscode.getState();

    const query = document.getElementById('query');
    const result = document.getElementById('result');

    const execute = document.getElementById('execute');

    const rowCount = document.getElementById('rowCount');

    execute.onclick = () => {
        vscode.postMessage({
            command: 'execute',
            query: query.value,
            rowCount: parseInt(rowCount.value)
        });
    }


    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'result':
                showResult(JSON.parse(message.data));
                break;
            case 'error':
                showError(message.data);
                break;
        }
    });
}());