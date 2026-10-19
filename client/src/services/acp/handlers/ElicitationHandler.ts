import * as vscode from 'vscode';
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationFormMode,
  ElicitationContentValue,
  ElicitationPropertySchema,
} from '@agentclientprotocol/sdk';
import { log } from '../utils/Logger';

type FieldResult =
  | { kind: 'value'; value: ElicitationContentValue }
  | { kind: 'skip' }
  | { kind: 'cancel' }
  | { kind: 'unsupported' };

interface ElicitationPick extends vscode.QuickPickItem {
  value: string | boolean | null;
}

export class ElicitationHandler {
  async createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    if (params.mode !== 'form') {
      log(`Unsupported ACP elicitation mode: ${params.mode}`);
      return { action: 'decline' };
    }

    const form = params as ElicitationFormMode & { mode: 'form'; message: string };
    const schema = form.requestedSchema;
    const properties = Object.entries(schema.properties || {});
    const required = new Set(schema.required || []);
    const content: Record<string, ElicitationContentValue> = {};

    for (let index = 0; index < properties.length; index++) {
      const [name, property] = properties[index];
      const result = await this.promptField(form, name, property, required.has(name), index + 1, properties.length);
      if (result.kind === 'cancel') {
        return { action: 'cancel' };
      }
      if (result.kind === 'unsupported') {
        vscode.window.showWarningMessage(`The agent requested an unsupported input type for "${name}".`);
        return { action: 'decline' };
      }
      if (result.kind === 'value') {
        content[name] = result.value;
      }
    }

    return { action: 'accept', content };
  }

  private async promptField(
    request: ElicitationFormMode & { mode: 'form'; message: string },
    name: string,
    property: ElicitationPropertySchema,
    required: boolean,
    index: number,
    total: number,
  ): Promise<FieldResult> {
    const field = property as unknown as Record<string, any>;
    const title = `${request.requestedSchema.title || 'Agent'} (${index}/${total})`;
    const prompt = [request.message, field.description].filter(Boolean).join('\n\n');
    const enumOptions = this.enumOptions(field);

    if (property.type === 'boolean') {
      const items: ElicitationPick[] = [
        { label: 'True', value: true },
        { label: 'False', value: false },
      ];
      if (!required) {
        items.push({ label: 'Skip', value: null });
      }
      const selected = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: field.title || name,
        ignoreFocusOut: true,
      });
      if (!selected) {
        return { kind: 'cancel' };
      }
      return selected.value === null ? { kind: 'skip' } : { kind: 'value', value: selected.value };
    }

    if (property.type === 'string' && enumOptions.length > 0) {
      const items: ElicitationPick[] = enumOptions.map(option => ({
        label: option.title,
        description: option.description,
        value: option.value,
      }));
      if (!required) {
        items.push({ label: 'Skip', value: null });
      }
      const selected = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: field.title || name,
        ignoreFocusOut: true,
      });
      if (!selected) {
        return { kind: 'cancel' };
      }
      return selected.value === null ? { kind: 'skip' } : { kind: 'value', value: selected.value as string };
    }

    if (property.type === 'array') {
      const values = this.multiSelectOptions(field.items);
      if (values) {
        const items: ElicitationPick[] = values.map(option => ({
          label: option.title,
          description: option.description,
          value: option.value,
        }));
        const selected = await vscode.window.showQuickPick(items, {
          title,
          placeHolder: `${field.title || name} (select all that apply)`,
          canPickMany: true,
          ignoreFocusOut: true,
        });
        if (selected === undefined) {
          return { kind: 'cancel' };
        }
        const picked = selected.map(item => item.value as string);
        if (required && picked.length === 0) {
          vscode.window.showWarningMessage(`Select at least one value for "${name}".`);
          return this.promptField(request, name, property, required, index, total);
        }
        if ((field.minItems !== undefined && field.minItems !== null && picked.length < field.minItems)
          || (field.maxItems !== undefined && field.maxItems !== null && picked.length > field.maxItems)) {
          vscode.window.showWarningMessage(`The selection count for "${name}" is outside the allowed range.`);
          return this.promptField(request, name, property, required, index, total);
        }
        return { kind: 'value', value: picked };
      }

      const value = await vscode.window.showInputBox({
        title,
        prompt: `${prompt}\nEnter comma-separated values.`,
        placeHolder: field.title || name,
        ignoreFocusOut: true,
        validateInput: input => {
          const count = input.split(',').map(item => item.trim()).filter(Boolean).length;
          if (required && count === 0) {
            return 'Enter at least one value.';
          }
          if (field.minItems !== undefined && field.minItems !== null && count < field.minItems) {
            return `Enter at least ${field.minItems} values.`;
          }
          if (field.maxItems !== undefined && field.maxItems !== null && count > field.maxItems) {
            return `Enter no more than ${field.maxItems} values.`;
          }
          return undefined;
        },
      });
      if (value === undefined) {
        return { kind: 'cancel' };
      }
      const picked = value.split(',').map(item => item.trim()).filter(Boolean);
      return picked.length ? { kind: 'value', value: picked } : { kind: 'skip' };
    }

    if (property.type !== 'string' && property.type !== 'number' && property.type !== 'integer') {
      return { kind: 'unsupported' };
    }

    const value = await vscode.window.showInputBox({
      title,
      prompt,
      placeHolder: field.title || name,
      value: typeof field.default === 'string' ? field.default : undefined,
      ignoreFocusOut: true,
      validateInput: input => this.validateValue(input, property.type, field, required),
    });
    if (value === undefined) {
      return { kind: 'cancel' };
    }
    if (value === '' && !required) {
      return { kind: 'skip' };
    }
    if (property.type === 'string') {
      return { kind: 'value', value };
    }
    const numberValue = Number(value);
    return { kind: 'value', value: property.type === 'integer' ? Math.trunc(numberValue) : numberValue };
  }

  private validateValue(
    value: string,
    type: string,
    field: Record<string, any>,
    required: boolean,
  ): string | undefined {
    if (required && value.trim() === '') {
      return 'This value is required.';
    }
    if (type === 'string') {
      if (field.minLength !== undefined && field.minLength !== null && value.length < field.minLength) {
        return `Enter at least ${field.minLength} characters.`;
      }
      if (field.maxLength !== undefined && field.maxLength !== null && value.length > field.maxLength) {
        return `Enter no more than ${field.maxLength} characters.`;
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            return 'The value does not match the required format.';
          }
        } catch {
          return 'The agent supplied an invalid input pattern.';
        }
      }
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 'Enter a valid number.';
    }
    if (type === 'integer' && !Number.isInteger(parsed)) {
      return 'Enter a whole number.';
    }
    if (field.minimum !== undefined && field.minimum !== null && parsed < field.minimum) {
      return `Enter a value of at least ${field.minimum}.`;
    }
    if (field.maximum !== undefined && field.maximum !== null && parsed > field.maximum) {
      return `Enter a value no greater than ${field.maximum}.`;
    }
    return undefined;
  }

  private enumOptions(field: Record<string, any>): Array<{ value: string; title: string; description?: string }> {
    if (Array.isArray(field.oneOf)) {
      return field.oneOf
        .filter((option: any) => typeof option?.const === 'string')
        .map((option: any) => ({
          value: option.const,
          title: option.title || option.const,
          description: option.description || undefined,
        }));
    }
    if (Array.isArray(field.enum)) {
      return field.enum
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => ({ value, title: value }));
    }
    return [];
  }

  private multiSelectOptions(items: any): Array<{ value: string; title: string; description?: string }> | undefined {
    if (!items || typeof items !== 'object') {
      return undefined;
    }
    if (Array.isArray(items.anyOf)) {
      return items.anyOf
        .filter((option: any) => typeof option?.const === 'string')
        .map((option: any) => ({
          value: option.const,
          title: option.title || option.const,
          description: option.description || undefined,
        }));
    }
    if (Array.isArray(items.enum)) {
      return items.enum
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => ({ value, title: value }));
    }
    return undefined;
  }
}
