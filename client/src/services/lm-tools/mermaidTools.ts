/**
 * Mermaid Diagram Tools for ABAP Language Model
 * - Create diagrams in webview
 * - Validate syntax
 * - Get documentation
 * - Detect diagram types
 */

import * as vscode from 'vscode';
import { MermaidWebviewManager } from '../MermaidWebviewManager';
import { MERMAID_DOCUMENTATION } from '../MermaidDocumentation';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ICreateMermaidDiagramParameters {
  code: string;
  diagramType?: 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'journey' | 'gantt' | 'pie' | 'gitgraph' | 'mindmap' | 'timeline' | 'sankey' | 'xychart' | 'block' | 'packet' | 'auto';
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
}

export interface IValidateMermaidSyntaxParameters {
  code: string;
  suppressErrors?: boolean;
}

export interface IGetMermaidDocumentationParameters {
  diagramType?: 'all' | 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'journey' | 'gantt' | 'pie' | 'gitgraph' | 'mindmap' | 'timeline' | 'sankey' | 'xychart' | 'block' | 'packet';
  includeExamples?: boolean;
}

export interface IDetectMermaidDiagramTypeParameters {
  code: string;
}

// ============================================================================
// TOOL CLASSES
// ============================================================================

/**
 * 🎨 CREATE MERMAID DIAGRAM TOOL - Using Webview Manager
 */
export class CreateMermaidDiagramTool implements vscode.LanguageModelTool<ICreateMermaidDiagramParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateMermaidDiagramParameters>,
    _token: vscode.CancellationToken
  ) {
    const { code, theme } = options.input;
    
    const confirmationMessages = {
      title: 'Create Mermaid Diagram',
      message: new vscode.MarkdownString(
        `Create Mermaid diagram in interactive webview with theme: ${theme || 'forest'}` +
        ' and 500% zoom for detailed viewing'
      ),
    };

    return {
      invocationMessage: `Creating Mermaid diagram in webview...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateMermaidDiagramParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { code, theme = 'forest' } = options.input;
    logTelemetry("tool_create_mermaid_diagram_called"); // No connectionId available
    

    try {
      // Get the webview manager instance (it's already initialized)
      const webviewManager = MermaidWebviewManager.getInstance();
      const renderResult = await webviewManager.renderDiagram(code, theme);

      if (!renderResult.success) {
        throw new Error(renderResult.error || 'Failed to render diagram');
      }

      let resultMessage = `✅ Diagram displayed in webview successfully (Type: ${renderResult.diagramType})`;

      const resultText = `**🎨 Mermaid Diagram Created Successfully** ✅\n\n` +
        `• **Diagram Type:** ${renderResult.diagramType}\n` +
        `• **Theme:** ${theme}\n` +
        `• **Display:** Opened in webview with zoom controls\n` +
        `• **Zoom Level:** 500% (adjustable)\n` +
        `• **Save Option:** Click "Save to Desktop" button in webview\n\n` +
        `**🔍 Webview Features:**\n` +
        `• **Zoom In/Out:** Use +/- buttons or Ctrl+scroll\n` +
        `• **Keyboard Shortcuts:** Ctrl+Plus/Minus, Ctrl+0 (reset), Ctrl+S (save)\n` +
        `• **High Quality:** SVG format ensures perfect quality at any zoom level\n`;


      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      //logCommands.error('❌ Failed to create Mermaid diagram:', error);
      
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('Parse error')) {
        errorMessage = `Syntax error in diagram code: ${errorMessage}`;
      }

      throw new Error(`Failed to create diagram: ${errorMessage}`);
    }
  }
}

/**
 * ✅ VALIDATE MERMAID SYNTAX TOOL - Using Webview Manager
 */
export class ValidateMermaidSyntaxTool implements vscode.LanguageModelTool<IValidateMermaidSyntaxParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IValidateMermaidSyntaxParameters>,
    _token: vscode.CancellationToken
  ) {
    const { code } = options.input;
    
    const confirmationMessages = {
      title: 'Validate Mermaid Syntax',
      message: new vscode.MarkdownString(
        `Validate Mermaid diagram syntax (${code.length} characters)`
      ),
    };

    return {
      invocationMessage: `Validating Mermaid syntax...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IValidateMermaidSyntaxParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { code } = options.input;
    logTelemetry("tool_validate_mermaid_syntax_called"); // No connectionId available
    

    try {
      // Get the webview manager instance (it's already initialized)
      const webviewManager = MermaidWebviewManager.getInstance();
      const validationResult = await webviewManager.validateSyntax(code);

      if (validationResult.isValid) {
        const resultText = `**✅ Valid Mermaid Syntax** ✅\n\n` +
          `• **Diagram Type:** ${validationResult.diagramType || 'auto-detected'}\n` +
          `• **Code Length:** ${code.length} characters\n` +
          `• **Validation Status:** Passed\n\n` +
          `**🎯 Ready for Rendering!** The syntax is valid and can be rendered as a diagram.`;


        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
      } else {
        const resultText = `**❌ Syntax Validation Failed**\n\n` +
          `**Error:** ${validationResult.error || 'Syntax error'}\n\n` +
          `**📝 Code Length:** ${code.length} characters\n` +
          `**🔍 Status:** Validation error\n\n` +
          `**💡 Common Issues:**\n` +
          `• Missing or incorrect diagram type declaration\n` +
          `• Invalid node syntax or connections\n` +
          `• Unsupported diagram features\n` +
          `• Malformed text or special characters`;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
      }

    } catch (error) {
      //logCommands.error('❌ Mermaid syntax validation failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const resultText = `**❌ Validation Error**\n\n` +
        `**Error:** ${errorMessage}\n\n` +
        `**📝 Code Length:** ${code.length} characters`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);
    }
  }
}

/**
 * 📚 GET MERMAID DOCUMENTATION TOOL - Using Local Documentation
 */
export class GetMermaidDocumentationTool implements vscode.LanguageModelTool<IGetMermaidDocumentationParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetMermaidDocumentationParameters>,
    _token: vscode.CancellationToken
  ) {
    const { diagramType, includeExamples } = options.input;
    
    const confirmationMessages = {
      title: 'Get Mermaid Documentation',
      message: new vscode.MarkdownString(
        `Get Mermaid documentation for: ${diagramType || 'all diagram types'}` +
        (includeExamples !== false ? ' with syntax examples' : ' without examples')
      ),
    };

    return {
      invocationMessage: `Getting Mermaid documentation...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetMermaidDocumentationParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { diagramType = 'all', includeExamples = true } = options.input;
    logTelemetry("tool_get_mermaid_documentation_called"); // No connectionId available
    

    try {
      // Use local documentation data
      const documentation = MERMAID_DOCUMENTATION;
      
      // Build response based on request
      if (diagramType === 'all') {
        const supportedTypes = Object.keys(documentation);
        
        let resultText = `**📚 Complete Mermaid Documentation** 📖\n\n`;
        resultText += `**🎯 Supported Diagram Types:** ${supportedTypes.length} types\n\n`;
        
        resultText += `**📋 Available Diagram Types:**\n`;
        
        for (const [type, info] of Object.entries(documentation)) {
          resultText += `\n**${type.toUpperCase()}** - ${info.description}\n`;
          resultText += `Keywords: ${info.keywords.join(', ')}\n`;
          
          if (includeExamples) {
            resultText += `Example:\n\`\`\`\n${info.syntax}\n\`\`\`\n`;
          }
        }
        
        resultText += `\n**💡 Usage Tips:**\n`;
        resultText += `• Each diagram starts with a type declaration\n`;
        resultText += `• Flowchart directions: TD (Top-Down), LR (Left-Right), TB, RL\n`;
        resultText += `• Sequence arrows: ->> (solid), -->> (dotted)\n`;
        resultText += `• Class relationships: <|-- (inheritance), --> (association)\n`;
        resultText += `• Nodes: [text] (rectangle), ((text)) (circle), {text} (diamond)\n`;
        resultText += `• Styling: CSS classes and inline styles supported`;
        
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
        
      } else if (documentation[diagramType]) {
        const specificDoc = documentation[diagramType];
        
        let resultText = `**📚 ${diagramType.toUpperCase()} Diagram Documentation** 📖\n\n`;
        resultText += `**Description:** ${specificDoc.description}\n`;
        resultText += `**Keywords:** ${specificDoc.keywords.join(', ')}\n\n`;
        
        if (includeExamples) {
          resultText += `**🎯 Syntax Example:**\n`;
          resultText += `\`\`\`\n${specificDoc.syntax}\n\`\`\`\n\n`;
        }
        
        resultText += `**💡 Specific Tips for ${diagramType.toUpperCase()}:**\n`;
        
        switch (diagramType) {
          case 'flowchart':
            resultText += `• Use TD, LR, TB, RL for direction\n`;
            resultText += `• Node shapes: [] rectangle, () rounded, {} diamond, (()) circle\n`;
            resultText += `• Arrows: --> solid, -.-> dotted, ==> thick`;
            break;
          case 'sequence':
            resultText += `• Define participants first\n`;
            resultText += `• Messages: ->> solid arrow, -->> dotted arrow\n`;
            resultText += `• Use 'activate' and 'deactivate' for lifelines`;
            break;
          case 'class':
            resultText += `• Visibility: + public, - private, # protected, ~ package\n`;
            resultText += `• Relationships: <|-- inheritance, --> association\n`;
            resultText += `• Methods and attributes in class body`;
            break;
          default:
            resultText += `• Start with '${diagramType}' keyword\n`;
            resultText += `• Follow the syntax pattern shown above\n`;
            resultText += `• Check spacing and indentation`;
        }
        
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
        
      } else {
        const availableTypes = Object.keys(documentation);
        const resultText = `**❌ Unknown Diagram Type: ${diagramType}**\n\n` +
          `**Available Types:**\n${availableTypes.map(t => `• ${t}`).join('\n')}\n\n` +
          `Use 'all' to get complete documentation for all diagram types.`;
          
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(resultText)
        ]);
      }

    } catch (error) {
     // logCommands.error('❌ Failed to get Mermaid documentation:', error);
      
      throw new Error(`Failed to get documentation: ${error}`);
    }
  }
}

/**
 * 🔍 DETECT MERMAID DIAGRAM TYPE TOOL - Using Webview Manager
 */
export class DetectMermaidDiagramTypeTool implements vscode.LanguageModelTool<IDetectMermaidDiagramTypeParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDetectMermaidDiagramTypeParameters>,
    _token: vscode.CancellationToken
  ) {
    const { code } = options.input;
    
    const confirmationMessages = {
      title: 'Detect Mermaid Diagram Type',
      message: new vscode.MarkdownString(
        `Analyze Mermaid diagram code to detect type (${code.length} characters)`
      ),
    };

    return {
      invocationMessage: `Detecting diagram type...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDetectMermaidDiagramTypeParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { code } = options.input;
    logTelemetry("tool_detect_mermaid_diagram_type_called"); // No connectionId available

    try {
      // Get the webview manager instance (it's already initialized)
      const webviewManager = MermaidWebviewManager.getInstance();
      const detectionResult = await webviewManager.detectDiagramType(code);

      const detectedType = detectionResult.diagramType;
      const confidence = detectedType !== 'unknown' ? 0.9 : 0.1;

      let resultText = `**🔍 Diagram Type Detection Results** 🎯\n\n`;
      resultText += `• **Detected Type:** ${detectedType}\n`;
      resultText += `• **Confidence:** ${Math.round(confidence * 100)}%\n`;
      resultText += `• **Code Length:** ${code.length} characters\n\n`;
      
      if (detectedType !== 'unknown') {
        resultText += `**✅ Success!** The diagram appears to be a **${detectedType}** diagram.\n\n`;
        
        // Add type-specific guidance from documentation
        const docs = MERMAID_DOCUMENTATION;
        if (docs[detectedType]) {
          const docInfo = docs[detectedType];
          resultText += `**📝 Description:** ${docInfo.description}\n`;
          resultText += `**🔑 Keywords:** ${docInfo.keywords.join(', ')}`;
        }
      } else {
        resultText += `**⚠️ Detection Failed** - Could not determine diagram type.\n\n`;
        resultText += `**💡 Suggestions:**\n`;
        resultText += `• Check if the code starts with a valid diagram type declaration\n`;
        resultText += `• Supported types: flowchart, sequenceDiagram, classDiagram, etc.\n`;
        resultText += `• Ensure proper syntax and formatting`;
      }


      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
     // logCommands.error('❌ Failed to detect diagram type:', error);
      
      throw new Error(`Failed to detect diagram type: ${error}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerMermaidTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('create_mermaid_diagram', new CreateMermaidDiagramTool())
  );

  context.subscriptions.push(
    vscode.lm.registerTool('validate_mermaid_syntax', new ValidateMermaidSyntaxTool())
  );

  context.subscriptions.push(
    vscode.lm.registerTool('get_mermaid_documentation', new GetMermaidDocumentationTool())
  );

  context.subscriptions.push(
    vscode.lm.registerTool('detect_mermaid_diagram_type', new DetectMermaidDiagramTypeTool())
  );
}
