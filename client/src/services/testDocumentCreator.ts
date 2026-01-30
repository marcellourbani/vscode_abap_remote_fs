/**
 * Test Documentation Creator Service
 * Creates Word documents from Playwright screenshots organized by scenarios
 */

import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } from 'docx';

export interface TestScenario {
  scenarioId: number;
  scenarioName: string;
  scenarioDescription: string;
  screenshots: Array<{
    filePath: string;
    description: string;
  }>;
}

export interface TestDocumentOptions {
  scenarios: TestScenario[];
  reportTitle?: string;
  testDate?: string;
}

export class TestDocumentCreator {
  
  /**
   * Creates a Word document from test scenarios and screenshots
   */
  async createDocument(options: TestDocumentOptions): Promise<Buffer> {
    const { scenarios, reportTitle = 'Test Documentation Report', testDate = new Date().toISOString().split('T')[0] } = options;
    
    // Create document sections
    const sections: Paragraph[] = [];
    
    // Add title and header
    sections.push(
      new Paragraph({
        text: reportTitle,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Test Date: ${testDate}`,
            bold: true,
          }),
        ],
        spacing: { after: 400 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated: ${new Date().toLocaleString()}`,
            italics: true,
            size: 20,
          }),
        ],
        spacing: { after: 600 },
      })
    );
    
    // Process each scenario
    for (const scenario of scenarios) {
      // Scenario header
      sections.push(
        new Paragraph({
          text: `Scenario ${scenario.scenarioId}: ${scenario.scenarioName}`,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 600, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: scenario.scenarioDescription,
              italics: true,
            }),
          ],
          spacing: { after: 400 },
        })
      );
      
      // Process screenshots for this scenario
      for (let i = 0; i < scenario.screenshots.length; i++) {
        const screenshot = scenario.screenshots[i];
        
        try {
          // Read image file
          const normalizedPath = path.normalize(screenshot.filePath);
          const imageUri = vscode.Uri.file(normalizedPath);
          const imageData = await vscode.workspace.fs.readFile(imageUri);
          
          // Add screenshot description
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${i + 1}. ${screenshot.description}`,
                  bold: true,
                }),
              ],
              spacing: { before: 300, after: 100 },
            })
          );
          
          // Add image with proper PNG format specification
          sections.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageData,
                  transformation: {
                    width: 600,
                    height: 400,
                  },
                  type: 'png',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            })
          );
          
        } catch (imageError) {
          // Add error message if image can't be loaded
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${i + 1}. ${screenshot.description}`,
                  bold: true,
                }),
              ],
              spacing: { before: 300, after: 100 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Error loading image: ${screenshot.filePath} - ${imageError}`,
                  color: 'FF0000',
                  italics: true,
                }),
              ],
              spacing: { after: 400 },
            })
          );
        }
      }
    }
    
    // Create document
    const doc = new Document({
      sections: [{
        children: sections,
      }],
    });
    
    // Generate buffer
    return await Packer.toBuffer(doc);
  }
  
  /**
   * Shows save dialog and saves the document
   */
  async saveDocument(documentBuffer: Buffer, defaultFileName?: string): Promise<string | null> {
    const fileName = defaultFileName || `test-documentation-${Date.now()}.docx`;
    
    const saveUri = await window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: {
        'Word Documents': ['docx'],
        'All Files': ['*']
      },
      title: 'Save Test Documentation'
    });
    
    if (saveUri) {
      await vscode.workspace.fs.writeFile(saveUri, documentBuffer);
      return saveUri.fsPath;
    }
    
    return null;
  }
}
