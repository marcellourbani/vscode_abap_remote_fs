### ABAP Debugging

**Setup:**
1. Open an ABAP object, click gutter to set breakpoints
2. **Ctrl+Shift+D** → Run & Debug panel
3. Select **ABAP on server** → pick system if multiple connected
4. **F5** to attach — debugger listens for breakpoint hits
5. Trigger program from SAP GUI, embedded GUI, or another session

**While debugging:**
- **F10** Step Over, **F11** Step Into, **Shift+F11** Step Out
- Variables panel, Call Stack, Watch expressions

Max debug threads configurable per system in Connection Manager (default: 4).
