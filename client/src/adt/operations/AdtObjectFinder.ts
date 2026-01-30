import { PACKAGE } from "./AdtObjectCreator"
import {
  ADTClient,
  CreatableTypeIds,
  FragmentLocation,
  ObjectType,
  SearchResult,
  UriParts
} from "abap-adt-api"
import {
  window,
  QuickPickItem,
  workspace,
  commands,
  Uri,
  FileStat,
  Range,
  ThemeIcon
} from "vscode"

import { splitAdtUri, vscPosition, log, caughtToString, promCache } from "../../lib"
import { getClient, getRoot, uriRoot } from "../conections"
import {
  PathItem,
  isFolder,
  isAbapFolder,
  isAbapFile,
  isAbapStat,
  Root,
  AbapFile,
  AbapStat
} from "abapfs"

interface AdtSearchResult {
  uri: string
  type: string
  name: string
  packageName?: string
  description?: string
}

export class MySearchResult implements QuickPickItem, AdtSearchResult {
  public static async createResults(
    results: SearchResult[],
    client: ADTClient
  ) {
    const myresults = results.map(r => new MySearchResult(r))
    if (myresults.find(r => !r.description)) {
      if (!this.types) this.types = await client.loadTypes()
      myresults
        .filter(r => !r.description)
        .forEach(r => {
          const typ = this.types.find(t => t.OBJECT_TYPE === r.type)
          r.description = typ ? typ.OBJECT_TYPE_LABEL : r.type
        })
    }
    myresults.forEach(typ => {
      if (!typ.packageName)
        typ.packageName = typ.type === PACKAGE ? typ.name : "unknown"
    })
    return myresults
  }
  private static types: ObjectType[]
  get label(): string {
    return `${this.name}(${this.description})`
  }
  public uri: string
  public type: string
  public name: string
  public packageName?: string
  public description?: string
  get detail(): string | undefined {
    return `Package ${this.packageName} type ${this.type}`
  }
  public picked: boolean = false
  constructor(r: SearchResult) {
    this.uri = r["adtcore:uri"]
    this.type = r["adtcore:type"]
    this.name = r["adtcore:name"]
    this.packageName = r["adtcore:packageName"]
    this.description = r["adtcore:description"]
  }
}

export class AdtObjectFinder {
  constructor(public readonly connId: string) { }
  private fragCache = promCache<FragmentLocation>()

  public async vscodeUriWithFile(uri: string, main = true) {
    const { path, file } = (await getRoot(this.connId).findByAdtUri(uri, main)) || {}
    if (!path) throw new Error(`can't find an URL for ${uri}`)
    const url = createUri(this.connId, path).toString()
    return { uri: url, file }
  }

  public async vscodeUri(uri: string, main = true) {
    const uf = await this.vscodeUriWithFile(uri, main)
    return uf.uri
  }

  public async vscodeObject(uri: string, main = true) {
    const { file } = await this.vscodeUriWithFile(uri, main)
    if (isAbapStat(file)) return file.object
  }

  public clearCaches() {
    this.fragCache = promCache()
  }

  public async vscodeRange(uri: string | UriParts, useFragCache = false) {
    const u = splitAdtUri(uri)
    const rval = { uri: "", start: u.start, file: undefined as AbapFile | undefined }
    if (u.type && u.name) {
      const getFrag = () => getClient(this.connId).fragmentMappings(u.path, u.type!, u.name!)
      const frag = await this.fragCache(`${u.path}_${u.type}_${u.name}`, getFrag, !useFragCache)
      const uf = await this.vscodeUriWithFile(frag.uri)
      rval.uri = uf.uri
      if (isAbapFile(uf.file)) rval.file = uf.file // should always be an abapfile at this point
      rval.start = vscPosition(frag.line + (u.start?.line || 0), frag.column)
    }
    else {
      const uf = await this.vscodeUriWithFile(u.path)
      if (isAbapFile(uf.file)) rval.file = uf.file // should always be an abapfile at this point
      rval.uri = uf.uri
    }
    return rval
  }

  public async vscodeUriFromAdt(adtUri: string) {
    const prefixRe = /adt:\/\/[^\/]+\/sap\/bc\/adt/
    if (adtUri.match(prefixRe)) {
      const base = adtUri.replace(prefixRe, "/sap/bc/adt")
      const { uri, start } = await this.vscodeRange(base)
      return { uri: Uri.parse(uri), start }
    } else {
      throw new Error(`Unexpected ADT URI format for ${adtUri}`)
    }

  }

  public async displayAdtUri(adtUri: string) {
    try {
      const { uri, start } = await this.vscodeUriFromAdt(adtUri) || {}
      if (uri && start) {
        const document = await workspace.openTextDocument(uri)
        const selection = start ? new Range(start, start) : undefined
        window.showTextDocument(document, { selection })
      }
    } catch (error) {
      window.showErrorMessage(`Failed to open document ofr object ${adtUri}:\n${caughtToString(error)}`)
    }
  }

  public async displayNode(nodePath: PathItem) {
    let uri
    if (isFolder(nodePath.file)) {
      if (
        isAbapFolder(nodePath.file) &&
        nodePath.file.object.type.match(/DEVC/i)
      ) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      const main = await findMainIncludeAsync(nodePath)
      if (!main) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      uri = main.path
    } else uri = nodePath.path
    try {
      const doc = await workspace.openTextDocument(createUri(this.connId, uri))
      await window.showTextDocument(doc)
      commands.executeCommand("workbench.files.action.showActiveFileInExplorer")
    } catch (e) {
      window.showErrorMessage(
        `Error displaying object ${nodePath.path}.Type not supported?`
      )
    }
  }
  EPMTYPACKAGE = {
    "adtcore:uri": "",
    "adtcore:type": PACKAGE,
    "adtcore:name": "",
    "adtcore:packageName": "",
    "adtcore:description": "<NONE>"
  }
  /**
   * Enhanced search with type selection UI (for manual search command)
   */
  public async findObjectWithTypeFilter(
    prompt: string = "Search an ABAP object",
    forceTypeSelection: boolean = false
  ): Promise<MySearchResult | undefined> {
    const context = (await import('../../extension')).context
    const skipTypeSelectionKey = 'abapfs.searchSkipTypeSelection'
    const skipTypeSelection = context.globalState.get<boolean>(skipTypeSelectionKey)
    const savedTypesKey = 'abapfs.searchTypeFilter'
    const savedTypes = context.globalState.get<string[]>(savedTypesKey)
    
    let selectedTypes: string[] | undefined
    
    // Check if we should skip type selection (unless forced to show it)
    if (!forceTypeSelection && skipTypeSelection === true && savedTypes !== undefined) {
      // Use saved types directly, skip type selection
      selectedTypes = savedTypes
    } else {
      // Show type selector
      selectedTypes = await this.selectObjectTypes()
      if (selectedTypes === undefined) {
        return undefined // User cancelled
      }
      
      // Ask if user wants to skip type selection in future (only if preference not set yet, or if forced)
      if (skipTypeSelection === undefined || forceTypeSelection) {
        const answer = await window.showQuickPick(
          [
            { label: 'Yes', value: true, description: 'Skip type selection and use these types for future searches' },
            { label: 'No', value: false, description: 'Always ask me to select types before searching' }
          ],
          {
            placeHolder: 'Would you like to save this type preference for future searches?',
            title: 'Save Search Type Preference'
          }
        )
        
        if (answer) {
          await context.globalState.update(skipTypeSelectionKey, answer.value)
        }
      }
    }
    // Note: selectedTypes can be [] (empty array) if all types are selected - this is intentional
    
    // Step 2: Search with selected types
    return this.findObject(prompt, "", undefined, selectedTypes)
  }
  
  /**
   * Select object types to filter search
   */
  private async selectObjectTypes(): Promise<string[] | undefined> {
    const storageKey = 'abapfs.searchTypeFilter'
    const context = (await import('../../extension')).context
    const previousSelection = context.globalState.get<string[]>(storageKey) || []
    
    // All SAP object types supported by ADT search
    const objectTypes = [
      // Programs & Code
      { type: 'PROG/P', label: 'Programs (Reports)', picked: previousSelection.includes('PROG/P') },
      { type: 'PROG/I', label: 'Includes', picked: previousSelection.includes('PROG/I') },
      { type: 'CLAS/OC', label: 'Classes', picked: previousSelection.includes('CLAS/OC') },
      { type: 'INTF/OI', label: 'Interfaces', picked: previousSelection.includes('INTF/OI') },
      { type: 'FUGR/F', label: 'Function Groups', picked: previousSelection.includes('FUGR/F') },
      { type: 'FUGR/FF', label: 'Function Modules', picked: previousSelection.includes('FUGR/FF') },
      { type: 'TYPE/TY', label: 'Type Groups', picked: previousSelection.includes('TYPE/TY') },
      
      // Dictionary Objects
      { type: 'TABL/DT', label: 'Database Tables', picked: previousSelection.includes('TABL/DT') },
      { type: 'TABL/DS', label: 'Structures', picked: previousSelection.includes('TABL/DS') },
      { type: 'DTEL/DE', label: 'Data Elements', picked: previousSelection.includes('DTEL/DE') },
      { type: 'DOMA/DD', label: 'Domains', picked: previousSelection.includes('DOMA/DD') },
      { type: 'TTYP/DA', label: 'Table Types', picked: previousSelection.includes('TTYP/DA') },
      { type: 'VIEW/DV', label: 'Views', picked: previousSelection.includes('VIEW/DV') },
      { type: 'SHLP/DH', label: 'Search Helps', picked: previousSelection.includes('SHLP/DH') },
      { type: 'ENQU/DL', label: 'Lock/Enqueue Objects (ENQU/DL)', picked: previousSelection.includes('ENQU/DL') },
      { type: 'DDLS/DF', label: 'CDS Data Definitions (DDLS/DF)', picked: previousSelection.includes('DDLS/DF') },
      { type: 'STOB/DO', label: 'CDS Entities (STOB/DO)', picked: previousSelection.includes('STOB/DO') },
      { type: 'VIEW/DV', label: 'CDS Database Views (VIEW/DV)', picked: previousSelection.includes('VIEW/DV') },
      
      // Other Objects
      { type: 'MSAG/N', label: 'Message Classes', picked: previousSelection.includes('MSAG/N') },
      { type: 'TRAN/T', label: 'Transactions', picked: previousSelection.includes('TRAN/T') },
      { type: 'DEVC/K', label: 'Packages', picked: previousSelection.includes('DEVC/K') },
      
      // Enhancements & BAdIs
      { type: 'ENHO/XHB', label: 'Enhancement Implementations', picked: previousSelection.includes('ENHO/XHB') },
      { type: 'ENHS/XS', label: 'Enhancement Spots', picked: previousSelection.includes('ENHS/XS') },
      { type: 'SXSD/XD', label: 'BAdI Definitions', picked: previousSelection.includes('SXSD/XD') },
      { type: 'SXCI/XI', label: 'BAdI Implementations', picked: previousSelection.includes('SXCI/XI') },
      
      // Transformations
      { type: 'XSLT/XT', label: 'XSLT Programs', picked: previousSelection.includes('XSLT/XT') },
      { type: 'STOB/ST', label: 'Simple Transformations', picked: previousSelection.includes('STOB/ST') },
      
      // Authorization & Security
      { type: 'SUSO/SO', label: 'Authorization Objects', picked: previousSelection.includes('SUSO/SO') },
      { type: 'SUSC/SC', label: 'Authorization Object Classes', picked: previousSelection.includes('SUSC/SC') },

      // Advanced Objects
      { type: 'PINF/PI', label: 'Package Interfaces', picked: previousSelection.includes('PINF/PI') },
      { type: 'NROB/NR', label: 'Number Range Objects', picked: previousSelection.includes('NROB/NR') },
      
    ]
    
    const selected = await window.showQuickPick(
      objectTypes.map(ot => ({
        label: ot.label,
        description: ot.type,
        picked: ot.picked,
        type: ot.type
      })),
      {
        canPickMany: true,
        placeHolder: '⚠️ Type here to FILTER the list below (not to search objects!)',
        title: '1️⃣ Select Object Types → 2️⃣ Then Search Objects',
        matchOnDescription: true,
        matchOnDetail: true
      }
    )
    
    if (!selected || selected.length === 0) {
      return undefined
    }
    
    const selectedTypeStrings = selected.map(s => (s as any).type)
    
    // Save selection for next time
    await context.globalState.update(storageKey, selectedTypeStrings)
    
    // If all types are selected, return empty array to search all types
    // This ensures we don't miss any object types that might not be in our list
    if (selectedTypeStrings.length === objectTypes.length) {
      return [] // Empty array will be treated as "search all types"
    }
    
    return selectedTypeStrings
  }
  
  public async findObject(
    prompt: string = "Search an ABAP object",
    objType: string = "",
    forType?: CreatableTypeIds,
    typeFilter?: string[]
  ): Promise<MySearchResult | undefined> {
    const context = (await import('../../extension')).context
    
    const o = await new Promise<MySearchResult>(async resolve => {
      const empty: MySearchResult[] = []
      if (forType === PACKAGE) empty.push(new MySearchResult(this.EPMTYPACKAGE))
      const qp = window.createQuickPick()
      qp.ignoreFocusOut = true
      
      // Add button to change type filter (show always when no specific type is requested)
      if (!objType && !forType) {
        qp.buttons = [{
          iconPath: new ThemeIcon('filter'),
          tooltip: 'Change Type Filter (Click to select different object types)'
        }]
        
        qp.onDidTriggerButton(async () => {
          qp.hide()
          // Re-run the full flow (force type selection and ask preference again)
          const result = await this.findObjectWithTypeFilter(prompt, true)
          if (result) {
            resolve(result)
          }
        })
        
        // Update placeholder to mention the filter button
        prompt = prompt + ' (Use filter button on the top right to change types)'
      }
      
      const searchParent = async (e: string) => {
        qp.items =
          e.length >= 2
            ? await this.search(e, getClient(this.connId), objType, typeFilter)
            : empty
      }

      qp.items = empty
      qp.items = [...empty]
      qp.onDidChangeValue(async e => searchParent(e))
      qp.placeholder = prompt
      qp.onDidChangeSelection(e => {
        if (e[0]) {
          resolve(e[0] as MySearchResult)
          qp.hide()
        }
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    })
    return o
  }

  private async search(
    prefix: string,
    client: ADTClient,
    objType: string = "",
    typeFilter?: string[]
  ): Promise<MySearchResult[]> {
    const query = prefix.toUpperCase() + "*"
    const raw = await client.searchObject(query, objType)
    
    // Apply type filter if provided
    let filtered = raw
    if (typeFilter && typeFilter.length > 0) {
      filtered = raw.filter(r => typeFilter.includes(r["adtcore:type"]))
    } else if (objType) {
      // Fallback to original objType filtering
      filtered = raw.filter(r => objType === r["adtcore:type"])
    }
    
    return await MySearchResult.createResults(filtered, client)
  }
}

const findMainIncludeAsync = async (item: PathItem) => {
  if (isAbapFile(item.file)) return item
  if (isAbapFolder(item.file)) {
    const main = item.file.mainInclude(item.path)
    if (main) return main
    await item.file.refresh()
    return item.file.mainInclude(item.path)
  }
}

export function createUri(connId: string, path: string, query: string = "") {
  return Uri.parse("adt://" + connId).with({
    path,
    query
  })
}

export async function findAbapObject(uri: Uri) {
  const file = await uriRoot(uri).getNodeAsync(uri.path)
  if (isAbapStat(file)) return file.object
  throw new Error("Not an ABAP object")
}

export const uriAbapFile = (uri?: Uri): AbapStat | undefined => {
  try {
    if (!uri) return
    
    // Only process adt:// URIs - reject output, file, etc.
    if (uri.scheme !== 'adt') {
      return undefined;
    }
    
    const root = uriRoot(uri)
    const file = root.getNode(uri.path)
    if (isAbapStat(file)) return file
  } catch (error) {
    // Log the actual error instead of swallowing it with stack trace
    throw error; // Re-throw so caller can handle it
  }
}

export const pathSequence = (root: Root, uri: Uri | undefined): FileStat[] => {
  if (uri)
    try {
      const parts = uri.path.split("/")
      let path = ""
      const nodes: FileStat[] = []
      for (const part of parts) {
        const sep = path.substr(-1) === "/" ? "" : "/"
        path = `${path}${sep}${part}`
        const hit = root.getNode(path)
        if (!hit) log(`Incomplete path hierarchy for ${uri.path}`)
        else nodes.unshift(hit)
      }
      return nodes
    } catch (e) {
      // ignore
    }
  return []
}
