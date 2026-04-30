(function () {
  const vscode = acquireVsCodeApi()

  const systemSelect = document.getElementById("systemSelect")
  const runBtn = document.getElementById("runBtn")
  const clearBtn = document.getElementById("clearBtn")
  const codeInput = document.getElementById("codeInput")
  const spinner = document.getElementById("spinner")
  const outputSection = document.getElementById("outputSection")
  const outputTitle = document.getElementById("outputTitle")
  const outputMeta = document.getElementById("outputMeta")
  const outputBox = document.getElementById("outputBox")
  const confirmOverlay = document.getElementById("confirmOverlay")
  const confirmSystem = document.getElementById("confirmSystem")
  const confirmCode = document.getElementById("confirmCode")
  const confirmCancel = document.getElementById("confirmCancel")
  const confirmRun = document.getElementById("confirmRun")

  let pendingCode = ""
  let pendingSystem = ""

  vscode.postMessage({ command: "getSystems" })

  codeInput.addEventListener("input", function () {
    autoResize(this)
    updateRunButton()
  })

  codeInput.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault()
      var start = this.selectionStart
      var end = this.selectionEnd
      this.value = this.value.substring(0, start) + "  " + this.value.substring(end)
      this.selectionStart = this.selectionEnd = start + 2
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault()
      runBtn.click()
    }
  })

  systemSelect.addEventListener("change", updateRunButton)

  runBtn.addEventListener("click", function () {
    var code = codeInput.value.trim()
    var system = systemSelect.value
    if (!code || !system) return

    pendingCode = code
    pendingSystem = system

    confirmSystem.textContent = system.toUpperCase()
    confirmCode.textContent = code
    confirmOverlay.classList.add("visible")
  })

  confirmCancel.addEventListener("click", function () {
    confirmOverlay.classList.remove("visible")
    pendingCode = ""
    pendingSystem = ""
  })

  confirmRun.addEventListener("click", function () {
    if (!pendingCode || !pendingSystem) return
    var code = pendingCode
    var system = pendingSystem
    pendingCode = ""
    pendingSystem = ""
    confirmOverlay.classList.remove("visible")
    doExecute(code, system)
  })

  clearBtn.addEventListener("click", function () {
    codeInput.value = ""
    autoResize(codeInput)
    outputSection.classList.remove("visible")
    updateRunButton()
    codeInput.focus()
  })

  var executionTimer = null

  function doExecute(code, system) {
    setRunning(true)
    outputSection.classList.remove("visible")
    vscode.postMessage({ command: "execute", code: code, connectionId: system })

    if (executionTimer) clearTimeout(executionTimer)
    executionTimer = setTimeout(function () {
      showResult({
        success: false,
        output: "",
        error: "Execution timed out (65s). The SAP request may still be running. Check ST22 for dumps.",
        runtime_ms: 0
      })
    }, 65000)
  }

  function setRunning(running) {
    runBtn.disabled = running
    spinner.classList.toggle("visible", running)
    if (running) {
      runBtn.textContent = "Running..."
    } else {
      runBtn.textContent = "Run"
      updateRunButton()
    }
  }

  function updateRunButton() {
    var hasCode = codeInput.value.trim().length > 0
    var hasSystem = systemSelect.value !== ""
    runBtn.disabled = !hasCode || !hasSystem
  }

  function autoResize(textarea) {
    textarea.style.height = "auto"
    var newHeight = Math.max(60, Math.min(textarea.scrollHeight, 400))
    textarea.style.height = newHeight + "px"
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  window.addEventListener("message", function (event) {
    var msg = event.data
    if (!msg || typeof msg !== "object") return
    switch (msg.command) {
      case "systems":
        populateSystems(msg.systems)
        break
      case "result":
        showResult(msg.data)
        break
    }
  })

  function populateSystems(systems) {
    systemSelect.innerHTML = ""
    if (!systems || systems.length === 0) {
      var opt = document.createElement("option")
      opt.value = ""
      opt.textContent = "No systems connected"
      systemSelect.appendChild(opt)
      return
    }

    var placeholder = document.createElement("option")
    placeholder.value = ""
    placeholder.textContent = "-- Select SAP System --"
    systemSelect.appendChild(placeholder)

    for (var i = 0; i < systems.length; i++) {
      var opt = document.createElement("option")
      opt.value = systems[i]
      opt.textContent = systems[i].toUpperCase()
      systemSelect.appendChild(opt)
    }
    updateRunButton()
  }

  function showResult(data) {
    if (executionTimer) { clearTimeout(executionTimer); executionTimer = null; }
    setRunning(false)
    outputSection.classList.add("visible")

    if (data.success) {
      outputTitle.textContent = "Output"
      outputBox.className = "output-box success"
      outputBox.innerHTML = data.output ? escapeHtml(String(data.output)) : "<em>(no output)</em>"
    } else {
      outputTitle.textContent = "Error"
      outputBox.className = "output-box error"
      outputBox.innerHTML = escapeHtml(String(data.error || "Unknown error"))
    }

    var meta = []
    if (data.runtime_ms !== undefined) meta.push(data.runtime_ms + "ms")
    outputMeta.textContent = meta.join(" | ")
  }
})()
