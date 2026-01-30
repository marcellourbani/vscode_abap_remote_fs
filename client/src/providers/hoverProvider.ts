import * as vscode from 'vscode';
import { funWindow as window } from '../services/funMessenger';

export class AbapHoverProviderV2 implements vscode.HoverProvider {
    constructor(
        private log?: (message: string) => void
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const startTime = Date.now();
        
        try {
            // Custom word range detection for ABAP-specific tokens like TEXT-001, SY-SUBRC, etc.
            let wordRange = this.getAbapWordRange(document, position);
            if (!wordRange) {
                wordRange = document.getWordRangeAtPosition(position);
                if (!wordRange) return;
            }

            const word = document.getText(wordRange);
            const line = document.lineAt(position.line).text;
            
            
            // 1. PRIORITY: Use existing Go to Definition to resolve what the user is hovering over
            const definitionHover = await this.getDefinitionBasedHover(document, position, word);
            if (definitionHover) {
                return new vscode.Hover(definitionHover, wordRange);
            }
            
            // 2. PRIORITY: Context-aware keywords (MESSAGE TYPE, etc.) - for language constructs
            const contextAwareHover = this.getContextAwareHover(word, line);
            if (contextAwareHover) {
                return new vscode.Hover(contextAwareHover, wordRange);
            }
            
            // 2.5. Text symbols: Disabled (requires ADT API integration)
            // const textSymbolHover = await this.getTextSymbolHover(word, document);
            // if (textSymbolHover) {
            //     return new vscode.Hover(textSymbolHover, wordRange);
            // }
            
            // 3. FALLBACK: Built-in types (only as last resort)
            const builtInHover = this.getBuiltInTypeHover(word);
            if (builtInHover) {
                return new vscode.Hover(builtInHover, wordRange);
            }


        } catch (error) {
            this.log?.(`[V2] ❌ Error in hover provider: ${error}`);
            console.error('[V2] Error in hover provider:', error);
        }

        return undefined;
    }

    // Custom word range detection for ABAP-specific patterns
    private getAbapWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
        const line = document.lineAt(position.line);
        const text = line.text;
        const character = position.character;

        // Check for TEXT-XXX pattern
        const textSymbolPattern = /\bTEXT-\d{3}\b/g;
        let match;
        while ((match = textSymbolPattern.exec(text)) !== null) {
            const start = match.index;
            const end = match.index + match[0].length;
            if (character >= start && character < end) {
                return new vscode.Range(
                    new vscode.Position(position.line, start),
                    new vscode.Position(position.line, end)
                );
            }
        }

        // Check for SY-XXX pattern (system variables)
        const syVarPattern = /\bSY-\w+\b/gi;
        syVarPattern.lastIndex = 0; // Reset regex
        while ((match = syVarPattern.exec(text)) !== null) {
            const start = match.index;
            const end = match.index + match[0].length;
            if (character >= start && character < end) {
                return new vscode.Range(
                    new vscode.Position(position.line, start),
                    new vscode.Position(position.line, end)
                );
            }
        }

        // Check for SYST-XXX pattern (alternative system variable format)
        const systVarPattern = /\bSYST-\w+\b/gi;
        systVarPattern.lastIndex = 0; // Reset regex
        while ((match = systVarPattern.exec(text)) !== null) {
            const start = match.index;
            const end = match.index + match[0].length;
            if (character >= start && character < end) {
             //   this.log?.(`[V2] 🎯 Detected SYST variable: ${match[0]}`);
                return new vscode.Range(
                    new vscode.Position(position.line, start),
                    new vscode.Position(position.line, end)
                );
            }
        }

        return undefined;
    }

    // ============================================================================
    // DEFINITION-BASED HOVER
    // ============================================================================

    private async getDefinitionBasedHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        word: string
    ): Promise<vscode.MarkdownString | undefined> {
        try {
         //   this.log?.(`[V2] 🔍 Using Go to Definition for: ${word}`);
            
            const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                document.uri,
                position
            );

            if (!definitions || definitions.length === 0) {
              //  this.log?.(`[V2] ⚠️ No definition found for: ${word}`);
                return undefined;
            }

            const definition = definitions[0];
            
            // Check if the document is already open to avoid refreshing it
            const existingEditor = window.visibleTextEditors.find(
              editor => editor.document.uri.toString() === definition.uri.toString()
            );
            
            let definitionDoc: vscode.TextDocument;
            if (existingEditor) {
              // Document is already open, use the existing document
              definitionDoc = existingEditor.document;
            } else {
              // Document is not open, safe to open it
              definitionDoc = await vscode.workspace.openTextDocument(definition.uri);
            }
            const definitionLine = definitionDoc.lineAt(definition.range.start.line);
            const definitionText = definitionLine.text.trim();

           // this.log?.(`[V2] ✅ Definition found at: ${definition.uri.fsPath}:${definition.range.start.line + 1}`);
          //  this.log?.(`[V2] 📖 Definition content: "${definitionText}"`);

            // If the definition looks incomplete (common with structures), try to get more context
            if (definitionText.includes('define structure') || 
                definitionText.includes('@EndUserText') ||
                definitionText.includes('@AbapCatalog') ||
                (definitionText.length < 50 && definitionText.includes('{'))) {
                
               // this.log?.(`[V2] 🔍 Definition appears to be a structure, extracting complete definition`);
                const completeDefinition = await this.extractCompleteStructureDefinition(definitionDoc, definition.range.start.line, word);
                if (completeDefinition) {
                    // Use the complete definition instead of the basic one
                    return this.createDefinitionHover(word, definition, completeDefinition, definitionDoc, document, position);
                }
            }

            return this.createDefinitionHover(word, definition, definitionText, definitionDoc, document, position);

        } catch (error) {
            this.log?.(`[V2] ❌ Error in definition-based hover: ${error}`);
            return undefined;
        }
    }

    private async createDefinitionHover(
        word: string,
        definition: vscode.Location,
        definitionText: string,
        definitionDoc: vscode.TextDocument,
        originalDocument: vscode.TextDocument,
        originalPosition: vscode.Position
    ): Promise<vscode.MarkdownString | undefined> {
        
        
        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;

        const fileName = definition.uri.path.split('/').pop() || 'Unknown';
        const lineNumber = definition.range.start.line + 1;
        const definitionUpper = definitionText.toUpperCase();

        let signatureInfo: string | undefined;

        if (definitionUpper.startsWith('FUNCTION')) {
            markdown.appendMarkdown(`⚙️ **Function Module**: \`${word}\`\n\n`);
            signatureInfo = await this.extractSignature(definitionDoc, definition.range.start.line, 'ENDFUNCTION');
            
        } else if (definitionUpper.startsWith('METHOD ')) {  // Note the space - matches "METHOD xyz" but not "METHODS xyz"
            markdown.appendMarkdown(`🔧 **Method**: \`${word}\`\n\n`);
            
            // Determine where we're hovering: declaration (METHODS), implementation (METHOD), or call site
            const originalLine = originalDocument.lineAt(originalPosition.line).text.trim().toUpperCase();
            const isAtDeclaration = originalLine.includes('METHODS '); // plural = declaration
            const isAtImplementation = originalDocument.uri.toString() === definition.uri.toString() &&
                                       originalPosition.line === definition.range.start.line;
            
            try {
                if (isAtDeclaration) {
                    // At declaration - show only implementation (signature is already visible in editor)
                    const implCode = await this.extractSignature(definitionDoc, definition.range.start.line, 'ENDMETHOD');
                    if (implCode) {
                        markdown.appendMarkdown(`**Implementation:**\n`);
                        markdown.appendCodeblock(implCode, 'abap');
                        markdown.appendMarkdown(`\n---\n`);
                        markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`);
                        return markdown;
                    }
                } else if (isAtImplementation) {
                    // At implementation - show only signature (implementation is already visible in editor)
                    const declDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeImplementationProvider',
                        originalDocument.uri,
                        originalPosition
                    );
                    if (declDefinitions && declDefinitions.length > 0) {
                        const declDoc = await vscode.workspace.openTextDocument(declDefinitions[0].uri);
                        const methodDecl = await this.extractMethodDeclaration(declDoc, declDefinitions[0].range.start.line);
                        if (methodDecl) {
                            markdown.appendMarkdown(`**Signature:**\n`);
                            markdown.appendCodeblock(methodDecl, 'abap');
                            markdown.appendMarkdown(`\n---\n`);
                            markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`);
                            return markdown;
                        }
                    }
                } else {
                    // At call site - show both signature and implementation
                    const declDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeImplementationProvider',
                        originalDocument.uri,
                        originalPosition
                    );
                    if (declDefinitions && declDefinitions.length > 0) {
                        const declDoc = await vscode.workspace.openTextDocument(declDefinitions[0].uri);
                        const methodDecl = await this.extractMethodDeclaration(declDoc, declDefinitions[0].range.start.line);
                        const implCode = await this.extractSignature(definitionDoc, definition.range.start.line, 'ENDMETHOD');
                        
                        if (methodDecl && implCode) {
                            markdown.appendMarkdown(`**Signature:**\n`);
                            markdown.appendCodeblock(methodDecl, 'abap');
                            markdown.appendMarkdown(`\n**Implementation:**\n`);
                            markdown.appendCodeblock(implCode, 'abap');
                            markdown.appendMarkdown(`\n---\n`);
                            markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`);
                            return markdown;
                        }
                    }
                }
            } catch (e) {
                // Fall through to default behavior if any error occurs
            }
            
            signatureInfo = await this.extractSignature(definitionDoc, definition.range.start.line, 'ENDMETHOD');

        } else if (definitionUpper.startsWith('CLASS')) {
            markdown.appendMarkdown(`🏗️ **Class**: \`${word}\`\n\n`);
            signatureInfo = await this.extractSignature(definitionDoc, definition.range.start.line, 'ENDCLASS');

        } else if (definitionUpper.startsWith('TYPES')) {
            // TYPES declaration - Show complete type definition, especially for structured types
            markdown.appendMarkdown(`🏗️ **Type Definition**: \`${word}\`\n\n`);
            
            // Check if it's a structured type (BEGIN OF / END OF)
            if (definitionUpper.includes('BEGIN OF')) {
                signatureInfo = await this.extractStructuredType(definitionDoc, definition.range.start.line);
            }
            
        } else if (definitionUpper.startsWith('DEFINE STRUCTURE') || definitionUpper.includes('DEFINE STRUCTURE')) {
            // CDS/DDIC Structure definition - Show complete structure with annotations
            markdown.appendMarkdown(`🏗️ **Structure Definition**: \`${word}\`\n\n`);
            signatureInfo = await this.extractCompleteStructureDefinition(definitionDoc, definition.range.start.line, word);
            
        } else if (definitionUpper.startsWith('@') || (definitionUpper.includes('@') && definitionUpper.includes('DEFINE STRUCTURE'))) {
            // Structure with annotations - capture everything including annotations
            markdown.appendMarkdown(`🏗️ **Annotated Structure**: \`${word}\`\n\n`);
            signatureInfo = await this.extractCompleteStructureDefinition(definitionDoc, definition.range.start.line, word);
            
        } else if (definitionUpper.startsWith('DATA')) {
            markdown.appendMarkdown(`📦 **Variable**: \`${word}\`\n\n`);
            
        } else if (definitionUpper.startsWith('PARAMETERS')) {
            markdown.appendMarkdown(`🔧 **Parameter**: \`${word}\`\n\n`);

        } else if (definitionUpper.startsWith('TABLES')) {
            markdown.appendMarkdown(`🗃️ **Table Work Area**: \`${word}\`\n\n`);

        } else if (definitionUpper.startsWith('INCLUDE')) {
            markdown.appendMarkdown(`📄 **Include**: \`${word}\`\n\n`);
        
        } else {
            // Check if this might be a method declaration (no keyword prefix)
            const isMethodDeclaration = await this.isMethodDeclaration(definitionDoc, definition.range.start.line, definitionText, word);
            
            if (isMethodDeclaration) {
                markdown.appendMarkdown(`🔧 **Method Declaration**: \`${word}\`\n\n`);
                
                // Show the signature (declaration) - we're already at it
                signatureInfo = await this.extractMethodDeclaration(definitionDoc, definition.range.start.line);
                
                // Get the implementation (since Definition and Implementation are swapped, 
                // executeImplementationProvider will go to the actual implementation)
                try {
                    const implDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeDefinitionProvider',  // This now goes to implementation (because we swapped them)
                        originalDocument.uri,
                        originalPosition
                    );
                    
                    if (implDefinitions && implDefinitions.length > 0) {
                        const implDef = implDefinitions[0];
                        
                        // Check if implementation is different from declaration
                        const isDifferent = 
                            implDef.uri.toString() !== definition.uri.toString() ||
                            implDef.range.start.line !== definition.range.start.line;
                        
                        if (isDifferent) {
                            const implDoc = await vscode.workspace.openTextDocument(implDef.uri);
                            const implCode = await this.extractSignature(implDoc, implDef.range.start.line, 'ENDMETHOD');
                            
                            if (implCode && signatureInfo) {
                                markdown.appendMarkdown(`**Signature:**\n`);
                                markdown.appendCodeblock(signatureInfo, 'abap');
                                markdown.appendMarkdown(`\n**Implementation:**\n`);
                                markdown.appendCodeblock(implCode, 'abap');
                                signatureInfo = undefined; // Prevent double rendering below
                            }
                        }
                    }
                } catch (e) {
                    // If we can't get implementation, just show the signature
                }
            } else {
                markdown.appendMarkdown(`📄 **Definition**: \`${word}\`\n\n`);
            }
        }

        if (signatureInfo) {
            // Check if it's XML data dictionary content
            if (signatureInfo.trim().startsWith('<?xml')) {
                const parsedInfo = this.parseDataDictionaryXml(signatureInfo, word);
                if (parsedInfo) {
                    markdown.appendMarkdown(parsedInfo);
                } else {
                    markdown.appendMarkdown(`**Raw Definition:**\n`);
                    markdown.appendCodeblock(signatureInfo, 'abap');
                }
            } else {
                // For structure definitions, provide enhanced formatting
                if (signatureInfo.includes('@EndUserText') || signatureInfo.includes('@AbapCatalog') || signatureInfo.includes('define structure')) {
                    markdown.appendMarkdown(`**Complete Definition:**\n`);
                    
                    // Extract and highlight key information from annotations
                    const annotations = this.extractAnnotationInfo(signatureInfo);
                    if (annotations.length > 0) {
                        markdown.appendMarkdown(`**Annotations:**\n`);
                        annotations.forEach(annotation => {
                            markdown.appendMarkdown(`• ${annotation}\n`);
                        });
                        markdown.appendMarkdown(`\n**Source Code:**\n`);
                    }
                }
                markdown.appendCodeblock(signatureInfo, 'abap');
            }
        } else {
            // Check if the single line definition text is XML
            if (definitionText.trim().startsWith('<?xml')) {
                const parsedInfo = this.parseDataDictionaryXml(definitionText, word);
                if (parsedInfo) {
                    markdown.appendMarkdown(parsedInfo);
                } else {
                    markdown.appendCodeblock(definitionText, 'abap');
                }
            } else {
                markdown.appendCodeblock(definitionText, 'abap');
            }
        }
        
        markdown.appendMarkdown(`\n---\n`);
        markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`);

        return markdown;
    }

    private async extractSignature(doc: vscode.TextDocument, startLine: number, endKeyword: string): Promise<string | undefined> {
        try {
            let signatureText = '';
            let balance = 0;
            let inComment = false;

            for (let i = startLine; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text;
                const trimmedLine = line.trim();

                if (trimmedLine.startsWith('*')) continue; // Skip full-line comments
                
                const commentIndex = trimmedLine.indexOf('"');
                const lineContent = commentIndex !== -1 ? trimmedLine.substring(0, commentIndex) : trimmedLine;

                signatureText += line + '\n';

                if (lineContent.toUpperCase().includes(endKeyword)) {
                    break;
                }
            }
            return signatureText;
        } catch (error) {
            this.log?.(`[V2] ⚠️ Error extracting signature: ${error}`);
            return undefined;
        }
    }

    private async extractStructuredType(doc: vscode.TextDocument, startLine: number): Promise<string | undefined> {
        try {
            let typeDefinition = '';
            let foundBeginOf = false;
            let indentLevel = 0;

            for (let i = startLine; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text;
                const trimmedLine = line.trim();
                const lineUpper = trimmedLine.toUpperCase();

                // Skip full-line comments
                if (trimmedLine.startsWith('*')) continue;
                
                // Remove inline comments
                const commentIndex = trimmedLine.indexOf('"');
                const lineContent = commentIndex !== -1 ? trimmedLine.substring(0, commentIndex).trim() : trimmedLine;
                const lineContentUpper = lineContent.toUpperCase();

                // Add the line to our definition
                typeDefinition += line + '\n';

                // Track BEGIN OF statements
                if (lineContentUpper.includes('BEGIN OF')) {
                    foundBeginOf = true;
                    indentLevel++;
                }

                // Track nested BEGIN OF statements (for nested structures)
                if (foundBeginOf && lineContentUpper.includes('BEGIN OF') && i > startLine) {
                    indentLevel++;
                }

                // Track END OF statements
                if (lineContentUpper.includes('END OF')) {
                    indentLevel--;
                    
                    // If we've closed all nested structures, we're done
                    if (indentLevel <= 0) {
                        break;
                    }
                }

                // Safety check to prevent infinite loops
                if (i - startLine > 150) {
                    this.log?.(`[V2] ⚠️ Structure definition too long, truncating at line ${i}`);
                    break;
                }
            }

            return typeDefinition;
        } catch (error) {
            this.log?.(`[V2] ⚠️ Error extracting structured type: ${error}`);
            return undefined;
        }
    }

    private async extractCompleteStructureDefinition(doc: vscode.TextDocument, startLine: number, structureName: string): Promise<string | undefined> {
        try {
          //  this.log?.(`[V2] 🏗️ Extracting complete structure definition for: ${structureName}`);
            
            let definition = '';
            let scanStartLine = startLine;
            
            // Look backwards to find annotations - simple approach
            for (let i = startLine - 1; i >= Math.max(0, startLine - 5); i--) {
                const line = doc.lineAt(i).text.trim();
                if (line.startsWith('@')) {
                    scanStartLine = i;
                } else if (line === '' || line.startsWith('*')) {  
                    // Allow blank lines and comments between annotations
                    continue;
                } else {
                    // Hit non-annotation content, stop looking back
                    break;
                }
            }
            
            // Extract from annotations to end of structure
            let braceCount = 0;
            let foundStructure = false;
            
            for (let i = scanStartLine; i < Math.min(doc.lineCount, scanStartLine + 20); i++) {
                const line = doc.lineAt(i).text;
                definition += line + '\n';
                
                const trimmed = line.trim().toUpperCase();
                
                if (trimmed.includes('DEFINE STRUCTURE')) {
                    foundStructure = true;
                }
                
                if (foundStructure) {
                    braceCount += (line.match(/\{/g) || []).length;
                    braceCount -= (line.match(/\}/g) || []).length;
                    
                    // Structure complete when we close the main brace
                    if (braceCount <= 0 && line.includes('}')) {
                        break;
                    }
                }
            }
            
            return definition.trim();
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error extracting structure: ${error}`);
            return undefined;
        }
    }

    private extractAnnotationInfo(sourceCode: string): string[] {
        const annotations: string[] = [];
        const lines = sourceCode.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Extract EndUserText label
            const endUserTextMatch = trimmedLine.match(/@EndUserText\.label\s*:\s*'([^']+)'/);
            if (endUserTextMatch) {
                annotations.push(`**Label**: ${endUserTextMatch[1]}`);
            }
            
            // Extract AbapCatalog enhancement category  
            const enhancementMatch = trimmedLine.match(/@AbapCatalog\.enhancement\.category\s*:\s*#(\w+)/);
            if (enhancementMatch) {
                annotations.push(`**Enhancement Category**: ${enhancementMatch[1]}`);
            }
            
            // Extract other common annotations
            const annotationMatch = trimmedLine.match(/@(\w+(?:\.\w+)*)\s*:\s*(.+)/);
            if (annotationMatch && !endUserTextMatch && !enhancementMatch) {
                annotations.push(`**${annotationMatch[1]}**: ${annotationMatch[2]}`);
            }
        }
        
        return annotations;
    }

    private parseDataDictionaryXml(xmlContent: string, objectName: string): string | undefined {
        try {
          //  this.log?.(`[V2] 🔍 Parsing XML content for Data Dictionary object: ${objectName}`);
            
            // Table Type (like SOLIX_TAB)
            if (xmlContent.includes('<ttyp:tableType')) {
                return this.parseTableTypeXml(xmlContent, objectName);
            }
            
            // Structure/Data Element
            if (xmlContent.includes('<dtel:dataElement') || xmlContent.includes('<stru:')) {
                return this.parseStructureXml(xmlContent, objectName);
            }
            
            // Database Table
            if (xmlContent.includes('<tabl:table')) {
                return this.parseTableXml(xmlContent, objectName);
            }
            
            // Domain
            if (xmlContent.includes('<doma:domain')) {
                return this.parseDomainXml(xmlContent, objectName);
            }
            
            this.log?.(`[V2] ⚠️ Unknown XML format for ${objectName}`);
            return undefined;
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error parsing XML for ${objectName}: ${error}`);
            return undefined;
        }
    }

    private parseTableTypeXml(xmlContent: string, objectName: string): string {
        let result = '';
        
        try {
            // Extract all core attributes
            const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/);
            const typeMatch = xmlContent.match(/adtcore:type="([^"]+)"/);
            const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/);
            const descTextLimitMatch = xmlContent.match(/adtcore:descriptionTextLimit="([^"]+)"/);
            const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/);
            const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/);
            const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/);
            const abapLangVersionMatch = xmlContent.match(/adtcore:abapLanguageVersion="([^"]+)"/);
            const languageMatch = xmlContent.match(/adtcore:language="([^"]+)"/);
            const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/);
            const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/);
            const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/);
            const createdAtMatch = xmlContent.match(/adtcore:createdAt="([^"]+)"/);
            const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/);
            
            // Header information
            result += `🗂️ **Table Type**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            
            if (descMatch) {
                result += `**Description**: ${descMatch[1]}\n`;
                if (descTextLimitMatch) {
                    result += `*(max ${descTextLimitMatch[1]} chars)*\n`;
                }
                result += `\n`;
            }
            
            // Metadata
            result += `**📋 Metadata:**\n`;
            if (typeMatch) result += `• **Object Type**: ${typeMatch[1]}\n`;
            if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`;
            if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`;
            if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`;
            if (languageMatch) result += `• **Current Language**: ${languageMatch[1]}\n`;
            if (abapLangVersionMatch) result += `• **ABAP Language Version**: ${abapLangVersionMatch[1]}\n`;
            if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`;
            if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`;
            if (createdAtMatch) {
                const date = new Date(createdAtMatch[1]);
                result += `• **Created At**: ${date.toLocaleString()}\n`;
            }
            if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`;
            if (changedAtMatch) {
                const date = new Date(changedAtMatch[1]);
                result += `• **Last Changed At**: ${date.toLocaleString()}\n`;
            }
            result += `\n`;
            
            // Package information
            const packageMatch = xmlContent.match(/<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/);
            if (packageMatch) {
                result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`;
            }
            
            // Row type information
            const typeKindMatch = xmlContent.match(/<ttyp:typeKind>([^<]+)<\/ttyp:typeKind>/);
            const typeNameMatch = xmlContent.match(/<ttyp:typeName>([^<]+)<\/ttyp:typeName>/);
            const dataTypeMatch = xmlContent.match(/<ttyp:dataType>([^<]+)<\/ttyp:dataType>/);
            const lengthMatch = xmlContent.match(/<ttyp:length>(\d+)<\/ttyp:length>/);
            const decimalsMatch = xmlContent.match(/<ttyp:decimals>(\d+)<\/ttyp:decimals>/);
            
            result += `**🔧 Row Type Definition:**\n`;
            if (typeKindMatch) result += `• **Type Kind**: ${typeKindMatch[1]}\n`;
            if (typeNameMatch) result += `• **Type Name**: \`${typeNameMatch[1]}\`\n`;
            if (dataTypeMatch) result += `• **Data Type**: ${dataTypeMatch[1]}\n`;
            if (lengthMatch && parseInt(lengthMatch[1]) > 0) result += `• **Length**: ${parseInt(lengthMatch[1])}\n`;
            if (decimalsMatch && parseInt(decimalsMatch[1]) > 0) result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`;
            result += `\n`;
            
            // Table characteristics
            const initialRowCountMatch = xmlContent.match(/<ttyp:initialRowCount>(\d+)<\/ttyp:initialRowCount>/);
            const accessTypeMatch = xmlContent.match(/<ttyp:accessType>([^<]+)<\/ttyp:accessType>/);
            
            result += `**📊 Table Characteristics:**\n`;
            if (accessTypeMatch) {
                const accessType = accessTypeMatch[1];
                const accessTypeDesc = {
                    'standard': 'Standard Table (index access)',
                    'sorted': 'Sorted Table (key and index access)',
                    'hashed': 'Hashed Table (key access only)',
                    'index': 'Index Table'
                }[accessType] || accessType;
                result += `• **Access Type**: ${accessTypeDesc}\n`;
            }
            if (initialRowCountMatch) {
                result += `• **Initial Row Count**: ${parseInt(initialRowCountMatch[1])}\n`;
            }
            result += `\n`;
            
            // Primary key information
            const keyDefinitionMatch = xmlContent.match(/<ttyp:definition>([^<]+)<\/ttyp:definition>/);
            const keyKindMatch = xmlContent.match(/<ttyp:kind>([^<]+)<\/ttyp:kind>/);
            const keyVisibleMatch = xmlContent.match(/<ttyp:primaryKey[^>]*ttyp:isVisible="([^"]+)"/);
            const keyEditableMatch = xmlContent.match(/<ttyp:primaryKey[^>]*ttyp:isEditable="([^"]+)"/);
            
            result += `**🔑 Primary Key:**\n`;
            if (keyDefinitionMatch) result += `• **Definition**: ${keyDefinitionMatch[1]}\n`;
            if (keyKindMatch) {
                const keyKind = keyKindMatch[1] === 'nonUnique' ? 'Non-unique' : 'Unique';
                result += `• **Key Kind**: ${keyKind}\n`;
            }
            if (keyVisibleMatch) result += `• **Visible**: ${keyVisibleMatch[1]}\n`;
            if (keyEditableMatch) result += `• **Editable**: ${keyEditableMatch[1]}\n`;
            result += `\n`;
            
            // Secondary keys information
            const secKeyAllowedMatch = xmlContent.match(/<ttyp:allowed>([^<]+)<\/ttyp:allowed>/);
            const secKeyVisibleMatch = xmlContent.match(/<ttyp:secondaryKeys[^>]*ttyp:isVisible="([^"]+)"/);
            const secKeyEditableMatch = xmlContent.match(/<ttyp:secondaryKeys[^>]*ttyp:isEditable="([^"]+)"/);
            
            if (secKeyAllowedMatch || secKeyVisibleMatch || secKeyEditableMatch) {
                result += `**🔑 Secondary Keys:**\n`;
                if (secKeyAllowedMatch) result += `• **Allowed**: ${secKeyAllowedMatch[1]}\n`;
                if (secKeyVisibleMatch) result += `• **Visible**: ${secKeyVisibleMatch[1]}\n`;
                if (secKeyEditableMatch) result += `• **Editable**: ${secKeyEditableMatch[1]}\n`;
                result += `\n`;
            }
            
            // Usage example
            result += `**💡 Usage Examples:**\n`;
            result += `\`\`\`abap\n`;
            result += `" Declaration\n`;
            result += `DATA: lt_table TYPE ${objectName.toLowerCase()}.\n\n`;
            result += `" Add entries\n`;
            result += `APPEND VALUE #( /* fields */ ) TO lt_table.\n\n`;
            result += `" Loop processing\n`;
            result += `LOOP AT lt_table INTO DATA(ls_entry).\n`;
            result += `  " Process entry\n`;
            result += `ENDLOOP.\n`;
            result += `\`\`\``;
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error parsing table type XML: ${error}`);
            result = `**Table Type**: ${objectName}\n\nError parsing XML: ${error}`;
        }
        
        return result;
    }

    private parseStructureXml(xmlContent: string, objectName: string): string {
        let result = '';
        
        try {
            // Extract all core attributes
            const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/);
            const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/);
            const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/);
            const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/);
            const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/);
            const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/);
            const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/);
            const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/);
            const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/);
            const typeMatch = xmlContent.match(/adtcore:type="([^"]+)"/);
            
            // Determine object type
            const isDataElement = xmlContent.includes('<dtel:dataElement');
            const isStructure = xmlContent.includes('<stru:');
            
            // Header information
            if (isDataElement) {
                result += `📊 **Data Element**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            } else if (isStructure) {
                result += `🏗️ **Structure**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            } else {
                result += `📄 **Dictionary Object**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            }
            
            if (descMatch) {
                result += `**Description**: ${descMatch[1]}\n\n`;
            }
            
            // Metadata
            result += `**📋 Metadata:**\n`;
            if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`;
            if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`;
            if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`;
            if (typeMatch) result += `• **Object Type**: ${typeMatch[1]}\n`;
            if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`;
            if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`;
            if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`;
            if (changedAtMatch) {
                const date = new Date(changedAtMatch[1]);
                result += `• **Last Changed**: ${date.toLocaleString()}\n`;
            }
            result += `\n`;
            
            // Package information
            const packageMatch = xmlContent.match(/<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/);
            if (packageMatch) {
                result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`;
            }
            
            // For Data Elements - extract ALL available information
            if (isDataElement) {
                // Type definition
                const typeKindMatch = xmlContent.match(/<dtel:typeKind>([^<]+)<\/dtel:typeKind>/);
                const typeNameMatch = xmlContent.match(/<dtel:typeName>([^<]+)<\/dtel:typeName>/);
                const domainMatch = xmlContent.match(/<dtel:domainName>([^<]+)<\/dtel:domainName>/);
                const dataTypeMatch = xmlContent.match(/<dtel:dataType>([^<]+)<\/dtel:dataType>/);
                const dataTypeLengthMatch = xmlContent.match(/<dtel:dataTypeLength>(\d+)<\/dtel:dataTypeLength>/);
                const dataTypeDecimalsMatch = xmlContent.match(/<dtel:dataTypeDecimals>(\d+)<\/dtel:dataTypeDecimals>/);
                const lengthMatch = xmlContent.match(/<dtel:length>(\d+)<\/dtel:length>/);
                const decimalsMatch = xmlContent.match(/<dtel:decimals>(\d+)<\/dtel:decimals>/);
                
                result += `**🔧 Technical Details:**\n`;
                if (typeKindMatch) result += `• **Type Kind**: ${typeKindMatch[1]}\n`;
                if (typeNameMatch) result += `• **Type Name**: \`${typeNameMatch[1]}\`\n`;
                if (domainMatch) result += `• **Domain**: \`${domainMatch[1]}\`\n`;
                if (dataTypeMatch) result += `• **Data Type**: ${dataTypeMatch[1]}\n`;
                if (dataTypeLengthMatch && parseInt(dataTypeLengthMatch[1]) > 0) result += `• **Data Type Length**: ${parseInt(dataTypeLengthMatch[1])}\n`;
                if (lengthMatch && parseInt(lengthMatch[1]) > 0) result += `• **Length**: ${parseInt(lengthMatch[1])}\n`;
                if (dataTypeDecimalsMatch && parseInt(dataTypeDecimalsMatch[1]) > 0) result += `• **Data Type Decimals**: ${parseInt(dataTypeDecimalsMatch[1])}\n`;
                if (decimalsMatch && parseInt(decimalsMatch[1]) > 0) result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`;
                result += `\n`;
                
                // Field labels (all variants)
                const shortFieldLabelMatch = xmlContent.match(/<dtel:shortFieldLabel>([^<]+)<\/dtel:shortFieldLabel>/);
                const shortFieldLengthMatch = xmlContent.match(/<dtel:shortFieldLength>(\d+)<\/dtel:shortFieldLength>/);
                const shortFieldMaxLengthMatch = xmlContent.match(/<dtel:shortFieldMaxLength>(\d+)<\/dtel:shortFieldMaxLength>/);
                const mediumFieldLabelMatch = xmlContent.match(/<dtel:mediumFieldLabel>([^<]+)<\/dtel:mediumFieldLabel>/);
                const mediumFieldLengthMatch = xmlContent.match(/<dtel:mediumFieldLength>(\d+)<\/dtel:mediumFieldLength>/);
                const mediumFieldMaxLengthMatch = xmlContent.match(/<dtel:mediumFieldMaxLength>(\d+)<\/dtel:mediumFieldMaxLength>/);
                const longFieldLabelMatch = xmlContent.match(/<dtel:longFieldLabel>([^<]+)<\/dtel:longFieldLabel>/);
                const longFieldLengthMatch = xmlContent.match(/<dtel:longFieldLength>(\d+)<\/dtel:longFieldLength>/);
                const longFieldMaxLengthMatch = xmlContent.match(/<dtel:longFieldMaxLength>(\d+)<\/dtel:longFieldMaxLength>/);
                const headingFieldLabelMatch = xmlContent.match(/<dtel:headingFieldLabel>([^<]+)<\/dtel:headingFieldLabel>/);
                const headingFieldLengthMatch = xmlContent.match(/<dtel:headingFieldLength>(\d+)<\/dtel:headingFieldLength>/);
                const headingFieldMaxLengthMatch = xmlContent.match(/<dtel:headingFieldMaxLength>(\d+)<\/dtel:headingFieldMaxLength>/);
                
                // Legacy field label fields
                const shortTextMatch = xmlContent.match(/<dtel:shortText>([^<]+)<\/dtel:shortText>/);
                const mediumTextMatch = xmlContent.match(/<dtel:mediumText>([^<]+)<\/dtel:mediumText>/);
                const longTextMatch = xmlContent.match(/<dtel:longText>([^<]+)<\/dtel:longText>/);
                const headingMatch = xmlContent.match(/<dtel:heading>([^<]+)<\/dtel:heading>/);
                
                if (shortFieldLabelMatch || mediumFieldLabelMatch || longFieldLabelMatch || headingFieldLabelMatch || shortTextMatch || mediumTextMatch || longTextMatch || headingMatch) {
                    result += `**🏷️ Field Labels:**\n`;
                    if (shortFieldLabelMatch) result += `• **Short Label**: "${shortFieldLabelMatch[1]}" (${shortFieldLengthMatch ? shortFieldLengthMatch[1] : '?'}/${shortFieldMaxLengthMatch ? shortFieldMaxLengthMatch[1] : '?'})\n`;
                    if (mediumFieldLabelMatch) result += `• **Medium Label**: "${mediumFieldLabelMatch[1]}" (${mediumFieldLengthMatch ? mediumFieldLengthMatch[1] : '?'}/${mediumFieldMaxLengthMatch ? mediumFieldMaxLengthMatch[1] : '?'})\n`;
                    if (longFieldLabelMatch) result += `• **Long Label**: "${longFieldLabelMatch[1]}" (${longFieldLengthMatch ? longFieldLengthMatch[1] : '?'}/${longFieldMaxLengthMatch ? longFieldMaxLengthMatch[1] : '?'})\n`;
                    if (headingFieldLabelMatch) result += `• **Heading**: "${headingFieldLabelMatch[1]}" (${headingFieldLengthMatch ? headingFieldLengthMatch[1] : '?'}/${headingFieldMaxLengthMatch ? headingFieldMaxLengthMatch[1] : '?'})\n`;
                    
                    // Show legacy labels if they exist and new ones don't
                    if (!shortFieldLabelMatch && shortTextMatch) result += `• **Short Text**: ${shortTextMatch[1]}\n`;
                    if (!mediumFieldLabelMatch && mediumTextMatch) result += `• **Medium Text**: ${mediumTextMatch[1]}\n`;
                    if (!longFieldLabelMatch && longTextMatch) result += `• **Long Text**: ${longTextMatch[1]}\n`;
                    if (!headingFieldLabelMatch && headingMatch) result += `• **Heading**: ${headingMatch[1]}\n`;
                    result += `\n`;
                }
                
                // Additional field properties
                const searchHelpMatch = xmlContent.match(/<dtel:searchHelp>([^<]+)<\/dtel:searchHelp>/);
                const searchHelpParameterMatch = xmlContent.match(/<dtel:searchHelpParameter>([^<]+)<\/dtel:searchHelpParameter>/);
                const setGetParameterMatch = xmlContent.match(/<dtel:setGetParameter>([^<]+)<\/dtel:setGetParameter>/);
                const defaultComponentNameMatch = xmlContent.match(/<dtel:defaultComponentName>([^<]+)<\/dtel:defaultComponentName>/);
                const deactivateInputHistoryMatch = xmlContent.match(/<dtel:deactivateInputHistory>([^<]+)<\/dtel:deactivateInputHistory>/);
                const changeDocumentMatch = xmlContent.match(/<dtel:changeDocument>([^<]+)<\/dtel:changeDocument>/);
                const leftToRightDirectionMatch = xmlContent.match(/<dtel:leftToRightDirection>([^<]+)<\/dtel:leftToRightDirection>/);
                const deactivateBIDIFilteringMatch = xmlContent.match(/<dtel:deactivateBIDIFiltering>([^<]+)<\/dtel:deactivateBIDIFiltering>/);
                
                if (searchHelpMatch || searchHelpParameterMatch || setGetParameterMatch || defaultComponentNameMatch || 
                    deactivateInputHistoryMatch || changeDocumentMatch || leftToRightDirectionMatch || deactivateBIDIFilteringMatch) {
                    result += `**⚙️ Field Properties:**\n`;
                    if (searchHelpMatch && searchHelpMatch[1]) result += `• **Search Help**: ${searchHelpMatch[1]}\n`;
                    if (searchHelpParameterMatch && searchHelpParameterMatch[1]) result += `• **Search Help Parameter**: ${searchHelpParameterMatch[1]}\n`;
                    if (setGetParameterMatch && setGetParameterMatch[1]) result += `• **Set/Get Parameter**: ${setGetParameterMatch[1]}\n`;
                    if (defaultComponentNameMatch && defaultComponentNameMatch[1]) result += `• **Default Component Name**: ${defaultComponentNameMatch[1]}\n`;
                    if (deactivateInputHistoryMatch) result += `• **Deactivate Input History**: ${deactivateInputHistoryMatch[1]}\n`;
                    if (changeDocumentMatch) result += `• **Change Document**: ${changeDocumentMatch[1]}\n`;
                    if (leftToRightDirectionMatch) result += `• **Left-to-Right Direction**: ${leftToRightDirectionMatch[1]}\n`;
                    if (deactivateBIDIFilteringMatch) result += `• **Deactivate BIDI Filtering**: ${deactivateBIDIFilteringMatch[1]}\n`;
                    result += `\n`;
                }
            }
            
            // For Structures - extract field information if available
            if (isStructure) {
                // Try to extract component information
                const componentMatches = xmlContent.match(/<stru:component[^>]*>/g);
                if (componentMatches && componentMatches.length > 0) {
                    result += `**🔧 Structure Components:**\n`;
                    result += `• **Number of Fields**: ${componentMatches.length}\n`;
                    result += `• Contains multiple data fields with their own types and properties\n\n`;
                }
            }
            
            // Usage examples
            result += `**💡 Usage Examples:**\n`;
            result += `\`\`\`abap\n`;
            if (isDataElement) {
                result += `" Variable declaration\n`;
                result += `DATA: lv_field TYPE ${objectName.toLowerCase()}.\n\n`;
                result += `" Parameter declaration\n`;
                result += `PARAMETERS: p_value TYPE ${objectName.toLowerCase()}.\n`;
            } else if (isStructure) {
                result += `" Structure declaration\n`;
                result += `DATA: ls_struct TYPE ${objectName.toLowerCase()}.\n\n`;
                result += `" Access structure components\n`;
                result += `ls_struct-field1 = 'value'.\n`;
                result += `WRITE: ls_struct-field2.\n`;
            } else {
                result += `" Declaration\n`;
                result += `DATA: lv_var TYPE ${objectName.toLowerCase()}.\n`;
            }
            result += `\`\`\``;
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error parsing structure/data element XML: ${error}`);
            result = `**Dictionary Object**: ${objectName}\n\nError parsing XML: ${error}`;
        }
        
        return result;
    }

    private parseTableXml(xmlContent: string, objectName: string): string {
        let result = '';
        
        try {
            // Extract all core attributes
            const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/);
            const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/);
            const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/);
            const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/);
            const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/);
            const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/);
            const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/);
            const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/);
            const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/);
            
            // Header information
            result += `🗃️ **Database Table**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            
            if (descMatch) {
                result += `**Description**: ${descMatch[1]}\n\n`;
            }
            
            // Metadata
            result += `**📋 Metadata:**\n`;
            if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`;
            if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`;
            if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`;
            if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`;
            if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`;
            if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`;
            if (changedAtMatch) {
                const date = new Date(changedAtMatch[1]);
                result += `• **Last Changed**: ${date.toLocaleString()}\n`;
            }
            result += `\n`;
            
            // Package information
            const packageMatch = xmlContent.match(/<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/);
            if (packageMatch) {
                result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`;
            }
            
            // Technical details
            const deliveryMatch = xmlContent.match(/<tabl:deliveryClass>([^<]+)<\/tabl:deliveryClass>/);
            const categoryMatch = xmlContent.match(/<tabl:dataClass>([^<]+)<\/tabl:dataClass>/);
            const sizeMatch = xmlContent.match(/<tabl:sizeCategory>([^<]+)<\/tabl:sizeCategory>/);
            const bufferMatch = xmlContent.match(/<tabl:buffering>([^<]+)<\/tabl:buffering>/);
            const logMatch = xmlContent.match(/<tabl:logging>([^<]+)<\/tabl:logging>/);
            
            result += `**🔧 Technical Settings:**\n`;
            if (deliveryMatch) {
                const deliveryDesc = {
                    'A': 'Application table (master and transaction data)',
                    'C': 'Customer table',
                    'G': 'Customer table, changes to repository',
                    'E': 'Control table',
                    'S': 'System table',
                    'W': 'System table (display/maintenance via SAP)'
                }[deliveryMatch[1]] || deliveryMatch[1];
                result += `• **Delivery Class**: ${deliveryMatch[1]} - ${deliveryDesc}\n`;
            }
            if (categoryMatch) result += `• **Data Class**: ${categoryMatch[1]}\n`;
            if (sizeMatch) result += `• **Size Category**: ${sizeMatch[1]}\n`;
            if (bufferMatch) result += `• **Buffering**: ${bufferMatch[1]}\n`;
            if (logMatch) result += `• **Logging**: ${logMatch[1]}\n`;
            result += `\n`;
            
            // Fields information (if available)
            const fieldMatches = xmlContent.match(/<tabl:field[^>]*>/g);
            if (fieldMatches && fieldMatches.length > 0) {
                result += `**📊 Table Structure:**\n`;
                result += `• **Number of Fields**: ${fieldMatches.length}\n`;
                result += `• Contains table fields with their data types and properties\n\n`;
            }
            
            // Primary key (if available)
            const keyFieldMatches = xmlContent.match(/<tabl:keyField[^>]*>/g);
            if (keyFieldMatches && keyFieldMatches.length > 0) {
                result += `**🔑 Primary Key:**\n`;
                result += `• **Key Fields**: ${keyFieldMatches.length}\n\n`;
            }
            
            // Indexes (if available)
            const indexMatches = xmlContent.match(/<tabl:index[^>]*>/g);
            if (indexMatches && indexMatches.length > 0) {
                result += `**📇 Indexes:**\n`;
                result += `• **Number of Indexes**: ${indexMatches.length}\n\n`;
            }
            
            // Usage examples
            result += `**💡 Usage Examples:**\n`;
            result += `\`\`\`abap\n`;
            result += `" Select data\n`;
            result += `SELECT * FROM ${objectName.toLowerCase()}\n`;
            result += `  INTO TABLE @DATA(lt_data)\n`;
            result += `  WHERE field1 = @lv_value.\n\n`;
            result += `" Insert data\n`;
            result += `INSERT ${objectName.toLowerCase()} FROM @ls_record.\n\n`;
            result += `" Update data\n`;
            result += `UPDATE ${objectName.toLowerCase()}\n`;
            result += `  SET field2 = @lv_new_value\n`;
            result += `  WHERE field1 = @lv_key.\n`;
            result += `\`\`\``;
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error parsing table XML: ${error}`);
            result = `**Database Table**: ${objectName}\n\nError parsing XML: ${error}`;
        }
        
        return result;
    }

    private parseDomainXml(xmlContent: string, objectName: string): string {
        let result = '';
        
        try {
            // Extract all core attributes
            const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/);
            const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/);
            const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/);
            const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/);
            const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/);
            const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/);
            const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/);
            const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/);
            const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/);
            
            // Header information
            result += `🔧 **Domain**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`;
            
            if (descMatch) {
                result += `**Description**: ${descMatch[1]}\n\n`;
            }
            
            // Metadata
            result += `**📋 Metadata:**\n`;
            if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`;
            if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`;
            if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`;
            if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`;
            if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`;
            if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`;
            if (changedAtMatch) {
                const date = new Date(changedAtMatch[1]);
                result += `• **Last Changed**: ${date.toLocaleString()}\n`;
            }
            result += `\n`;
            
            // Package information
            const packageMatch = xmlContent.match(/<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/);
            if (packageMatch) {
                result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`;
            }
            
            // Technical data type information
            const dataTypeMatch = xmlContent.match(/<doma:dataType>([^<]+)<\/doma:dataType>/);
            const lengthMatch = xmlContent.match(/<doma:length>(\d+)<\/doma:length>/);
            const decimalsMatch = xmlContent.match(/<doma:decimals>(\d+)<\/doma:decimals>/);
            const outputLengthMatch = xmlContent.match(/<doma:outputLength>(\d+)<\/doma:outputLength>/);
            const signedMatch = xmlContent.match(/<doma:signed>([^<]+)<\/doma:signed>/);
            const lowercaseMatch = xmlContent.match(/<doma:lowercase>([^<]+)<\/doma:lowercase>/);
            
            result += `**🔧 Technical Definition:**\n`;
            if (dataTypeMatch) {
                const dataTypeDesc = {
                    'CHAR': 'Character',
                    'NUMC': 'Numeric Character',
                    'DEC': 'Decimal',
                    'INT1': '1-byte Integer',
                    'INT2': '2-byte Integer',
                    'INT4': '4-byte Integer',
                    'INT8': '8-byte Integer',
                    'FLTP': 'Floating Point',
                    'CURR': 'Currency',
                    'QUAN': 'Quantity',
                    'DATS': 'Date',
                    'TIMS': 'Time',
                    'RAW': 'Raw Data',
                    'LANG': 'Language Key',
                    'UNIT': 'Unit of Measure',
                    'ACCP': 'Accounting Period',
                    'PREC': 'Precision',
                    'CLNT': 'Client'
                }[dataTypeMatch[1]] || dataTypeMatch[1];
                result += `• **Data Type**: ${dataTypeMatch[1]} (${dataTypeDesc})\n`;
            }
            if (lengthMatch && parseInt(lengthMatch[1]) > 0) result += `• **Length**: ${parseInt(lengthMatch[1])}\n`;
            if (decimalsMatch && parseInt(decimalsMatch[1]) > 0) result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`;
            if (outputLengthMatch && parseInt(outputLengthMatch[1]) > 0) result += `• **Output Length**: ${parseInt(outputLengthMatch[1])}\n`;
            if (signedMatch) result += `• **Signed**: ${signedMatch[1]}\n`;
            if (lowercaseMatch) result += `• **Lowercase Allowed**: ${lowercaseMatch[1]}\n`;
            result += `\n`;
            
            // Value range information
            const valueRangeMatch = xmlContent.match(/<doma:valueRange[^>]*>/);
            if (valueRangeMatch) {
                result += `**📊 Value Range:**\n`;
                
                // Fixed values
                const fixedValueMatches = xmlContent.match(/<doma:fixedValue[^>]*doma:value="([^"]*)"[^>]*doma:description="([^"]*)"/g);
                if (fixedValueMatches && fixedValueMatches.length > 0) {
                    result += `• **Fixed Values**: ${fixedValueMatches.length} defined\n`;
                    fixedValueMatches.slice(0, 5).forEach(match => {
                        const valueMatch = match.match(/doma:value="([^"]*)"/);
                        const descMatch = match.match(/doma:description="([^"]*)"/);
                        if (valueMatch) {
                            result += `  - \`${valueMatch[1]}\``;
                            if (descMatch && descMatch[1]) {
                                result += `: ${descMatch[1]}`;
                            }
                            result += `\n`;
                        }
                    });
                    if (fixedValueMatches.length > 5) {
                        result += `  - ... and ${fixedValueMatches.length - 5} more\n`;
                    }
                }
                
                // Intervals
                const intervalMatches = xmlContent.match(/<doma:interval[^>]*>/g);
                if (intervalMatches && intervalMatches.length > 0) {
                    result += `• **Intervals**: ${intervalMatches.length} defined\n`;
                }
                
                result += `\n`;
            }
            
            // Conversion exit
            const conversionExitMatch = xmlContent.match(/<doma:conversionExit>([^<]+)<\/doma:conversionExit>/);
            if (conversionExitMatch) {
                result += `**🔄 Conversion Exit**: ${conversionExitMatch[1]}\n\n`;
            }
            
            // Usage examples
            result += `**💡 Usage Examples:**\n`;
            result += `\`\`\`abap\n`;
            result += `" Data element using this domain\n`;
            result += `" (Domain defines technical characteristics)\n`;
            result += `DATA: lv_field TYPE some_data_element_using_${objectName.toLowerCase()}.\n\n`;
            result += `" Direct usage (rare)\n`;
            result += `DATA: lv_direct TYPE ${objectName.toLowerCase()}.\n`;
            result += `\`\`\``;
            
        } catch (error) {
            this.log?.(`[V2] ❌ Error parsing domain XML: ${error}`);
            result = `**Domain**: ${objectName}\n\nError parsing XML: ${error}`;
        }
        
        return result;
    }

    // ============================================================================
    // FALLBACK & CONTEXTUAL HOVERS
    // ============================================================================

    private getContextAwareHover(word: string, line: string): vscode.MarkdownString | undefined {
        const lineUpper = line.toUpperCase();
        
        if (lineUpper.includes('MESSAGE') && lineUpper.includes('TYPE')) {
            const messageTypes: { [key: string]: string } = {
                'I': 'Information', 'S': 'Success', 'W': 'Warning',
                'E': 'Error', 'A': 'Abort', 'X': 'Exit (short dump)'
            };
            const type = word.toUpperCase();
            if (messageTypes[type]) {
                const markdown = new vscode.MarkdownString();
                markdown.supportHtml = true;
                markdown.appendMarkdown(`💬 **Message Type**: \`${type}\`\n\n`);
                markdown.appendMarkdown(`**Description**: ${messageTypes[type]}\n\n`);
                markdown.appendCodeblock(`MESSAGE 'Your message' TYPE '${type}'.`, 'abap');
                return markdown;
            }
        }
        return undefined;
    }

    private getBuiltInTypeHover(word: string): vscode.MarkdownString | undefined {
        const builtInTypes: { [key: string]: string } = {
            'STRING': 'Variable-length character string.',
            'I': '4-byte integer.',
            'C': 'Fixed-length character string.',
            'D': 'Date field (YYYYMMDD).',
            'T': 'Time field (HHMMSS).',
            'P': 'Packed number (decimal).',
            'F': 'Floating point number.',
            'XSTRING': 'Variable-length byte string.',
            'X': 'Fixed-length byte string.'
        };

        const typeInfo = builtInTypes[word.toUpperCase()];
        if (typeInfo) {
            const markdown = new vscode.MarkdownString();
            markdown.supportHtml = true;
            markdown.appendMarkdown(`🔤 **Built-in Type**: \`${word.toUpperCase()}\`\n\n`);
            markdown.appendMarkdown(`**Description**: ${typeInfo}\n\n`);
            markdown.appendCodeblock(`DATA my_var TYPE ${word.toLowerCase()}.`, 'abap');
            return markdown;
        }
        return undefined;
    }

    private async getTextSymbolHover(word: string, document: vscode.TextDocument): Promise<vscode.MarkdownString | undefined> {
        // Check if it's a text symbol (TEXT-001, TEXT-002, etc.)
        const textSymbolMatch = word.match(/^TEXT-(\d{3})$/i);
        if (!textSymbolMatch) return undefined;

        const textId = textSymbolMatch[1];
       // this.log?.(`[V2] 🔍 Searching for text symbol: ${word}`);

        // Only try to find text in current document - no SAP client attempts
        return await this.searchTextElementInProgram(word, textId, document);
    }

    private async searchTextElementInProgram(word: string, textId: string, document: vscode.TextDocument): Promise<vscode.MarkdownString | undefined> {
        try {
            // Search for text element definitions in current document
            const documentText = document.getText();
            
            // Look for text element definitions in comments or text element sections
            const textDefPatterns = [
                new RegExp(`TEXT-${textId}\\s*['"]([^'"]+)['"]`, 'i'),
                new RegExp(`${textId}\\s*['"]([^'"]+)['"].*TEXT-${textId}`, 'i'),
                new RegExp(`TEXT-${textId}.*?['"]([^'"]+)['"]`, 'i')
            ];

            for (const pattern of textDefPatterns) {
                const match = documentText.match(pattern);
                if (match) {
                    const textContent = match[1];
                    const markdown = new vscode.MarkdownString();
                    markdown.supportHtml = true;
                    
                    markdown.appendMarkdown(`📝 **Text Symbol**: \`${word}\`\n\n`);
                    markdown.appendMarkdown(`**Text**: "${textContent}"\n\n`);
                    markdown.appendMarkdown(`*Found in current program*\n\n`);
                    markdown.appendMarkdown(`**Usage Examples:**\n`);
                    markdown.appendCodeblock(`MESSAGE ${word} TYPE 'I'.\n" Display as message\n\nWRITE: / ${word}.\n" Display as output`, 'abap');
                    
                    return markdown;
                }
            }

        } catch (error) {
            this.log?.(`[V2] ❌ Error searching text element in program: ${error}`);
        }

        return undefined;
    }

    private async isMethodDeclaration(doc: vscode.TextDocument, startLine: number, definitionText: string, word: string): Promise<boolean> {
        try {
            // Check if definition line contains only the identifier (no ABAP keywords)
            const cleanLine = definitionText.trim();
            const lineUpper = cleanLine.toUpperCase();
            
            // If line contains ABAP keywords as separate words, it's not a simple method declaration
            const lineWords = lineUpper.split(/\s+/);
            const firstWord = lineWords[0];
            
            if (firstWord === 'METHOD' || firstWord === 'DATA' || firstWord === 'TYPES' || 
                firstWord === 'FUNCTION' || firstWord === 'CLASS' || firstWord === 'INCLUDE' ||
                firstWord === 'PARAMETERS' || firstWord === 'TABLES') {
                return false;
            }
            
            // Check if the line contains mainly just the word we're looking for
            const words = cleanLine.split(/\s+/);
            if (words.length > 2) {
                return false; // Too many words, probably not a simple method declaration
            }
            
            // Look ahead for method parameter keywords
            let foundParameterKeyword = false;
            for (let i = startLine + 1; i < Math.min(startLine + 10, doc.lineCount); i++) {
                const line = doc.lineAt(i).text;
                const lineUpper = line.trim().toUpperCase();
                
                if (lineUpper.includes('IMPORTING') || lineUpper.includes('EXPORTING') || 
                    lineUpper.includes('CHANGING') || lineUpper.includes('RETURNING')) {
                    foundParameterKeyword = true;
                    break;
                }
                
                // Stop if we hit something that doesn't look like method parameters
                if (lineUpper.includes('METHOD') || lineUpper.includes('DATA') || 
                    lineUpper.includes('ENDCLASS') || lineUpper.includes('PRIVATE') ||
                    lineUpper.includes('PUBLIC') || lineUpper.includes('PROTECTED')) {
                    break;
                }
            }
            
           // this.log?.(`[V2] 🔍 Method declaration check for "${word}": paramKeyword=${foundParameterKeyword}`);
            
            // Consider it a method declaration if we found parameter keywords
            return foundParameterKeyword;
            
        } catch (error) {
          //  this.log?.(`[V2] ⚠️ Error checking method declaration: ${error}`);
            return false;
        }
    }

    private async extractMethodDeclaration(doc: vscode.TextDocument, startLine: number): Promise<string | undefined> {
        try {
            //this.log?.(`[V2] 🔧 Extracting method declaration from line ${startLine + 1}`);
            
            let signatureText = '';
            
            for (let i = startLine; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text;
                const trimmedLine = line.trim();

                if (trimmedLine.startsWith('*')) continue; // Skip full-line comments
                
                const commentIndex = trimmedLine.indexOf('"');
                const lineContent = commentIndex !== -1 ? trimmedLine.substring(0, commentIndex) : trimmedLine;

                // Check stop conditions BEFORE adding the line
                
                // Stop when we find a period or comma that ends the method declaration
                if (lineContent.trim().includes('.') || lineContent.trim().includes(',')) {
                    // Add this final line and then stop
                    signatureText += line + '\n';
                  //  this.log?.(`[V2] ✅ Found method declaration end at line ${i + 1}`);
                    break;
                }
                
                // Stop if we hit another method or class section (DON'T include these lines)
                const trimmedUpper = lineContent.trim().toUpperCase();
                if (i > startLine) {
                    // Check for exact ABAP section keywords (not just prefixes)
                    const words = trimmedUpper.split(/\s+/);
                    const firstWord = words[0];
                    
                    if (firstWord === 'METHOD' || firstWord === 'DATA:' || firstWord === 'DATA' ||
                        firstWord === 'PRIVATE' || firstWord === 'PUBLIC' || firstWord === 'PROTECTED' || 
                        firstWord === 'ENDCLASS' || trimmedUpper === 'METHODS:') {
                      //  this.log?.(`[V2] 🛑 Hit new section at line ${i + 1}, stopping extraction`);
                        break;
                    }
                }
                
                // Safety check
                if (i - startLine > 30) {
                  //  this.log?.(`[V2] ⚠️ Method declaration too long, truncating at line ${i + 1}`);
                    break;
                }

                // If we reach here, add the line
                signatureText += line + '\n';
            }

            const finalSignature = signatureText.trim();
          //  this.log?.(`[V2] 📄 Extracted method declaration: ${finalSignature.length} chars`);
            
            return finalSignature.length > 0 ? finalSignature : undefined;
            
        } catch (error) {
          //  this.log?.(`[V2] ❌ Error extracting method declaration: ${error}`);
            return undefined;
        }
    }
}
