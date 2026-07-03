/**
 * Diagram Viewer JavaScript - Handles zoom controls and save functionality
 */

// Global state
let currentZoom = 2.0; // Start at 200%
const minZoom = 0.5;   // 50%
const maxZoom = 10.0;  // 1000%
const zoomStep = 0.2;  // 20% increments

// VS Code API
const vscode = acquireVsCodeApi();

// DOM elements
let diagramViewer;
let zoomLevelDisplay;
let saveBtn;
let zoomInBtn;
let zoomOutBtn;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeElements();
    setupEventListeners();
    applyZoom(currentZoom);
    
   // console.log('Diagram viewer initialized with zoom:', currentZoom);
});

function initializeElements() {
    diagramViewer = document.getElementById('diagram-viewer');
    zoomLevelDisplay = document.getElementById('zoom-level');
    saveBtn = document.getElementById('save-btn');
    zoomInBtn = document.getElementById('zoom-in');
    zoomOutBtn = document.getElementById('zoom-out');
    
    if (!diagramViewer || !zoomLevelDisplay || !saveBtn || !zoomInBtn || !zoomOutBtn) {
        console.error('Failed to find required DOM elements');
        return;
    }
    
    console.log('All DOM elements found successfully');
}

function setupEventListeners() {
    // Zoom controls
    zoomInBtn.addEventListener('click', () => {
        zoomIn();
    });
    
    zoomOutBtn.addEventListener('click', () => {
        zoomOut();
    });
    
    // Save functionality
    saveBtn.addEventListener('click', () => {
        saveDiagram();
    });
    
    // Mouse wheel zoom (optional enhancement)
    diagramViewer.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
            if (event.deltaY < 0) {
                zoomIn();
            } else {
                zoomOut();
            }
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey) {
            switch (event.key) {
                case '=':
                case '+':
                    event.preventDefault();
                    zoomIn();
                    break;
                case '-':
                    event.preventDefault();
                    zoomOut();
                    break;
                case '0':
                    event.preventDefault();
                    resetZoom();
                    break;
                case 's':
                    event.preventDefault();
                    saveDiagram();
                    break;
            }
        }
    });
    
    console.log('Event listeners set up successfully');
}

function zoomIn() {
    if (currentZoom < maxZoom) {
        currentZoom = Math.min(currentZoom + zoomStep, maxZoom);
        applyZoom(currentZoom);
        updateZoomDisplay();
        console.log('Zoomed in to:', currentZoom);
    }
}

function zoomOut() {
    if (currentZoom > minZoom) {
        currentZoom = Math.max(currentZoom - zoomStep, minZoom);
        applyZoom(currentZoom);
        updateZoomDisplay();
        console.log('Zoomed out to:', currentZoom);
    }
}

function resetZoom() {
    currentZoom = 1.0;
    applyZoom(currentZoom);
    updateZoomDisplay();
    console.log('Zoom reset to:', currentZoom);
}

function applyZoom(zoom) {
    if (!diagramViewer) return;
    
    diagramViewer.style.transform = `scale(${zoom})`;
    
    // Update button states
    updateButtonStates();
}

function updateZoomDisplay() {
    if (zoomLevelDisplay) {
        zoomLevelDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
    }
}

function updateButtonStates() {
    if (zoomInBtn) {
        zoomInBtn.disabled = currentZoom >= maxZoom;
        zoomInBtn.style.opacity = currentZoom >= maxZoom ? '0.5' : '1';
    }
    
    if (zoomOutBtn) {
        zoomOutBtn.disabled = currentZoom <= minZoom;
        zoomOutBtn.style.opacity = currentZoom <= minZoom ? '0.5' : '1';
    }
}

function saveDiagram() {
    try {
        // Get the SVG element
        const svgElement = diagramViewer.querySelector('svg');
        if (!svgElement) {
            console.error('No SVG element found in diagram');
            vscode.postMessage({
                command: 'log',
                message: 'Error: No SVG element found in diagram'
            });
            return;
        }
        
        // Get the SVG as string
        const svgString = new XMLSerializer().serializeToString(svgElement);
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `mermaid-diagram-${timestamp}.svg`;
        
        console.log('Saving diagram:', filename);
        
        // Send save command to extension
        vscode.postMessage({
            command: 'saveDiagram',
            svg: svgString,
            filename: filename
        });
        
    } catch (error) {
        console.error('Failed to save diagram:', error);
        vscode.postMessage({
            command: 'log',
            message: `Error saving diagram: ${error.message}`
        });
    }
}

// Initialize zoom display when script loads
updateZoomDisplay();

// Log initialization
console.log('Diagram viewer script loaded successfully');
vscode.postMessage({
    command: 'log',
   // message: 'Diagram viewer initialized with 200% zoom'
});
